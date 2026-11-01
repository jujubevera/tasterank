-- TasteRank migration 008: browse by category and brand, adding without a flavour, and Withdraw
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The site that's live now keeps working on it: every function it calls is kept, with the same arguments.
--
-- What it does (design/prompts/12-database-browse.md):
--   1. A snack can be 'withdrawn' by the person who sent it, while it's still waiting.
--   2. One snack per name per country: snack_key() ignores capitals, punctuation, apostrophes, "&"/"and" and pack
--      sizes ("150g", "6 x 25g"), so "M&S Double Devon Toffees 150g" is the same snack as "M&S Double Devon Toffees".
--      This replaces "one per brand per flavour". The same barcode also counts as the same snack.
--   3. Flavours are guessed (guess_variant) from the name; every category gets an "Other" flavour for the rest,
--      which the owner sorts (to_sort). Plain toffee shows as "Plain" instead of "Original".
--   4. Open Food Facts category tags on each category and flavour, so adding can fill in the category.
--   5. New lookups for the new pages: home_categories, home_brands, category_page, brand_page, next_snack.
--   6. New ways in: submit_snack, submit_new_category (a new category, checked by the owner), withdraw_submission.
--   7. The brand Werther's becomes Werther's Original (the name on the front of the pack).
--
-- For the owner only (SQL Editor, never the website):
--   select * from public.to_sort();                                  -- snacks whose flavour is "Other"
--   update public.items set variant_id = 5 where id = 123;           -- …put one in Cheese & onion
--   select * from public.review_list();                              -- new categories (and old-style new rankings)
--   select public.accept_request(7, p_category => 2);                -- a new category, filed under Sweets
--
-- It stops, changing nothing, if two snacks in one country already have the same name once tidied, or if a
-- separate brand called "Werther's Original" already exists. The message lists them.
-- On 2026-11-01 the live database had one: M&S Double Devon Toffees #50 (waiting, in Milk chocolate bars) is the
-- same snack as #5 (live, in Toffee). Before running this, close the waiting one (it stays in the database):
--   update public.items set status = 'closed' where id = 50 and status = 'pending';

begin;

-- ---------- 1. Withdrawn ----------
alter table public.items add column if not exists withdrawn_at timestamptz;
alter table public.item_requests add column if not exists withdrawn_at timestamptz;
-- The status rules were made without names (items' is "items_status_check1" on the live database, because the
-- original foods table had the first name), so they're found by what they check.
do $$
declare c record;
begin
  for c in select con.conrelid::regclass tbl, con.conname from pg_catalog.pg_constraint con
            where con.conrelid in ('public.items'::regclass, 'public.item_requests'::regclass) and con.contype = 'c'
              and pg_catalog.pg_get_constraintdef(con.oid) ~ '\(status = ANY' loop
    execute pg_catalog.format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;
alter table public.items add constraint items_status_check check (status in ('pending', 'live', 'closed', 'withdrawn'));
alter table public.item_requests add constraint item_requests_status_check
  check (status in ('review', 'accepted', 'declined', 'withdrawn'));

