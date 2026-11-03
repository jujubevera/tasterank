-- TasteRank migration 011: the owner page (design/mockups/owner.html), at tasterank.app/#/owner
-- Paste this whole file into Supabase → SQL Editor → New query.
-- BEFORE pressing Run: on the line marked "YOUR EMAIL" near the bottom, type the email address you sign in to
-- TasteRank with, between the quotes. It's only used inside Supabase to find your account; it isn't saved anywhere new.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The live site (version 2026-11-03c) keeps working on it; the new site needs it, so run this first, then push.
--
-- What it does:
--   1. An owners list. Every owner action below checks it in the database, so only accounts on it can use them.
--   2. Snacks can be hidden: off the site, ratings kept, and shown again later. A hidden snack doesn't stop
--      someone adding the same snack again (that copy goes to the vote like any other).
--   3. A new subcategory keeps the category the sender picked (it used to say "you pick" in review_list).
--   4. The owner page's lookups and actions: what's waiting, every snack, the subcategories; accept, decline,
--      change or hide a snack, put one live, change a subcategory, move one subcategory's snacks into another.

begin;

-- ---------- 1. Owners ----------
create table if not exists public.owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.owners enable row level security;
revoke all on table public.owners from anon, authenticated;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.owners where user_id = auth.uid())
$$;

create or replace function public.require_owner() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'This is for TasteRank''s owner' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- ---------- 2. Hidden snacks ----------
alter table public.items add column if not exists hidden_from text check (hidden_from is null or hidden_from in ('pending', 'live', 'closed'));
alter table public.items drop constraint if exists items_status_check;
alter table public.items add constraint items_status_check check (status in ('pending', 'live', 'closed', 'withdrawn', 'hidden'));
drop index if exists public.items_one_per_name;
create unique index items_one_per_name on public.items (country_id, name_key)
  where status not in ('closed', 'withdrawn', 'hidden');

-- The duplicate check while adding: a hidden snack isn't "already on TasteRank"
create or replace function public.find_same_snack(p_country int, p_pack text, p_barcode text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'product_id', i.product_id,
           'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name),
           'status', public.status_now(i.status, i.created_at),
           'ratings', (select count(*) from public.item_ratings r where r.item_id = i.id))
  from public.items i join public.products p on p.id = i.product_id
  where i.country_id = p_country and i.status not in ('closed', 'withdrawn', 'hidden')
    and public.status_now(i.status, i.created_at) <> 'closed'
    and (i.name_key = public.snack_key(p_pack) or (p_barcode is not null and i.barcode = p_barcode))
  order by i.name_key = public.snack_key(p_pack) desc, i.status = 'live' desc, i.id
  limit 1
$$;

-- ---------- 3. A new subcategory keeps the sender's category ----------
drop function if exists public.submit_new_category(int, text, text, text, text, text, text, int);
create or replace function public.submit_new_category(p_country int, p_new_category text, p_brand_name text, p_pack_name text,
                                                      p_image_path text default null, p_image_url text default null,
                                                      p_barcode text default null, p_score int default null,
                                                      p_category int default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); nc text := public.tidy_case(p_new_category, true); brand text; pack text;
        rid bigint; found_name text; dup jsonb;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from public.categories where id = p_category) then
    raise exception 'Pick the category' using errcode = '22023';
  end if;
  if nc = '' then raise exception 'Name the kind of snack' using errcode = '22023'; end if;
  if pg_catalog.char_length(nc) > 60 then raise exception 'Keep the category under 60 letters' using errcode = '22023'; end if;
  if public.clean(p_brand_name) = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  pack := public.tidy_case(p_pack_name);
  if pack = '' then raise exception 'Type the name on the pack' using errcode = '22023'; end if;
  perform public.check_snack_extras(u, p_image_path, p_image_url, p_barcode, p_score);
  select coalesce(public.local_name('product', p.id, p_country), p.name) into found_name from public.products p
   where public.norm(p.name) = public.norm(nc)
      or exists (select 1 from public.local_names l where l.kind = 'product' and l.target_id = p.id and public.norm(l.name) = public.norm(nc))
   limit 1;
  if found_name is not null then
    raise exception '% is already a category. Pick it from the list.', found_name using errcode = 'P0001';
  end if;
  dup := public.find_same_snack(p_country, pack, p_barcode);
  if dup is not null then
    raise exception 'Already on TasteRank: % is in %.', dup->>'pack_name', dup->>'product' using errcode = '23505', detail = dup::text;
  end if;
  brand := coalesce((select name from public.brands where name_key = public.norm(p_brand_name)), public.tidy_case(p_brand_name));
  insert into public.item_requests (kind, country_id, category_id, new_ranking, brand_name, pack_name,
                                    image_path, image_url, barcode, score, user_id)
  values ('category', p_country, p_category, nc, brand, pack, p_image_path, p_image_url, p_barcode, p_score, u)
  returning id into rid;
  return rid;
