-- ============================================================================
--  Migration 007 — admin back office
--
--  Accounts are created ONLY from the Supabase dashboard (Authentication >
--  Users > Add user). There is no sign-up path in the app: a civic dataset that
--  anyone can grant themselves write access to is not a dataset anyone can act
--  on. Being in auth.users is not enough either — a row in `admins` is what
--  grants access, so revoking is a delete rather than a password reset.
--
--  Safe to run repeatedly.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- who is staff
create table if not exists admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  display_name text,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

-- SECURITY DEFINER so the check itself is not subject to the policies it feeds;
-- a policy that queries an RLS-protected table it also guards recurses.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from admins a where a.user_id = auth.uid());
$$;

drop policy if exists admins_self_read on admins;
create policy admins_self_read on admins for select to authenticated
  using (user_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------- repair state
alter table clusters
  add column if not exists repaired_at   timestamptz,
  add column if not exists repaired_by   uuid references auth.users(id),
  add column if not exists repair_note   text,
  add column if not exists assigned_to   text,
  add column if not exists priority      double precision;

-- Full history rather than just current state: "was this fixed before?" is the
-- question that separates a bad repair from a structural problem, and a single
-- mutable status column cannot answer it.
create table if not exists repairs (
  id          uuid primary key default uuid_generate_v4(),
  cluster_id  uuid not null references clusters(id) on delete cascade,
  action      text not null check (action in ('fixed', 'reopened', 'dismissed', 'assigned', 'note')),
  note        text,
  actor       uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists repairs_cluster_idx on repairs (cluster_id, created_at desc);

alter table repairs enable row level security;

drop policy if exists repairs_admin_all on repairs;
create policy repairs_admin_all on repairs for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------- admin access
drop policy if exists obs_admin_read on observations;
create policy obs_admin_read on observations for select to authenticated
  using (is_admin());

drop policy if exists obs_admin_write on observations;
create policy obs_admin_write on observations for update to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists clusters_admin_write on clusters;
create policy clusters_admin_write on clusters for update to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists rides_admin_read on rides;
create policy rides_admin_read on rides for select to authenticated
  using (is_admin());

drop policy if exists feedback_admin_read on accel_feedback;
create policy feedback_admin_read on accel_feedback for select to authenticated
  using (is_admin());

grant usage on schema public to authenticated;
grant select on rides, observations, accel_feedback, admins to authenticated;
grant select, update on clusters to authenticated;
grant select, insert on repairs to authenticated;

-- ============================================================================
--  Priority — which pothole to send a crew to first.
--
--  Deliberately a transparent formula rather than a model. A maintenance team
--  has to be able to argue with the ranking; a score nobody can explain gets
--  ignored the first time it disagrees with someone's judgement.
--
--    severity   how bad the defect is                        weight 40
--    exposure   how many independent rides met it            weight 25
--    road class a trunk road carries more traffic            weight 20
--    certainty  corroboration across methods                 weight 15
--
--  Age is deliberately NOT a term. Potholes do not become more urgent by being
--  ignored, and adding age would let a trivial defect outrank a dangerous one
--  simply by having waited longer. Age is surfaced separately, as a backlog
--  problem rather than a severity one.
-- ============================================================================
create or replace function compute_priority(p_cluster_id uuid)
returns double precision
language sql
stable
as $$
  select least(100,
      40 * case c.severity when 'high' then 1.0 when 'medium' then 0.55 else 0.2 end
    + 25 * least(c.n_rides, 5) / 5.0
    + 20 * case c.road_type
             when 'motorway' then 1.0 when 'trunk' then 0.9
             when 'primary'  then 0.8 when 'secondary' then 0.6
             when 'tertiary' then 0.45 when 'residential' then 0.3
             else 0.25 end
    + 15 * c.confidence
  )
  from clusters c where c.id = p_cluster_id;
$$;

create or replace function refresh_priorities()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare n integer;
begin
  update clusters c set priority = compute_priority(c.id)
  where c.repaired_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- mark as fixed
create or replace function mark_fixed(p_cluster_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'not authorised';
  end if;

  update clusters
     set status = 'repaired',
         repaired_at = now(),
         repaired_by = auth.uid(),
         repair_note = coalesce(p_note, repair_note),
         priority = 0,
         updated_at = now()
   where id = p_cluster_id;

  insert into repairs (cluster_id, action, note, actor)
  values (p_cluster_id, 'fixed', p_note, auth.uid());
end $$;

create or replace function reopen_cluster(p_cluster_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'not authorised';
  end if;

  update clusters
     set status = case when n_rides >= 2 or n_methods >= 2 then 'confirmed' else 'candidate' end,
         repaired_at = null, repaired_by = null,
         priority = compute_priority(p_cluster_id),
         updated_at = now()
   where id = p_cluster_id;

  insert into repairs (cluster_id, action, note, actor)
  values (p_cluster_id, 'reopened', p_note, auth.uid());
end $$;

-- ============================================================================
--  Analytics views. Admin-only: they are built on raw observations.
-- ============================================================================

-- Daily arrivals vs repairs, the two flows that decide whether the backlog
-- grows or shrinks.
create or replace view admin_flow_daily as
with days as (
  select generate_series(
    (current_date - interval '89 days')::date, current_date, interval '1 day')::date as d
),
arrived as (
  select first_seen::date as d, count(*) n from clusters
  where first_seen >= current_date - interval '89 days' group by 1
),
fixed as (
  select repaired_at::date as d, count(*) n from clusters
  where repaired_at >= current_date - interval '89 days' group by 1
)
select days.d as day,
       coalesce(arrived.n, 0) as reported,
       coalesce(fixed.n, 0)   as repaired
from days
left join arrived on arrived.d = days.d
left join fixed   on fixed.d   = days.d
order by days.d;

-- How long open reports have been waiting. Buckets, not an average: an average
-- age hides the tail, and the tail is the part that embarrasses a council.
create or replace view admin_aging as
select
  case
    when age_days <  7  then '0-7 j'
    when age_days <  30 then '7-30 j'
    when age_days <  90 then '30-90 j'
    else '90+ j'
  end as bucket,
  case
    when age_days <  7  then 1 when age_days <  30 then 2
    when age_days <  90 then 3 else 4
  end as ord,
  count(*) as n,
  count(*) filter (where severity = 'high') as high
from (
  select id, severity, extract(day from now() - first_seen)::int as age_days
  from clusters where repaired_at is null
) s
group by 1, 2
order by 2;

-- Damage by street. Repairing a corridor in one pass costs far less per m2 than
-- returning to individual holes, so the road is the unit a crew plans around.
create or replace view admin_roads as
select
  coalesce(road_name, '(rue non nommée)') as road,
  road_type,
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

-- Defects that got worse between the first and the latest sighting. This is the
-- closest thing to a real prediction the data supports: something already
-- observed to be deteriorating is the best candidate for failing next.
create or replace view admin_deteriorating as
with obs_rank as (
  select oc.cluster_id, o.severity, o.observed_at,
         row_number() over (partition by oc.cluster_id order by o.observed_at)      as first_r,
         row_number() over (partition by oc.cluster_id order by o.observed_at desc) as last_r
  from observation_clusters oc
  join observations o on o.id = oc.observation_id
  where o.severity is not null
)
select c.id, c.lat, c.lon, c.road_name, c.severity, c.priority,
       f.severity as first_severity, l.severity as latest_severity,
       f.observed_at as first_at, l.observed_at as latest_at,
       extract(day from l.observed_at - f.observed_at)::int as days_span
from clusters c
join obs_rank f on f.cluster_id = c.id and f.first_r = 1
join obs_rank l on l.cluster_id = c.id and l.last_r  = 1
where c.repaired_at is null
  and l.severity > f.severity
order by c.priority desc nulls last;

-- Repaired, then reported again. Either the repair failed or the road is
-- structurally bad underneath — both are worth knowing before paying twice.
create or replace view admin_recurrence as
select c.id, c.road_name, c.severity, c.repaired_at,
       count(o.id) filter (where o.observed_at > c.repaired_at) as sightings_since_repair,
       max(o.observed_at) as last_seen_after
from clusters c
join observation_clusters oc on oc.cluster_id = c.id
join observations o on o.id = oc.observation_id
where c.repaired_at is not null
group by c.id, c.road_name, c.severity, c.repaired_at
having count(o.id) filter (where o.observed_at > c.repaired_at) > 0
order by sightings_since_repair desc;

-- Headline figures for the dashboard.
create or replace view admin_summary as
select
  (select count(*) from clusters where repaired_at is null)                          as open_total,
  (select count(*) from clusters where repaired_at is null and severity = 'high')    as open_high,
  (select count(*) from clusters where repaired_at is not null)                      as repaired_total,
  (select count(*) from clusters where repaired_at >= current_date - interval '30 days') as repaired_30d,
  (select count(*) from clusters where first_seen  >= current_date - interval '30 days') as reported_30d,
  (select count(*) from observations where verification_status = 'pending')          as pending_reports,
  (select round(avg(extract(day from now() - first_seen))::numeric, 1)
     from clusters where repaired_at is null)                                        as avg_open_age_days,
  (select round(avg(extract(day from repaired_at - first_seen))::numeric, 1)
     from clusters where repaired_at is not null)                                    as avg_time_to_repair,
  (select count(*) from admin_deteriorating)                                         as deteriorating,
  (select count(*) from admin_recurrence)                                            as recurring;

grant select on admin_flow_daily, admin_aging, admin_roads,
                admin_deteriorating, admin_recurrence, admin_summary
  to authenticated;

select refresh_priorities() as priorities_computed;