-- ---------- 2. Tidy names ----------
-- The key two snack names are compared by. Pack sizes are a number with a unit; every other number stays,
-- so "3 Musketeers" and "70%" are part of the name. Written without locale-dependent classes, so it gives the
-- same answer everywhere (Japanese and Chinese names are kept as they are).
create or replace function public.snack_key(t text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare s text := pg_catalog.lower(coalesce(t, ''));
begin
  s := pg_catalog.replace(pg_catalog.translate(s, '’‘`´', ''''''''''), '''', '');   -- Werther’s = Werthers
  s := pg_catalog.replace(s, '&', ' and ');                                          -- M&S = M and S
  -- Pack sizes: multipacks first ("6 x 25g", "6x25 g"), then single sizes ("150g", "1.5 kg", "330ml", "2 pack", "4pk").
  s := pg_catalog.regexp_replace(s, '(^|[^a-z0-9.,])[0-9]+([.,][0-9]+)?\s*[x×]\s*[0-9]+([.,][0-9]+)?\s*(g|kg|ml|cl|l)(?![a-z])', '\1 ', 'g');
  s := pg_catalog.regexp_replace(s, '(^|[^a-z0-9.,])[0-9]+([.,][0-9]+)?\s*(g|gr|grams?|kg|ml|cl|l|litres?|liters?|oz|packs?|pk|multipack)(?![a-z])', '\1 ', 'g');
  -- Punctuation (ASCII and the common Unicode kinds) becomes a space; letters in any script stay.
  s := pg_catalog.regexp_replace(s, '[]["!#$%()*+,./:;<=>?@^_{|}~“”«»–—…·、。（）「」【】・\\-]', ' ', 'g');
  return pg_catalog.btrim(pg_catalog.regexp_replace(s, '\s+', ' ', 'g'));
end $$;

-- Commas and stray punctuation between words become single spaces ("Boundless, Sea Salt" → "Boundless Sea Salt"),
-- then capitals are tidied as before. "&", apostrophes, "%", hyphens, full stops and brackets stay.
create or replace function public.tidy_case(t text, p_sentence boolean default false) returns text
language plpgsql immutable set search_path = '' as $$
declare c text; caps boolean; mixed boolean; w text; i int := 0; res text := '';
begin
  c := public.clean(pg_catalog.regexp_replace(pg_catalog.regexp_replace(coalesce(t, ''),
         '\s*[,;|*]+\s*', ' ', 'g'), '\s+[-–—:]+\s+', ' ', 'g'));
  c := pg_catalog.btrim(c, ' ,;:-–—');
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

-- Each snack's key, kept up to date by a trigger (not a generated column, so snack_key can be tuned later:
-- after changing it, run  update public.items set name_key = public.snack_key(pack_name);).
alter table public.items add column if not exists name_key text;
create or replace function public.items_set_name_key() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name_key := public.snack_key(new.pack_name);
  return new;
end $$;
drop trigger if exists items_name_key on public.items;
create trigger items_name_key before insert or update of pack_name on public.items
  for each row execute function public.items_set_name_key();

-- ---------- 3. Werther's Original (Vera, 2026-11-01) ----------
do $$
declare old_id bigint; new_id bigint; list text;
begin
  select id into old_id from public.brands where name_key = public.norm('Werther''s');
  select id into new_id from public.brands where name_key = public.norm('Werther''s Original');
  if old_id is not null and new_id is not null then
    select string_agg(i.pack_name || ' (' || pl.short_name || ', ' || i.status || ')', '; ') into list
      from public.items i join public.places pl on pl.id = i.country_id where i.brand_id = new_id;
    raise exception 'There are two brands: "Werther''s" and "Werther''s Original" (with %). Nothing was changed. Ask Claude how to merge them.',
      coalesce(list, 'no snacks');
  end if;
  if old_id is not null then
    update public.brands set name = 'Werther''s Original' where id = old_id;
  end if;
  update public.items i set pack_name = 'Werther''s Original Butter Candies'
   from public.brands b
   where b.id = i.brand_id and b.name_key = public.norm('Werther''s Original') and i.country_id = 1
     and i.pack_name = 'Werther''s Original';
end $$;

-- ---------- 4. One snack per name per country ----------
-- A snack that's been waiting more than 30 days has closed (status_now already says so); write it down, so it
-- doesn't hold on to its name.
update public.items set status = 'closed' where status = 'pending' and public.status_now(status, created_at) = 'closed';
update public.items set name_key = public.snack_key(pack_name) where name_key is distinct from public.snack_key(pack_name);

do $$
declare list text;
begin
  select string_agg(x.names || ' (' || x.country || ')', '; ') into list from (
    select pl.short_name country, string_agg(i.pack_name || ' #' || i.id || ' (' || i.status || ')', ' = ' order by i.id) names
    from public.items i join public.places pl on pl.id = i.country_id
    where i.status not in ('closed', 'withdrawn')
    group by pl.short_name, i.country_id, i.name_key having count(*) > 1) x;
  if list is not null then
    raise exception 'These snacks have the same name: %. Nothing was changed. Close the copy that''s waiting (it isn''t deleted), e.g.  update public.items set status = ''closed'' where id = 50;  then run this again.', list;
  end if;
end $$;

drop index if exists public.items_one_per_brand;
create unique index if not exists items_one_per_name on public.items (country_id, name_key)
  where status not in ('closed', 'withdrawn');
create index if not exists items_by_barcode on public.items (country_id, barcode) where barcode is not null;
create index if not exists items_by_product on public.items (product_id, country_id);
create index if not exists items_by_brand on public.items (brand_id, country_id);

-- ---------- 5. Flavours: guessed, then sorted by the owner ----------
alter table public.variants add column if not exists keywords text[] not null default '{}';
alter table public.variants add column if not exists off_tags text[] not null default '{}';
alter table public.variants add column if not exists is_other boolean not null default false;
alter table public.products add column if not exists off_tags text[] not null default '{}';

-- Plain toffee's chip says "Plain": "Original" read as part of Werther's Original.
update public.variants set name = 'Plain' where id = 2 and name = 'Original';

-- Words in a name that point to a flavour, in snack_key form. Checked in sort order, so the specific flavours
-- (Salt & vinegar, Cheese & onion) win over the plain ones (Ready salted).
update public.variants set keywords = '{vinegar}' where id = 4;
update public.variants set keywords = '{cheese, cheddar}' where id = 5;
update public.variants set keywords = '{ready salted, lightly salted, lightly sea salted, sea salt, sea salted}' where id = 6;
update public.variants set keywords = '{milk}' where id = 1;
update public.variants set keywords = '{chocolate covered, chocolate toffee}' where id = 3;
-- A flavour added later (e.g. "Dark chocolate") starts with its own name as its keyword.
update public.variants set keywords = array[public.snack_key(name)]
 where keywords = '{}' and not is_other and public.norm(name) not in ('plain', 'original', 'other');

-- Open Food Facts category tags, checked against UK packs on 2026-11-01 (en:toffees has none; toffees are en:caramels).
update public.products set off_tags = '{en:crisps, en:potato-crisps}' where id = 3;
update public.products set off_tags = '{en:caramels, en:toffees, en:toffee}' where id = 2;
update public.products set off_tags = '{en:chocolate-bars, en:milk-chocolate-bars, en:dark-chocolate-bars}' where id = 1;
update public.variants set off_tags = '{en:salt-and-vinegar-crisps}' where id = 4;
update public.variants set off_tags = '{en:cheese-and-onion-crisps}' where id = 5;
update public.variants set off_tags = '{en:milk-chocolate-bars}' where id = 1;

-- Every category has an "Other" flavour (sort 99), titled "Other crisps", with local titles where the category
-- has a local name ("Other chips" in the US). Called for every category now, and by accept_request for new ones.
create or replace function public.ensure_other_variant(p_product int) returns int
language plpgsql security definer set search_path = '' as $$
declare vid int; pname text;
begin
  select id into vid from public.variants where product_id = p_product and (is_other or name_key = 'other') limit 1;
  select name into pname from public.products where id = p_product;
  if pname is null then return null; end if;
  if vid is null then
    vid := (select coalesce(max(id), 0) + 1 from public.variants);
    insert into public.variants (id, product_id, name, title, is_default, sort, is_other)
    values (vid, p_product, 'Other', 'Other ' || pg_catalog.lower(pname), false, 99, true);
  else
    update public.variants set is_other = true, is_default = false where id = vid;
  end if;
  insert into public.local_names (kind, target_id, place_id, name)
    select 'title', vid, l.place_id, 'Other ' || pg_catalog.lower(l.name)
    from public.local_names l where l.kind = 'product' and l.target_id = p_product
  on conflict (kind, target_id, place_id) do nothing;
  return vid;
end $$;
select public.ensure_other_variant(id) from public.products;

-- The flavour for a new snack: the first flavour of that category, in sort order, whose keywords are in the name;
-- else the hint (the flavour chip it was added from, or an Open Food Facts match); else the category's Other.
create or replace function public.guess_variant(p_product int, p_name text, p_hint int default null) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select v.id from public.variants v
      where v.product_id = p_product and not v.is_other
        and exists (select 1 from pg_catalog.unnest(v.keywords) k
                     where pg_catalog.strpos(' ' || public.snack_key(p_name) || ' ', ' ' || public.snack_key(k) || ' ') > 0)
      order by v.sort, v.id limit 1),
    (select v.id from public.variants v where v.id = p_hint and v.product_id = p_product),
    (select v.id from public.variants v where v.product_id = p_product and v.is_other limit 1))
