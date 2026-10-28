-- TasteRank migration 004: brand-against-brand rankings
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
--
-- The structure (see design/DATA-MODEL.md):
--   Category › Product › Variant are curated (by the database owner); brands and items are added by people.
--   An ITEM is one brand's version of a product variant, sold in one country: Walkers · Crisps · Salt & vinegar · UK.
--   A RANKING is one product + variant in one country; items are ranked once they have 10 ratings.
--   PLACES are countries and regions, plus Unknown; where someone lives is optional.
--
-- What it does:
--   1. Checks that migration 002's tables hold no real ratings or approvals, then removes them.
--   2. Renames the original foods table `items` to `legacy_items` (nothing deleted) so the new `items` can use the name,
--      and repoints the two old functions that read it. The current website keeps working until it's replaced.
--   3. Creates the new tables, rules and functions.
--   4. Loads the starter data: 5 countries, the UK's 12 regions, 3 launch categories, 48 items.
--
-- Security: the website never reads or writes these tables directly; everything goes through the functions below,
-- which check who is signed in and enforce the rules. Nobody can see who rated or submitted what.

begin;

-- ---------- 1. Remove migration 002's structure (only if nobody has used it) ----------
do $$
begin
  -- Only while migration 002's structure is still here (the flavours table is its marker), so a second run
  -- never touches the new tables that reuse some of the same names.
  if to_regclass('public.flavours') is not null then
    if exists (select 1 from public.flavour_ratings) or exists (select 1 from public.product_votes)
       or exists (select 1 from public.flavour_votes) or exists (select 1 from public.planned_ratings) then
      raise exception 'Migration 002 tables contain ratings or approvals from real people. Nothing was changed. Ask Claude before removing them.';
    end if;
    drop function if exists public.product_list(text), public.product_detail(bigint), public.search_products(text),
      public.product_for_item(bigint), public.product_countries(), public.rate_flavour(bigint, int),
      public.approve_product(bigint), public.approve_flavour(bigint),
      public.submit_product(text, text, text, text, text[], text, text), public.submit_flavour(bigint, text, int),
      public.promote_product(bigint), public.promote_flavour(bigint), public.copy_legacy_items(),
      public.check_submission_limit(uuid), public.my_rating_count(), public.my_ratings(), public.my_submissions();
    drop table public.planned_ratings, public.flavour_votes, public.product_votes, public.flavour_ratings,
      public.flavours, public.products;
  end if;
end $$;

-- ---------- 2. Keep the original foods under a new name ----------
do $$
begin
  if to_regclass('public.legacy_items') is null and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'category') then
    alter table public.items rename to legacy_items;
  end if;
end $$;

-- These two read the old table by name, so they follow it to its new name.
create or replace function public.item_list()
returns table (id bigint, name text, brand text, country text, category text, emoji text, image_url text, status text,
               r1 int, r2 int, r3 int, r4 int, r5 int, votes int, mine boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.name, i.brand, i.country, i.category, i.emoji, i.image_url, i.status,
         count(r.score) filter (where r.score = 1)::int,
         count(r.score) filter (where r.score = 2)::int,
         count(r.score) filter (where r.score = 3)::int,
         count(r.score) filter (where r.score = 4)::int,
         count(r.score) filter (where r.score = 5)::int,
         (select count(*) from public.votes v where v.item_id = i.id)::int,
         coalesce(i.submitted_by = auth.uid(), false)
  from public.legacy_items i
  left join public.ratings r on r.item_id = i.id
  group by i.id
  order by i.id;
$$;

create or replace function public.promote_when_approved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.legacy_items set status = 'live'
   where id = new.item_id and status = 'pending'
     and (select count(*) from public.votes v where v.item_id = new.item_id) >= 5;
  return new;
end $$;

-- ---------- 3. Settings and helpers ----------
create or replace function public.app_settings() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"approval_votes": 5, "rank_after_ratings": 10, "close_after_days": 30, "max_open_submissions": 10,
           "brand_card_variants": 5, "group_min_ratings": 10}'::jsonb
$$;
-- norm(), clean(), status_now() and require_user() come from migration 002 and are kept as they are.

-- ---------- 4. Tables ----------
create table if not exists public.places (
  id int primary key,
  parent_id int references public.places(id),
  level text not null check (level in ('country', 'region', 'unknown')),
  name text not null,
  short_name text not null,
  adjective text,                 -- "Japanese", for "the Japanese versions"
  code text not null unique,      -- ISO 3166 for countries; official ITL1 codes for UK regions
  flag text not null default '',
  in_picker boolean not null default false,
  sort int not null default 0
);

create table if not exists public.categories (
  id int primary key,
  name text not null unique,
  visible boolean not null default false,
  sort int not null
);

create table if not exists public.products (
  id int primary key,
  category_id int not null references public.categories(id),
  name text not null unique,
  emoji text not null default '🍽️',   -- shown when an item has no photo
  sort int not null
);

