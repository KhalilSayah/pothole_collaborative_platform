-- ============================================================================
--  Migration 003 — photo storage bucket
--
--  Fixes "Bucket not found" when submitting a pedestrian photo report.
--  Safe to run repeatedly.
--
--  Alternative: Dashboard -> Storage -> New bucket, named exactly
--  `pothole-images`, marked public. You still need the policies below, so
--  running this script is the simpler path.
-- ============================================================================

-- Public read, because the map shows the photo in a marker popup and the
-- verification worker fetches it. Nothing private is in these images beyond
-- what the reporter deliberately photographed of a public road.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pothole-images',
  'pothole-images',
  true,
  -- The client downscales to ~1280px before upload, which lands well under
  -- 1 MB. 5 MB leaves room for an unshrunk upload without letting anyone
  -- park a video in the bucket.
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- policies
--  Anonymous contributors may ADD a photo and nothing else.
--
--  Deliberately no update and no delete policy: those are what would let one
--  person overwrite or erase everyone else's evidence, and there is no account
--  system here to trace it back to. Uploading is the only capability an
--  anonymous reporter needs.

drop policy if exists "pothole images anon upload" on storage.objects;
create policy "pothole images anon upload"
  on storage.objects for insert to anon
  with check (bucket_id = 'pothole-images');

drop policy if exists "pothole images public read" on storage.objects;
create policy "pothole images public read"
  on storage.objects for select to public
  using (bucket_id = 'pothole-images');

-- ---------------------------------------------------------------- check
select
  id,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'pothole-images';

select policyname, cmd, roles::text
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'pothole images%'
order by cmd;

-- Expected: one bucket row (public = true), and two policies —
--   pothole images anon upload   INSERT  {anon}
--   pothole images public read   SELECT  {public}