$$;

-- ---------- 6. What the live site already calls, kept working ----------
-- The list behind the old add form: now with Open Food Facts tags, and without the empty "Other" flavours.
create or replace function public.catalogue(p_country int default 1) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(public.local_name('category', c.id, p_country), c.name),
           'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id,
                          'name', coalesce(public.local_name('product', p.id, p_country), p.name), 'emoji', p.emoji,
                          'off_tags', p.off_tags,
                          'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id,
                                          'name', coalesce(public.local_name('variant', v.id, p_country), v.name),
                                          'title', public.ranking_title(v.id, p_country), 'off_tags', v.off_tags) order by v.sort), '[]'::jsonb)
                                       from public.variants v where v.product_id = p.id and not v.is_other)) order by p.sort), '[]'::jsonb)
                        from public.products p where p.category_id = c.id))
         order by c.sort), '[]'::jsonb)
  from public.categories c where c.visible
$$;

-- The old add form's "send it in": as in 006, except a withdrawn snack doesn't count as "already here", and a
-- name that's already taken in that country gives a plain message instead of a database error.
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

  update public.items set status = 'closed'
   where product_id = p_product and variant_id = p_variant and brand_id = bid and country_id = p_country
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  select id into existing from public.items
   where product_id = p_product and variant_id = p_variant and brand_id = bid and country_id = p_country
     and status not in ('closed', 'withdrawn');
  if existing is not null then
    raise exception 'Already here' using errcode = '23505', detail = existing::text;
  end if;

  pack := nullif(public.tidy_case(p_pack_name), '');
  if pack is null then
    select b.name || ' ' || v.name || ' ' || coalesce(public.local_name('product', p_product, p_country), p.name)
      into pack from public.variants v join public.products p on p.id = v.product_id, public.brands b
     where v.id = p_variant and b.id = bid;
  end if;
  update public.items set status = 'closed'
   where country_id = p_country and name_key = public.snack_key(pack)
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  begin
    insert into public.items (product_id, variant_id, brand_id, country_id, pack_name, image_path, image_url, barcode, status, submitted_by)
    values (p_product, p_variant, bid, p_country, pack, p_image_path, p_image_url, p_barcode, 'pending', u)
    returning id into iid;
  exception when unique_violation then
    raise exception 'That snack is already on TasteRank.' using errcode = 'P0001';
  end;
  insert into public.approvals (item_id, user_id) values (iid, u);
  if p_score is not null then
    insert into public.planned_ratings (item_id, user_id, score) values (iid, u, p_score);
  end if;
  return iid;
