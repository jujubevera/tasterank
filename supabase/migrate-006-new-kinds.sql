-- TasteRank migration 006: "Check it" adding, new rankings in plain words, Open Food Facts photos, tidy capitals,
-- and local names for types (US "Candy", "Chips & Snacks").
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Safe to run again.
-- It replaces the first version of 006 (round 1), which is already live; see section 0.
--
-- What it does:
--   1. tidy_case(): "TONY'S CHOCOLONELY" or "tony's chocolonely" → "Tony's Chocolonely". Names typed in mixed case
--      ("KitKat", "Walkers Max") are kept exactly as typed. New brands, pack names and new rankings are tidied when sent.
--   2. item_requests: a snack for a ranking that doesn't exist yet. Visitors name the ranking in plain words
--      ("Dark chocolate bars"); the site may add a guess of the product and variant. It waits for the owner's check;
--      accepting it adds the product/variant and sends the snack to the normal 5-approval vote.
--   3. Snacks can carry an Open Food Facts photo (image_url) and barcode instead of an uploaded photo.
--   4. Types (categories) can have local names per country, like products already do.
--   5. For the owner only (SQL Editor, never the website):
--        select * from public.review_list();                                  -- what's waiting, with my guess
--        select public.accept_request(1);                                      -- accept with the guess
--        select public.accept_request(1, p_variant_name => 'Dark', p_title => 'Dark chocolate bars');   -- or your own
--        select public.accept_request(2, p_product_name => 'Gummy sweets');    -- file it under another (or a new) product
--        select public.decline_request(3);                                     -- say no; the sender sees "Not this time"

begin;

-- ---------- 0. Upgrading from the first version ----------
-- A first version of this migration (2026-11-01, round 1) is already live, with other arguments and another
-- item_requests shape. Every version of the four functions that change is dropped here and made again below.
do $$
declare f record;
begin
  for f in select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) args from pg_catalog.pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('submit_item', 'submit_item_request', 'accept_request', 'review_list') loop
    execute pg_catalog.format('drop function public.%I(%s)', f.proname, f.args);
  end loop;
end $$;
-- The round-1 item_requests is dropped if it's empty, or kept as item_requests_round1 so nothing is lost.
do $$
begin
  if to_regclass('public.item_requests') is not null and not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'item_requests' and column_name = 'new_ranking') then
    if exists (select 1 from public.item_requests) then
      alter table public.item_requests rename to item_requests_round1;
      raise notice 'Kept the first-version requests in item_requests_round1';
    else
      drop table public.item_requests;
    end if;
  end if;
end $$;