create table if not exists public.variants (
  id int primary key,
  product_id int not null references public.products(id),
  name text not null,
  title text not null,             -- the ranking's title, written by hand: "Salt & vinegar crisps"
  is_default boolean not null default false,
  sort int not null,
  name_key text generated always as (public.norm(name)) stored,
  unique (product_id, name_key),
  unique (product_id, id)
);

create table if not exists public.local_names (
  kind text not null check (kind in ('product', 'variant', 'title')),
  target_id int not null,
  place_id int not null references public.places(id),
  name text not null,
  primary key (kind, target_id, place_id)
);

create table if not exists public.brands (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 60),
  name_key text generated always as (public.norm(name)) stored unique,
  status text not null default 'pending' check (status in ('pending', 'live')),
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id bigint generated always as identity primary key,
  product_id int not null references public.products(id),
  variant_id int not null,
  brand_id bigint not null references public.brands(id),
  country_id int not null references public.places(id),
  pack_name text not null check (char_length(pack_name) between 1 and 120),
  image_url text check (image_url is null or (image_url ~ '^https://images\.openfoodfacts\.org/' and char_length(image_url) <= 500)),
  image_path text check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  status text not null default 'pending' check (status in ('pending', 'live', 'closed')),
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (product_id, variant_id) references public.variants(product_id, id)
);
-- One item per brand, variant and country (closed ones don't count, so they can be sent in again).
create unique index if not exists items_one_per_brand on public.items (product_id, variant_id, brand_id, country_id)
  where status <> 'closed';
create index if not exists items_by_ranking on public.items (product_id, variant_id, country_id);

create table if not exists public.item_ratings (
  item_id bigint not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  rater_place_id int not null default 0 references public.places(id),  -- where they lived when they rated
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists item_ratings_by_user on public.item_ratings (user_id);

create table if not exists public.rating_events (    -- every rating and change, never edited
  id bigint generated always as identity primary key,
  item_id bigint not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  rater_place_id int not null default 0 references public.places(id),
  created_at timestamptz not null default now()
);

create table if not exists public.approvals (
  item_id bigint not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table if not exists public.planned_ratings (  -- "Tried it?" while adding; saved for real once the item is live
  item_id bigint not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  primary key (item_id, user_id)
);

create table if not exists public.catalogue_suggestions (  -- read by Vera in the Table Editor
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('product', 'variant')),
  text text not null check (char_length(text) between 1 and 120),
  created_at timestamptz not null default now()
);

-- ---------- 5. Starter data: places, catalogue ----------
insert into public.places (id, parent_id, level, name, short_name, adjective, code, flag, in_picker, sort) values
  (0, null, 'unknown', 'Unknown', 'Unknown', null, 'ZZ', '', false, 99),
  (1, null, 'country', 'United Kingdom', 'UK', 'British', 'GB', '🇬🇧', true, 1),
  (2, null, 'country', 'United States', 'US', 'American', 'US', '🇺🇸', true, 2),
  (3, null, 'country', 'Australia', 'Australia', 'Australian', 'AU', '🇦🇺', true, 3),
  (4, null, 'country', 'Japan', 'Japan', 'Japanese', 'JP', '🇯🇵', true, 4),
  (5, null, 'country', 'China', 'China', 'Chinese', 'CN', '🇨🇳', true, 5),
  (101, 1, 'region', 'Scotland', 'Scotland', null, 'TLM', '', false, 1),
  (102, 1, 'region', 'Wales', 'Wales', null, 'TLL', '', false, 2),
  (103, 1, 'region', 'Northern Ireland', 'Northern Ireland', null, 'TLN', '', false, 3),
  (104, 1, 'region', 'North East', 'North East', null, 'TLC', '', false, 4),
  (105, 1, 'region', 'North West', 'North West', null, 'TLD', '', false, 5),
  (106, 1, 'region', 'Yorkshire & the Humber', 'Yorkshire & the Humber', null, 'TLE', '', false, 6),
  (107, 1, 'region', 'East Midlands', 'East Midlands', null, 'TLF', '', false, 7),
  (108, 1, 'region', 'West Midlands', 'West Midlands', null, 'TLG', '', false, 8),
  (109, 1, 'region', 'East of England', 'East of England', null, 'TLH', '', false, 9),
  (110, 1, 'region', 'London', 'London', null, 'TLI', '', false, 10),
  (111, 1, 'region', 'South East', 'South East', null, 'TLJ', '', false, 11),
  (112, 1, 'region', 'South West', 'South West', null, 'TLK', '', false, 12)
on conflict (id) do update set parent_id = excluded.parent_id, level = excluded.level, name = excluded.name,
  short_name = excluded.short_name, adjective = excluded.adjective, code = excluded.code, flag = excluded.flag,
  in_picker = excluded.in_picker, sort = excluded.sort;

-- Where someone lives: optional, Unknown until they say.
alter table public.profiles add column if not exists home_place_id int not null default 0 references public.places(id);

insert into public.categories (id, name, visible, sort) values
  (1, 'Chocolate', true, 1), (2, 'Sweets', true, 2), (3, 'Crisps & Snacks', true, 3),
  (4, 'Biscuits & Cereal Bars', false, 4), (5, 'Mints & Chewing Gum', false, 5),
  (6, 'Nuts & Seeds', false, 6), (7, 'Crackers & Crispbreads', false, 7)
on conflict (id) do update set name = excluded.name, visible = excluded.visible, sort = excluded.sort;

insert into public.products (id, category_id, name, emoji, sort) values
  (1, 1, 'Chocolate bars', '🍫', 1), (2, 2, 'Toffee', '🍬', 2), (3, 3, 'Crisps', '🥔', 3)
on conflict (id) do update set category_id = excluded.category_id, name = excluded.name, emoji = excluded.emoji, sort = excluded.sort;

insert into public.variants (id, product_id, name, title, is_default, sort) values
  (1, 1, 'Milk chocolate', 'Milk chocolate bars', true, 1),
  (2, 2, 'Original', 'Toffee', true, 1),
  (3, 2, 'Chocolate-covered', 'Chocolate-covered toffee', false, 2),
  (4, 3, 'Salt & vinegar', 'Salt & vinegar crisps', false, 1),
  (5, 3, 'Cheese & onion', 'Cheese & onion crisps', false, 2),
  (6, 3, 'Ready salted', 'Ready salted crisps', true, 3)
on conflict (id) do update set product_id = excluded.product_id, name = excluded.name, title = excluded.title,
  is_default = excluded.is_default, sort = excluded.sort;

insert into public.local_names (kind, target_id, place_id, name) values
  ('product', 3, 2, 'Chips'), ('product', 3, 3, 'Chips'), ('product', 3, 4, 'Potato chips'), ('product', 3, 5, 'Potato chips'),
  ('product', 2, 4, 'Caramel'), ('product', 2, 5, 'Milk candy'),
  ('variant', 6, 4, 'Lightly salted (うすしお)'), ('variant', 6, 5, 'Original (原味)'),
  ('variant', 2, 4, 'Milk caramel'), ('variant', 2, 5, 'Milk candy (奶糖)'),
  ('title', 4, 2, 'Salt & vinegar chips'), ('title', 4, 3, 'Salt & vinegar chips'),
  ('title', 5, 2, 'Cheese & onion chips'), ('title', 5, 3, 'Cheese & onion chips'),
  ('title', 6, 2, 'Plain chips'), ('title', 6, 3, 'Plain chips'),
  ('title', 6, 4, 'Lightly salted potato chips (うすしお)'), ('title', 6, 5, 'Original potato chips (原味)'),
  ('title', 2, 4, 'Milk caramel'), ('title', 2, 5, 'Milk candy (奶糖)')
on conflict (kind, target_id, place_id) do update set name = excluded.name;

-- ---------- 6. Security: no direct access; the functions below do all reading and writing ----------
alter table public.places                enable row level security;
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.variants              enable row level security;
alter table public.local_names           enable row level security;
alter table public.brands                enable row level security;
alter table public.items                 enable row level security;
alter table public.item_ratings          enable row level security;
alter table public.rating_events         enable row level security;
alter table public.approvals             enable row level security;
alter table public.planned_ratings       enable row level security;
alter table public.catalogue_suggestions enable row level security;
revoke all on table public.places, public.categories, public.products, public.variants, public.local_names,
  public.brands, public.items, public.item_ratings, public.rating_events, public.approvals, public.planned_ratings,
  public.catalogue_suggestions from anon, authenticated;

-- ---------- 7. Internal steps (not callable from the website) ----------
create or replace function public.local_name(p_kind text, p_id int, p_place int) returns text
language sql stable security definer set search_path = '' as $$
  select l.name from public.local_names l where l.kind = p_kind and l.target_id = p_id and l.place_id = p_place
$$;

create or replace function public.ranking_title(p_variant int, p_country int) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(public.local_name('title', p_variant, p_country), v.title) from public.variants v where v.id = p_variant
$$;

-- Live items with their rating totals; the building block for every view.
create or replace function public.item_totals(p_country int)
returns table (id bigint, product_id int, variant_id int, brand_id bigint, brand text, pack_name text,
               image_url text, image_path text, emoji text, r1 int, r2 int, r3 int, r4 int, r5 int,
               total int, avg numeric, ranked boolean, my_score int)
language sql stable security definer set search_path = '' as $$
  select i.id, i.product_id, i.variant_id, i.brand_id, b.name, i.pack_name, i.image_url, i.image_path, p.emoji,
         count(r.score) filter (where r.score = 1)::int, count(r.score) filter (where r.score = 2)::int,
         count(r.score) filter (where r.score = 3)::int, count(r.score) filter (where r.score = 4)::int,
         count(r.score) filter (where r.score = 5)::int, count(r.score)::int, round(avg(r.score), 2),
         count(r.score) >= (public.app_settings()->>'rank_after_ratings')::int,
         (select m.score from public.item_ratings m where m.item_id = i.id and m.user_id = auth.uid())::int
  from public.items i
  join public.brands b on b.id = i.brand_id
  join public.products p on p.id = i.product_id
  left join public.item_ratings r on r.item_id = i.id
  where i.country_id = p_country and i.status = 'live'
  group by i.id, b.name, p.emoji
$$;

create or replace function public.check_submission_limit(u uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare lim int := (public.app_settings()->>'max_open_submissions')::int;
begin
  if (select count(*) from public.items i where i.submitted_by = u and public.status_now(i.status, i.created_at) = 'pending') >= lim then
    raise exception 'You already have % things waiting for approval. Add more once some go live.', lim using errcode = 'P0001';
  end if;
end $$;

-- 5 approvals → the item goes live, its new brand with it, and any "Tried it?" rating is saved.
create or replace function public.promote_item(p_item bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare b bigint;
begin
  if (select count(*) from public.approvals a where a.item_id = p_item) < (public.app_settings()->>'approval_votes')::int then
    return false;
  end if;
  update public.items set status = 'live' where id = p_item and status = 'pending' returning brand_id into b;
  if b is null then return false; end if;
  update public.brands set status = 'live' where id = b and status = 'pending';
  insert into public.item_ratings (item_id, user_id, score, rater_place_id)
    select pr.item_id, pr.user_id, pr.score, coalesce(pf.home_place_id, 0)
    from public.planned_ratings pr left join public.profiles pf on pf.id = pr.user_id
    where pr.item_id = p_item
  on conflict do nothing;
  insert into public.rating_events (item_id, user_id, score, rater_place_id)
    select pr.item_id, pr.user_id, pr.score, coalesce(pf.home_place_id, 0)
    from public.planned_ratings pr left join public.profiles pf on pf.id = pr.user_id
    where pr.item_id = p_item;
  delete from public.planned_ratings where item_id = p_item;
  return true;
end $$;

-- ---------- 8. What signed-in people can do ----------
-- Rate a live item (or change your rating). Returns how many items you've rated, for the 10-rating moment.
create or replace function public.rate_item(p_item bigint, p_score int) returns int
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); place int;
begin
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Pick a face from 1 to 5' using errcode = '22023';
  end if;
  if not exists (select 1 from public.items where id = p_item and status = 'live') then
    raise exception 'This item can''t be rated yet' using errcode = 'P0001';
  end if;
  select coalesce((select home_place_id from public.profiles where id = u), 0) into place;
  insert into public.item_ratings (item_id, user_id, score, rater_place_id, updated_at)
  values (p_item, u, p_score, place, now())
  on conflict (item_id, user_id) do update
    set score = excluded.score, rater_place_id = excluded.rater_place_id, updated_at = excluded.updated_at;
  insert into public.rating_events (item_id, user_id, score, rater_place_id) values (p_item, u, p_score, place);
  return (select count(*) from public.item_ratings where user_id = u);
end $$;

-- Approve an item waiting for approval. Approving twice changes nothing.
create or replace function public.approve_item(p_item bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); i public.items;
begin
  select * into i from public.items where id = p_item for update;
  if not found or public.status_now(i.status, i.created_at) <> 'pending' then
    raise exception 'This item isn''t waiting for approval' using errcode = 'P0001';
  end if;
  insert into public.approvals (item_id, user_id) values (p_item, u) on conflict do nothing;
  perform public.promote_item(p_item);
  return jsonb_build_object('approvals', (select count(*) from public.approvals where item_id = p_item),
                            'status', (select status from public.items where id = p_item));
end $$;

-- Send in a new item (and its brand, if new). Counts as the first approval. Returns the new item's id.
-- A duplicate raises "Already here" with the existing item's id in the error detail.
create or replace function public.submit_item(p_product int, p_variant int, p_country int, p_brand_name text,
                                              p_pack_name text default null, p_image_path text default null,
                                              p_score int default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); bid bigint; iid bigint; existing bigint; pack text;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.variants v where v.id = p_variant and v.product_id = p_product) then
    raise exception 'Pick a product and variant from the list' using errcode = '22023';
  end if;
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if public.clean(p_brand_name) = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  if p_image_path is not null and pg_catalog.split_part(p_image_path, '/', 1) <> u::text then
    raise exception 'Photos must be uploaded to your own folder' using errcode = '42501';
  end if;
  if p_score is not null and p_score not between 1 and 5 then
    raise exception 'Pick a face from 1 to 5' using errcode = '22023';
  end if;

  select id into bid from public.brands where name_key = public.norm(p_brand_name);
  if bid is null then
    insert into public.brands (name, status, submitted_by) values (public.clean(p_brand_name), 'pending', u) returning id into bid;
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

  pack := nullif(public.clean(p_pack_name), '');
  if pack is null then
    select public.clean(p_brand_name) || ' ' || v.name || ' ' || coalesce(public.local_name('product', p_product, p_country), p.name)
      into pack from public.variants v join public.products p on p.id = v.product_id where v.id = p_variant;
  end if;
  insert into public.items (product_id, variant_id, brand_id, country_id, pack_name, image_path, status, submitted_by)
  values (p_product, p_variant, bid, p_country, pack, p_image_path, 'pending', u)
  returning id into iid;
  insert into public.approvals (item_id, user_id) values (iid, u);
  if p_score is not null then
    insert into public.planned_ratings (item_id, user_id, score) values (iid, u, p_score);
  end if;
  return iid;
end $$;

-- "Not listed? Suggest a product or variant"
create or replace function public.suggest_catalogue(p_kind text, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user();
begin
  insert into public.catalogue_suggestions (user_id, kind, text) values (u, p_kind, public.clean(p_text));
end $$;

-- Where you live: a country, a region, or Unknown (0).
create or replace function public.set_home_place(p_place int) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user();
begin
  if not exists (select 1 from public.places where id = p_place) then
    raise exception 'Unknown place' using errcode = '22023';
  end if;
  insert into public.profiles (id, home_place_id) values (u, p_place)
  on conflict (id) do update set home_place_id = excluded.home_place_id;
end $$;

-- ---------- 9. What everyone can read (totals only, never who rated or submitted) ----------
-- Countries in the picker, each with its regions.
create or replace function public.place_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'short_name', c.short_name,
           'adjective', c.adjective, 'code', c.code, 'flag', c.flag,
           'regions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.sort)
                                 from public.places r where r.parent_id = c.id), '[]'::jsonb))
         order by c.sort), '[]'::jsonb)
  from public.places c where c.level = 'country' and c.in_picker
