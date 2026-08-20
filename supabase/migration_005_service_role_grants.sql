-- ============================================================================
--  Migration 005 — grant the backend role access
--
--  Symptom: verify_worker.py fails with
--      HTTP 403 {"code":"42501","message":"permission denied for table observations"}
--  even though the key decodes as service_role.
--
--  Cause: service_role bypasses Row Level Security, but NOT table privileges.
--  Those are two separate mechanisms and both must allow the operation. Every
--  grant written so far named only `anon`, so the backend role could reach the
--  API but not the tables behind it.
--
--  Safe to run repeatedly.
-- ============================================================================

set search_path = public, extensions;

grant usage on schema public to service_role;

-- The worker reads pending reports and writes verdicts back. The rest is for
-- moderation queries and the training-set export.
grant select, insert, update, delete
  on rides, observations, clusters, observation_clusters, accel_feedback
  to service_role;

grant select on public_map          to service_role;
grant select on pending_reports     to service_role;
grant select on accel_training_set  to service_role;

grant usage, select on all sequences in schema public to service_role;

-- Anything added later inherits the same access, so a new table does not
-- silently lock the backend out again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- ---------------------------------------------------------------- check
select table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as granted
from information_schema.role_table_grants
where grantee = 'service_role'
  and table_schema = 'public'
  and table_name in ('observations', 'rides', 'clusters',
                     'observation_clusters', 'accel_feedback')
group by table_name
order by table_name;

-- Expect DELETE, INSERT, SELECT, UPDATE on all five.
