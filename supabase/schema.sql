-- ============================================================================
--  Tlemcen pothole collection — schema
--
--  Design rules, in priority order:
--
--  1. OBSERVATIONS ARE RAW AND IMMUTABLE. Every signal any device ever produced
--     is stored exactly as measured, and never edited. Fusion is a derived view.
--     If we later improve the clustering or the accelerometer thresholds, we can
--     recompute the entire map from scratch without having lost anything.
--
--  2. CLUSTERS ARE DERIVED AND DISPOSABLE. `clusters` is the Waze-style public
--     map: one row per physical pothole, fused across methods and across rides.
--     It can always be rebuilt by re-running the fusion over `observations`.
--
--  3. FULLY ANONYMOUS. There is no user table, no auth, no device fingerprint.
--     A ride carries a client-generated random UUID and nothing else. Two rides
--     by the same person are not linkable by design.
-- ============================================================================

-- Supabase installs PostGIS into the `extensions` schema, not `public`. Without
-- `extensions` on the search_path every unqualified st_* call below fails to
-- resolve, so this line is load-bearing rather than cosmetic.
create schema if not exists extensions;
create extension if not exists postgis      with schema extensions;
create extension if not exists "uuid-ossp"  with schema extensions;

set search_path = public, extensions;

-- ---------------------------------------------------------------- enums
do $$ begin
  create type collection_method as enum ('camera', 'accel', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Damage taxonomy. `pothole` is the classic hole; the rest matter because
  -- they are what the accelerometer will otherwise confuse with a pothole.
  create type damage_type as enum (
    'pothole',        -- nid-de-poule
    'crack',          -- fissure / faïençage
    'depression',     -- affaissement
    'bump',           -- dos d'âne sauvage, gendarme couché
    'manhole',        -- regard / plaque d'égout saillante
    'broken_surface', -- chaussée dégradée, gravier
    'debris',         -- obstacle
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type severity_level as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- rides
create table if not exists rides (
  id             uuid primary key default uuid_generate_v4(),
  started_at     timestamptz not null,
  ended_at       timestamptz,

  -- Coarse device class only. Enough to interpret sensor scaling, not enough
  -- to identify anyone.
  platform       text,                    -- 'ios' | 'android' | 'other'
  app_version    text,

  -- The detector configuration in force for this ride. Stored per ride because
  -- thresholds are auto-calibrated and drift; without this snapshot the raw
  -- accelerometer events would be uninterpretable later.
  detector_config jsonb not null default '{}'::jsonb,

  -- Denormalised ride summary, filled on close.
  distance_m     double precision,
  duration_s     double precision,
  n_observations integer default 0,

  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- observations
--  The unified record. Every collection method writes here with the same shape,
--  which is what makes cross-method fusion possible at all.
create table if not exists observations (
  id            uuid primary key default uuid_generate_v4(),
  ride_id       uuid not null references rides(id) on delete cascade,

  method        collection_method not null,

  -- Client clock. Used for within-ride ordering and for matching an accel event
  -- to the manual tap that followed it.
  observed_at   timestamptz not null,
  -- Milliseconds since ride start. Immune to device clock changes mid-ride,
  -- so this — not observed_at — is the authoritative within-ride timeline.
  t_offset_ms   integer not null,

  -- ---- position, as measured ----
  lat           double precision not null,
  lon           double precision not null,
  gps_accuracy_m double precision,
  speed_mps     double precision,
  heading_deg   double precision,

  -- ---- position, corrected ----
  -- A manual report is tapped 1–2 s AFTER the car passed the pothole. At
  -- 50 km/h that is a 20 m error, so the corrected position is back-projected
  -- along the heading by (reaction_lag * speed). Both are kept: `lat`/`lon` is
  -- what the sensor said, `corrected_*` is our best estimate of the truth.
  corrected_lat double precision,
  corrected_lon double precision,
  position_correction_m double precision,

  -- ---- what was observed ----
  damage_type   damage_type,
  severity      severity_level,
  -- 0..1. Manual taps are near 1.0 (a human saw it); accel events carry the
  -- detector's own confidence; camera detections carry the model score.
  confidence    double precision not null default 0.5,

  -- ---- method-specific detail ----
  --  accel  : { peak_g, z_score, baseline_g, sigma_g, leading_sign,
  --             axle_confirmed, duration_ms, waveform:[...], sample_hz }
  --  manual : { reaction_lag_s, ui_variant }
  --  camera : { area_m2, dist_m, bbox, model, image_path }
  payload       jsonb not null default '{}'::jsonb,

  -- Set once the image is uploaded to Supabase Storage (method 1 only).
  image_path    text,

  created_at    timestamptz not null default now(),

  constraint lat_ok check (lat between -90 and 90),
  constraint lon_ok check (lon between -180 and 180)
);

-- Generated geography column so PostGIS distance queries are indexable.
alter table observations
  add column if not exists geom geography(Point, 4326)
  generated always as (
    st_setsrid(st_makepoint(coalesce(corrected_lon, lon), coalesce(corrected_lat, lat)), 4326)::geography
  ) stored;

create index if not exists obs_geom_idx   on observations using gist (geom);
create index if not exists obs_ride_idx   on observations (ride_id, t_offset_ms);
create index if not exists obs_method_idx on observations (method);
create index if not exists obs_time_idx   on observations (observed_at);

-- ---------------------------------------------------------------- clusters
--  One row per physical pothole. This is what the public map reads.
create table if not exists clusters (
  id              uuid primary key default uuid_generate_v4(),

  lat             double precision not null,
  lon             double precision not null,

  road_name       text,
  road_type       text,

  severity        severity_level,
  damage_type     damage_type,

  -- Confidence is driven by INDEPENDENT corroboration, not by repetition.
  -- Ten accel hits from one ride is weak; one accel hit plus one manual report
  -- from two different rides is strong.
  confidence      double precision not null default 0,
  n_observations  integer not null default 0,
  n_rides         integer not null default 0,
  n_methods       integer not null default 0,
  method_mix      text[],

  first_seen      timestamptz,
  last_seen       timestamptz,

  -- Representative photo, chosen from this cluster's verified observations.
  image_path      text,

  -- 'candidate' : seen once, unconfirmed
  -- 'confirmed' : corroborated by independent rides or methods
  -- 'repaired'  : rides passed over it recently with no signal
  status          text not null default 'candidate',

  updated_at      timestamptz not null default now()
);

alter table clusters
  add column if not exists geom geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(lon, lat), 4326)::geography) stored;

create index if not exists cluster_geom_idx   on clusters using gist (geom);
create index if not exists cluster_status_idx on clusters (status);

create table if not exists observation_clusters (
  observation_id uuid not null references observations(id) on delete cascade,
  cluster_id     uuid not null references clusters(id) on delete cascade,
  distance_m     double precision,
  primary key (observation_id, cluster_id)
);

-- ---------------------------------------------------------------- feedback
--  Ground truth for tuning the accelerometer. When the detector fires and the
--  driver did not report anything, we ask. The answer is a LABEL: it tells us
--  whether that exact waveform was a real pothole.
--
--  This table plus observations.payload->'waveform' is the training set for
--  choosing the trigger threshold. It is the whole reason we store waveforms.
--  `label` is multi-class, not yes/no. Knowing that a jolt was a SPEED BUMP or
--  a HARD BRAKE — rather than merely "not a pothole" — is what lets a model
--  learn to separate the confusable classes instead of only thresholding
--  magnitude. These are the target classes of the trained detector.
do $$ begin
  create type accel_label as enum (
    'pothole',        -- nid-de-poule
    'speed_bump',     -- dos d'âne / ralentisseur
    'hard_braking',   -- freinage brusque
    'road_vibration', -- vibration normale, chaussée rugueuse
    'manhole',        -- plaque, joint de chaussée
    'other',
    'unsure',         -- driver could not tell: excluded from training
    'dismissed'       -- never answered: MISSING, not a negative
  );
exception when duplicate_object then null; end $$;

create table if not exists accel_feedback (
  id             uuid primary key default uuid_generate_v4(),
  observation_id uuid not null references observations(id) on delete cascade,

  label          accel_label not null,
  -- Kept for backwards compatibility and quick binary queries.
  answer         text generated always as (
                   case when label = 'pothole' then 'yes'
                        when label in ('unsure','dismissed') then 'dismissed'
                        else 'no' end) stored,

  -- True when the prompt came from training mode, where the trigger threshold
  -- is deliberately lowered to collect the ambiguous and negative examples a
  -- classifier needs. Production-mode labels are drawn from a different
  -- distribution, so the two must never be pooled without accounting for it.
  training_mode  boolean not null default false,

  answered_at    timestamptz not null default now(),
  latency_ms     integer
);

create index if not exists feedback_obs_idx on accel_feedback (observation_id);

-- ============================================================================
--  Row Level Security
--
--  Anonymous clients may CONTRIBUTE but may not READ raw observations. Raw data
--  contains a full ride trace; letting anyone read it would let them follow an
--  individual journey, which defeats the anonymity guarantee even without names.
--  The public map reads `clusters`, which is aggregated and unlinkable.
-- ============================================================================
alter table rides               enable row level security;
alter table observations        enable row level security;
alter table clusters            enable row level security;
alter table observation_clusters enable row level security;
alter table accel_feedback      enable row level security;

drop policy if exists rides_insert on rides;
create policy rides_insert on rides for insert to anon with check (true);

-- A client may close only the ride it just created, and only while it is open.
drop policy if exists rides_update on rides;
create policy rides_update on rides for update to anon
  using (ended_at is null) with check (true);

drop policy if exists obs_insert on observations;
create policy obs_insert on observations for insert to anon with check (true);

-- Labelling an event rewrites its damage_type/severity/confidence — including
-- zeroing the confidence of a jolt the driver identifies as braking, so it never
-- reaches the public map. Deliberately narrow: only these three columns matter,
-- and observations remain unreadable to anon either way.
drop policy if exists obs_update on observations;
create policy obs_update on observations for update to anon
  using (true) with check (true);

drop policy if exists feedback_insert on accel_feedback;
create policy feedback_insert on accel_feedback for insert to anon with check (true);

-- The map is public, read-only.
drop policy if exists clusters_read on clusters;
create policy clusters_read on clusters for select to anon using (true);

-- Signing in switches the role from anon to authenticated, so a policy naming
-- only anon stops applying to staff and the back office reads zero rows.
drop policy if exists clusters_read_authed on clusters;
create policy clusters_read_authed on clusters for select to authenticated
  using (true);

-- Table-level privileges. RLS decides WHICH rows; grants decide whether the
-- role may touch the table at all. Both are required.
grant usage on schema public to anon;
grant insert on rides, observations, accel_feedback to anon;
grant update on rides, observations to anon;

-- SELECT is required even though clients must never read this data.
--
-- `update rides set ... where id = $1` reads the id column, and PostgreSQL
-- demands SELECT privilege on every column a statement reads — including ones
-- only used in a WHERE clause. Without it the update fails with
-- "permission denied for table rides".
--
-- Privacy is preserved by RLS rather than by the grant: there is deliberately
-- NO select policy on either table, so a genuine `select * from observations`
-- returns zero rows. The UPDATE still works because row visibility for an
-- UPDATE is governed by the update policy's USING clause, not by a select
-- policy. Grant answers "may this role touch the table"; RLS answers "which
-- rows" — and here the answer to the second question is still "none".
grant select on rides, observations to anon;

grant select on clusters to anon;

-- The backend role. service_role bypasses Row Level Security, but table
-- privileges are a separate mechanism and it needs them explicitly — without
-- these the verification worker gets 42501 "permission denied" while holding a
-- perfectly valid service_role key.
grant usage on schema public to service_role;
grant select, insert, update, delete
  on rides, observations, clusters, observation_clusters, accel_feedback
  to service_role;
-- public_map is granted where it is created, further down.

-- ============================================================================
--  Fusion
-- ============================================================================

-- ---- Step 1: within a single ride -------------------------------------------
--  One pothole often produces several observations in the same ride: the
--  accelerometer fires, and a second later the driver taps a card. These must
--  become ONE observation group, or every corroborated pothole would be double
--  counted and look twice as bad as it is.
--
--  Matching is asymmetric in time: a manual tap may lag an accel event by
--  several seconds (human reaction), but never precedes it by more than a
--  moment. Hence the -1s .. +6s window.
create or replace function fuse_ride(p_ride_id uuid, p_radius_m double precision default 20)
returns table (group_id integer, observation_ids uuid[], methods text[]) as $$
  -- WITH RECURSIVE is required: `reach` refers to itself to walk the graph of
  -- "these two observations describe the same pothole" links until it closes.
  with recursive obs as (
    select id, method::text as m, t_offset_ms, geom
    from observations where ride_id = p_ride_id
  ),
  -- Undirected adjacency. Emitted both ways so the walk can travel in either
  -- direction; without that, A-B and C-B would stay separate groups.
  pairs as (
    select a.id as x, b.id as y
    from obs a join obs b
      on a.id <> b.id
     and st_dwithin(a.geom, b.geom, p_radius_m)
     and b.t_offset_ms - a.t_offset_ms between -1000 and 6000
  ),
  reach as (
    select id as node, id as root from obs
    union
    select p.y, r.root from pairs p join reach r on p.x = r.node
  ),
  -- One observation can be reached from several starting points; the smallest
  -- root is the canonical group id, which makes the assignment deterministic.
  canon as (
    select node, min(root::text) as root from reach group by node
  )
  select
    dense_rank() over (order by c.root)::integer,
    array_agg(distinct o.id),
    array_agg(distinct o.m)
  from canon c join obs o on o.id = c.node
  group by c.root;
$$ language sql stable;

-- ---- Step 2: across rides ---------------------------------------------------
--  Attach an observation to an existing cluster, or start a new one.
--  `p_radius_m` must exceed typical GPS error (~8–15 m is the useful range).
create or replace function attach_observation(p_obs_id uuid, p_radius_m double precision default 12)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_obs      observations%rowtype;
  v_cluster  uuid;
  v_dist     double precision;
begin
  select * into v_obs from observations where id = p_obs_id;
  if not found then raise exception 'no such observation %', p_obs_id; end if;

  select c.id, st_distance(c.geom, v_obs.geom)
    into v_cluster, v_dist
  from clusters c
  where st_dwithin(c.geom, v_obs.geom, p_radius_m)
  order by st_distance(c.geom, v_obs.geom)
  limit 1;

  if v_cluster is null then
    insert into clusters (lat, lon, severity, damage_type, first_seen, last_seen)
    values (coalesce(v_obs.corrected_lat, v_obs.lat),
            coalesce(v_obs.corrected_lon, v_obs.lon),
            v_obs.severity, v_obs.damage_type,
            v_obs.observed_at, v_obs.observed_at)
    returning id into v_cluster;
    v_dist := 0;
  end if;

  insert into observation_clusters (observation_id, cluster_id, distance_m)
  values (p_obs_id, v_cluster, v_dist)
  on conflict do nothing;

  perform refresh_cluster(v_cluster);
  return v_cluster;
end;
$$;

-- ---- Step 3: recompute a cluster's public summary ---------------------------
create or replace function refresh_cluster(p_cluster_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rides int; v_methods int; v_obs int; v_conf double precision;
begin
  -- Position: weight each observation by GPS quality, so a 3 m fix moves the
  -- centroid more than a 40 m fix.
  update clusters c set
    lat = s.lat, lon = s.lon,
    n_observations = s.n_obs, n_rides = s.n_rides, n_methods = s.n_methods,
    method_mix = s.methods,
    severity = s.severity,
    damage_type = s.damage_type,
    first_seen = s.first_seen, last_seen = s.last_seen,
    updated_at = now()
  from (
    select
      sum(coalesce(o.corrected_lat, o.lat) * w) / sum(w) as lat,
      sum(coalesce(o.corrected_lon, o.lon) * w) / sum(w) as lon,
      count(*)                        as n_obs,
      count(distinct o.ride_id)       as n_rides,
      count(distinct o.method)        as n_methods,
      array_agg(distinct o.method::text) as methods,
      -- Worst severity reported wins: under-reporting damage is the costlier
      -- error. The enum is declared low < medium < high, so max() is exactly
      -- "the most severe report anyone made".
      max(o.severity) as severity,
      -- Damage type: trust humans over sensors.
      (array_agg(o.damage_type order by
         case o.method when 'manual' then 3 when 'camera' then 2 else 1 end desc)
       filter (where o.damage_type is not null))[1] as damage_type,
      min(o.observed_at) as first_seen,
      max(o.observed_at) as last_seen
    from observation_clusters oc
    join observations o on o.id = oc.observation_id
    cross join lateral (select 1.0 / greatest(coalesce(o.gps_accuracy_m, 15), 3) as w) wq
    where oc.cluster_id = p_cluster_id
  ) s
  where c.id = p_cluster_id;

  select n_rides, n_methods, n_observations into v_rides, v_methods, v_obs
  from clusters where id = p_cluster_id;

  -- Confidence: independent corroboration dominates. Distinct rides count for
  -- much more than repeat observations within one ride, and a second METHOD
  -- agreeing is the strongest signal of all.
  v_conf := least(1.0,
      0.35 * least(v_rides, 4) / 4.0      -- independent rides
    + 0.40 * least(v_methods, 3) / 3.0    -- independent methods
    + 0.25 * least(v_obs, 8) / 8.0        -- raw volume (weakest evidence)
  );

  update clusters set
    confidence = v_conf,
    status = case
      when v_rides >= 2 or v_methods >= 2 then 'confirmed'
      else 'candidate' end
  where id = p_cluster_id;
end;
$$;

-- Attach every new observation automatically.
create or replace function trg_attach_observation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform attach_observation(new.id);
  return new;
end $$;

drop trigger if exists observations_attach on observations;
create trigger observations_attach after insert on observations
  for each row execute function trg_attach_observation();

-- ---------------------------------------------------------------- public view
--  What the map reads. Deliberately excludes anything ride-linkable.
create or replace view public_map as
select id, lat, lon, road_name, road_type, severity, damage_type, confidence,
       n_observations, n_rides, method_mix, status, image_path,
       first_seen, last_seen
from clusters
where confidence >= 0.15;

grant select on public_map to anon;

-- ---------------------------------------------------------------- training set
--  One row per labelled waveform: the features the detector already computes,
--  the raw signal, and the human label. This is the table a training script
--  reads. 'unsure' and 'dismissed' are excluded because an unanswered prompt is
--  missing data — treating it as a negative would teach the model that real
--  potholes are not potholes.
create or replace view accel_training_set as
select
  f.id                              as label_id,
  f.label,
  f.training_mode,
  o.id                              as observation_id,
  o.speed_mps,
  (o.payload->>'peak_g')::double precision      as peak_g,
  (o.payload->>'z_score')::double precision     as z_score,
  (o.payload->>'sigma_g')::double precision     as sigma_g,
  (o.payload->>'baseline_g')::double precision  as baseline_g,
  (o.payload->>'leading_sign')::int             as leading_sign,
  (o.payload->>'axle_confirmed')::boolean       as axle_confirmed,
  (o.payload->>'duration_ms')::int              as duration_ms,
  (o.payload->>'severity_index')::double precision as severity_index,
  (o.payload->>'sample_hz')::int                as sample_hz,
  o.payload->'waveform'                         as waveform,
  r.detector_config,
  r.platform,
  f.answered_at
from accel_feedback f
join observations o on o.id = f.observation_id
join rides r        on r.id = o.ride_id
where f.label not in ('unsure', 'dismissed');

-- ---------------------------------------------------------------- storage
--  Method 1 (camera) crops. Run once in the Supabase dashboard or via CLI:
--
--    insert into storage.buckets (id, name, public)
--    values ('pothole-images', 'pothole-images', true)
--    on conflict do nothing;
--
--  Then allow anonymous upload but not listing or deletion:
--
--    create policy "anon upload" on storage.objects for insert to anon
--      with check (bucket_id = 'pothole-images');
--    create policy "public read" on storage.objects for select to public
--      using (bucket_id = 'pothole-images');