end $$;

-- Approving: a withdrawn snack says so.
create or replace function public.approve_item(p_item bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); i public.items;
begin
  select * into i from public.items where id = p_item for update;
  if found and i.status = 'withdrawn' then
    raise exception 'It was just withdrawn, so there''s nothing to approve.' using errcode = 'P0001';
  end if;
  if not found or public.status_now(i.status, i.created_at) <> 'pending' then
    raise exception 'This item isn''t waiting for approval' using errcode = 'P0001';
  end if;
  insert into public.approvals (item_id, user_id) values (p_item, u) on conflict do nothing;
  perform public.promote_item(p_item);
  return jsonb_build_object('approvals', (select count(*) from public.approvals where item_id = p_item),
                            'status', (select status from public.items where id = p_item));
end $$;

-- Search: also says which category each snack is in ("Toffee").
create or replace function public.search_items(q text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.live desc, x.pack_name), '[]'::jsonb) from (
    select jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name, 'brand_id', b.id,
             'status', public.status_now(i.status, i.created_at),
             'product_id', i.product_id, 'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name),
             'variant_id', i.variant_id, 'country_id', i.country_id, 'barcode', i.barcode,
             'country', pl.short_name, 'flag', pl.flag, 'ranking_title', public.ranking_title(i.variant_id, i.country_id),
             'ratings', (select count(*) from public.item_ratings r where r.item_id = i.id),
             'image_url', i.image_url, 'image_path', i.image_path, 'emoji', p.emoji) as j,
           i.status = 'live' as live, i.pack_name
    from public.items i
    join public.brands b on b.id = i.brand_id
    join public.products p on p.id = i.product_id
    join public.variants v on v.id = i.variant_id
    join public.places pl on pl.id = i.country_id
    where char_length(public.norm(q)) >= 2
      and public.status_now(i.status, i.created_at) in ('live', 'pending')
      and public.snack_key(q) <> ''   -- every word typed, apostrophes and punctuation aside ("werthers" finds Werther's)
      and not exists (select 1 from pg_catalog.regexp_split_to_table(public.snack_key(q), ' ') w
                      where pg_catalog.strpos(public.snack_key(b.name) || ' ' || i.name_key || ' ' || public.snack_key(p.name)
                                              || ' ' || public.snack_key(v.name) || ' ' || public.snack_key(public.ranking_title(v.id, i.country_id))
                                              || ' ' || public.snack_key(coalesce(public.local_name('product', p.id, i.country_id), '')), w) = 0)
    order by i.status = 'live' desc, i.pack_name
    limit 20
  ) x
$$;

