-- Migration 012: at most 5 additions per person a day (Vera, 2026-11-03).
-- Run AFTER migrate-011-owner-page.sql. Paste the whole file into Supabase → SQL Editor and press Run.
-- Safe to run more than once. Nothing is deleted.
--
-- Counts every addition sent in the last 24 hours: snacks (submit_snack) and new subcategories (submit_new_category),
-- including ones withdrawn or declined since, so adding, withdrawing and adding again doesn't get round it.
-- A new subcategory that was accepted counts once, not twice. The owner has no daily limit.
-- The old rule stays too: at most 10 waiting for approval at once.

begin;

-- ---------- 1. The number, next to the other rules ----------
create or replace function public.app_settings() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"approval_votes": 5, "rank_after_ratings": 10, "close_after_days": 30, "max_open_submissions": 10,
           "max_daily_submissions": 5, "brand_card_variants": 5, "group_min_ratings": 10}'::jsonb
$$;

-- ---------- 2. The check both ways of adding already call ----------
create or replace function public.check_submission_limit(u uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare lim int := (public.app_settings()->>'max_open_submissions')::int;
        per_day int := (public.app_settings()->>'max_daily_submissions')::int;
begin
  if not public.is_owner() and
     (select count(*) from public.items i where i.submitted_by = u and i.created_at > now() - interval '24 hours'
        and not exists (select 1 from public.item_requests r where r.item_id = i.id))   -- an accepted request is counted below
     + (select count(*) from public.item_requests r where r.user_id = u and r.created_at > now() - interval '24 hours') >= per_day then
    raise exception 'You''ve added % snacks today, the most for one day. Thanks! You can add more tomorrow.', per_day using errcode = 'P0001';
  end if;
  if (select count(*) from public.items i where i.submitted_by = u and public.status_now(i.status, i.created_at) = 'pending')
     + (select count(*) from public.item_requests r where r.user_id = u and r.status = 'review') >= lim then
    raise exception 'You already have % things waiting for approval. Add more once some go live.', lim using errcode = 'P0001';
  end if;
end $$;

revoke execute on function public.check_submission_limit(uuid) from public, anon, authenticated;
grant execute on function public.app_settings() to anon, authenticated;

-- What you should see after pressing Run: max_daily_submissions 5.
select (public.app_settings()->>'max_daily_submissions')::int as max_daily_submissions;

commit;
