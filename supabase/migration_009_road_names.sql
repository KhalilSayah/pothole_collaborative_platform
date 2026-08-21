-- ============================================================================
--  Migration 009 — name the streets
--
--  Two separate problems produced "(rue non nommée)" everywhere:
--
--  1. Nothing ever wrote clusters.road_name. The column existed, the view
--     selected it, refresh_cluster never set it. Even a perfectly named road
--     came out blank.
--
--  2. OpenStreetMap coverage in Tlemcen is thin: 7% of ways carry a name, and
--     only 4% of residential streets. No API can fix that — Nominatim and the
--     rest are derived from the same OSM data.
--
--  So the label falls back through a hierarchy instead of giving up. A crew
--  needs something they can drive to; "rue sans nom (Mansourah)" is actionable,
--  "(rue non nommée)" is not.
--
--  Run data_tlemcen_roads.sql FIRST — it loads the network this depends on.
-- ============================================================================

set search_path = public, extensions;

grant select on osm_roads, osm_places to anon, authenticated, service_role;

-- Only 11% of positions land on a road OSM has actually named; the rest get a
-- description. Recording which is which lets the UI say so honestly and lets
-- the "worst streets" ranking prefer real names over proximity labels.
alter table clusters add column if not exists road_exact boolean default false;

-- ---------------------------------------------------------------- resolver
--  Returns the best available label plus the road class, which the priority
--  score needs and which is present far more often than a name.
create or replace function resolve_road(p_lat double precision, p_lon double precision)
returns table (label text, road_type text, exact boolean)
language sql
stable
as $$
with pt as (select st_makepoint(p_lon, p_lat)::geography as g),
-- The road the defect actually sits on. 30 m absorbs GPS error without
-- reaching across a block to a parallel street.
nearest as (
  select r.name, r.ref, r.highway, st_distance(r.geom, pt.g) as d
  from osm_roads r, pt
  where st_dwithin(r.geom, pt.g, 30)
  order by st_distance(r.geom, pt.g)
  limit 1
),
-- The closest road that HAS a name, used only to describe an unnamed one.
-- 250 m: past that the reference stops helping anyone find the place.
named as (
  select coalesce(r.name, r.ref) as nm, st_distance(r.geom, pt.g) as d
  from osm_roads r, pt
  where (r.name is not null or r.ref is not null)
    and st_dwithin(r.geom, pt.g, 250)
  order by st_distance(r.geom, pt.g)
  limit 1
),
-- Neighbourhood. Places are sparse points, so the radius is generous.
place as (
  select p.name as nm from osm_places p, pt
  where st_dwithin(p.geom, pt.g, 1500)
  order by st_distance(p.geom, pt.g)
  limit 1
)
select
  case
    -- 1. the road itself is named
    when (select coalesce(name, ref) from nearest) is not null
      then (select coalesce(name, ref) from nearest)
    -- 2. unnamed, but we can place it: nearest named road + neighbourhood
    when (select nm from named) is not null and (select nm from place) is not null
      then 'Près de ' || (select nm from named) || ' — ' || (select nm from place)
    when (select nm from named) is not null
      then 'Près de ' || (select nm from named)
    -- 3. only the neighbourhood is known
    when (select nm from place) is not null
      then 'Quartier ' || (select nm from place)
    else null
  end,
  (select highway from nearest),
  -- Callers need to know whether this is the street's real name or a
  -- description, so a UI can style it differently and analytics can exclude
  -- approximations from a "worst streets" ranking if it wants to.
  (select coalesce(name, ref) from nearest) is not null
$$;