-- ---------- 1. Tidy capitals ----------
-- Capital first letter (after any opening bracket or quote), the rest small: TONY'S → Tony's.
create or replace function public.cap_first(w text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.substr(l, 1, p - 1) || pg_catalog.upper(pg_catalog.substr(l, p, 1)) || pg_catalog.substr(l, p + 1)
  from (select pg_catalog.lower(w) l, coalesce(nullif(pg_catalog.strpos(pg_catalog.lower(w),
          pg_catalog.substring(pg_catalog.lower(w), '[[:alpha:]]')), 0), 1) p) x
$$;

-- Text typed ALL IN CAPITALS or all in small letters gets capitals at the start of each word. Short words stay small
-- ("Salt and Vinegar"), words with digits or & stay as typed (70%, M&S), and two-letter words typed in capitals stay (KP, XL).
-- Mixed capitals ("KitKat", "Walkers Max") are kept as typed.
-- p_sentence: "Dark chocolate" style, for products and variants: only the first word starts with a capital
-- ("Dark Chocolate" → "Dark chocolate"), but words like "KitKat" keep their capitals.
create or replace function public.tidy_case(t text, p_sentence boolean default false) returns text
language plpgsql immutable set search_path = '' as $$
declare c text := public.clean(t); caps boolean; mixed boolean; w text; i int := 0; res text := '';
begin
  mixed := c <> pg_catalog.upper(c) and c <> pg_catalog.lower(c);
  if c = '' or (mixed and not p_sentence) then return c; end if;
  caps := c = pg_catalog.upper(c);
  foreach w in array pg_catalog.string_to_array(c, ' ') loop
    i := i + 1;
    if mixed then  -- sentence style: "Chocolate" after the first word becomes "chocolate"; "KitKat" stays
      if i > 1 and w ~ '^[[:upper:]][[:lower:]'']+$' then w := pg_catalog.lower(w); end if;
    elsif w ~ '[0-9&]' then
      null;
    elsif caps and pg_catalog.char_length(w) <= 2 and pg_catalog.lower(w) not in ('of', 'in', 'on', 'a', 'to', 'n') then
      null;
    elsif i > 1 and (p_sentence or pg_catalog.lower(w) in ('and', 'of', 'the', 'with', 'in', 'on', 'a', 'n', 'to')) then
      w := pg_catalog.lower(w);
    else
      w := public.cap_first(w);
    end if;
    res := res || case when i > 1 then ' ' else '' end || w;
  end loop;
  return res;
end $$;

-- A ranking title worked out from the names: Dark chocolate + Chocolate bars → "Dark chocolate bars",
-- Prawn cocktail + Crisps → "Prawn cocktail crisps", Original + Popcorn → "Popcorn". The owner can write their own.
create or replace function public.guess_title(p_variant text, p_product text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := public.clean(p_variant); p text := pg_catalog.lower(public.clean(p_product)); last_v text;
begin
  if pg_catalog.lower(v) in ('original', 'regular', 'plain') then return public.cap_first(p); end if;
  last_v := pg_catalog.lower(pg_catalog.regexp_replace(v, '^.* ', ''));
  if pg_catalog.split_part(p, ' ', 1) = last_v then  -- the variant's last word starts the product: merge them
    return v || pg_catalog.substr(p, pg_catalog.char_length(last_v) + 1);
  end if;
  return v || ' ' || p;
end $$;

-- ---------- 2. Snacks waiting for a new ranking ----------
create table if not exists public.item_requests (
  id bigint generated always as identity primary key,
  country_id int not null references public.places(id),
  category_id int not null references public.categories(id),
  new_ranking text not null check (char_length(new_ranking) between 1 and 60),   -- as the sender typed it, tidied
  product_id int references public.products(id),     -- the site's guess, when the ranking looked like one of this product's
  new_variant text check (new_variant is null or char_length(new_variant) between 1 and 60),   -- the site's guess
  brand_name text not null check (char_length(brand_name) between 1 and 60),
  pack_name text not null check (char_length(pack_name) between 1 and 120),
  image_path text check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  image_url text check (image_url is null or (image_url ~ '^https://images\.openfoodfacts\.org/' and char_length(image_url) <= 500)),
  barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  score smallint check (score between 1 and 5),     -- "Tried it?", saved as a planned rating when accepted
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'review' check (status in ('review', 'accepted', 'declined')),
  item_id bigint references public.items(id) on delete set null,   -- the snack it became
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (image_path is null or image_url is null)
);
alter table public.item_requests enable row level security;
revoke all on table public.item_requests from anon, authenticated;

-- A snack's barcode, when it came from Open Food Facts. Not unique: the same pack can be sold in several countries.
alter table public.items add column if not exists barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$');

-- Waiting for a check counts towards the limit of things waiting, like waiting for approval.
create or replace function public.check_submission_limit(u uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare lim int := (public.app_settings()->>'max_open_submissions')::int;
begin
  if (select count(*) from public.items i where i.submitted_by = u and public.status_now(i.status, i.created_at) = 'pending')
     + (select count(*) from public.item_requests r where r.user_id = u and r.status = 'review') >= lim then
    raise exception 'You already have % things waiting for approval. Add more once some go live.', lim using errcode = 'P0001';
  end if;
end $$;

-- Photo and barcode rules shared by both ways of sending in.
create or replace function public.check_snack_extras(u uuid, p_image_path text, p_image_url text, p_barcode text, p_score int) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_image_path is not null and p_image_url is not null then
    raise exception 'Use one photo: your own or the Open Food Facts one' using errcode = '22023';
  end if;
  if p_image_path is not null and pg_catalog.split_part(p_image_path, '/', 1) <> u::text then
    raise exception 'Photos must be uploaded to your own folder' using errcode = '42501';
  end if;
  if p_image_url is not null and (p_image_url !~ '^https://images\.openfoodfacts\.org/' or pg_catalog.char_length(p_image_url) > 500) then
    raise exception 'Photos can only come from Open Food Facts' using errcode = '22023';
  end if;
  if p_barcode is not null and p_barcode !~ '^[0-9]{8,14}$' then
    raise exception 'That barcode doesn''t look right' using errcode = '22023';
  end if;
  if p_score is not null and p_score not between 1 and 5 then
    raise exception 'Pick a face from 1 to 5' using errcode = '22023';
  end if;
end $$;

-- ---------- 3. Sending in ----------
-- Into a ranking that exists. As before, plus tidied names (a new brand typed in capitals is saved as "Tony's Chocolonely")
-- and an Open Food Facts photo and barcode. (The old version without those was dropped in section 0.)
create or replace function public.submit_item(p_product int, p_variant int, p_country int, p_brand_name text,
                                              p_pack_name text default null, p_image_path text default null,
                                              p_score int default null, p_image_url text default null,
                                              p_barcode text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); bid bigint; iid bigint; existing bigint; pack text;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.variants v where v.id = p_variant and v.product_id = p_product) then
    raise exception 'Pick a ranking from the list' using errcode = '22023';
  end if;
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if public.clean(p_brand_name) = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  perform public.check_snack_extras(u, p_image_path, p_image_url, p_barcode, p_score);

  select id into bid from public.brands where name_key = public.norm(p_brand_name);
  if bid is null then
    insert into public.brands (name, status, submitted_by) values (public.tidy_case(p_brand_name), 'pending', u) returning id into bid;
  end if;

  -- One that closed after 30 days can be sent in again.
  update public.items set status = 'closed'
   where product_id = p_product and variant_id = p_variant and brand_id = bid and country_id = p_country
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  select id into existing from public.items
   where product_id = p_product and variant_id = p_variant and brand_id = bid and country_id = p_country and status <> 'closed';
  if existing is not null then
    raise exception 'Already here' using errcode = '23505', detail = existing::text;
  end if;

  pack := nullif(public.tidy_case(p_pack_name), '');
  if pack is null then
    select b.name || ' ' || v.name || ' ' || coalesce(public.local_name('product', p_product, p_country), p.name)
      into pack from public.variants v join public.products p on p.id = v.product_id, public.brands b
     where v.id = p_variant and b.id = bid;
  end if;
  insert into public.items (product_id, variant_id, brand_id, country_id, pack_name, image_path, image_url, barcode, status, submitted_by)
  values (p_product, p_variant, bid, p_country, pack, p_image_path, p_image_url, p_barcode, 'pending', u)
  returning id into iid;
  insert into public.approvals (item_id, user_id) values (iid, u);
  if p_score is not null then
    insert into public.planned_ratings (item_id, user_id, score) values (iid, u, p_score);
  end if;
  return iid;
end $$;

-- Into a ranking that doesn't exist yet: the sender names it in plain words. Waits for the owner's check.
-- p_product / p_new_variant are the site's guess at how to file it (optional). Returns the request's id.
create or replace function public.submit_item_request(p_country int, p_category int, p_new_ranking text, p_brand_name text,
                                                      p_pack_name text default null, p_product int default null,
                                                      p_new_variant text default null, p_image_path text default null,
                                                      p_image_url text default null, p_barcode text default null,
                                                      p_score int default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); nr text := public.tidy_case(p_new_ranking, true);
        nv text := nullif(public.tidy_case(p_new_variant, true), ''); brand text; pack text; rid bigint; found_name text;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if not exists (select 1 from public.categories c where c.id = p_category) then
    raise exception 'Pick a type first' using errcode = '22023';
  end if;
  if p_product is not null and not exists (select 1 from public.products p where p.id = p_product and p.category_id = p_category) then
    raise exception 'That product isn''t in this type' using errcode = '22023';
  end if;
  if nr = '' then raise exception 'Name the ranking' using errcode = '22023'; end if;
  if pg_catalog.char_length(nr) > 60 then raise exception 'Keep the ranking name under 60 letters' using errcode = '22023'; end if;
  if public.clean(p_brand_name) = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  perform public.check_snack_extras(u, p_image_path, p_image_url, p_barcode, p_score);
  -- Already a ranking (by its title in this country, or its usual title)? Then it goes in through submit_item instead.
  select public.ranking_title(v.id, p_country) into found_name from public.variants v
   where public.norm(public.ranking_title(v.id, p_country)) = public.norm(nr) or public.norm(v.title) = public.norm(nr)
   limit 1;
  if found_name is not null then
    raise exception '% is already a ranking. Pick it from the list.', found_name using errcode = 'P0001';
  end if;

  brand := coalesce((select name from public.brands where name_key = public.norm(p_brand_name)), public.tidy_case(p_brand_name));
  pack := coalesce(nullif(public.tidy_case(p_pack_name), ''), brand || ' ' || nr);
  insert into public.item_requests (country_id, category_id, new_ranking, product_id, new_variant, brand_name, pack_name,
                                    image_path, image_url, barcode, score, user_id)
  values (p_country, p_category, nr, p_product, nv, brand, pack, p_image_path, p_image_url, p_barcode, p_score, u)
  returning id into rid;
  return rid;
end $$;

-- Your own submissions, including snacks waiting for a check ('review') or turned down ('declined').
-- Their ids start with "r" so they never clash with snack ids.
create or replace function public.my_submissions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
    select i.created_at, jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
             'product_id', i.product_id, 'variant_id', i.variant_id, 'country_id', i.country_id,
             'status', public.status_now(i.status, i.created_at),
             'approvals', (select count(*) from public.approvals a where a.item_id = i.id), 'created_at', i.created_at) j
    from public.items i join public.brands b on b.id = i.brand_id
    where i.submitted_by = auth.uid()
    union all
    select r.created_at, jsonb_build_object('id', 'r' || r.id, 'pack_name', r.pack_name, 'brand', r.brand_name,
             'country_id', r.country_id, 'category_id', r.category_id, 'new_ranking', r.new_ranking,
             'status', r.status, 'approvals', 0, 'created_at', r.created_at) j
    from public.item_requests r
    where r.user_id = auth.uid() and r.status <> 'accepted'   -- once accepted, the snack itself is listed above
  ) x
