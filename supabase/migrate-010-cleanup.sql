-- TasteRank migration 010: remove everything the site no longer uses (replaces migration 007, which was never run)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The live site (version 2026-11-03b, migrations 008 and 009) calls none of what it removes.
--
-- What it removes:
--   Tables from the original site, before brands (migration 004):
--     legacy_items           the original foods (the site stopped reading them at 004)
--     ratings, votes         the original site's ratings and approvals (never copied into the new tables)
--     suggestions            the original "suggest a category" ideas
--     catalogue_suggestions  the "Suggest a product or variant" ideas (that form is gone; new ones go through item_requests)
--   Functions the site stopped calling (rankings by flavour, before the category and brand pages):
--     ranking, home_rankings, brand_cards, brand_view, next_to_rate, submit_item, submit_item_request,
--     guess_title, my_rating_count, and the original site's item_list, suggest_catalogue, vote_for_own_item and
--     promote_when_approved (with the two triggers on legacy_items and votes).
-- It keeps everything the site, the owner's lists (to_sort, review_list, accept_request, decline_request) and
-- prompt 06 (set_home_place) use, and every person's ratings, approvals and additions in the new tables.
--
-- Safety check: if any of the old tables hold anything from people (ratings, approvals, ideas, foods they added),
-- it stops and changes nothing. On 2026-11-03 catalogue_suggestions held at least Vera's "Dark chocolate" idea.
-- To go ahead anyway:
--   1. Supabase → Table Editor → each table it names → Export → CSV, and keep the files.
--   2. Change 'no' to 'yes' on the line just below, and run it again.
select set_config('tasterank.old_data_saved', 'no', false);

begin;

do $$
declare
  t text;
  n bigint;
  kept text := '';
begin
  if current_setting('tasterank.old_data_saved', true) is distinct from 'yes' then
    foreach t in array array['ratings', 'votes', 'legacy_items', 'suggestions', 'catalogue_suggestions'] loop
      if to_regclass('public.' || t) is not null then
        -- the starter foods in legacy_items aren't anyone's; only foods people added count
        execute format('select count(*) from public.%I%s', t,
          case when t = 'legacy_items' then ' where submitted_by is not null' else '' end) into n;
        if n > 0 then kept := kept || case when kept = '' then ' ' else ', ' end || format('%s (%s)', t, n); end if;
      end if;
    end loop;
    if kept <> '' then
      raise exception 'These old tables still hold things people sent in:%. Nothing was changed. Download them as CSV first (see the top of this file), then change ''no'' to ''yes'' and run it again.', kept;
    end if;
  end if;
end $$;

-- Tables first (their triggers and security rules go with them), then the functions
drop table if exists public.ratings, public.votes, public.legacy_items, public.suggestions, public.catalogue_suggestions;

drop function if exists
  public.item_list(), public.promote_when_approved(), public.vote_for_own_item(), public.suggest_catalogue(text, text),
  public.copy_legacy_items(), public.product_for_item(bigint),
  public.ranking(int, int, int), public.home_rankings(int), public.brand_cards(int), public.brand_view(bigint, int, int),
  public.next_to_rate(bigint, boolean), public.guess_title(text, text), public.my_rating_count(),
  public.submit_item(int, int, int, text, text, text, int, text, text),
  public.submit_item_request(int, int, text, text, text, int, text, text, text, text, int);

-- What you should see after pressing Run: 0 old tables and 0 old functions left, and the home list still works.
select (select count(*) from pg_tables where schemaname = 'public'
          and tablename in ('ratings', 'votes', 'legacy_items', 'suggestions', 'catalogue_suggestions')) as old_tables_left,
       (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
          and p.proname in ('ranking', 'home_rankings', 'brand_cards', 'brand_view', 'next_to_rate', 'submit_item',
                            'submit_item_request', 'guess_title', 'my_rating_count', 'item_list', 'suggest_catalogue')) as old_functions_left,
       jsonb_array_length(public.home_categories(1)) as uk_home_cards;

commit;
