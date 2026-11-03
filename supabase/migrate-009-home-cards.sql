-- TasteRank migration 009: lighter home cards (design/mockups/home-cards.html)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The site that's live now keeps working on it: it only adds to what the two home lookups send back.
--
-- What it does:
--   1. home_categories and home_brands send up to 4 photos per card ('thumbs'): snacks with a photo first,
--      then the most rated.
--   2. Both send 'lead': the most ratings any one snack on the card has, so the card can say
--      "Top snack needs 9 more ratings to win".
--   Nothing else changes: same arguments, same order, every field the live site reads is still there.

begin;

-- Home, by category: one card per category with live snacks in that country, most ratings first.
create or replace function public.home_categories(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  pr as (
    select p.id, p.sort, p.emoji, p.category_id, c.sort as csort,
           coalesce(public.local_name('product', p.id, p_country), p.name) as name,
           coalesce(public.local_name('category', c.id, p_country), c.name) as type,
           (select count(*) from t where t.product_id = p.id)::int as snacks,
           (select coalesce(sum(t.total), 0) from t where t.product_id = p.id)::int as ratings,
           (select coalesce(max(t.total), 0) from t where t.product_id = p.id)::int as lead
    from public.products p join public.categories c on c.id = p.category_id and c.visible
    where exists (select 1 from t where t.product_id = p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'emoji', pr.emoji, 'type', pr.type,
           'type_id', pr.category_id, 'snacks', pr.snacks, 'ratings', pr.ratings, 'lead', pr.lead,
           'thumbs', (select coalesce(jsonb_agg(jsonb_build_object('image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji)
                                                order by x.k), '[]'::jsonb)
                        from (select t.*, row_number() over (order by t.image_url is null and t.image_path is null, t.total desc, t.id) as k
                              from t where t.product_id = pr.id) x where x.k <= 4),
           'top', (select coalesce(jsonb_agg(jsonb_build_object('item_id', x.id, 'pack_name', x.pack_name, 'brand', x.brand,
                                     'avg', x.avg, 'total', x.total)), '[]'::jsonb)
                     from (select * from t where t.product_id = pr.id and t.ranked order by t.avg desc, t.total desc, t.id limit 3) x),
           'to_rate', (select coalesce(jsonb_agg(jsonb_build_object('item_id', x.id, 'pack_name', x.pack_name, 'total', x.total)), '[]'::jsonb)
                         from (select * from t where t.product_id = pr.id and not t.ranked
                                 and not exists (select 1 from t t2 where t2.product_id = pr.id and t2.ranked)
                               order by t.total desc, t.id limit 2) x))
         order by pr.ratings desc, pr.csort, pr.sort), '[]'::jsonb)
  from pr
$$;

-- Home, by brand: brands with 2+ live snacks in that country.
create or replace function public.home_brands(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  g as (select t.brand_id, t.brand, count(*)::int as snacks, sum(t.total)::int as ratings, max(t.total)::int as lead
        from t group by t.brand_id, t.brand having count(*) >= 2)
  select coalesce(jsonb_agg(jsonb_build_object('id', g.brand_id, 'name', g.brand, 'snacks', g.snacks, 'ratings', g.ratings, 'lead', g.lead,
           'categories', (select jsonb_agg(x.name order by x.n desc, x.sort) from (
                            select coalesce(public.local_name('product', p.id, p_country), p.name) as name, p.sort, count(*) as n
                            from t join public.products p on p.id = t.product_id where t.brand_id = g.brand_id
                            group by p.id, p.name, p.sort) x),
           'type_ids', (select jsonb_agg(distinct p.category_id) from t join public.products p on p.id = t.product_id
                         where t.brand_id = g.brand_id),
           'thumb', (select jsonb_build_object('image_url', t.image_url, 'image_path', t.image_path, 'emoji', t.emoji)
                       from t where t.brand_id = g.brand_id order by t.image_url is null and t.image_path is null, t.total desc, t.id limit 1),
           'thumbs', (select coalesce(jsonb_agg(jsonb_build_object('image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji)
                                                order by x.k), '[]'::jsonb)
                        from (select t.*, row_number() over (order by t.image_url is null and t.image_path is null, t.total desc, t.id) as k
                              from t where t.brand_id = g.brand_id) x where x.k <= 4),
           'best', (select jsonb_build_object('item_id', t.id, 'pack_name', t.pack_name, 'avg', t.avg, 'total', t.total)
                      from t where t.brand_id = g.brand_id and t.ranked order by t.avg desc, t.total desc, t.id limit 1))
         order by g.ratings desc, g.brand), '[]'::jsonb)
  from g
$$;

grant execute on function public.home_categories(int), public.home_brands(int) to anon, authenticated;

-- What you should see after pressing Run: each category with its number of snacks, photos and top snack's ratings.
select c->>'name' as category, (c->>'snacks')::int as snacks, jsonb_array_length(c->'thumbs') as photos, (c->>'lead')::int as top_snack_ratings
from jsonb_array_elements(public.home_categories(1)) c;

commit;