$$;

-- ---------- 4. For the owner (SQL Editor only) ----------
-- What's waiting, oldest first, with the guess accept_request() will use unless you give your own.
create or replace function public.review_list()
returns table (id bigint, sent date, country text, type text, new_ranking text, guess text, brand text, pack_name text,
               photo text, barcode text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.created_at::date, pl.short_name, coalesce(public.local_name('category', c.id, r.country_id), c.name), r.new_ranking,
         case when p.id is not null then p.name || ' › ' || coalesce(r.new_variant, 'Original')
              else 'new product "' || r.new_ranking || '" › Original' end,
         r.brand_name, r.pack_name,
         case when r.image_path is not null then 'upload' when r.image_url is not null then 'Open Food Facts' end,
         r.barcode
  from public.item_requests r
  join public.places pl on pl.id = r.country_id
  join public.categories c on c.id = r.category_id
  left join public.products p on p.id = r.product_id
  where r.status = 'review' order by r.created_at
$$;

-- Accept: files the new ranking under a product (the guess, or one you name, or a new one named after the ranking),
-- adds the variant unless one with that name exists, then sends the snack to the vote with the sender's approval
-- and "Tried it?" face, just as if they'd picked it from the list.
create or replace function public.accept_request(p_request bigint, p_product_name text default null,
                                                 p_variant_name text default null, p_title text default null,
                                                 p_emoji text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.item_requests; pid int; vid int; pname text; vname text; bid bigint; iid bigint; existing bigint;
begin
  select * into r from public.item_requests where id = p_request for update;
  if not found or r.status <> 'review' then raise exception 'Request % isn''t waiting for review', p_request; end if;

  -- The product
  if nullif(public.clean(p_product_name), '') is not null then
    pname := public.tidy_case(p_product_name, true);
    select id into pid from public.products where public.norm(name) = public.norm(pname);
  elsif r.product_id is not null then
    pid := r.product_id;
  else
    pname := r.new_ranking;
    select id into pid from public.products where public.norm(name) = public.norm(pname);
  end if;
  if pid is null then
    pid := (select coalesce(max(id), 0) + 1 from public.products);
    insert into public.products (id, category_id, name, emoji, sort)
    values (pid, r.category_id, pname, coalesce(nullif(public.clean(p_emoji), ''), '🍽️'),
            (select coalesce(max(sort), 0) + 1 from public.products));
    update public.categories set visible = true where id = r.category_id;
  end if;

  -- The variant: yours, else the guess (only when the guessed product is used), else Original
  vname := coalesce(nullif(public.tidy_case(p_variant_name, true), ''),
                    case when pid = r.product_id then r.new_variant end, 'Original');
  select id into vid from public.variants where product_id = pid and name_key = public.norm(vname);
  if vid is null then
    vid := (select coalesce(max(id), 0) + 1 from public.variants);
    insert into public.variants (id, product_id, name, title, is_default, sort)
    values (vid, pid, vname, coalesce(nullif(public.clean(p_title), ''), r.new_ranking), public.norm(vname) = 'original',
            (select coalesce(max(sort), 0) + 1 from public.variants where product_id = pid));
  end if;

  -- The snack, sent to the vote on the sender's behalf
  select id into bid from public.brands where name_key = public.norm(r.brand_name);
  if bid is null then
    insert into public.brands (name, status, submitted_by) values (r.brand_name, 'pending', r.user_id) returning id into bid;
  end if;
  update public.items set status = 'closed'   -- one that closed after 30 days can be sent in again
   where product_id = pid and variant_id = vid and brand_id = bid and country_id = r.country_id
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  select id into existing from public.items
   where product_id = pid and variant_id = vid and brand_id = bid and country_id = r.country_id and status <> 'closed';
  if existing is not null then
    update public.item_requests set status = 'accepted', item_id = existing, reviewed_at = now() where id = p_request;
    return public.ranking_title(vid, r.country_id) || ' is listed. ' || r.brand_name || ' was already there (snack ' || existing
           || '), so nothing new was sent to the vote.';
  end if;
  insert into public.items (product_id, variant_id, brand_id, country_id, pack_name, image_path, image_url, barcode, status, submitted_by)
  values (pid, vid, bid, r.country_id, r.pack_name, r.image_path, r.image_url, r.barcode, 'pending', r.user_id)
  returning id into iid;
  if r.user_id is not null then
    insert into public.approvals (item_id, user_id) values (iid, r.user_id);
    if r.score is not null then
      insert into public.planned_ratings (item_id, user_id, score) values (iid, r.user_id, r.score);
    end if;
  end if;
  update public.item_requests set status = 'accepted', item_id = iid, reviewed_at = now() where id = p_request;
  return 'Added ' || r.pack_name || ' to ' || public.ranking_title(vid, r.country_id) || ': it''s now in the vote.';
end $$;

create or replace function public.decline_request(p_request bigint) returns text
language plpgsql security definer set search_path = '' as $$
begin
  update public.item_requests set status = 'declined', reviewed_at = now() where id = p_request and status = 'review';
  if not found then raise exception 'Request % isn''t waiting for review', p_request; end if;
  return 'Declined. The sender will see "Not this time".';
end $$;

-- ---------- 5. Local names for types ----------
-- Like products ("Chips" in the US), types can have a name per country. Chocolate is the same everywhere.
alter table public.local_names drop constraint if exists local_names_kind_check;
alter table public.local_names add constraint local_names_kind_check check (kind in ('product', 'variant', 'title', 'category'));
insert into public.local_names (kind, target_id, place_id, name) values
  ('category', 2, 2, 'Candy'),   ('category', 3, 2, 'Chips & Snacks'),   -- United States
  ('category', 2, 3, 'Lollies'), ('category', 3, 3, 'Chips & Snacks'),   -- Australia
  ('category', 2, 4, 'Candy'),   ('category', 3, 4, 'Chips & Snacks'),   -- Japan
  ('category', 2, 5, 'Candy'),   ('category', 3, 5, 'Chips & Snacks')    -- China
on conflict (kind, target_id, place_id) do nothing;

-- The three places a type's name reaches the site, now with the local name (otherwise unchanged from migration 004).
create or replace function public.home_rankings(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  r as (
    select v.product_id, v.id as variant_id, p.category_id, coalesce(public.local_name('category', c.id, p_country), c.name) as category, p.sort as psort, v.sort as vsort,
           public.ranking_title(v.id, p_country) as title,
           (select count(*) from t where t.variant_id = v.id)::int as brands,
           (select coalesce(sum(t.total), 0) from t where t.variant_id = v.id)::int as ratings,
           (select jsonb_build_object('item_id', t.id, 'brand', t.brand, 'pack_name', t.pack_name, 'avg', t.avg, 'ratings', t.total)
              from t where t.variant_id = v.id and t.ranked order by t.avg desc, t.total desc, t.id limit 1) as top,
           (select coalesce(jsonb_agg(jsonb_build_object('image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji)), '[]'::jsonb)
              from (select * from t where t.variant_id = v.id order by t.total desc, t.id limit 3) x) as photos
    from public.variants v
    join public.products p on p.id = v.product_id
    join public.categories c on c.id = p.category_id and c.visible
    where exists (select 1 from t where t.variant_id = v.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'variant_id', variant_id, 'title', title,
           'category_id', category_id, 'category', category, 'brands', brands, 'ratings', ratings, 'top', top, 'photos', photos)
         order by ratings desc, psort, vsort), '[]'::jsonb)
  from r
$$;

create or replace function public.ranking(p_product int, p_variant int, p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  live as (
    select t.*, (select count(*) from t t2 where t2.brand_id = t.brand_id and t2.product_id = t.product_id)::int as brand_variants
    from t where t.product_id = p_product and t.variant_id = p_variant
  ),
  pend as (
    select i.id, b.name as brand, i.pack_name, i.image_url, i.image_path, p.emoji,
           (select count(*) from public.approvals a where a.item_id = i.id)::int as approvals,
           exists (select 1 from public.approvals a where a.item_id = i.id and a.user_id = auth.uid()) as approved,
           coalesce(i.submitted_by = auth.uid(), false) as mine,
           greatest(0, (public.app_settings()->>'close_after_days')::int - extract(day from now() - i.created_at)::int) as days_left
    from public.items i join public.brands b on b.id = i.brand_id join public.products p on p.id = i.product_id
    where i.product_id = p_product and i.variant_id = p_variant and i.country_id = p_country
      and public.status_now(i.status, i.created_at) = 'pending'
  )
  select case when v.id is null then null else jsonb_build_object(
    'title', public.ranking_title(p_variant, p_country),
    'category', coalesce(public.local_name('category', c.id, p_country), c.name),
    'product', coalesce(public.local_name('product', p_product, p_country), p.name),
    'variant', coalesce(public.local_name('variant', p_variant, p_country), v.name),
    'country', jsonb_build_object('id', pl.id, 'name', pl.name, 'short_name', pl.short_name, 'flag', pl.flag),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v2.id,
                    'name', coalesce(public.local_name('variant', v2.id, p_country), v2.name),
                    'title', public.ranking_title(v2.id, p_country)) order by v2.sort)
                  from public.variants v2 where v2.product_id = p_product
                    and exists (select 1 from t where t.variant_id = v2.id)), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'brand_id', l.brand_id, 'brand', l.brand,
                    'pack_name', l.pack_name, 'image_url', l.image_url, 'image_path', l.image_path, 'emoji', l.emoji,
                    'r1', l.r1, 'r2', l.r2, 'r3', l.r3, 'r4', l.r4, 'r5', l.r5, 'total', l.total, 'avg', l.avg,
                    'ranked', l.ranked, 'my_score', l.my_score, 'brand_variants', l.brand_variants)
                  order by l.ranked desc, case when l.ranked then l.avg end desc nulls last, l.total desc, l.id)
                  from live l), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(to_jsonb(pe) order by pe.mine desc, pe.approvals desc, pe.id) from pend pe), '[]'::jsonb))
  end
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  join public.places pl on pl.id = p_country
  where v.id = p_variant and v.product_id = p_product