-- ---------------------------------------------------------------- wire it in
create or replace function refresh_cluster(p_cluster_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rides int; v_methods int; v_obs int; v_conf double precision;
  v_lat double precision; v_lon double precision;
  v_label text; v_type text;
begin
  update clusters c set
    lat = s.lat, lon = s.lon,
    n_observations = s.n_obs, n_rides = s.n_rides, n_methods = s.n_methods,
    method_mix = s.methods,
    severity = s.severity,
    damage_type = s.damage_type,
    image_path = s.image_path,
    first_seen = s.first_seen, last_seen = s.last_seen,
    updated_at = now()
  from (
    select
      sum(coalesce(o.corrected_lat, o.lat) * w) / sum(w) as lat,
      sum(coalesce(o.corrected_lon, o.lon) * w) / sum(w) as lon,
      count(*) as n_obs,
      count(distinct o.ride_id) as n_rides,
      count(distinct o.method) as n_methods,
      array_agg(distinct o.method::text) as methods,
      max(o.severity) as severity,
      (array_agg(o.damage_type order by
         case o.method when 'manual' then 3 when 'camera' then 2 else 1 end desc)
       filter (where o.damage_type is not null))[1] as damage_type,
      (array_agg(o.image_path order by
         case o.method when 'photo' then 2 when 'camera' then 1 else 0 end desc,
         o.confidence desc nulls last)
       filter (where o.image_path is not null
                 and o.verification_status = 'verified'))[1] as image_path,
      min(o.observed_at) as first_seen,
      max(o.observed_at) as last_seen
    from observation_clusters oc
    join observations o on o.id = oc.observation_id
    cross join lateral (select 1.0 / greatest(coalesce(o.gps_accuracy_m, 15), 3) as w) wq
    where oc.cluster_id = p_cluster_id
  ) s
  where c.id = p_cluster_id;

  -- Name it from the position we just recomputed, not the one it arrived with.
  select lat, lon into v_lat, v_lon from clusters where id = p_cluster_id;
  declare v_exact boolean;
  begin
    select label, road_type, exact into v_label, v_type, v_exact
    from resolve_road(v_lat, v_lon);
    update clusters
       set road_name = v_label, road_type = v_type, road_exact = coalesce(v_exact, false)
     where id = p_cluster_id;
  end;

  select n_rides, n_methods, n_observations into v_rides, v_methods, v_obs
  from clusters where id = p_cluster_id;

  v_conf := least(1.0,
      0.35 * least(v_rides, 4) / 4.0
    + 0.40 * least(v_methods, 3) / 3.0
    + 0.25 * least(v_obs, 8) / 8.0);

  update clusters set
    confidence = v_conf,
    status = case when repaired_at is not null then 'repaired'
                  when v_rides >= 2 or v_methods >= 2 then 'confirmed'
                  else 'candidate' end
  where id = p_cluster_id;
end;
$$;

-- ---------------------------------------------------------------- backfill
do $$
declare r record;
begin
  for r in select id from clusters loop
    perform refresh_cluster(r.id);
  end loop;
end $$;

drop view if exists public_map;
create view public_map as
select id, lat, lon, road_name, road_type, road_exact, severity, damage_type,
       confidence, n_observations, n_rides, method_mix, status, image_path,
       first_seen, last_seen
from clusters
where confidence >= 0.15;

grant select on public_map to anon, authenticated, service_role;

-- Worst streets: group approximations under the named road they reference, so
-- a corridor is not split across a dozen "Près de X — quartier Y" variants.
create or replace view admin_roads as
select
  coalesce(
    nullif(split_part(replace(road_name, 'Près de ', ''), ' — ', 1), ''),
    'Secteur non identifié')                      as road,
  road_type,
  bool_or(road_exact)                             as has_exact_name,
  count(*)                                        as total,
  count(*) filter (where repaired_at is null)     as open,
  count(*) filter (where severity = 'high' and repaired_at is null) as high_open,
  round(avg(priority)::numeric, 1)                as avg_priority,
  max(priority)                                   as top_priority,
  min(first_seen)                                 as since
from clusters
group by 1, 2
having count(*) filter (where repaired_at is null) > 0
order by high_open desc, avg_priority desc nulls last;

grant select on admin_roads to authenticated;

select refresh_priorities() as priorities_recomputed;

-- ---------------------------------------------------------------- check
select
  count(*)                                                as clusters,
  count(road_name)                                        as avec_label,
  count(*) filter (where road_name like 'Près de%')       as par_proximite,
  count(*) filter (where road_name like 'Quartier%')      as par_quartier,
  count(*) filter (where road_name is null)               as sans_rien
from clusters;