$$;

-- Home: one card per ranking with live items in that country.
create or replace function public.home_rankings(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  r as (
    select v.product_id, v.id as variant_id, p.category_id, c.name as category, p.sort as psort, v.sort as vsort,
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

-- Brands with 5+ live variants of one product in a country get their own card on home.
create or replace function public.brand_cards(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country))
  select coalesce(jsonb_agg(jsonb_build_object('brand_id', g.brand_id, 'brand', g.brand, 'product_id', g.product_id,
           'product', coalesce(public.local_name('product', g.product_id, p_country), p.name), 'variants', g.n, 'ratings', g.ratings)
         order by g.ratings desc), '[]'::jsonb)
  from (select brand_id, brand, product_id, count(*)::int as n, sum(total)::int as ratings from t group by brand_id, brand, product_id) g
  join public.products p on p.id = g.product_id
  where g.n >= (public.app_settings()->>'brand_card_variants')::int
$$;

-- A ranking page: one product + variant in one country.
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
    'category', c.name,
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

-- A brand's items of one product in one country, each with its place in its own ranking.
create or replace function public.brand_view(p_brand bigint, p_product int, p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  placed as (
    select t.*, (select count(*) from t t2 where t2.variant_id = t.variant_id and t2.product_id = t.product_id)::int as of_n,
           case when t.ranked then (select count(*) + 1 from t t2 where t2.product_id = t.product_id and t2.variant_id = t.variant_id
                                      and t2.ranked and (t2.avg > t.avg or (t2.avg = t.avg and t2.total > t.total)))::int end as place
    from t where t.product_id = p_product
  )
  select jsonb_build_object(
    'brand', b.name,
    'product', coalesce(public.local_name('product', p_product, p_country), p.name),
    'country', jsonb_build_object('id', pl.id, 'short_name', pl.short_name, 'flag', pl.flag),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'variant_id', x.variant_id,
                    'variant', coalesce(public.local_name('variant', x.variant_id, p_country), v.name),
                    'ranking_title', public.ranking_title(x.variant_id, p_country),
                    'pack_name', x.pack_name, 'image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji,
                    'total', x.total, 'avg', x.avg, 'ranked', x.ranked, 'my_score', x.my_score,
                    'place_in_ranking', x.place, 'ranking_size', x.of_n)
                  order by x.ranked desc, case when x.ranked then x.avg end desc nulls last, x.total desc, x.id)
                  from placed x join public.variants v on v.id = x.variant_id where x.brand_id = p_brand), '[]'::jsonb))
  from public.brands b, public.products p, public.places pl
  where b.id = p_brand and p.id = p_product and pl.id = p_country