-- ---------- 7. New lookups for the new pages (totals only, never who) ----------
-- Home, by category: one card per category with live snacks in that country, most ratings first.
create or replace function public.home_categories(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  pr as (
    select p.id, p.sort, p.emoji, p.category_id, c.sort as csort,
           coalesce(public.local_name('product', p.id, p_country), p.name) as name,
           coalesce(public.local_name('category', c.id, p_country), c.name) as type,
           (select count(*) from t where t.product_id = p.id)::int as snacks,
           (select coalesce(sum(t.total), 0) from t where t.product_id = p.id)::int as ratings
    from public.products p join public.categories c on c.id = p.category_id and c.visible
    where exists (select 1 from t where t.product_id = p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'emoji', pr.emoji, 'type', pr.type,
           'type_id', pr.category_id, 'snacks', pr.snacks, 'ratings', pr.ratings,
           'thumbs', (select coalesce(jsonb_agg(jsonb_build_object('image_url', x.image_url, 'image_path', x.image_path, 'emoji', x.emoji)), '[]'::jsonb)
                        from (select * from t where t.product_id = pr.id
                              order by t.ranked desc, case when t.ranked then t.avg end desc nulls last, t.total desc, t.id limit 3) x),
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

-- Home, by brand: brands with 2+ live snacks in that country, most ratings first, with their best.
create or replace function public.home_brands(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  g as (select t.brand_id, t.brand, count(*)::int as snacks, sum(t.total)::int as ratings from t group by t.brand_id, t.brand
        having count(*) >= 2)
  select coalesce(jsonb_agg(jsonb_build_object('id', g.brand_id, 'name', g.brand, 'snacks', g.snacks, 'ratings', g.ratings,
           'categories', (select jsonb_agg(x.name order by x.n desc, x.sort) from (
                            select coalesce(public.local_name('product', p.id, p_country), p.name) as name, p.sort, count(*) as n
                            from t join public.products p on p.id = t.product_id where t.brand_id = g.brand_id
                            group by p.id, p.name, p.sort) x),
           'type_ids', (select jsonb_agg(distinct p.category_id) from t join public.products p on p.id = t.product_id
                         where t.brand_id = g.brand_id),
           'thumb', (select jsonb_build_object('image_url', t.image_url, 'image_path', t.image_path, 'emoji', t.emoji)
                       from t where t.brand_id = g.brand_id order by t.image_url is null and t.image_path is null, t.total desc, t.id limit 1),
           'best', (select jsonb_build_object('item_id', t.id, 'pack_name', t.pack_name, 'avg', t.avg, 'total', t.total)
                      from t where t.brand_id = g.brand_id and t.ranked order by t.avg desc, t.total desc, t.id limit 1))
         order by g.ratings desc, g.brand), '[]'::jsonb)
  from g
$$;

-- A category page: every live snack of one category in one country, with its flavour, so the page can filter
-- by flavour itself. Also what's waiting for approval, and snacks withdrawn in the last 30 days.
create or replace function public.category_page(p_product int, p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  live as (
    select t.*, (select count(*) from t t2 where t2.brand_id = t.brand_id)::int as brand_snacks
    from t where t.product_id = p_product
  ),
  pend as (
    select i.id, i.brand_id, b.name as brand, i.pack_name, i.variant_id, i.image_url, i.image_path, p.emoji,
           (select count(*) from public.approvals a where a.item_id = i.id)::int as approvals,
           exists (select 1 from public.approvals a where a.item_id = i.id and a.user_id = auth.uid()) as approved,
           coalesce(i.submitted_by = auth.uid(), false) as mine,
           greatest(0, (public.app_settings()->>'close_after_days')::int - extract(day from now() - i.created_at)::int) as days_left
    from public.items i join public.brands b on b.id = i.brand_id join public.products p on p.id = i.product_id
    where i.product_id = p_product and i.country_id = p_country and public.status_now(i.status, i.created_at) = 'pending'
  )
  select jsonb_build_object(
    'id', p.id, 'name', coalesce(public.local_name('product', p.id, p_country), p.name), 'emoji', p.emoji,
    'type', coalesce(public.local_name('category', c.id, p_country), c.name), 'type_id', c.id,
    'country', jsonb_build_object('id', pl.id, 'name', pl.name, 'short_name', pl.short_name, 'flag', pl.flag, 'code', pl.code),
    'flavours', coalesce((select jsonb_agg(jsonb_build_object('id', v.id,
                    'name', coalesce(public.local_name('variant', v.id, p_country), v.name),
                    'title', public.ranking_title(v.id, p_country), 'is_other', v.is_other,
                    'count', (select count(*) from live l where l.variant_id = v.id)) order by v.is_other, v.sort, v.id)
                  from public.variants v where v.product_id = p_product
                    and exists (select 1 from live l where l.variant_id = v.id)), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'brand_id', l.brand_id, 'brand', l.brand,
                    'brand_snacks', l.brand_snacks, 'variant_id', l.variant_id,
                    'pack_name', l.pack_name, 'image_url', l.image_url, 'image_path', l.image_path, 'emoji', l.emoji,
                    'r1', l.r1, 'r2', l.r2, 'r3', l.r3, 'r4', l.r4, 'r5', l.r5, 'total', l.total, 'avg', l.avg,
                    'ranked', l.ranked, 'my_score', l.my_score)
                  order by l.ranked desc, case when l.ranked then l.avg end desc nulls last, l.total desc, l.id)
                  from live l), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(to_jsonb(pe) order by pe.mine desc, pe.approvals desc, pe.id) from pend pe), '[]'::jsonb),
    'withdrawn', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'pack_name', i.pack_name))
                  from public.items i where i.product_id = p_product and i.country_id = p_country
                    and i.status = 'withdrawn' and i.withdrawn_at > now() - interval '30 days'), '[]'::jsonb))
  from public.products p
  join public.categories c on c.id = p.category_id
  join public.places pl on pl.id = p_country and pl.level = 'country'
  where p.id = p_product
$$;

-- A brand page: every live snack of one brand in one country, each with its place among the ranked snacks of
-- its category there ("#3 in Crisps").
create or replace function public.brand_page(p_brand bigint, p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select * from public.item_totals(p_country)),
  mine as (
    select t.*, case when t.ranked then (select count(*) + 1 from t t2 where t2.product_id = t.product_id and t2.ranked
                                          and (t2.avg > t.avg or (t2.avg = t.avg and (t2.total > t.total
                                               or (t2.total = t.total and t2.id < t.id)))))::int end as place
    from t where t.brand_id = p_brand
  )
  select jsonb_build_object(
    'id', b.id, 'name', b.name,
    'country', jsonb_build_object('id', pl.id, 'name', pl.name, 'short_name', pl.short_name, 'flag', pl.flag, 'code', pl.code),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'pack_name', m.pack_name,
                    'product_id', m.product_id, 'product', coalesce(public.local_name('product', m.product_id, p_country), p.name),
                    'variant_id', m.variant_id, 'flavour', coalesce(public.local_name('variant', m.variant_id, p_country), v.name),
                    'flavour_title', public.ranking_title(m.variant_id, p_country),
                    'image_url', m.image_url, 'image_path', m.image_path, 'emoji', m.emoji,
                    'r1', m.r1, 'r2', m.r2, 'r3', m.r3, 'r4', m.r4, 'r5', m.r5, 'total', m.total, 'avg', m.avg,
                    'ranked', m.ranked, 'my_score', m.my_score, 'place', m.place)
                  order by m.ranked desc, case when m.ranked then m.avg end desc nulls last, m.total desc, m.id)
                  from mine m join public.products p on p.id = m.product_id join public.variants v on v.id = m.variant_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id,
                    'name', coalesce(public.local_name('product', p.id, p_country), p.name), 'count', x.n) order by x.n desc, p.sort)
                  from (select product_id, count(*)::int n from mine group by product_id) x join public.products p on p.id = x.product_id), '[]'::jsonb),
    'flavours', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'product_id', v.product_id,
                    'name', coalesce(public.local_name('variant', v.id, p_country), v.name), 'title', public.ranking_title(v.id, p_country),
                    'is_other', v.is_other, 'count', x.n) order by v.is_other, v.sort, v.id)
                  from (select variant_id, count(*)::int n from mine group by variant_id) x join public.variants v on v.id = x.variant_id), '[]'::jsonb))
  from public.brands b
  join public.places pl on pl.id = p_country and pl.level = 'country'
  where b.id = p_brand
