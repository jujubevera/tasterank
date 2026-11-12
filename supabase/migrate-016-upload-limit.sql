-- TasteRank migration 016: at most 10 photo uploads per person per day
-- (engineering review 2026-11-12, reviews/engineering-review-2026-11-12.md, Medium "Photo uploads have no limit")
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The site works the same before and after it; the site update only words the "too many photos" message kindly.
--
-- Why: the photo rule (migration 002) let any signed-in person upload into their own folder as often as they liked.
-- The 5-a-day limit only counts snacks sent, not photos, so someone using the storage address directly could fill
-- the free 1 GB and then nobody could add a photo. Now the 11th upload in 24 hours is refused. The owner isn't limited.
--
-- The count has to be a security-definer function: a count written inside the rule itself would see 0 rows,
-- because people can't read storage.objects. The last line checks that the function can see the photos.

begin;

-- True while you have uploaded fewer than 10 photos in the last 24 hours (always true for the owner).
create or replace function public.may_upload_photo() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner()
      or (select pg_catalog.count(*) from storage.objects
          where bucket_id = 'product-photos'
            and (storage.foldername(name))[1] = (select auth.uid()::text)
            and created_at > pg_catalog.now() - interval '1 day') < 10
$$;
revoke execute on function public.may_upload_photo() from public, anon;
grant execute on function public.may_upload_photo() to authenticated;

drop policy if exists "upload product photos to own folder" on storage.objects;
create policy "upload product photos to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos'
              and (storage.foldername(name))[1] = (select auth.uid()::text)
              and public.may_upload_photo());

commit;

-- Should say limit_works = true. If it says false, tell Claude: the function can't see the photos, so the limit never triggers
-- (uploads still work as before).
select r.rolbypassrls or r.rolsuper as limit_works,
       (select pg_catalog.count(*) from storage.objects where bucket_id = 'product-photos') as photos_stored
from pg_catalog.pg_roles r
where r.rolname = (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.proname = 'may_upload_photo');