$$;

-- What the "Next" button suggests after rating p_item:
--   1. another brand in the same ranking (those still short of 10 ratings first),
--   2. another variant from the same brand (1 and 2 swap when coming from a brand view),
--   3. a nearby ranking: another variant of the same product, then another product in the same category,
--   4. done.
create or replace function public.next_to_rate(p_item bigint, p_from_brand_view boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.items; same_ranking jsonb; same_brand jsonb; nearby jsonb; need int := (public.app_settings()->>'rank_after_ratings')::int;
begin
  select * into i from public.items where id = p_item;
  if not found then return jsonb_build_object('kind', 'done'); end if;

  select jsonb_build_object('kind', 'item', 'id', t.id, 'short_label', t.brand) into same_ranking
  from public.item_totals(i.country_id) t
  where t.product_id = i.product_id and t.variant_id = i.variant_id and t.id <> i.id and t.my_score is null
  order by (t.total < need) desc, t.total, t.id limit 1;

  select jsonb_build_object('kind', 'item', 'id', t.id,
           'short_label', coalesce(public.local_name('variant', t.variant_id, i.country_id), v.name)) into same_brand
  from public.item_totals(i.country_id) t join public.variants v on v.id = t.variant_id
  where t.product_id = i.product_id and t.brand_id = i.brand_id and t.variant_id <> i.variant_id and t.my_score is null
  order by t.total, t.id limit 1;

  if p_from_brand_view then
    if same_brand is not null then return same_brand; end if;
    if same_ranking is not null then return same_ranking; end if;
  else
    if same_ranking is not null then return same_ranking; end if;
    if same_brand is not null then return same_brand; end if;
  end if;

  select jsonb_build_object('kind', 'ranking', 'product_id', t.product_id, 'variant_id', t.variant_id,
           'title', public.ranking_title(t.variant_id, i.country_id)) into nearby
  from public.item_totals(i.country_id) t
  join public.products p on p.id = t.product_id
  join public.variants v on v.id = t.variant_id
  where t.my_score is null and not (t.product_id = i.product_id and t.variant_id = i.variant_id)
    and p.category_id = (select category_id from public.products where id = i.product_id)
  order by (t.product_id = i.product_id) desc, p.sort, v.sort limit 1;
  return coalesce(nearby, jsonb_build_object('kind', 'done'));
end $$;

-- Search across every country: every word typed must appear in the brand, pack name, product or variant.
create or replace function public.search_items(q text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.live desc, x.pack_name), '[]'::jsonb) from (
    select jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name, 'status', public.status_now(i.status, i.created_at),
             'product_id', i.product_id, 'variant_id', i.variant_id, 'country_id', i.country_id,
             'country', pl.short_name, 'flag', pl.flag, 'ranking_title', public.ranking_title(i.variant_id, i.country_id),
             'image_url', i.image_url, 'image_path', i.image_path, 'emoji', p.emoji) as j,
           i.status = 'live' as live, i.pack_name
    from public.items i
    join public.brands b on b.id = i.brand_id
    join public.products p on p.id = i.product_id
    join public.variants v on v.id = i.variant_id
    join public.places pl on pl.id = i.country_id
    where char_length(public.norm(q)) >= 2
      and public.status_now(i.status, i.created_at) in ('live', 'pending')
      and not exists (select 1 from pg_catalog.regexp_split_to_table(public.norm(q), ' ') w
                      where pg_catalog.strpos(b.name_key || ' ' || public.norm(i.pack_name) || ' ' || public.norm(p.name)
                                              || ' ' || v.name_key || ' ' || public.norm(public.ranking_title(v.id, i.country_id)), w) = 0)
    order by i.status = 'live' desc, i.pack_name
    limit 20
  ) x
