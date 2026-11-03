-- REPLACED by migrate-010-cleanup.sql (2026-11-03): don't run this one. 007 was never run on the live database;
-- 010 does the same and also removes the old ranking functions. Kept so the tests can replay the history.
-- TasteRank migration 007: remove the old site's tables and functions
-- Run this ONLY after the new add flow (prompts 09 + 10) is pushed and you've checked the live site works:
-- the site before that still calls suggest_catalogue().
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
--
-- What it removes:
--   legacy_items           the original foods (renamed by migration 004; the new site never reads them)
--   ratings, votes         the original site's ratings and approvals (never copied into the new tables)
--   suggestions            the original "suggest a category" ideas
--   catalogue_suggestions  the "Suggest a product or variant" ideas (that form is gone; new rankings go through item_requests)
--   item_list(), promote_when_approved(), vote_for_own_item(), suggest_catalogue(), and migration 002's
--   copy_legacy_items() and product_for_item() if they're still there.
-- It keeps profiles, delete_me() and everything the new site uses.
--
-- Safety check: if any of those tables hold anything from people (ratings, approvals, ideas, foods they added),
-- it stops and changes nothing. To go ahead anyway:
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

-- Tables first (their triggers and security rules go with them), then the functions that used them
drop table if exists public.ratings, public.votes, public.legacy_items, public.suggestions, public.catalogue_suggestions;

drop function if exists public.item_list(), public.promote_when_approved(), public.vote_for_own_item(),
  public.suggest_catalogue(text, text), public.copy_legacy_items(), public.product_for_item(bigint);

commit;
