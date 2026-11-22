-- TasteRank migration 019: where each snack's photo came from, on the owner page
-- (design/mockups/owner-photo-source.html, 2026-11-22)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Run it BEFORE pushing the site update (?v=2026-11-22e).
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The current site keeps working on it.
--
-- What it does:
--   1. Three new fields on each snack: photo_source ('commons' when the owner says an uploaded photo came from
--      Wikimedia Commons; empty otherwise), photo_credit (the photographer and licence) and photo_link (its Commons page).
--      Only the owner can set them, only on a photo uploaded to an owner's folder, and a Commons photo needs its credit.
--   2. photo_source_of(): works out where a photo came from, for the owner page:
--        'off'     an Open Food Facts link          'commons' an owner's upload marked as Commons
--        'you'     another upload in an owner's folder  'taster' an upload in anyone else's folder (never says who)
--        'none'    no photo
--   3. owner_snacks() and owner_reports() include the source (and the credit and link); owner_save_snack() takes
--      the owner's choice. Changing or removing a photo clears its old source, so it can't go stale.
-- Visitors see nothing new.

begin;

-- ---------- 1. The new fields ----------
alter table public.items add column if not exists photo_source text;
alter table public.items add column if not exists photo_credit text;
alter table public.items add column if not exists photo_link text;
alter table public.items drop constraint if exists items_photo_source_check;
alter table public.items add constraint items_photo_source_check check (
  (photo_source is null and photo_credit is null and photo_link is null)
  or (photo_source = 'commons' and image_path is not null and photo_credit is not null
      and pg_catalog.char_length(photo_credit) between 1 and 200
      and (photo_link is null or (photo_link ~ '^https://([a-z-]+\.)?(wikimedia|wikipedia)\.org/' and pg_catalog.char_length(photo_link) <= 500))));

