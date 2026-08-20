-- ============================================================================
--  Moderation helpers — inspect and approve pending photo reports.
--
--  Photo reports do not appear on the map immediately. They land as `pending`
--  and are excluded from clustering until something verifies them, so that a
--  single anonymous visitor cannot publish invented potholes at will.
--
--  Run the blocks below one at a time.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- 1. is it there?
--  Distinguishes "the gate is holding it" from "the insert never happened".
select
  id,
  method,
  verification_status,
  damage_type,
  severity,
  round(lat::numeric, 5) as lat,
  round(lon::numeric, 5) as lon,
  image_path is not null as has_photo,
  note,
  observed_at
from observations
order by created_at desc
limit 20;

-- ---------------------------------------------------------------- 2. what is waiting
select count(*) filter (where verification_status = 'pending')  as pending,
       count(*) filter (where verification_status = 'verified')  as verified,
       count(*) filter (where verification_status = 'rejected')  as rejected,
       count(*) filter (where verification_status = 'review')    as needs_review
from observations;

-- ---------------------------------------------------------------- 3. approve one
--  Replace the id. The update trigger attaches it to a cluster, which is what
--  puts it on the public map.
--
-- update observations
--    set verification_status = 'verified',
--        verified_at = now(),
--        verification = '{"reason":"approved_manually"}'::jsonb
--  where id = 'PASTE-THE-ID-HERE';

-- ---------------------------------------------------------------- 4. approve everything pending
--  Commented out deliberately: running this file whole would otherwise approve
--  every pending report in one go, which empties the queue the worker is meant
--  to process and defeats the point of the gate. Uncomment only to unblock your
--  own test reports.
--
-- update observations
--    set verification_status = 'verified',
--        verified_at = now(),
--        verification = '{"reason":"bulk_approved_for_testing"}'::jsonb
--  where verification_status = 'pending';

-- ---------------------------------------------------------------- 5. did it reach the map?
--  public_map hides anything below 0.15 confidence. A single verified report
--  from one ride via one method scores about 0.25, so it should appear.
select id,
       round(lat::numeric, 5) as lat,
       round(lon::numeric, 5) as lon,
       severity,
       damage_type,
       round(confidence::numeric, 3) as confidence,
       n_observations,
       n_rides,
       method_mix,
       status
from public_map
order by last_seen desc
limit 20;

-- If step 4 reported rows updated but this returns nothing, the cluster exists
-- but scored under the threshold — check `select * from clusters` directly.

-- ---------------------------------------------------------------- reject instead
-- update observations
--    set verification_status = 'rejected', verified_at = now()
--  where id = 'PASTE-THE-ID-HERE';
