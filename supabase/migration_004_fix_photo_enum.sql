-- ============================================================================
--  Migration 004 — repair the `photo` enum value
--
--  Symptom: photos land in the storage bucket, but no observation row appears
--  and the verification worker reports "nothing pending".
--
--  Cause: migration_002 wrapped the ALTER TYPE in
--      do $$ begin ... exception when others then null; end $$;
--  which swallows EVERY error, not just "already exists". If the ALTER failed,
--  it failed silently while the rest of the migration carried on creating the
--  columns — so the schema looks correct, but `method = 'photo'` is still an
--  invalid enum value and every pedestrian report is rejected on insert.
--
--  ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds
--  it, so RUN STEP 2 ON ITS OWN before running step 3.
-- ============================================================================

-- ---------------------------------------------------------------- step 1: look
-- What does the enum actually contain right now?
select enumlabel as current_values
from pg_enum
where enumtypid = 'collection_method'::regtype
order by enumsortorder;
-- Expect: camera, accel, manual, photo
-- If `photo` is missing, that is the bug.


-- ---------------------------------------------------------------- step 2: fix
-- Run this statement BY ITSELF (select just this line, then Run).
-- No DO block, no exception handler: if it fails, you will see why.

alter type collection_method add value if not exists 'photo';


-- ---------------------------------------------------------------- step 3: confirm
-- Run after step 2 has committed.
select enumlabel as values_now
from pg_enum
where enumtypid = 'collection_method'::regtype
order by enumsortorder;

-- Confirm the rest of migration_002 is present too.
select column_name
from information_schema.columns
where table_name = 'observations'
  and column_name in ('verification_status', 'verification', 'verified_at', 'note')
order by column_name;
-- Expect all four.

-- And that the insert trigger exists.
select tgname
from pg_trigger
where tgrelid = 'observations'::regtype
  and not tgisinternal
order by tgname;
-- Expect: observations_attach, observations_attach_on_verify,
--         observations_default_verification