-- ---------- 2. Where a photo came from ----------
create or replace function public.photo_source_of(p_url text, p_path text, p_source text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_url is not null then 'off'
    when p_path is null then 'none'
    when not exists (select 1 from public.owners o where o.user_id::text = pg_catalog.split_part(p_path, '/', 1)) then 'taster'
    when p_source = 'commons' then 'commons'
    else 'you' end
$$;

-- ---------- 3. The owner's calls ----------
-- Snacks: as in migration 011, plus photo_source, photo_credit and photo_link
create or replace function public.owner_snacks(p_country int default null, p_item bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name, 'brand_id', b.id,
            'product_id', i.product_id, 'product', p.name, 'category_id', p.category_id, 'emoji', p.emoji,
            'variant_id', i.variant_id, 'flavour', v.name, 'is_other', v.is_other, 'country_id', i.country_id,
            'status', public.status_now(i.status, i.created_at), 'hidden_from', i.hidden_from,
            'ratings', (select count(*) from public.item_ratings x where x.item_id = i.id),
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

-- Change a snack: as in migration 018, plus where the photo came from.
--   p_photo_source: null keeps the old source while the photo stays the same (a new or removed photo clears it);
--                   'own' says it's the owner's own photo; 'commons' says it's from Wikimedia Commons, with p_photo_credit
--                   (required) and p_photo_link (optional, its Commons page). Only for photos uploaded to an owner's folder.
-- The old 8-field version is replaced, so the current site's calls still work (the new fields default to empty).
drop function if exists public.owner_save_snack(bigint, text, text, int, int, text, text, text);
create or replace function public.owner_save_snack(p_item bigint, p_pack_name text, p_brand_name text, p_country int,
                                                   p_category int, p_subcategory text, p_flavour text,
                                                   p_photo text default null, p_photo_source text default null,
                                                   p_photo_credit text default null, p_photo_link text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_owner(); i public.items; pack text; bn text := public.clean(p_brand_name); bid bigint;
        old_name text; pid int; vid int; url text; path text; k int;
        src text; credit text := nullif(public.clean(p_photo_credit), ''); link text := nullif(btrim(coalesce(p_photo_link, '')), '');
begin
  select * into i from public.items where id = p_item for update;
  if not found or i.status = 'withdrawn' then raise exception 'That snack isn''t here any more' using errcode = 'P0001'; end if;
  if public.tidy_case(p_pack_name) = '' then raise exception 'Type the name on the pack' using errcode = '22023'; end if;
  if bn = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  if pg_catalog.char_length(bn) > 60 then raise exception 'Keep the brand under 60 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if p_photo_source is not null and p_photo_source not in ('own', 'commons') then
    raise exception 'Say where the photo is from' using errcode = '22023';
  end if;

  select id, name into bid, old_name from public.brands where name_key = public.norm(bn);
  if bid is null then
    insert into public.brands (name, status) values (bn, case when i.status = 'live' then 'live' else 'pending' end)
    returning id into bid;
  elsif old_name <> bn and pg_catalog.lower(old_name) = pg_catalog.lower(bn) then   -- new capitals: rename it everywhere
    update public.brands set name = bn where id = bid;
    k := pg_catalog.char_length(bn);
    update public.items set pack_name = bn || pg_catalog.substr(pack_name, k + 1)
     where brand_id = bid and pg_catalog.lower(pg_catalog.substr(pack_name, 1, k)) = pg_catalog.lower(bn)
       and pg_catalog.substr(pack_name, 1, k) <> bn and (pg_catalog.char_length(pack_name) = k or pg_catalog.substr(pack_name, k + 1, 1) = ' ');
  end if;

  pack := public.tidy_case(p_pack_name);
  if pg_catalog.char_length(pack) > 120 then raise exception 'Keep the name under 120 letters' using errcode = '22023'; end if;
  pid := public.owner_product(p_subcategory, p_category);
  if nullif(public.clean(p_flavour), '') is null then
    vid := case when pid = i.product_id then i.variant_id else public.guess_variant(pid, pack, null) end;
  else
    vid := public.owner_variant(pid, p_flavour);
  end if;

  url := i.image_url; path := i.image_path;
  if p_photo = '' then url := null; path := null;
  elsif p_photo ~ '^https://' then
    if p_photo !~ '^https://images\.openfoodfacts\.org/' or pg_catalog.char_length(p_photo) > 500 then
      raise exception 'Photos can only come from Open Food Facts' using errcode = '22023';
    end if;
    url := p_photo; path := null;
  elsif p_photo is not null then
    if pg_catalog.split_part(p_photo, '/', 1) <> u::text then raise exception 'Photos must be uploaded to your own folder' using errcode = '42501'; end if;
    url := null; path := p_photo;
  end if;

  -- Where the photo came from: kept only while the photo stays the same
  src := case when url is null and path is not distinct from i.image_path then i.photo_source end;
  if p_photo_source = 'own' then src := null;
  elsif p_photo_source = 'commons' then
    if url is not null or path is null or public.photo_source_of(url, path, null) <> 'you' then
      raise exception 'Only a photo uploaded from the owner page can be marked as from Wikimedia Commons' using errcode = '22023';
    end if;
    if credit is null then raise exception 'Add the credit: the photographer and licence, as the Commons page shows them' using errcode = '22023'; end if;
    if pg_catalog.char_length(credit) > 200 then raise exception 'Keep the credit under 200 letters' using errcode = '22023'; end if;
    if link is not null and link !~* '^https?://' then link := 'https://' || link; end if;
    if link is not null and (link !~ '^https://([a-z-]+\.)?(wikimedia|wikipedia)\.org/' or pg_catalog.char_length(link) > 500) then
      raise exception 'The Commons page should be a commons.wikimedia.org link' using errcode = '22023';
    end if;
    src := 'commons';
  end if;

  begin
    update public.items set pack_name = pack, brand_id = bid, country_id = p_country, product_id = pid, variant_id = vid,
                            image_url = url, image_path = path,
                            photo_source = src,
                            photo_credit = case when src is null then null when p_photo_source = 'commons' then credit else i.photo_credit end,
                            photo_link = case when src is null then null when p_photo_source = 'commons' then link else i.photo_link end
     where id = p_item;
  exception when unique_violation then
    raise exception 'Another snack in % already has that name. Change one of them, or hide the extra one.',
      (select short_name from public.places where id = p_country) using errcode = '23505';
  end;
  if i.status = 'live' then update public.brands set status = 'live' where id = bid; end if;
  return (public.owner_snacks(null, p_item))->0;
end $$;

-- Reports: as in migration 018, plus where the snack's photo came from
create or replace function public.owner_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(x.j order by x.last_at desc), '[]'::jsonb) from (
    select max(r.created_at) as last_at, jsonb_build_object('item_id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
             'product_id', i.product_id, 'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name),
             'emoji', p.emoji, 'image_url', i.image_url, 'image_path', i.image_path,
             'photo_source', public.photo_source_of(i.image_url, i.image_path, i.photo_source),
             'country_id', i.country_id, 'status', public.status_now(i.status, i.created_at),
             'approvals', (select count(*) from public.approvals a where a.item_id = i.id),
             'reports', count(*),
             'reasons', (select jsonb_object_agg(z.reason, z.n) from (select r2.reason, count(*) n from public.item_reports r2
                          where r2.item_id = i.id and r2.status = 'open' group by r2.reason) z),
             'notes', coalesce((select jsonb_agg(r3.note order by r3.created_at desc) from public.item_reports r3
                          where r3.item_id = i.id and r3.status = 'open' and r3.note is not null), '[]'::jsonb),
             'last_at', max(r.created_at)) j
    from public.item_reports r
    join public.items i on i.id = r.item_id
    join public.brands b on b.id = i.brand_id
    join public.products p on p.id = i.product_id
    where r.status = 'open' and i.status not in ('withdrawn', 'hidden')
    group by i.id, b.id, p.id
  ) x);
end $$;

-- ---------- Who may call what ----------
revoke execute on function public.photo_source_of(text, text, text) from public, anon, authenticated;
revoke execute on function public.owner_snacks(int, bigint), public.owner_reports(),
  public.owner_save_snack(bigint, text, text, int, int, text, text, text, text, text, text) from public, anon;
grant execute on function public.owner_snacks(int, bigint), public.owner_reports(),
  public.owner_save_snack(bigint, text, text, int, int, text, text, text, text, text, text) to authenticated;

commit;

-- What you should see after pressing Run: how many snacks have each kind of photo (no Commons ones yet).
select public.photo_source_of(image_url, image_path, photo_source) as photo, count(*) as snacks
  from public.items where status <> 'withdrawn' group by 1 order by 2 desc;
