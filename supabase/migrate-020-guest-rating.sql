-- TasteRank migration 020: rate without signing in (guest tasters), 2026-11-23
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Run it BEFORE pushing the site update.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The current site keeps working on it (nobody is a guest until anonymous sign-ins are switched on in Supabase).
--
-- Why: testers found signing in a hurdle before rating. Now the site gives a visitor an invisible guest account
-- (a Supabase "anonymous sign-in") the first time they pick a face. A guest is a real account with a random ID, so
-- "one rating per person per snack" still holds. Approving, adding snacks, reporting and uploading photos still need
-- a proper sign-in: they decide what goes live, and one person could otherwise approve a snack five times from
-- five private windows.
--
-- What it does:
--   1. is_guest(): true for an anonymous Supabase account (auth.users.is_anonymous).
--   2. require_user() now turns guests away too, so every action that needs a real account (approve_item, submit_snack,
--      submit_new_category, withdraw_submission, report_item) refuses guests without being rewritten, and so will any
--      new action that calls it. require_rater() lets guests through; rate_item, unrate_item and set_home_place use it.
--   3. may_upload_photo() says no to guests (the photo bucket's upload rule uses it).
--   4. Moving a guest's ratings into their account when they sign in (Google or Facebook give the account a different ID):
--        guest_handover()   called by the guest just before leaving for Google: returns a one-time code
--                           (only its fingerprint is stored, for 1 hour).
--        claim_guest(code)  called once they're back, signed in: moves the guest's ratings (and their rating history)
--                           to the account, keeping the account's own rating where both rated the same snack; copies the
--                           guest's home place if the account has none; then deletes the guest account.
--   The ratings guests give count like everyone else's. Whether a rating came from a guest can still be told later
--   (auth.users.is_anonymous), if guest ratings ever need to be left out.

begin;

-- ---------- 1. Who's a guest ----------
create or replace function public.is_guest(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.is_anonymous from auth.users a where a.id = u), false)
$$;

-- ---------- 2. Real accounts only, or guests too ----------
create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or public.is_guest(u) then raise exception 'Please sign in first' using errcode = '42501'; end if;
  return u;
end $$;

create or replace function public.require_rater() returns uuid
language plpgsql stable set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  return u;
end $$;

-- The same as in migrations 004 and 005, with require_rater() in place of require_user()
create or replace function public.rate_item(p_item bigint, p_score int) returns int
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_rater(); place int;
begin
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Pick a face from 1 to 5' using errcode = '22023';
  end if;
  if not exists (select 1 from public.items where id = p_item and status = 'live') then
    raise exception 'This item can''t be rated yet' using errcode = 'P0001';
  end if;
  select coalesce((select home_place_id from public.profiles where id = u), 0) into place;
  insert into public.item_ratings (item_id, user_id, score, rater_place_id, updated_at)
  values (p_item, u, p_score, place, now())
  on conflict (item_id, user_id) do update
    set score = excluded.score, rater_place_id = excluded.rater_place_id, updated_at = excluded.updated_at;
  insert into public.rating_events (item_id, user_id, score, rater_place_id) values (p_item, u, p_score, place);
  return (select count(*) from public.item_ratings where user_id = u);
end $$;

create or replace function public.unrate_item(p_item bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_rater(); place int;
begin
  delete from public.item_ratings where item_id = p_item and user_id = u;
  if found then
    select coalesce((select home_place_id from public.profiles where id = u), 0) into place;
    insert into public.rating_events (item_id, user_id, score, rater_place_id) values (p_item, u, null, place);
  end if;
  return (select count(*) from public.item_ratings where user_id = u);
end $$;

create or replace function public.set_home_place(p_place int) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_rater();
begin
  if not exists (select 1 from public.places where id = p_place) then
    raise exception 'Unknown place' using errcode = '22023';
  end if;
  insert into public.profiles (id, home_place_id) values (u, p_place)
  on conflict (id) do update set home_place_id = excluded.home_place_id;
end $$;

-- ---------- 3. No photo uploads from guests (the same as migration 016, plus the guest check) ----------
create or replace function public.may_upload_photo() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_guest(auth.uid()) and (public.is_owner()
      or (select pg_catalog.count(*) from storage.objects
          where bucket_id = 'product-photos'
            and (storage.foldername(name))[1] = (select auth.uid()::text)
            and created_at > pg_catalog.now() - interval '1 day') < 10)
$$;

-- ---------- 4. A guest's ratings follow them into their account ----------
create table if not exists public.guest_handovers (
  code_hash text primary key,                 -- sha256 of the code; the code itself is never stored
  guest_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.guest_handovers enable row level security;
revoke all on table public.guest_handovers from anon, authenticated;

create or replace function public.code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')
$$;

create or replace function public.guest_handover() returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_rater(); code text;
begin
  if not public.is_guest(u) then raise exception 'Only a guest has ratings to hand over' using errcode = 'P0001'; end if;
  delete from public.guest_handovers where guest_id = u or created_at < now() - interval '1 day';
  code := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.guest_handovers (code_hash, guest_id) values (public.code_hash(code), u);
  return code;
end $$;

create or replace function public.claim_guest(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); g uuid; clash bigint[]; moved int;
begin
  delete from public.guest_handovers
   where code_hash = public.code_hash(p_code) and created_at > now() - interval '1 hour'
  returning guest_id into g;
  -- an old, used or unknown code, or one from an account that isn't a guest any more: nothing to move, and no error,
  -- since the person can't do anything about it
  if g is null or g = u or not public.is_guest(g) then return jsonb_build_object('moved', 0, 'kept', 0); end if;

  -- snacks both have rated: the account's rating stays, and the guest's (with its history) goes with the guest
  select coalesce(array_agg(gr.item_id), '{}') into clash from public.item_ratings gr
   where gr.user_id = g and exists (select 1 from public.item_ratings mr where mr.user_id = u and mr.item_id = gr.item_id);
  update public.item_ratings set user_id = u where user_id = g and not (item_id = any(clash));
  get diagnostics moved = row_count;
  update public.rating_events set user_id = u where user_id = g and not (item_id = any(clash));

  update public.profiles p set home_place_id = gp.home_place_id
    from public.profiles gp
   where p.id = u and gp.id = g and p.home_place_id = 0 and gp.home_place_id <> 0;
  insert into public.profiles (id, home_place_id)
    select u, gp.home_place_id from public.profiles gp where gp.id = g and gp.home_place_id <> 0
  on conflict (id) do nothing;

  delete from auth.users where id = g;     -- the guest's other rows (ratings already rated by the account) go with it
  return jsonb_build_object('moved', moved, 'kept', pg_catalog.cardinality(clash));
end $$;

-- ---------- Who may call what ----------
revoke execute on function public.is_guest(uuid), public.require_rater(), public.code_hash(text)
  from public, anon, authenticated;
revoke execute on function public.rate_item(bigint, int), public.unrate_item(bigint), public.set_home_place(int),
  public.may_upload_photo(), public.guest_handover(), public.claim_guest(text) from public, anon;
grant execute on function public.rate_item(bigint, int), public.unrate_item(bigint), public.set_home_place(int),
  public.may_upload_photo(), public.guest_handover(), public.claim_guest(text) to authenticated;

commit;

-- What you should see after pressing Run: guests 0 (none yet), and handovers 0.
select (select count(*) from auth.users where is_anonymous) as guests,
       (select count(*) from public.guest_handovers) as handovers;