end $$;
revoke execute on function public.submit_new_category(int, text, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.submit_new_category(int, text, text, text, text, text, text, int, int) to authenticated;

-- accept_request as in migration 008, except that a hidden snack doesn't count as already listed
create or replace function public.accept_request(p_request bigint, p_product_name text default null,
                                                 p_variant_name text default null, p_title text default null,
                                                 p_emoji text default null, p_category int default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.item_requests; pid int; vid int; pname text; vname text; bid bigint; iid bigint; existing bigint; cat int;
begin
  select * into r from public.item_requests where id = p_request for update;
  if not found or r.status <> 'review' then raise exception 'Request % isn''t waiting for review', p_request; end if;
  cat := coalesce(p_category, r.category_id);

  -- The product (the visitor's "category")
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
    if cat is null or not exists (select 1 from public.categories where id = cat) then
      raise exception 'Say which type: select public.accept_request(%, p_category => 2);  (1 Chocolate, 2 Sweets, 3 Crisps & Snacks)', p_request;
    end if;
    pid := (select coalesce(max(id), 0) + 1 from public.products);
    insert into public.products (id, category_id, name, emoji, sort)
    values (pid, cat, pname, coalesce(nullif(public.clean(p_emoji), ''), '🍽️'),
            (select coalesce(max(sort), 0) + 1 from public.products));
    update public.categories set visible = true where id = cat;
  end if;
  perform public.ensure_other_variant(pid);

  -- The flavour
  if r.kind = 'category' and nullif(public.clean(p_variant_name), '') is null then
    vid := public.guess_variant(pid, r.pack_name, null);
  else
    vname := coalesce(nullif(public.tidy_case(p_variant_name, true), ''),
                      case when pid = r.product_id then r.new_variant end, 'Original');
    select id into vid from public.variants where product_id = pid and name_key = public.norm(vname);
    if vid is null then
      vid := (select coalesce(max(id), 0) + 1 from public.variants);
      insert into public.variants (id, product_id, name, title, is_default, sort, keywords)
      values (vid, pid, vname, coalesce(nullif(public.clean(p_title), ''), case when r.kind = 'category' then vname || ' ' || pg_catalog.lower(r.new_ranking) else r.new_ranking end),
              public.norm(vname) = 'original',
              (select coalesce(max(sort), 0) + 1 from public.variants where product_id = pid and not is_other),
              case when public.norm(vname) in ('original', 'plain') then '{}'::text[] else array[public.snack_key(vname)] end);
    end if;
  end if;

  -- The snack, sent to the vote on the sender's behalf
  select id into bid from public.brands where name_key = public.norm(r.brand_name);
  if bid is null then
    insert into public.brands (name, status, submitted_by) values (r.brand_name, 'pending', r.user_id) returning id into bid;
  end if;
  update public.items set status = 'closed'   -- one that closed after 30 days can be sent in again
   where country_id = r.country_id and (name_key = public.snack_key(r.pack_name)
                                        or (product_id = pid and variant_id = vid and brand_id = bid))
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  select id into existing from public.items
   where country_id = r.country_id and status not in ('closed', 'withdrawn', 'hidden')
     and (name_key = public.snack_key(r.pack_name) or (r.kind = 'ranking' and product_id = pid and variant_id = vid and brand_id = bid));
  if existing is not null then
    update public.item_requests set status = 'accepted', item_id = existing, reviewed_at = now() where id = p_request;
    return public.ranking_title(vid, r.country_id) || ' is listed. That snack was already there (snack ' || existing
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
  update public.item_requests set status = 'accepted', item_id = iid, category_id = coalesce(category_id, cat), reviewed_at = now()
   where id = p_request;
  return 'Added ' || r.pack_name || ' to ' || public.ranking_title(vid, r.country_id) || ': it''s now in the vote.';
end $$;

-- ---------- 4. The owner page ----------
-- For the gear menu: is this person the owner, and how many additions are waiting. Anyone signed in may ask; others get {"owner": false}.
create or replace function public.owner_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_owner()
    then jsonb_build_object('owner', true, 'to_check', (select count(*) from public.item_requests where status = 'review'))
    else jsonb_build_object('owner', false) end
$$;

-- To check: every addition waiting, oldest first. Never says who sent it.
create or replace function public.owner_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'sent', r.created_at, 'country_id', r.country_id,
            'category_id', coalesce(r.category_id, p.category_id), 'new_ranking', r.new_ranking, 'product_id', r.product_id,
            'product', p.name, 'new_variant', r.new_variant, 'brand_name', r.brand_name, 'pack_name', r.pack_name,
            'image_url', r.image_url, 'image_path', r.image_path, 'barcode', r.barcode) order by r.created_at), '[]'::jsonb)
          from public.item_requests r left join public.products p on p.id = r.product_id
          where r.status = 'review');
