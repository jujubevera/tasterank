-- TasteRank migration 005: let people remove a rating they've given
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Safe to run again.
--
-- Adds unrate_item(item): deletes your own rating of that item and returns how many items you've still rated.
-- The rating history keeps a "removed" entry (a row with no score), so trends stay honest.

begin;

-- A history row with no score means "rating removed".
alter table public.rating_events alter column score drop not null;

create or replace function public.unrate_item(p_item bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); place int;
begin
  delete from public.item_ratings where item_id = p_item and user_id = u;
  if found then
    select coalesce((select home_place_id from public.profiles where id = u), 0) into place;
    insert into public.rating_events (item_id, user_id, score, rater_place_id) values (p_item, u, null, place);
  end if;
  return (select count(*) from public.item_ratings where user_id = u);
end $$;

revoke execute on function public.unrate_item(bigint) from public, anon;
grant execute on function public.unrate_item(bigint) to authenticated;

commit;
