-- ============================================================================
--  Migration 008 — let signed-in staff read clusters
--
--  Symptom: the admin map is empty while the public map is full.
--
--  Cause: signing in switches the PostgREST role from `anon` to
--  `authenticated`. The only select policy on `clusters` named `anon`, so an
--  authenticated admin matched no policy and got zero rows — no error, just an
--  empty list, which looks exactly like an empty database.
--
--  The public site never hit this because it reads `public_map`, and a view
--  runs with its owner's rights by default, bypassing RLS on the table beneath.
--
--  Safe to run repeatedly.
-- ============================================================================

set search_path = public, extensions;

-- Staff read everything, including repaired defects, which the public view
-- hides. Non-staff signed-in users see exactly what anonymous visitors see —
-- being logged in should never reveal less, nor more.
drop policy if exists clusters_read_authed on clusters;
create policy clusters_read_authed on clusters for select to authenticated
  using (is_admin() or confidence >= 0.15);

-- observation_clusters is read by the analytics views. Those run as definer and
-- would work anyway, but leaving a table with RLS on and no policy at all is a
-- trap for the next query written against it.
drop policy if exists obs_clusters_admin_read on observation_clusters;
create policy obs_clusters_admin_read on observation_clusters for select to authenticated
  using (is_admin());

grant select on observation_clusters to authenticated;

-- ---------------------------------------------------------------- audit
--  Every table an admin screen touches, and whether a policy covers the role
--  it will actually be using. A blank `roles` column here is the bug above.
select
  c.relname                                   as table_name,
  p.polname                                   as policy,
  case p.polcmd when 'r' then 'SELECT' when 'w' then 'UPDATE'
                when 'a' then 'INSERT' when 'd' then 'DELETE' else 'ALL' end as cmd,
  array(select rolname from pg_roles where oid = any(p.polroles)) as roles
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('clusters','observations','rides','repairs',
                    'observation_clusters','accel_feedback','admins')
order by c.relname, cmd;

-- Expect at least one SELECT policy naming `authenticated` for every table.