$$;

-- The curated lists for "What kind of snack?", with local names for the chosen country.
create or replace function public.catalogue(p_country int default 1) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
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

-- Live brands matching what's been typed (for the brand field).
create or replace function public.brand_suggest(q text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by (b.name_key like public.norm(q) || '%') desc, b.name), '[]'::jsonb)
  from (select * from public.brands b where b.status = 'live' and char_length(public.norm(q)) >= 1
          and pg_catalog.strpos(b.name_key, public.norm(q)) > 0 order by b.name limit 8) b
$$;

-- ---------- 10. What signed-in people can read about themselves ----------
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'taster_id', '#' || upper(left(replace(auth.uid()::text, '-', ''), 6)),
    'home_place', (select jsonb_build_object('id', pl.id, 'level', pl.level, 'name', pl.name, 'short_name', pl.short_name,
                     'country_id', case when pl.level = 'region' then pl.parent_id when pl.level = 'country' then pl.id end,
                     'country_name', case when pl.level = 'region' then par.name when pl.level = 'country' then pl.name end,
                     'flag', coalesce(nullif(pl.flag, ''), par.flag, ''))
                   from public.profiles pf join public.places pl on pl.id = pf.home_place_id
                   left join public.places par on par.id = pl.parent_id where pf.id = auth.uid()),
    'rated', (select count(*) from public.item_ratings where user_id = auth.uid()),
    'rankings_helped', (select count(distinct (i.product_id, i.variant_id, i.country_id))
                        from public.item_ratings r join public.items i on i.id = r.item_id where r.user_id = auth.uid()))
  where auth.uid() is not null