$$;

-- What "Next" suggests after rating p_item on the new pages:
--   from a brand page: another snack of that brand first;
--   then another snack in the same list (the picked flavour, if any), those short of 10 ratings first;
--   then the category with another flavour, or another category of the same type;
--   then done.
-- Like next_to_rate: {kind:'item', id, short_label} or {kind:'list', product_id, variant_id, title} or {kind:'done'}.
create or replace function public.next_snack(p_item bigint, p_variant int default null, p_brand boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.items; res jsonb; need int := (public.app_settings()->>'rank_after_ratings')::int;
begin
  select * into i from public.items where id = p_item;
  if not found then return jsonb_build_object('kind', 'done'); end if;

  if p_brand then
    select jsonb_build_object('kind', 'item', 'id', t.id, 'short_label', t.pack_name) into res
    from public.item_totals(i.country_id) t
    where t.brand_id = i.brand_id and t.id <> i.id and t.my_score is null
    order by (t.total < need) desc, t.total, t.id limit 1;
    if res is not null then return res; end if;
  end if;

  select jsonb_build_object('kind', 'item', 'id', t.id, 'short_label', t.pack_name) into res
  from public.item_totals(i.country_id) t
  where t.product_id = i.product_id and (p_variant is null or t.variant_id = p_variant) and t.id <> i.id and t.my_score is null
  order by (t.total < need) desc, t.total, t.id limit 1;
  if res is not null then return res; end if;

  if p_variant is not null then   -- the same category, another flavour
    select jsonb_build_object('kind', 'list', 'product_id', i.product_id, 'variant_id', v.id,
             'title', public.ranking_title(v.id, i.country_id)) into res
    from public.variants v
    where v.product_id = i.product_id and v.id <> p_variant
      and exists (select 1 from public.item_totals(i.country_id) t where t.variant_id = v.id and t.my_score is null)
    order by v.is_other, v.sort limit 1;
    if res is not null then return res; end if;
  end if;

  select jsonb_build_object('kind', 'list', 'product_id', p.id, 'variant_id', null,
           'title', coalesce(public.local_name('product', p.id, i.country_id), p.name)) into res
  from public.products p
  where p.id <> i.product_id and p.category_id = (select category_id from public.products where id = i.product_id)
    and exists (select 1 from public.item_totals(i.country_id) t where t.product_id = p.id and t.my_score is null)
  order by p.sort limit 1;
  return coalesce(res, jsonb_build_object('kind', 'done'));
end $$;

-- ---------- 8. Adding: a snack, or a snack in a new category ----------
-- A snack already in that country with the same name (snack_key) or barcode, if any.
create or replace function public.find_same_snack(p_country int, p_pack text, p_barcode text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'product_id', i.product_id,
           'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name),
           'status', public.status_now(i.status, i.created_at),
           'ratings', (select count(*) from public.item_ratings r where r.item_id = i.id))
  from public.items i join public.products p on p.id = i.product_id
  where i.country_id = p_country and i.status not in ('closed', 'withdrawn')
    and public.status_now(i.status, i.created_at) <> 'closed'
    and (i.name_key = public.snack_key(p_pack) or (p_barcode is not null and i.barcode = p_barcode))
  order by i.name_key = public.snack_key(p_pack) desc, i.status = 'live' desc, i.id
  limit 1
$$;

-- Send in a snack for a category that exists. The flavour is guessed. A snack that's already here (same name
-- or barcode, in that country) is returned as {duplicate: …} and nothing is added.
create or replace function public.submit_snack(p_country int, p_product int, p_brand_name text, p_pack_name text,
                                               p_variant_hint int default null, p_image_path text default null,
                                               p_image_url text default null, p_barcode text default null,
                                               p_score int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); bid bigint; bname text; vid int; iid bigint; pack text; dup jsonb; pname text;
