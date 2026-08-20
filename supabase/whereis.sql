-- ============================================================================
--  "Où est passé mon signalement ?" — one query per possible answer.
--  Read only. Run the whole file.
-- ============================================================================

set search_path = public, extensions;

-- 1. Did it arrive at all?
select 'observations' as step, count(*) as total,
       count(*) filter (where method = 'photo') as photo_reports
from observations;

-- 2. What state is each one in?
select 'by status' as step, method::text, verification_status::text, count(*)
from observations
group by 1, 2, 3
order by 2, 3;

-- 3. The most recent photo reports, in detail.
select 'latest photos' as step,
       id, verification_status::text, damage_type::text, severity::text,
       image_path is not null as has_photo,
       verification->>'reason' as why,
       created_at
from observations
where method = 'photo'
order by created_at desc
limit 10;

-- 4. Did any of them reach a cluster? (verified rows only ever get here)
select 'clusters' as step, c.id, c.status, round(c.confidence::numeric,3) as confidence,
       c.n_observations, c.n_rides, c.method_mix
from clusters c
join observation_clusters oc on oc.cluster_id = c.id
join observations o on o.id = oc.observation_id
where o.method = 'photo'
order by c.updated_at desc
limit 10;

-- 5. Is it on the public map? public_map hides confidence < 0.15.
select 'public_map' as step, count(*) as visible from public_map;

-- ---------------------------------------------------------------------------
-- Reading the result:
--   step 1 total = 0            -> nothing was ever inserted. The app queued it
--                                  locally but the server refused; check the
--                                  report screen, it now shows the server error.
--   step 2 shows 'verified'     -> already approved (moderate.sql block 4 runs
--                                  a bulk approve unless you commented it out).
--   step 4 empty but 2 verified -> the attach trigger did not fire; re-run
--                                  migration_002.
--   step 5 = 0 but 4 non-empty  -> cluster exists below the 0.15 threshold.
-- ---------------------------------------------------------------------------