$$;

create or replace function public.my_rating_count() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.item_ratings where user_id = auth.uid()
$$;

create or replace function public.my_ratings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
           'product_id', i.product_id, 'variant_id', i.variant_id, 'country_id', i.country_id, 'flag', pl.flag,
           'ranking_title', public.ranking_title(i.variant_id, i.country_id), 'score', r.score,
           'image_url', i.image_url, 'image_path', i.image_path, 'emoji', p.emoji) order by r.updated_at desc), '[]'::jsonb)
  from public.item_ratings r join public.items i on i.id = r.item_id join public.brands b on b.id = i.brand_id
  join public.places pl on pl.id = i.country_id join public.products p on p.id = i.product_id
  where r.user_id = auth.uid()
$$;

-- Your own submissions and where they stand, for the "it's live!" and "not this time" moments.
create or replace function public.my_submissions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
           'product_id', i.product_id, 'variant_id', i.variant_id, 'country_id', i.country_id,
           'status', public.status_now(i.status, i.created_at),
           'approvals', (select count(*) from public.approvals a where a.item_id = i.id), 'created_at', i.created_at)
         order by i.created_at desc), '[]'::jsonb)
  from public.items i join public.brands b on b.id = i.brand_id
  where i.submitted_by = auth.uid()
$$;