begin
  perform public.check_submission_limit(u);
  select coalesce(public.local_name('product', p.id, p_country), p.name) into pname from public.products p where p.id = p_product;
  if pname is null then raise exception 'Pick a category from the list' using errcode = '22023'; end if;
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if public.clean(p_brand_name) = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  pack := public.tidy_case(p_pack_name);
  if pack = '' then raise exception 'Type the name on the pack' using errcode = '22023'; end if;
  if pg_catalog.char_length(pack) > 120 then raise exception 'Keep the name under 120 letters' using errcode = '22023'; end if;
  perform public.check_snack_extras(u, p_image_path, p_image_url, p_barcode, p_score);

  update public.items set status = 'closed'
   where country_id = p_country and (name_key = public.snack_key(pack) or (p_barcode is not null and barcode = p_barcode))
     and status = 'pending' and public.status_now(status, created_at) = 'closed';
  dup := public.find_same_snack(p_country, pack, p_barcode);
  if dup is not null then return jsonb_build_object('duplicate', dup); end if;

  select id, name into bid, bname from public.brands where name_key = public.norm(p_brand_name);
  -- Just the brand is fine only while the brand has nothing in this category here yet ("Wispa").
  if bid is not null and public.snack_key(pack) = public.snack_key(bname) and exists (
       select 1 from public.items i where i.brand_id = bid and i.product_id = p_product and i.country_id = p_country
         and public.status_now(i.status, i.created_at) in ('live', 'pending')) then
    raise exception '% already has % here. Type the full name on the pack.', bname, pg_catalog.lower(pname) using errcode = 'P0001';
  end if;
  if bid is null then
    insert into public.brands (name, status, submitted_by) values (public.tidy_case(p_brand_name), 'pending', u) returning id into bid;
  end if;

  vid := public.guess_variant(p_product, pack, p_variant_hint);
  if vid is null then vid := public.ensure_other_variant(p_product); end if;
  begin
    insert into public.items (product_id, variant_id, brand_id, country_id, pack_name, image_path, image_url, barcode, status, submitted_by)
    values (p_product, vid, bid, p_country, pack, p_image_path, p_image_url, p_barcode, 'pending', u)
    returning id into iid;
  exception when unique_violation then   -- sent at the same moment as someone else
    return jsonb_build_object('duplicate', public.find_same_snack(p_country, pack, p_barcode));
  end;
  insert into public.approvals (item_id, user_id) values (iid, u);
  if p_score is not null then
    insert into public.planned_ratings (item_id, user_id, score) values (iid, u, p_score);
  end if;
  return jsonb_build_object('id', iid, 'pack_name', pack, 'product_id', p_product, 'product', pname,
                            'variant_id', vid, 'status', 'pending');
end $$;

-- A snack in a category that doesn't exist yet ("Chocolate sweets"). It waits for the owner, who files the new
-- category under a type with accept_request(id, p_category => …). Returns the request's id.
alter table public.item_requests alter column category_id drop not null;
alter table public.item_requests add column if not exists kind text not null default 'ranking';
alter table public.item_requests drop constraint if exists item_requests_kind_check;
alter table public.item_requests add constraint item_requests_kind_check check (kind in ('ranking', 'category'));

create or replace function public.submit_new_category(p_country int, p_new_category text, p_brand_name text, p_pack_name text,
                                                      p_image_path text default null, p_image_url text default null,
                                                      p_barcode text default null, p_score int default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); nc text := public.tidy_case(p_new_category, true); brand text; pack text;
        rid bigint; found_name text; dup jsonb;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
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
  values ('category', p_country, null, nc, brand, pack, p_image_path, p_image_url, p_barcode, p_score, u)
  returning id into rid;
  return rid;
end $$;

-- Withdraw something you sent that's still waiting: a snack (its id) or a snack in a new category ('r' + id).
create or replace function public.withdraw_submission(p_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); i public.items; r public.item_requests;
begin
  if p_id ~ '^r[0-9]+$' then
    select * into r from public.item_requests where id = pg_catalog.substr(p_id, 2)::bigint and user_id = u for update;
    if not found then raise exception 'That isn''t one of yours' using errcode = '42501'; end if;
    if r.status <> 'review' then raise exception 'Only snacks still waiting can be withdrawn.' using errcode = 'P0001'; end if;
    update public.item_requests set status = 'withdrawn', withdrawn_at = now() where id = r.id;
  elsif p_id ~ '^[0-9]+$' then
    select * into i from public.items where id = p_id::bigint and submitted_by = u for update;
    if not found then raise exception 'That isn''t one of yours' using errcode = '42501'; end if;
    if public.status_now(i.status, i.created_at) <> 'pending' then
      raise exception 'Only snacks still waiting can be withdrawn.' using errcode = 'P0001';
    end if;
    update public.items set status = 'withdrawn', withdrawn_at = now() where id = i.id;
    delete from public.approvals where item_id = i.id;
    delete from public.planned_ratings where item_id = i.id;
  else
    raise exception 'That isn''t one of yours' using errcode = '42501';
  end if;
  return 'Withdrawn';
end $$;

