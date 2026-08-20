-- ============================================================================
--  Migration 006 — expose a photo on the public map
--
--  A cluster aggregates several observations, so "the photo" has to be chosen
--  rather than simply joined. Preference order:
--    1. a pedestrian photo — framed deliberately by a person who stopped
--    2. a dashcam crop     — automatic, often motion-blurred
--    3. highest confidence within whichever kind won
--
--  Only verified observations are eligible, so a pending or rejected report can
--  never surface an image on the public map.
--
--  Safe to run repeatedly.
-- ============================================================================

set search_path = public, extensions;

alter table clusters add column if not exists image_path text;

create or replace function refresh_cluster(p_cluster_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rides int; v_methods int; v_obs int; v_conf double precision;
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
      count(*)                        as n_obs,
      count(distinct o.ride_id)       as n_rides,
      count(distinct o.method)        as n_methods,
      array_agg(distinct o.method::text) as methods,
      max(o.severity) as severity,
      (array_agg(o.damage_type order by
         case o.method when 'manual' then 3 when 'camera' then 2 else 1 end desc)
       filter (where o.damage_type is not null))[1] as damage_type,
      -- The representative image for this pothole.
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

  select n_rides, n_methods, n_observations into v_rides, v_methods, v_obs
  from clusters where id = p_cluster_id;

  v_conf := least(1.0,
      0.35 * least(v_rides, 4) / 4.0
    + 0.40 * least(v_methods, 3) / 3.0
    + 0.25 * least(v_obs, 8) / 8.0
  );

  update clusters set
    confidence = v_conf,
    status = case
      when v_rides >= 2 or v_methods >= 2 then 'confirmed'
      else 'candidate' end
  where id = p_cluster_id;
end;
$$;

-- Republish the view with the image and the fields the focus card shows.
--
-- Dropped rather than replaced: CREATE OR REPLACE VIEW can only append columns
-- at the end, and this version inserts road_type mid-list, which fails with
-- 42P16. Grants are lost with the view, so they are reapplied below.
drop view if exists public_map;

create view public_map as
select id, lat, lon, road_name, road_type, severity, damage_type, confidence,
       n_observations, n_rides, method_mix, status, image_path,
       first_seen, last_seen
from clusters
where confidence >= 0.15;

grant select on public_map to anon;
grant select on public_map to service_role;

-- Backfill every existing cluster so photos already verified show up.
do $$
declare r record;
begin
  for r in select id from clusters loop
    perform refresh_cluster(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------- check
select id, damage_type::text, severity::text,
       image_path is not null as has_photo,
       round(confidence::numeric, 2) as confidence
from public_map
order by last_seen desc
limit 10;
