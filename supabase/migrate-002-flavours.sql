-- TasteRank migration 002: products and flavours
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
--
-- What it does:
--   * Adds the new structure: Country → Product → Flavours.
--       products         a snack in one country (or 'Global'); 'pending' until 5 approvals, then 'live'
--       flavours         the flavours of a product; flavours sent in with a new product are approved with it,
--                        flavours added later need 5 approvals of their own
--       flavour_ratings  one emoji rating (1-5) per person per flavour
--       product_votes    approvals for new products (and the flavours sent in with them)
--       flavour_votes    approvals for flavours added to a live product
--       planned_ratings  a rating picked while adding a flavour, saved for real once the flavour goes live
--   * Copies the existing foods, ratings and approvals across (each food becomes a product with one flavour).
--   * Adds the 'product-photos' storage bucket for photo uploads.
--   * Leaves the old tables (items, ratings, votes) and item_list() untouched, so the current website keeps
--     working until the new one (build prompt 03) goes live. They are removed later, once Vera confirms.
--
-- Security: the website never reads or writes these tables directly. Everything goes through the functions
-- below, which check who is signed in and enforce the rules. Nobody can see who rated or submitted what.

begin;

-- ---------- Small helpers ----------
-- Names are compared ignoring capitals, extra spaces, curly apostrophes and "&" vs "and".
create or replace function public.norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.replace(pg_catalog.translate(pg_catalog.lower(coalesce(t, '')), E'’‘', ''''''), '&', ' and '),
           '\s+', ' ', 'g'))
$$;

-- Tidy a name before saving it: single spaces, no spaces at either end.
create or replace function public.clean(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))
$$;

-- The rules in one place, so the website can read them instead of keeping its own copy.
create or replace function public.app_settings() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"approval_votes": 5, "rank_after_ratings": 10, "close_after_days": 30, "max_open_submissions": 10}'::jsonb
$$;

-- Pending things close after 30 days. Worked out when reading, so no scheduled job is needed.
create or replace function public.status_now(status text, created_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when status = 'pending'
               and created_at < now() - make_interval(days => (public.app_settings()->>'close_after_days')::int)
              then 'closed' else status end
$$;

-- ---------- Tables ----------
create table if not exists public.products (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 80),
  brand text not null default '' check (char_length(brand) <= 60),
  country text not null check (char_length(country) between 1 and 60),          -- a country name, or 'Global'
  category text not null check (category in ('Chocolate & sweets','Crisps & snacks','Biscuits','Drinks','Spreads & sauces')),
  emoji text not null default '🍽️' check (char_length(emoji) <= 8),
  -- Photos: only uploads to our own storage, or Open Food Facts for the starter foods
  image_path text check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  image_url text check (image_url is null or (image_url ~ '^https://images\.openfoodfacts\.org/' and char_length(image_url) <= 500)),
  status text not null default 'pending' check (status in ('pending','live','closed')),
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  name_key text generated always as (public.norm(name)) stored,
  brand_key text generated always as (public.norm(brand)) stored
);
-- No two open products with the same name and brand in the same country.
create unique index if not exists products_same_name on public.products (country, name_key, brand_key) where status <> 'closed';