-- Your own submissions: withdrawn ones are left out; each says its category and country flag.
create or replace function public.my_submissions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
    select i.created_at, jsonb_build_object('id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
             'product_id', i.product_id, 'variant_id', i.variant_id, 'country_id', i.country_id,
             'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name), 'country_flag', pl.flag,
             'status', public.status_now(i.status, i.created_at),
             'approvals', (select count(*) from public.approvals a where a.item_id = i.id), 'created_at', i.created_at) j
    from public.items i join public.brands b on b.id = i.brand_id join public.products p on p.id = i.product_id
    join public.places pl on pl.id = i.country_id
    where i.submitted_by = auth.uid() and i.status <> 'withdrawn'
    union all
    select r.created_at, jsonb_build_object('id', 'r' || r.id, 'pack_name', r.pack_name, 'brand', r.brand_name,
             'country_id', r.country_id, 'category_id', r.category_id, 'new_ranking', r.new_ranking,
             'new_category', r.kind = 'category', 'product', r.new_ranking, 'country_flag', pl.flag,
             'status', r.status, 'approvals', 0, 'created_at', r.created_at) j
    from public.item_requests r join public.places pl on pl.id = r.country_id
    where r.user_id = auth.uid() and r.status not in ('accepted', 'withdrawn')   -- once accepted, the snack itself is listed above
  ) x
$$;

-- ---------- 9. For the owner (SQL Editor only) ----------
-- What's waiting for a check, oldest first. New categories say "you pick" for the type.
create or replace function public.review_list()
returns table (id bigint, sent date, country text, type text, new_ranking text, guess text, brand text, pack_name text,
               photo text, barcode text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.created_at::date, pl.short_name,
         coalesce(public.local_name('category', c.id, r.country_id), c.name, 'you pick: p_category => 1 Chocolate, 2 Sweets, 3 Crisps & Snacks…'),
         r.new_ranking,
         case when r.kind = 'category' then 'new category "' || r.new_ranking || '" › Other'
              when p.id is not null then p.name || ' › ' || coalesce(r.new_variant, 'Original')
              else 'new product "' || r.new_ranking || '" › Original' end,
         r.brand_name, r.pack_name,
         case when r.image_path is not null then 'upload' when r.image_url is not null then 'Open Food Facts' end,
         r.barcode
  from public.item_requests r
  join public.places pl on pl.id = r.country_id
  left join public.categories c on c.id = r.category_id
  left join public.products p on p.id = r.product_id
  where r.status = 'review' order by r.created_at
$$;

-- Snacks whose flavour is "Other", for sorting: update public.items set variant_id = <flavour id> where id = <id>;
create or replace function public.to_sort()
returns table (id bigint, sent date, country text, category text, brand text, pack_name text, status text, barcode text,
               flavours text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.created_at::date, pl.short_name, p.name, b.name, i.pack_name, public.status_now(i.status, i.created_at), i.barcode,
         (select string_agg(v2.id || ' ' || v2.name, ', ' order by v2.sort) from public.variants v2
           where v2.product_id = p.id and not v2.is_other)
  from public.items i join public.variants v on v.id = i.variant_id and v.is_other
  join public.products p on p.id = i.product_id join public.brands b on b.id = i.brand_id
  join public.places pl on pl.id = i.country_id
  where public.status_now(i.status, i.created_at) in ('live', 'pending')
  order by i.created_at
$$;

-- Accept: as in 006, plus new categories. A request for a new category needs its type:
--   select public.accept_request(7, p_category => 2);
-- A new category gets its Other flavour; the snack goes into the flavour guess_variant picks (Other, for a new
-- category) unless you name one with p_variant_name.
drop function if exists public.accept_request(bigint, text, text, text, text);
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
   where country_id = r.country_id and status not in ('closed', 'withdrawn')
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

-- ---------- 10. Who may call what ----------
revoke execute on function public.snack_key(text), public.items_set_name_key(), public.ensure_other_variant(int),
  public.guess_variant(int, text, int), public.find_same_snack(int, text, text), public.to_sort(), public.review_list(),
  public.accept_request(bigint, text, text, text, text, int), public.tidy_case(text, boolean)
  from public, anon, authenticated;
revoke execute on function public.submit_snack(int, int, text, text, int, text, text, text, int),
  public.submit_new_category(int, text, text, text, text, text, text, int), public.withdraw_submission(text),
  public.submit_item(int, int, int, text, text, text, int, text, text), public.approve_item(bigint),
  public.my_submissions() from public, anon;
grant execute on function public.submit_snack(int, int, text, text, int, text, text, text, int),
  public.submit_new_category(int, text, text, text, text, text, text, int), public.withdraw_submission(text),
  public.submit_item(int, int, int, text, text, text, int, text, text), public.approve_item(bigint),
  public.my_submissions() to authenticated;
grant execute on function public.home_categories(int), public.home_brands(int), public.category_page(int, int),
  public.brand_page(bigint, int), public.next_snack(bigint, int, boolean), public.search_items(text), public.catalogue(int)
  to anon, authenticated;

-- What you should see after pressing Run: how many snacks, and how many have a flavour still to sort.
select (select count(*) from public.items where status = 'live') as live_snacks,
       (select count(*) from public.items i join public.variants v on v.id = i.variant_id where v.is_other) as to_sort,
       (select name from public.brands where name_key = public.norm('Werther''s Original')) as werthers;

commit;
