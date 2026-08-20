-- ============================================================================
--  Migration 002 — pedestrian photo reports + verification gate
--
--  Safe to run on a live database. Idempotent.
--
--  Why a gate at all: a photo report comes from anyone, anonymously, with no
--  corroborating sensor evidence. Publishing it straight to the map would make
--  the dataset trivially poisonable — one person could fill Tlemcen with
--  invented potholes. So photo reports land as `pending` and are excluded from
--  clustering until something verifies them.
-- ============================================================================

set search_path = public, extensions;

-- 'photo' is its own method, not a variant of 'camera'. Camera means the
-- dashcam pipeline: continuous, geo-tracked, model-scored. Photo means a person
-- standing still who framed the shot deliberately. They have different error
-- profiles and must stay distinguishable in the data.
alter type collection_method add value if not exists 'photo';

do $$ begin
  create type verification_status as enum ('pending', 'verified', 'rejected', 'review');
exception when duplicate_object then null; end $$;

alter table observations
  add column if not exists verification_status verification_status not null default 'verified',
  add column if not exists verification jsonb not null default '{}'::jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists note text;

-- Sensor-derived observations are trusted on arrival: an accelerometer impact
-- and a tap made while driving are both anchored to a real ride. Only photo
-- reports need to earn their place, so only they default to pending.
create index if not exists obs_pending_idx
  on observations (verification_status)
  where verification_status = 'pending';

create or replace function default_verification()
returns trigger
language plpgsql
as $$
begin
  if new.method = 'photo' then
    new.verification_status := 'pending';
  end if;
  return new;
end $$;

drop trigger if exists observations_default_verification on observations;
create trigger observations_default_verification
  before insert on observations
  for each row execute function default_verification();

-- The clustering trigger must ignore anything unverified, otherwise the gate
-- above would be decorative.
create or replace function trg_attach_observation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.verification_status = 'verified' then
    perform attach_observation(new.id);
  end if;
  return new;
end $$;

-- When a pending report is later approved, it must join the map at that point.
create or replace function trg_attach_on_verify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    perform attach_observation(new.id);
  end if;
  return new;
end $$;

drop trigger if exists observations_attach_on_verify on observations;
create trigger observations_attach_on_verify
  after update of verification_status on observations
  for each row execute function trg_attach_on_verify();

-- ---------------------------------------------------------------- moderation
--  What a verification worker reads. Exposed only to service_role: it contains
--  raw report positions, which anon must never be able to enumerate.
create or replace view pending_reports as
select id, ride_id, method, observed_at, lat, lon, gps_accuracy_m,
       damage_type, severity, image_path, note, payload
from observations
where verification_status = 'pending'
order by observed_at;

revoke all on pending_reports from anon;

-- Anonymous clients may create a photo report and nothing more. They must not
-- be able to set their own verification_status — that is the whole gate.
revoke update (verification_status, verification, verified_at) on observations from anon;

comment on column observations.verification_status is
  'photo reports start pending; sensor observations are trusted on arrival';
