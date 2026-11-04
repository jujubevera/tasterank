-- TasteRank migration 013: new lists on home, so people can find them and approve their snacks
-- (design/mockups/new-lists.html)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- Run it after the site update that shows the "New list" card is live (?v=2026-11-04k or later):
-- the older site would show these new cards as "0 snacks".
--
-- What it does:
--   home_categories also sends a card for a subcategory whose only snacks in that country are in the vote
--   (waiting for 5 approvals), so friends can find it from home and approve them. Before, a brand-new
--   subcategory such as Jelly sweets had no card until a snack went live, so nobody could find it.
--   Every card gets 'waiting': how many of its snacks are in the vote in that country.
--   A card with no live snacks shows the waiting snacks' photos and comes after every card with live snacks.
--   Nothing else changes: same arguments, every field the site reads is still there, live cards in the same order.

begin;

create or replace function public.home_categories(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  w as ( -- snacks in the vote in this country (not closed after 30 days, not withdrawn or hidden)
    select i.id, i.product_id, i.image_url, i.image_path, p.emoji,
           (select count(*) from public.approvals a where a.item_id = i.id) as approvals
    from public.items i join public.products p on p.id = i.product_id
    where i.country_id = p_country and public.status_now(i.status, i.created_at) = 'pending'
  ),
  pr as (
    select p.id, p.sort, p.emoji, p.category_id, c.sort as csort,
           coalesce(public.local_name('product', p.id, p_country), p.name) as name,
           coalesce(public.local_name('category', c.id, p_country), c.name) as type,
           (select count(*) from t where t.product_id = p.id)::int as snacks,
           (select count(*) from w where w.product_id = p.id)::int as waiting,
           (select coalesce(sum(t.total), 0) from t where t.product_id = p.id)::int as ratings,
           (select coalesce(max(t.total), 0) from t where t.product_id = p.id)::int as lead
    from public.products p join public.categories c on c.id = p.category_id and c.visible
    where exists (select 1 from t where t.product_id = p.id) or exists (select 1 from w where w.product_id = p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'emoji', pr.emoji, 'type', pr.type,
           'type_id', pr.category_id, 'snacks', pr.snacks, 'waiting', pr.waiting, 'ratings', pr.ratings, 'lead', pr.lead,
           'thumbs', case when pr.snacks > 0 then
                       (select coalesce(jsonb_agg(jsonb_build_object('image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji)
                                                  order by x.k), '[]'::jsonb)
                          from (select t.*, row_number() over (order by t.image_url is null and t.image_path is null, t.total desc, t.id) as k
                                from t where t.product_id = pr.id) x where x.k <= 4)
                     else -- a new list: the waiting snacks, photos first, then the most approved
                       (select coalesce(jsonb_agg(jsonb_build_object('image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji)
                                                  order by x.k), '[]'::jsonb)
                          from (select w.*, row_number() over (order by w.image_url is null and w.image_path is null, w.approvals desc, w.id) as k
                                from w where w.product_id = pr.id) x where x.k <= 4)
                     end,
           'top', (select coalesce(jsonb_agg(jsonb_build_object('item_id', x.id, 'pack_name', x.pack_name, 'brand', x.brand,
                                     'avg', x.avg, 'total', x.total)), '[]'::jsonb)
                     from (select * from t where t.product_id = pr.id and t.ranked order by t.avg desc, t.total desc, t.id limit 3) x),
           'to_rate', (select coalesce(jsonb_agg(jsonb_build_object('item_id', x.id, 'pack_name', x.pack_name, 'total', x.total)), '[]'::jsonb)
                         from (select * from t where t.product_id = pr.id and not t.ranked
                                 and not exists (select 1 from t t2 where t2.product_id = pr.id and t2.ranked)
                               order by t.total desc, t.id limit 2) x))
         order by pr.snacks = 0, pr.ratings desc, pr.csort, pr.sort), '[]'::jsonb)
  from pr
$$;

grant execute on function public.home_categories(int) to anon, authenticated;

-- What you should see after pressing Run: every UK card, live snacks and snacks in the vote.
-- A new list (0 live snacks, 1 or more waiting) comes last.
select c->>'name' as list, (c->>'snacks')::int as live_snacks, (c->>'waiting')::int as waiting
from jsonb_array_elements(public.home_categories(1)) c;

commit;
