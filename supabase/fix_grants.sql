-- ============================================================================
--  Run this if the app reports "permission denied for table ..."
--
--  Safe to run repeatedly, and safe to run on a database that already has the
--  full schema — it only touches privileges, never data.
--
--  Two causes are covered:
--    1. schema.sql was applied from a revision that predated the GRANT block.
--    2. UPDATE was granted without SELECT. PostgreSQL requires SELECT on every
--       column a statement reads, and `update ... where id = $1` reads id.
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant insert on rides, observations, accel_feedback to anon, authenticated;
grant update on rides, observations                 to anon, authenticated;

-- See schema.sql for why SELECT here does not leak anything: there is no select
-- POLICY on these tables, so RLS returns zero rows to a real read. The grant
-- exists solely so that UPDATE ... WHERE can resolve its filter column.
grant select on rides, observations to anon, authenticated;

grant select on clusters   to anon, authenticated;
grant select on public_map to anon, authenticated;

-- Sequences are not used (all keys are uuids), but future tables might be.
grant usage on all sequences in schema public to anon, authenticated;

-- ---------------------------------------------------------------- diagnostics
select 'GRANTS' as check, table_name, string_agg(privilege_type, ', ' order by privilege_type) as granted
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
group by table_name
order by table_name;

select 'POLICIES' as check, tablename, policyname, cmd, roles::text
from pg_policies where schemaname = 'public'
order by tablename, cmd;

-- Expected:
--   rides           INSERT, SELECT, UPDATE
--   observations    INSERT, SELECT, UPDATE
--   accel_feedback  INSERT
--   clusters        SELECT
-- and NO select policy on rides or observations — that absence is what keeps
-- ride traces unreadable.
