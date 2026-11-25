-- TasteRank migration 021: Commons photo credits on About, and guest ratings on the owner page, 2026-11-25
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Run it BEFORE pushing the site update.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The current site keeps working on it.
--
-- Why (engineering review 2026-11-23):
--   1. A photo from Wikimedia Commons under CC BY-SA must credit its photographer where visitors can see it. The owner
--      page saves that credit (migration 019), but nothing showed it to visitors. photo_credits() lists every Commons
--      photo with its credit and Commons page, for the About page.
--   2. One person can rate a snack several times from private windows (each one gets a new guest). owner_snacks() now
--      says how many of a snack's ratings came from guests, so the owner can spot a snack that's being stuffed.

begin;

-- ---------- 1. Commons credits, for everyone ----------
-- Only what the About page shows: the snack's name, the credit and the Commons page. Withdrawn snacks are left out;
-- every other snack with a Commons photo is listed (crediting a photo that's hidden somewhere does no harm).
create or replace function public.photo_credits() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'pack_name', i.pack_name, 'credit', i.photo_credit, 'link', i.photo_link)
           order by i.pack_name, i.id), '[]'::jsonb)
    from public.items i
   where i.photo_source = 'commons' and i.image_path is not null and i.status <> 'withdrawn'
$$;

-- ---------- 2. Guest ratings per snack, for the owner ----------
-- As in migration 019, plus guest_ratings: how many of its ratings came from guest accounts (auth.users.is_anonymous)
create or replace function public.owner_snacks(p_country int default null, p_item bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name, 'brand_id', b.id,
            'product_id', i.product_id, 'product', p.name, 'category_id', p.category_id, 'emoji', p.emoji,
            'variant_id', i.variant_id, 'flavour', v.name, 'is_other', v.is_other, 'country_id', i.country_id,
            'status', public.status_now(i.status, i.created_at), 'hidden_from', i.hidden_from,
            'ratings', (select count(*) from public.item_ratings x where x.item_id = i.id),
            'guest_ratings', (select count(*) from public.item_ratings x join auth.users a on a.id = x.user_id
                               where x.item_id = i.id and a.is_anonymous),
            'avg', (select round(avg(x.score), 2) from public.item_ratings x where x.item_id = i.id),
            'approvals', (select count(*) from public.approvals a where a.item_id = i.id),
            'created_at', i.created_at,
            'days_left', greatest(0, (public.app_settings()->>'close_after_days')::int - extract(day from now() - i.created_at)::int),
            'image_url', i.image_url, 'image_path', i.image_path, 'barcode', i.barcode,
            'photo_source', public.photo_source_of(i.image_url, i.image_path, i.photo_source),
            'photo_credit', i.photo_credit, 'photo_link', i.photo_link) order by i.created_at desc, i.id desc), '[]'::jsonb)
          from public.items i
          join public.products p on p.id = i.product_id
          join public.variants v on v.id = i.variant_id
          join public.brands b on b.id = i.brand_id
          where i.status <> 'withdrawn' and (p_country is null or i.country_id = p_country) and (p_item is null or i.id = p_item));
end $$;

-- ---------- Who may call what ----------
revoke execute on function public.photo_credits() from public;
grant execute on function public.photo_credits() to anon, authenticated;
revoke execute on function public.owner_snacks(int, bigint) from public, anon;
grant execute on function public.owner_snacks(int, bigint) to authenticated;

commit;

-- What you should see after pressing Run: commons_photos 0 until you mark a photo as from Wikimedia Commons, and the
-- number of guest ratings so far.
select jsonb_array_length(public.photo_credits()) as commons_photos,
       (select count(*) from public.item_ratings x join auth.users a on a.id = x.user_id where a.is_anonymous) as guest_ratings;