-- ---------- 11. Who may call what ----------
revoke execute on function public.local_name(text, int, int), public.ranking_title(int, int), public.item_totals(int),
  public.check_submission_limit(uuid), public.promote_item(bigint) from public, anon, authenticated;
revoke execute on function public.rate_item(bigint, int), public.approve_item(bigint),
  public.submit_item(int, int, int, text, text, text, int), public.suggest_catalogue(text, text),
  public.set_home_place(int), public.my_profile(), public.my_rating_count(), public.my_ratings(),
  public.my_submissions() from public, anon;
grant execute on function public.rate_item(bigint, int), public.approve_item(bigint),
  public.submit_item(int, int, int, text, text, text, int), public.suggest_catalogue(text, text),
  public.set_home_place(int), public.my_profile(), public.my_rating_count(), public.my_ratings(),
  public.my_submissions() to authenticated;
grant execute on function public.app_settings(), public.place_list(), public.home_rankings(int), public.brand_cards(int),
  public.ranking(int, int, int), public.brand_view(bigint, int, int), public.next_to_rate(bigint, boolean),
  public.search_items(text), public.catalogue(int), public.brand_suggest(text) to anon, authenticated;

-- ---------- 12. Starter items (no ratings: every rating will be real) ----------
-- Country ids: 1 UK, 2 US, 3 Australia, 4 Japan, 5 China. Product/variant ids are in section 5.
create temporary table seed_items (country_id int, product_id int, variant_id int, brand text, pack_name text, image_url text) on commit drop;
insert into seed_items values
  -- United Kingdom
  (1, 1, 1, 'Cadbury', 'Cadbury Dairy Milk Chocolate Bar', 'https://images.openfoodfacts.org/images/products/762/221/049/7383/front.7.400.jpg'),
  (1, 1, 1, 'KitKat', 'KitKat Finger Milk Chocolate Bar', null),
  (1, 1, 1, 'Tony''s Chocolonely', 'Tony''s Chocolonely Milk Chocolate 32%', null),
  (1, 2, 2, 'Werther''s', 'Werther''s Original', 'https://images.openfoodfacts.org/images/products/401/440/091/8953/front_en.3.400.jpg'),
  (1, 2, 2, 'M&S', 'M&S Double Devon Toffees', null),
  (1, 2, 2, 'Walker''s Nonsuch', 'Walker''s Nonsuch Original Creamy Toffee', null),
  (1, 2, 2, 'Thorntons', 'Thorntons Special Toffee', 'https://images.openfoodfacts.org/images/products/501/634/614/2729/front_en.5.400.jpg'),
  (1, 3, 4, 'Walkers', 'Walkers Salt & Vinegar Crisps', 'https://images.openfoodfacts.org/images/products/57522241/front_en.12.400.jpg'),
  (1, 3, 4, 'Hula Hoops', 'Hula Hoops Salt & Vinegar', 'https://images.openfoodfacts.org/images/products/500/023/713/9523/front_en.3.400.jpg'),
  (1, 3, 4, 'KETTLE', 'KETTLE Chips Sea Salt & Balsamic Vinegar of Modena', 'https://images.openfoodfacts.org/images/products/501/776/443/0092/front_en.3.400.jpg'),
  (1, 3, 4, 'Jacob''s', 'Jacob''s Crinklys Salt & Vinegar 30% Less Fat', null),
  (1, 3, 4, 'Pringles', 'Pringles Salt & Vinegar', 'https://images.openfoodfacts.org/images/products/505/399/015/8362/front_en.3.400.jpg'),
  (1, 3, 5, 'Walkers', 'Walkers Cheese & Onion Crisps', 'https://images.openfoodfacts.org/images/products/13917821/front_en.14.400.jpg'),
  (1, 3, 5, 'Golden Wonder', 'Golden Wonder Cheese & Onion Crisps', null),
  (1, 3, 5, 'KETTLE', 'KETTLE Chips Mature Cheddar & Red Onion', 'https://images.openfoodfacts.org/images/products/501/776/412/8142/front_en.11.400.jpg'),
  -- United States
  (2, 1, 1, 'Hershey''s', 'Hershey''s Milk Chocolate Bar', 'https://images.openfoodfacts.org/images/products/03424005/front.6.400.jpg'),
  (2, 1, 1, 'Dove', 'Dove Milk Chocolate Bar', 'https://images.openfoodfacts.org/images/products/004/000/045/9842/front_en.7.400.jpg'),
  (2, 1, 1, 'KitKat', 'Kit Kat Milk Chocolate Wafer Bar', null),
  (2, 1, 1, 'Lindt', 'Lindt Classic Recipe Milk Chocolate Bar', 'https://images.openfoodfacts.org/images/products/000/954/244/5140/front_en.3.400.jpg'),
  (2, 2, 3, 'Heath', 'Heath Milk Chocolate English Toffee Bar', 'https://images.openfoodfacts.org/images/products/001/070/006/0679/front_en.5.400.jpg'),
  (2, 2, 3, 'Skor', 'Skor Butter Toffee Bar', null),
  (2, 2, 3, 'Almond Roca', 'Brown & Haley Almond Roca Buttercrunch Toffee', 'https://images.openfoodfacts.org/images/products/004/177/005/1809/front_en.3.400.jpg'),
  (2, 3, 4, 'Lay''s', 'Lay''s Salt & Vinegar Potato Chips', 'https://images.openfoodfacts.org/images/products/002/840/001/7503/front_en.16.400.jpg'),
  (2, 3, 4, 'Kettle Brand', 'Kettle Brand Sea Salt & Vinegar Potato Chips', null),
  (2, 3, 4, 'Cape Cod', 'Cape Cod Sea Salt & Vinegar Kettle Cooked Potato Chips', null),
  (2, 3, 4, 'Utz', 'Utz Salt''n Vinegar Potato Chips', 'https://images.openfoodfacts.org/images/products/004/178/019/0246/front_en.3.400.jpg'),
  (2, 3, 4, 'Pringles', 'Pringles Salt & Vinegar', 'https://images.openfoodfacts.org/images/products/003/800/013/8607/front_en.27.400.jpg'),
  -- Australia
  (3, 1, 1, 'Cadbury', 'Cadbury Dairy Milk Chocolate Block', 'https://images.openfoodfacts.org/images/products/930/061/700/3328/front_en.26.400.jpg'),
  (3, 1, 1, 'Whittaker''s', 'Whittaker''s Creamy Milk Chocolate Block', null),
  (3, 1, 1, 'KitKat', 'KitKat Milk Chocolate 4 Finger', null),
  (3, 2, 2, 'Werther''s', 'Werther''s Original', 'https://images.openfoodfacts.org/images/products/401/440/090/0897/front_en.63.400.jpg'),
  (3, 2, 2, 'Allen''s', 'Allen''s Fantales', 'https://images.openfoodfacts.org/images/products/930/060/515/1161/front_en.3.400.jpg'),
  (3, 3, 4, 'Smith''s', 'Smith''s Salt & Vinegar Chips', 'https://images.openfoodfacts.org/images/products/931/001/524/3707/front_en.3.400.jpg'),
  (3, 3, 4, 'KETTLE', 'Kettle Sea Salt & Vinegar', 'https://images.openfoodfacts.org/images/products/931/098/801/6063/front_en.8.400.jpg'),
  (3, 3, 4, 'Pringles', 'Pringles Salt & Vinegar', 'https://images.openfoodfacts.org/images/products/888/646/710/3445/front_en.17.400.jpg'),
  -- Japan
  (4, 1, 1, 'Meiji', 'Meiji Milk Chocolate (明治ミルクチョコレート)', null),
  (4, 1, 1, 'Lotte', 'Lotte Ghana Milk (ガーナミルク)', null),
  (4, 1, 1, 'KitKat', 'KitKat Mini Milk Chocolate (キットカット ミニ)', null),
  (4, 2, 2, 'Morinaga', 'Morinaga Milk Caramel (森永ミルクキャラメル)', null),
  (4, 2, 2, 'Werther''s', 'Werther''s Original (ヴェルタースオリジナル)', null),
  (4, 3, 6, 'Calbee', 'Calbee Potato Chips Usushio (うすしお味)', null),
  (4, 3, 6, 'Pringles', 'Pringles Original', null),
  -- China
  (5, 1, 1, 'Dove', 'Dove Silky Milk Chocolate (德芙丝滑牛奶巧克力)', null),
  (5, 1, 1, 'Hershey''s', 'Hershey''s Milk Chocolate (好时牛奶巧克力)', null),
  (5, 2, 2, 'White Rabbit', 'White Rabbit Creamy Candy (大白兔奶糖)', 'https://images.openfoodfacts.org/images/products/692/202/473/0043/front.3.400.jpg'),
  (5, 2, 2, 'Alpenliebe', 'Alpenliebe Caramel Milk Candy (阿尔卑斯焦糖牛奶糖)', null),
  (5, 3, 6, 'Lay''s', 'Lay''s Original Potato Chips (乐事原味薯片)', null),
  (5, 3, 6, 'Pringles', 'Pringles Original (品客原味)', null);

insert into public.brands (name, status)
  select distinct s.brand, 'live' from seed_items s
  on conflict (name_key) do update set status = 'live';
insert into public.items (product_id, variant_id, brand_id, country_id, pack_name, image_url, status)
  select s.product_id, s.variant_id, b.id, s.country_id, s.pack_name, s.image_url, 'live'
  from seed_items s join public.brands b on b.name_key = public.norm(s.brand)
on conflict (product_id, variant_id, brand_id, country_id) where status <> 'closed' do nothing;

-- What you should see after pressing Run:
select (select count(*) from public.places) as places, (select count(*) from public.brands) as brands,
       (select count(*) from public.items) as items, (select count(*) from public.item_ratings) as ratings;

commit;