$$;

create or replace function public.catalogue(p_country int default 1) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(public.local_name('category', c.id, p_country), c.name),
           'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id,
                          'name', coalesce(public.local_name('product', p.id, p_country), p.name), 'emoji', p.emoji,
                          'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id,
                                          'name', coalesce(public.local_name('variant', v.id, p_country), v.name),
                                          'title', public.ranking_title(v.id, p_country)) order by v.sort), '[]'::jsonb)
                                       from public.variants v where v.product_id = p.id)) order by p.sort), '[]'::jsonb)
                        from public.products p where p.category_id = c.id))
         order by c.sort), '[]'::jsonb)
  from public.categories c where c.visible
$$;

-- ---------- 6. Who may call what ----------
revoke execute on function public.review_list(), public.accept_request(bigint, text, text, text, text),
  public.decline_request(bigint), public.check_submission_limit(uuid),
  public.check_snack_extras(uuid, text, text, text, int), public.cap_first(text), public.tidy_case(text, boolean),
  public.guess_title(text, text) from public, anon, authenticated;
revoke execute on function public.submit_item_request(int, int, text, text, text, int, text, text, text, text, int),
  public.submit_item(int, int, int, text, text, text, int, text, text), public.my_submissions() from public, anon;
grant execute on function public.submit_item_request(int, int, text, text, text, int, text, text, text, text, int),
  public.submit_item(int, int, int, text, text, text, int, text, text), public.my_submissions() to authenticated;

commit;
