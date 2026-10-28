-- TasteRank migration 003: stop keeping people's Google names
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Safe to run again.
--
-- TasteRank's own tables identify people only by their random user ID. Until now, each new profile also
-- copied the person's Google name; this removes that column (and the names already saved in it) and stops
-- new sign-ins copying it.
-- Note: Supabase's sign-in system (the auth tables, not TasteRank's) still keeps the email address, name
-- and photo Google sends, because that is how it recognises someone when they sign in again.

begin;

-- New sign-in → an empty profile with just their user ID (home country is added when they pick it).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;

alter table public.profiles drop column if exists display_name;

commit;