end $$;

-- Snacks: every snack except withdrawn ones, newest first; one country (or all with null), or one snack with p_item
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
            'image_url', i.image_url, 'image_path', i.image_path, 'barcode', i.barcode) order by i.created_at desc, i.id desc), '[]'::jsonb)
          from public.items i
          join public.products p on p.id = i.product_id
          join public.variants v on v.id = i.variant_id
          join public.brands b on b.id = i.brand_id
          where i.status <> 'withdrawn' and (p_country is null or i.country_id = p_country) and (p_item is null or i.id = p_item));
end $$;

-- Subcategories: the categories (the page offers the visible ones), and every subcategory with its emoji, snacks, ratings and flavours
create or replace function public.owner_catalogue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'visible', c.visible) order by c.sort), '[]'::jsonb)
                   from public.categories c),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'emoji', p.emoji, 'category_id', p.category_id,
                   'snacks', (select count(*) from public.items i where i.product_id = p.id and i.status not in ('withdrawn', 'closed')
                                and public.status_now(i.status, i.created_at) <> 'closed'),
                   'ratings', (select count(*) from public.item_ratings x join public.items i on i.id = x.item_id where i.product_id = p.id),
                   'flavours', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'is_other', v.is_other)
                                                          order by v.is_other, v.sort, v.id), '[]'::jsonb)
                                from public.variants v where v.product_id = p.id)) order by p.sort, p.id), '[]'::jsonb)
                 from public.products p));
end $$;