create table if not exists public.flavours (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  status text not null default 'pending' check (status in ('pending','live','closed')),
  with_product boolean not null default false,   -- sent in with a new product: goes live when the product does
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  legacy_item_id bigint unique,                  -- the old items.id, so old links (#/item/5) can redirect
  name_key text generated always as (public.norm(name)) stored
);
create unique index if not exists flavours_same_name on public.flavours (product_id, name_key) where status <> 'closed';

create table if not exists public.flavour_ratings (
  flavour_id bigint not null references public.flavours(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (flavour_id, user_id)
);
create index if not exists flavour_ratings_by_user on public.flavour_ratings (user_id);

create table if not exists public.product_votes (
  product_id bigint not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, user_id)
);

create table if not exists public.flavour_votes (
  flavour_id bigint not null references public.flavours(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (flavour_id, user_id)
);

create table if not exists public.planned_ratings (
  flavour_id bigint not null references public.flavours(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  primary key (flavour_id, user_id)
);

-- ---------- Security: no direct access; the functions below do all reading and writing ----------
alter table public.products        enable row level security;
alter table public.flavours        enable row level security;
alter table public.flavour_ratings enable row level security;
alter table public.product_votes   enable row level security;
alter table public.flavour_votes   enable row level security;
alter table public.planned_ratings enable row level security;
revoke all on table public.products, public.flavours, public.flavour_ratings,
                    public.product_votes, public.flavour_votes, public.planned_ratings from anon, authenticated;

-- ---------- Internal steps (not callable from the website) ----------
create or replace function public.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  return u;
end $$;

-- At most 10 things waiting for approval per person, so nobody can flood the queue.
create or replace function public.check_submission_limit(u uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare lim int := (public.app_settings()->>'max_open_submissions')::int;
begin
  if (select count(*) from public.products p where p.submitted_by = u and public.status_now(p.status, p.created_at) = 'pending')
   + (select count(*) from public.flavours f where f.submitted_by = u and not f.with_product
                                               and public.status_now(f.status, f.created_at) = 'pending') >= lim then
    raise exception 'You already have % things waiting for approval. Add more once some go live.', lim using errcode = 'P0001';
  end if;
end $$;

-- 5 approvals → the product and the flavours sent in with it go live.
create or replace function public.promote_product(pid bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.product_votes v where v.product_id = pid) < (public.app_settings()->>'approval_votes')::int then
    return false;
  end if;
  update public.products set status = 'live' where id = pid and status = 'pending';
  if not found then return false; end if;
  update public.flavours set status = 'live' where product_id = pid and with_product and status = 'pending';
  insert into public.flavour_ratings (flavour_id, user_id, score)
    select pr.flavour_id, pr.user_id, pr.score from public.planned_ratings pr
    join public.flavours f on f.id = pr.flavour_id where f.product_id = pid and f.status = 'live'
    on conflict do nothing;
  delete from public.planned_ratings pr using public.flavours f
   where f.id = pr.flavour_id and f.product_id = pid and f.status = 'live';
  return true;
end $$;

-- 5 approvals → a flavour added to a live product goes live.
create or replace function public.promote_flavour(fid bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.flavour_votes v where v.flavour_id = fid) < (public.app_settings()->>'approval_votes')::int then
    return false;
  end if;
  update public.flavours set status = 'live' where id = fid and status = 'pending';
  if not found then return false; end if;
  insert into public.flavour_ratings (flavour_id, user_id, score)
    select flavour_id, user_id, score from public.planned_ratings where flavour_id = fid
    on conflict do nothing;
  delete from public.planned_ratings where flavour_id = fid;
  return true;
end $$;

-- ---------- What signed-in people can do ----------
-- Rate a live flavour (or change your rating). Returns how many flavours you've rated, for the 10-rating moment.
create or replace function public.rate_flavour(p_flavour bigint, p_score int) returns int
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user();
begin
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Pick a face from 1 to 5' using errcode = '22023';
  end if;
  if not exists (select 1 from public.flavours f join public.products p on p.id = f.product_id
                 where f.id = p_flavour and f.status = 'live' and p.status = 'live') then
    raise exception 'This flavour can''t be rated yet' using errcode = 'P0001';
  end if;
  insert into public.flavour_ratings (flavour_id, user_id, score, updated_at) values (p_flavour, u, p_score, now())
  on conflict (flavour_id, user_id) do update set score = excluded.score, updated_at = excluded.updated_at;
  return (select count(*) from public.flavour_ratings where user_id = u);
end $$;

-- Approve a product waiting for approval. Approving twice changes nothing.
create or replace function public.approve_product(p_product bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); p public.products;
begin
  select * into p from public.products where id = p_product for update;
  if not found or public.status_now(p.status, p.created_at) <> 'pending' then
    raise exception 'This product isn''t waiting for approval' using errcode = 'P0001';
  end if;
  insert into public.product_votes (product_id, user_id) values (p_product, u) on conflict do nothing;
  perform public.promote_product(p_product);
  return jsonb_build_object('votes', (select count(*) from public.product_votes where product_id = p_product),
                            'status', (select status from public.products where id = p_product));
end $$;

-- Approve a flavour added to a live product. Approving twice changes nothing.
create or replace function public.approve_flavour(p_flavour bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); f public.flavours;
begin
  select * into f from public.flavours where id = p_flavour for update;
  if not found or f.with_product or public.status_now(f.status, f.created_at) <> 'pending'
     or not exists (select 1 from public.products p where p.id = f.product_id and p.status = 'live') then
    raise exception 'This flavour isn''t waiting for approval' using errcode = 'P0001';
  end if;
  insert into public.flavour_votes (flavour_id, user_id) values (p_flavour, u) on conflict do nothing;
  perform public.promote_flavour(p_flavour);
  return jsonb_build_object('votes', (select count(*) from public.flavour_votes where flavour_id = p_flavour),
                            'status', (select status from public.flavours where id = p_flavour));
end $$;

-- Send in a new product with its first flavours. Counts as the first approval. Returns the new product id.
create or replace function public.submit_product(p_name text, p_brand text, p_country text, p_category text,
                                                 p_flavours text[], p_image_path text default null, p_emoji text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); pid bigint; fl text; seen text[] := '{}';
begin
  perform public.check_submission_limit(u);
  if p_image_path is not null and pg_catalog.split_part(p_image_path, '/', 1) <> u::text then
    raise exception 'Photos must be uploaded to your own folder' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_flavours), 0) not between 1 and 20 then
    raise exception 'Add between 1 and 20 flavours' using errcode = '22023';
  end if;
  -- A submission that closed after 30 days can be sent in again.
  update public.products set status = 'closed'
   where country = public.clean(p_country) and name_key = public.norm(p_name) and brand_key = public.norm(p_brand)
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  begin
    insert into public.products (name, brand, country, category, emoji, image_path, status, submitted_by)
    values (public.clean(p_name), public.clean(p_brand), public.clean(p_country), p_category,
            coalesce(nullif(public.clean(p_emoji), ''), '🍽️'), p_image_path, 'pending', u)
    returning id into pid;
  exception when unique_violation then
    raise exception 'Already here: % is already on TasteRank', public.clean(p_name) using errcode = '23505';
  end;
  foreach fl in array p_flavours loop
    continue when public.norm(fl) = '' or public.norm(fl) = any(seen);
    seen := seen || public.norm(fl);
    insert into public.flavours (product_id, name, status, with_product, submitted_by)
    values (pid, public.clean(fl), 'pending', true, u);
  end loop;
  if cardinality(seen) = 0 then raise exception 'Add at least one flavour' using errcode = '22023'; end if;
  insert into public.product_votes (product_id, user_id) values (pid, u);
  return pid;
end $$;

-- Add a flavour to a live product. Counts as the first approval. An optional rating is saved once it goes live.
create or replace function public.submit_flavour(p_product bigint, p_name text, p_score int default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); fid bigint;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.products where id = p_product and status = 'live') then
    raise exception 'Flavours can only be added to a live product' using errcode = 'P0001';
  end if;
  if p_score is not null and p_score not between 1 and 5 then
    raise exception 'Pick a face from 1 to 5' using errcode = '22023';
  end if;
  update public.flavours set status = 'closed'
   where product_id = p_product and name_key = public.norm(p_name) and not with_product
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  begin
    insert into public.flavours (product_id, name, status, with_product, submitted_by)
    values (p_product, public.clean(p_name), 'pending', false, u)
    returning id into fid;
  exception when unique_violation then
    raise exception 'Already here: % is already a flavour of this product', public.clean(p_name) using errcode = '23505';
  end;
  insert into public.flavour_votes (flavour_id, user_id) values (fid, u);
  if p_score is not null then
    insert into public.planned_ratings (flavour_id, user_id, score) values (fid, u, p_score);
  end if;
  return fid;
end $$;

-- ---------- What everyone can read (totals only, never who rated or submitted) ----------
-- Countries that have live products, for the country picker.
create or replace function public.product_countries()
returns table (country text, products int)
language sql stable security definer set search_path = '' as $$
  select p.country, count(*)::int from public.products p where p.status = 'live'
  group by p.country order by p.country
$$;

-- Products in one country ('Global' is its own choice): live ones with their current top flavour
-- (only flavours with 10+ ratings can be top), then open ones waiting for approval.
create or replace function public.product_list(p_country text)
returns table (id bigint, name text, brand text, country text, category text, emoji text, image_url text, image_path text,
               status text, flavour_count int, rating_count int,
               top_flavour_id bigint, top_flavour text, top_avg numeric, top_ratings int,
               votes int, voted boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  with prods as (
    select p.*, public.status_now(p.status, p.created_at) as state from public.products p
    where p.country = p_country
  ), fl as (
    select f.id, f.product_id, f.name, count(r.score)::int as n, avg(r.score) as a
    from public.flavours f left join public.flavour_ratings r on r.flavour_id = f.id
    where f.status = 'live' and f.product_id in (select prods.id from prods)
    group by f.id
  ), top as (
    select distinct on (fl.product_id) fl.product_id, fl.id, fl.name, fl.a, fl.n
    from fl where fl.n >= (public.app_settings()->>'rank_after_ratings')::int
    order by fl.product_id, fl.a desc, fl.n desc, fl.name
  )
  select p.id, p.name, p.brand, p.country, p.category, p.emoji, p.image_url, p.image_path, p.state,
         (select count(*)::int from fl where fl.product_id = p.id),
         coalesce((select sum(fl.n)::int from fl where fl.product_id = p.id), 0),
         t.id, t.name, round(t.a, 2), t.n,
         (select count(*)::int from public.product_votes v where v.product_id = p.id),
         exists (select 1 from public.product_votes v where v.product_id = p.id and v.user_id = auth.uid()),
         coalesce(p.submitted_by = auth.uid(), false)
  from prods p left join top t on t.product_id = p.id
  where p.state in ('live', 'pending')
  order by p.state = 'live' desc,
           coalesce((select sum(fl.n) from fl where fl.product_id = p.id), 0) desc, p.name
$$;

-- One product with every flavour: rating counts r1..r5, totals, approvals, and your own rating.
-- Returns null for a closed product unless it's yours.
create or replace function public.product_detail(p_product bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with p as (
    select pr.*, public.status_now(pr.status, pr.created_at) as state from public.products pr where pr.id = p_product
  ), f as (
    select fv.*, case when fv.with_product and fv.status = 'pending' then (select p.state from p)
                      else public.status_now(fv.status, fv.created_at) end as state
    from public.flavours fv where fv.product_id = p_product
  ), fr as (
    select f.id, f.name, f.state, f.with_product,
           count(r.score) filter (where r.score = 1)::int as r1, count(r.score) filter (where r.score = 2)::int as r2,
           count(r.score) filter (where r.score = 3)::int as r3, count(r.score) filter (where r.score = 4)::int as r4,
           count(r.score) filter (where r.score = 5)::int as r5, count(r.score)::int as total, round(avg(r.score), 2) as avg,
           (select count(*)::int from public.flavour_votes v where v.flavour_id = f.id) as votes,
           exists (select 1 from public.flavour_votes v where v.flavour_id = f.id and v.user_id = auth.uid()) as voted,
           coalesce(f.submitted_by = auth.uid(), false) as mine,
           (select r2.score from public.flavour_ratings r2 where r2.flavour_id = f.id and r2.user_id = auth.uid()) as my_score
    from f left join public.flavour_ratings r on r.flavour_id = f.id
    where f.state <> 'closed' or f.submitted_by = auth.uid()
    group by f.id, f.name, f.state, f.with_product, f.submitted_by
  )
  select case when p.id is null or (p.state = 'closed' and p.submitted_by is distinct from auth.uid()) then null
    else jsonb_build_object(
      'product', jsonb_build_object('id', p.id, 'name', p.name, 'brand', p.brand, 'country', p.country, 'category', p.category,
        'emoji', p.emoji, 'image_url', p.image_url, 'image_path', p.image_path, 'status', p.state,
        'votes', (select count(*) from public.product_votes v where v.product_id = p.id),
        'voted', exists (select 1 from public.product_votes v where v.product_id = p.id and v.user_id = auth.uid()),
        'mine', coalesce(p.submitted_by = auth.uid(), false)),
      'flavours', coalesce((select jsonb_agg(to_jsonb(fr) order by fr.total desc, fr.name) from fr), '[]'::jsonb))
    end
  from p
$$;

-- "Search first" when adding a product: matches across every country, ignoring capitals, "&"/"and" and spacing.
-- Every word typed must appear in the brand or name.
create or replace function public.search_products(q text)
returns table (id bigint, name text, brand text, country text, category text, emoji text, image_url text, image_path text,
               status text, flavour_count int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.brand, p.country, p.category, p.emoji, p.image_url, p.image_path,
         public.status_now(p.status, p.created_at),
         (select count(*)::int from public.flavours f where f.product_id = p.id and f.status = 'live')
  from public.products p
  where char_length(public.norm(q)) >= 2
    and public.status_now(p.status, p.created_at) in ('live', 'pending')
    and not exists (select 1 from pg_catalog.regexp_split_to_table(public.norm(q), ' ') w
                    where pg_catalog.strpos(p.brand_key || ' ' || p.name_key, w) = 0)
  order by p.status = 'live' desc, p.name
  limit 20
$$;

-- Old links (#/item/5) → the product that food became.
create or replace function public.product_for_item(p_item bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select f.product_id from public.flavours f where f.legacy_item_id = p_item
$$;

-- ---------- What signed-in people can read about themselves ----------
create or replace function public.my_rating_count() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.flavour_ratings where user_id = auth.uid()
$$;

create or replace function public.my_ratings()
returns table (flavour_id bigint, flavour text, product_id bigint, product text, country text, emoji text,
               image_url text, image_path text, score int, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.name, p.id, p.name, p.country, p.emoji, p.image_url, p.image_path, r.score, r.updated_at
  from public.flavour_ratings r join public.flavours f on f.id = r.flavour_id join public.products p on p.id = f.product_id
  where r.user_id = auth.uid() order by r.updated_at desc
$$;

-- Your own products and flavours with where they stand, for the "it's live!" and "not this time" moments.
create or replace function public.my_submissions()
returns table (kind text, id bigint, product_id bigint, name text, product_name text, status text, votes int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'product', p.id, p.id, p.name, p.name, public.status_now(p.status, p.created_at),
         (select count(*)::int from public.product_votes v where v.product_id = p.id), p.created_at
  from public.products p where p.submitted_by = auth.uid()
  union all
  select 'flavour', f.id, f.product_id, f.name, p.name, public.status_now(f.status, f.created_at),
         (select count(*)::int from public.flavour_votes v where v.flavour_id = f.id), f.created_at
  from public.flavours f join public.products p on p.id = f.product_id
  where f.submitted_by = auth.uid() and not f.with_product
  order by 8 desc
$$;

-- ---------- Copy the old foods across (safe to run again: it only adds what's missing) ----------
-- Each food becomes a product with one flavour. Starter foods are split where it's obvious;
-- everything else gets the flavour "Original". Ratings and approvals come too.
create or replace function public.copy_legacy_items() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it record; pname text; fname text; pid bigint; fid bigint; added int := 0;
begin
  for it in select i.* from public.items i
            where not exists (select 1 from public.flavours f where f.legacy_item_id = i.id) order by i.id loop
    select v.product, v.flavour into pname, fname from (values
      (1, 'Cadbury Dairy Milk', 'Original'), (2, 'McVitie''s Digestives', 'Milk Chocolate'),
      (3, 'Yorkshire Tea', 'Original'), (4, 'Walkers Crisps', 'Salt & Vinegar'), (5, 'Marmite', 'Original'),
      (6, 'McVitie''s Jaffa Cakes', 'Original'), (7, 'Percy Pigs', 'Original'), (8, 'Colman''s English Mustard', 'Original'),
      (9, 'KitKat', 'Matcha'), (10, 'Pocky', 'Chocolate'), (11, 'Jagariko', 'Original'), (12, 'Ramune', 'Original'),
      (13, 'Reese''s Peanut Butter Cups', 'Original'), (14, 'Goldfish Crackers', 'Original'), (15, 'A&W Root Beer', 'Original'),
      (16, 'Bonne Maman Jam', 'Apricot'), (17, 'LU Petit Beurre', 'Original'), (18, 'Carambar', 'Original'),
      (19, 'Takis', 'Fuego'), (20, 'Valentina Salsa Picante', 'Original'), (21, 'Tunnock''s Caramel Wafer', 'Original'),
      (22, 'Hello Panda', 'Original')
    ) as v(item_id, product, flavour) where v.item_id = it.id and it.submitted_by is null;
    if not found then pname := it.name; fname := 'Original'; end if;

    select p.id into pid from public.products p
     where p.country = it.country and p.name_key = public.norm(pname) and p.brand_key = public.norm(it.brand) and p.status <> 'closed';
    if pid is null then
      insert into public.products (name, brand, country, category, emoji, image_url, status, submitted_by, created_at)
      values (pname, it.brand, it.country, it.category, it.emoji,
              case when it.image_url ~ '^https://images\.openfoodfacts\.org/' then it.image_url end,
              it.status, it.submitted_by,
              -- starter foods waiting for approval get a fresh 30 days
              case when it.status = 'pending' and it.submitted_by is null then now() else it.created_at end)
      returning id into pid;
    end if;

    select f.id into fid from public.flavours f where f.product_id = pid and f.name_key = public.norm(fname) and f.status <> 'closed';
    if fid is null then
      insert into public.flavours (product_id, name, status, with_product, submitted_by, created_at, legacy_item_id)
      values (pid, fname, it.status, it.status = 'pending', it.submitted_by, it.created_at, it.id);
    else
      update public.flavours set legacy_item_id = it.id where id = fid and legacy_item_id is null;
    end if;
    added := added + 1;
  end loop;

  -- Foods that went live on the old site since the last copy
  update public.flavours f set status = 'live' from public.items i
   where f.legacy_item_id = i.id and i.status = 'live' and f.status = 'pending';
  update public.products p set status = 'live' from public.flavours f, public.items i
   where f.product_id = p.id and f.legacy_item_id = i.id and i.status = 'live' and p.status = 'pending';

  -- Ratings (keeping the newest if someone rated on both sites) and approvals
  insert into public.flavour_ratings (flavour_id, user_id, score, updated_at)
    select f.id, r.user_id, r.score, r.updated_at from public.ratings r join public.flavours f on f.legacy_item_id = r.item_id
  on conflict (flavour_id, user_id) do update set score = excluded.score, updated_at = excluded.updated_at
    where public.flavour_ratings.updated_at < excluded.updated_at;
  insert into public.product_votes (product_id, user_id, created_at)
    select f.product_id, v.user_id, v.created_at from public.votes v
    join public.flavours f on f.legacy_item_id = v.item_id join public.products p on p.id = f.product_id
    where p.status = 'pending'
  on conflict do nothing;
  perform public.promote_product(p.id) from public.products p where p.status = 'pending';

  return jsonb_build_object('foods_added', added,
    'products', (select count(*) from public.products), 'flavours', (select count(*) from public.flavours),
    'ratings', (select count(*) from public.flavour_ratings), 'approvals', (select count(*) from public.product_votes));
end $$;

-- ---------- Who may call what ----------
-- Internal steps: only the database itself.
revoke execute on function public.require_user(), public.check_submission_limit(uuid), public.promote_product(bigint),
  public.promote_flavour(bigint), public.copy_legacy_items() from public, anon, authenticated;
-- Signed-in only.
revoke execute on function public.rate_flavour(bigint, int), public.approve_product(bigint), public.approve_flavour(bigint),
  public.submit_product(text, text, text, text, text[], text, text), public.submit_flavour(bigint, text, int),
  public.my_rating_count(), public.my_ratings(), public.my_submissions() from public, anon;
grant execute on function public.rate_flavour(bigint, int), public.approve_product(bigint), public.approve_flavour(bigint),
  public.submit_product(text, text, text, text, text[], text, text), public.submit_flavour(bigint, text, int),
  public.my_rating_count(), public.my_ratings(), public.my_submissions() to authenticated;
-- Everyone.
grant execute on function public.app_settings(), public.product_countries(), public.product_list(text),
  public.product_detail(bigint), public.search_products(text), public.product_for_item(bigint) to anon, authenticated;

-- ---------- Photo storage ----------
-- Anyone can view photos; signed-in people can upload into a folder named after their own user id.
-- Max 1 MB; JPEG, PNG or WebP. No overwriting or deleting (there are no update/delete rules).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "upload product photos to own folder" on storage.objects;
create policy "upload product photos to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- ---------- Copy the foods now ----------
select public.copy_legacy_items();

commit;
