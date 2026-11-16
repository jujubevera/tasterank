-- TasteRank migration 017: "Next" can leave out snacks you've skipped ("Haven't tried it", prompt 16)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Run it BEFORE pushing the site update.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
--
-- Why: "Next" after a rating is picked here, by next_snack (migration 008): the unrated snack with the fewest ratings.
-- Once it reaches a snack you've never had, it offers that same one after every rating. The site now has a
-- "Haven't tried it" link; it remembers what you skipped on your own device and sends that list here as p_skip,
-- so Next can leave those snacks out. The list is only read, never stored: nothing about skips is saved.
-- With no list, Next works exactly as before, so the current site keeps working after this runs.

begin;

drop function if exists public.next_snack(bigint, int, boolean);

create or replace function public.next_snack(p_item bigint, p_variant int default null, p_brand boolean default false,
                                             p_skip bigint[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.items; res jsonb; need int := (public.app_settings()->>'rank_after_ratings')::int;
        skip bigint[] := coalesce(p_skip, '{}'::bigint[]);
begin
  select * into i from public.items where id = p_item;
  if not found then return jsonb_build_object('kind', 'done'); end if;

  if p_brand then
    select jsonb_build_object('kind', 'item', 'id', t.id, 'short_label', t.pack_name) into res
    from public.item_totals(i.country_id) t
    where t.brand_id = i.brand_id and t.id <> i.id and t.my_score is null and t.id <> all(skip)
    order by (t.total < need) desc, t.total, t.id limit 1;
    if res is not null then return res; end if;
  end if;

  select jsonb_build_object('kind', 'item', 'id', t.id, 'short_label', t.pack_name) into res
  from public.item_totals(i.country_id) t
  where t.product_id = i.product_id and (p_variant is null or t.variant_id = p_variant) and t.id <> i.id
    and t.my_score is null and t.id <> all(skip)
  order by (t.total < need) desc, t.total, t.id limit 1;
  if res is not null then return res; end if;

  if p_variant is not null then   -- the same category, another flavour
    select jsonb_build_object('kind', 'list', 'product_id', i.product_id, 'variant_id', v.id,
             'title', public.ranking_title(v.id, i.country_id)) into res
    from public.variants v
    where v.product_id = i.product_id and v.id <> p_variant
      and exists (select 1 from public.item_totals(i.country_id) t
                  where t.variant_id = v.id and t.my_score is null and t.id <> all(skip))
    order by v.is_other, v.sort limit 1;
    if res is not null then return res; end if;
  end if;

  select jsonb_build_object('kind', 'list', 'product_id', p.id, 'variant_id', null,
           'title', coalesce(public.local_name('product', p.id, i.country_id), p.name)) into res
  from public.products p
  where p.id <> i.product_id and p.category_id = (select category_id from public.products where id = i.product_id)
    and exists (select 1 from public.item_totals(i.country_id) t
                where t.product_id = p.id and t.my_score is null and t.id <> all(skip))
  order by p.sort limit 1;
  return coalesce(res, jsonb_build_object('kind', 'done'));
end $$;

revoke execute on function public.next_snack(bigint, int, boolean, bigint[]) from public;
grant execute on function public.next_snack(bigint, int, boolean, bigint[]) to anon, authenticated;

commit;

-- Should say next_snack_ok = true (exactly one next_snack, the new one with the skip list).
select count(*) = 1 and bool_and(pg_catalog.pg_get_function_identity_arguments(p.oid) like '%p_skip bigint[]%') as next_snack_ok
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'next_snack';