-- A subcategory by name: the one with that name, else a new one in p_category. Used by the actions below.
create or replace function public.owner_product(p_name text, p_category int, p_emoji text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare pname text := public.tidy_case(p_name, true); pid int;
begin
  if pname = '' then raise exception 'Name the subcategory' using errcode = '22023'; end if;
  if pg_catalog.char_length(pname) > 60 then raise exception 'Keep the subcategory under 60 letters' using errcode = '22023'; end if;
  select id into pid from public.products where public.norm(name) = public.norm(pname);
  if pid is not null then return pid; end if;
  if p_category is null or not exists (select 1 from public.categories where id = p_category) then
    raise exception 'Pick the category' using errcode = '22023';
  end if;
  pid := (select coalesce(max(id), 0) + 1 from public.products);
  insert into public.products (id, category_id, name, emoji, sort)
  values (pid, p_category, pname, coalesce(nullif(public.clean(p_emoji), ''), '🍽️'), (select coalesce(max(sort), 0) + 1 from public.products));
  update public.categories set visible = true where id = p_category;
  perform public.ensure_other_variant(pid);
  return pid;
end $$;

-- A flavour in a subcategory by name: the one with that name, "Other" for Other, else a new one
create or replace function public.owner_variant(p_product int, p_name text) returns int
language plpgsql security definer set search_path = '' as $$
declare vname text := public.tidy_case(p_name, true); vid int; pname text;
begin
  if vname = '' then raise exception 'Name the flavour' using errcode = '22023'; end if;
  if public.norm(vname) = 'other' then return public.ensure_other_variant(p_product); end if;
  select id into vid from public.variants where product_id = p_product and name_key = public.norm(vname);
  if vid is not null then return vid; end if;
  select name into pname from public.products where id = p_product;
  vid := (select coalesce(max(id), 0) + 1 from public.variants);
  insert into public.variants (id, product_id, name, title, is_default, sort, keywords)
  values (vid, p_product, vname, vname || ' ' || pg_catalog.lower(pname), public.norm(vname) = 'original',
          (select coalesce(max(sort), 0) + 1 from public.variants where product_id = p_product and not is_other),
          case when public.norm(vname) in ('original', 'plain') then '{}'::text[] else array[public.snack_key(vname)] end);
  return vid;
end $$;

-- An emoji the owner typed: one emoji (up to 10 characters, for flags and joined ones like 👩‍🍳), made only of emoji characters
create or replace function public.owner_emoji(p_emoji text) returns text
language plpgsql immutable set search_path = '' as $$
declare e text := pg_catalog.btrim(coalesce(p_emoji, ''));
begin
  if e = '' then return null; end if;
  if pg_catalog.char_length(e) > 10
     or e !~ '^[\u00a9\u00ae\u200d\u2030-\u2bff\u3030\u303d\u3297\u3299\ufe0e\ufe0f\U0001F000-\U0001FAFF\U000E0020-\U000E007F]+$' then
    raise exception 'Just one emoji' using errcode = '22023';
  end if;
  return e;
end $$;

-- Accept: optional changes first (the name on the pack, the brand, the category), then accept_request
create or replace function public.owner_accept(p_request bigint, p_category int default null, p_subcategory text default null,
                                               p_flavour text default null, p_emoji text default null,
                                               p_brand_name text default null, p_pack_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare msg text; r public.item_requests; pack text;
begin
  perform public.require_owner();
  select * into r from public.item_requests where id = p_request for update;
  if not found or r.status <> 'review' then raise exception 'That one isn''t waiting any more' using errcode = 'P0001'; end if;
  if nullif(public.clean(p_pack_name), '') is not null then
    pack := public.tidy_case(p_pack_name);
    if pg_catalog.char_length(pack) > 120 then raise exception 'Keep the name under 120 letters' using errcode = '22023'; end if;
    update public.item_requests set pack_name = pack where id = p_request;
  end if;
  if nullif(public.clean(p_brand_name), '') is not null then
    if pg_catalog.char_length(public.clean(p_brand_name)) > 60 then raise exception 'Keep the brand under 60 letters' using errcode = '22023'; end if;
    update public.item_requests
       set brand_name = coalesce((select name from public.brands where name_key = public.norm(p_brand_name)), public.tidy_case(p_brand_name))
     where id = p_request;
  end if;
  if p_category is not null then
    if not exists (select 1 from public.categories where id = p_category) then raise exception 'Pick the category' using errcode = '22023'; end if;
    update public.item_requests set category_id = p_category where id = p_request;
  end if;
  msg := public.accept_request(p_request, p_product_name => p_subcategory, p_variant_name => p_flavour,
                               p_emoji => public.owner_emoji(p_emoji), p_category => p_category);
  select * into r from public.item_requests where id = p_request;
  return jsonb_build_object('message', msg, 'item_id', r.item_id, 'pack_name', r.pack_name,
                            'product', (select p.name from public.items i join public.products p on p.id = i.product_id where i.id = r.item_id));
end $$;

create or replace function public.owner_decline(p_request bigint) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return public.decline_request(p_request);
end $$;

-- Change a snack. p_photo: null keeps it, '' removes it, an Open Food Facts link, or a photo uploaded to the owner's own folder.
create or replace function public.owner_save_snack(p_item bigint, p_pack_name text, p_brand_name text, p_country int,
                                                   p_category int, p_subcategory text, p_flavour text,
                                                   p_photo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_owner(); i public.items; pack text := public.tidy_case(p_pack_name); bid bigint; pid int; vid int;
        url text; path text;
begin
  select * into i from public.items where id = p_item for update;
  if not found or i.status = 'withdrawn' then raise exception 'That snack isn''t here any more' using errcode = 'P0001'; end if;
  if pack = '' then raise exception 'Type the name on the pack' using errcode = '22023'; end if;
  if pg_catalog.char_length(pack) > 120 then raise exception 'Keep the name under 120 letters' using errcode = '22023'; end if;
  if public.clean(p_brand_name) = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  if pg_catalog.char_length(public.clean(p_brand_name)) > 60 then raise exception 'Keep the brand under 60 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;

  select id into bid from public.brands where name_key = public.norm(p_brand_name);
  if bid is null then
    insert into public.brands (name, status) values (public.tidy_case(p_brand_name), case when i.status = 'live' then 'live' else 'pending' end)
    returning id into bid;
  end if;
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

  begin
    update public.items set pack_name = pack, brand_id = bid, country_id = p_country, product_id = pid, variant_id = vid,
                            image_url = url, image_path = path
     where id = p_item;
  exception when unique_violation then
    raise exception 'Another snack in % already has that name. Change one of them, or hide the extra one.',
      (select short_name from public.places where id = p_country) using errcode = '23505';
  end;
  if i.status = 'live' then update public.brands set status = 'live' where id = bid; end if;
  return (public.owner_snacks(null, p_item))->0;
end $$;

-- Hide, show again, or put live now (skipping the vote, for a snack in the vote or closed)
create or replace function public.owner_set_status(p_item bigint, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.items; now_status text;
begin
  perform public.require_owner();
  select * into i from public.items where id = p_item for update;
  if not found or i.status = 'withdrawn' then raise exception 'That snack isn''t here any more' using errcode = 'P0001'; end if;
  now_status := public.status_now(i.status, i.created_at);
  begin
    if p_action = 'hide' then
      if i.status <> 'hidden' then
        update public.items set status = 'hidden', hidden_from = now_status where id = p_item;
      end if;
    elsif p_action = 'show' then
      if i.status = 'hidden' then
        update public.items set status = coalesce(i.hidden_from, 'live'), hidden_from = null where id = p_item;
      end if;
    elsif p_action = 'live' then
      if now_status not in ('pending', 'closed') then raise exception 'Only a snack in the vote or closed can be put live' using errcode = 'P0001'; end if;
      update public.items set status = 'live' where id = p_item;
      update public.brands set status = 'live' where id = i.brand_id;
      -- "Tried it?" faces become real ratings, as when the vote puts a snack live
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
    else
      raise exception 'Unknown action %', p_action using errcode = '22023';
    end if;
  exception when unique_violation then
    raise exception 'Another snack with this name is listed now. Hide that one first.' using errcode = '23505';
  end;
  return (public.owner_snacks(null, p_item))->0;
end $$;

-- Change a subcategory: name, category, emoji
create or replace function public.owner_save_subcategory(p_product int, p_name text, p_category int, p_emoji text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pname text := public.tidy_case(p_name, true); other text; e text := public.owner_emoji(p_emoji);
begin
  perform public.require_owner();
  if not exists (select 1 from public.products where id = p_product) then raise exception 'That subcategory isn''t here any more' using errcode = 'P0001'; end if;
  if pname = '' then raise exception 'Name the subcategory' using errcode = '22023'; end if;
  if pg_catalog.char_length(pname) > 60 then raise exception 'Keep the subcategory under 60 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.categories where id = p_category) then raise exception 'Pick the category' using errcode = '22023'; end if;
  select name into other from public.products where public.norm(name) = public.norm(pname) and id <> p_product;
  if other is not null then
    raise exception 'There''s already a subcategory called %. To join them, use "Move its snacks into…".', other using errcode = '23505';
  end if;
  update public.products set name = pname, category_id = p_category, emoji = coalesce(e, emoji) where id = p_product;
  update public.variants set title = 'Other ' || pg_catalog.lower(pname) where product_id = p_product and is_other;
  update public.categories set visible = true where id = p_category;
  return (select jsonb_build_object('id', p.id, 'name', p.name, 'emoji', p.emoji, 'category_id', p.category_id) from public.products p where p.id = p_product);
end $$;

-- Move every snack from one subcategory into another (for a duplicate), flavour by flavour, then remove the empty one
create or replace function public.owner_move_snacks(p_from int, p_into int) returns int
language plpgsql security definer set search_path = '' as $$
declare v record; target int; moved int := 0; n int;
begin
  perform public.require_owner();
  if p_from = p_into then raise exception 'Pick a different subcategory' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_from) or not exists (select 1 from public.products where id = p_into) then
    raise exception 'That subcategory isn''t here any more' using errcode = 'P0001';
  end if;
  for v in select * from public.variants where product_id = p_from loop
    if v.is_other then
      target := public.ensure_other_variant(p_into);
    else
      select id into target from public.variants where product_id = p_into and name_key = v.name_key;
      if target is null then
        target := (select coalesce(max(id), 0) + 1 from public.variants);
        insert into public.variants (id, product_id, name, title, is_default, sort, keywords, off_tags)
        values (target, p_into, v.name, v.title, false,
                (select coalesce(max(sort), 0) + 1 from public.variants where product_id = p_into and not is_other), v.keywords, v.off_tags);
      end if;
    end if;
    update public.items set product_id = p_into, variant_id = target where product_id = p_from and variant_id = v.id;
    get diagnostics n = row_count; moved := moved + n;
  end loop;
  update public.item_requests set product_id = p_into where product_id = p_from;
  delete from public.local_names where (kind = 'product' and target_id = p_from)
     or (kind in ('variant', 'title') and target_id in (select id from public.variants where product_id = p_from));
  delete from public.variants where product_id = p_from;
  delete from public.products where id = p_from;
  return moved;
end $$;

-- ---------- 5. Who may call what ----------
revoke execute on function public.is_owner(), public.require_owner(), public.owner_product(text, int, text),
  public.owner_variant(int, text), public.owner_emoji(text), public.accept_request(bigint, text, text, text, text, int),
  public.find_same_snack(int, text, text)
  from public, anon, authenticated;
revoke execute on function public.owner_status(), public.owner_queue(), public.owner_snacks(int, bigint), public.owner_catalogue(),
  public.owner_accept(bigint, int, text, text, text, text, text), public.owner_decline(bigint),
  public.owner_save_snack(bigint, text, text, int, int, text, text, text), public.owner_set_status(bigint, text),
  public.owner_save_subcategory(int, text, int, text), public.owner_move_snacks(int, int)
  from public, anon;
grant execute on function public.owner_status(), public.owner_queue(), public.owner_snacks(int, bigint), public.owner_catalogue(),
  public.owner_accept(bigint, int, text, text, text, text, text), public.owner_decline(bigint),
  public.owner_save_snack(bigint, text, text, int, int, text, text, text), public.owner_set_status(bigint, text),
  public.owner_save_subcategory(int, text, int, text), public.owner_move_snacks(int, int)
  to authenticated;

-- ---------- 6. You, as the owner ----------
-- YOUR EMAIL: type the address you sign in to TasteRank with between the quotes, e.g. 'name@gmail.com'
insert into public.owners (user_id)
  select id from auth.users where lower(email) = lower(pg_catalog.btrim('type-your-email-here'))
on conflict do nothing;

-- What you should see after pressing Run: owners 1 (if it says 0, the email didn't match: fix it and run again),
-- and how many additions are waiting for you.
select (select count(*) from public.owners) as owners,
       (select count(*) from public.item_requests where status = 'review') as to_check;

commit;
