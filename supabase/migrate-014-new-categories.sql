-- TasteRank migration 014: people can suggest a whole new category, not only a subcategory
-- (design/mockups/new-category.html)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- Run it BEFORE pushing the site update that offers "＋ New category" (?v=2026-11-04m): the new site needs it.
-- The site that's live now keeps working on it: every call it makes still works the same way.
--
-- What it does:
--   1. A request can carry a new category name (new_type), e.g. "Cakes", with its first subcategory ("Bakewell tarts").
--   2. category_list: every category, including the ones set up with no snacks yet (Biscuits & Cereal Bars, …), so the
--      add form can find them when someone types "biscuit" instead of offering a second biscuit category.
--   3. submit_new_category takes p_new_type. A name that's already a category is refused, saying so.
--   4. owner_accept takes p_new_type: with no category picked, it creates the new category (or uses the one with that
--      name), then accepts as before. Accepting switches the category on, so it shows on home straight away.
--   5. owner_queue and my_submissions say the new category, so the owner page and the profile can show it.

begin;

-- ---------- 1. A request can carry a new category ----------
alter table public.item_requests add column if not exists new_type text;
alter table public.item_requests drop constraint if exists item_requests_new_type_check;
alter table public.item_requests add constraint item_requests_new_type_check
  check (new_type is null or char_length(new_type) between 1 and 40);

-- ---------- 2. Every category, for the add form's search ----------
create or replace function public.category_list(p_country int default 1) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(public.local_name('category', c.id, p_country), c.name),
           'visible', c.visible) order by c.sort, c.id), '[]'::jsonb)
  from public.categories c
$$;

-- A category by name (its own name or a country's name for it), or null
create or replace function public.find_category(p_name text) returns int
language sql stable security definer set search_path = '' as $$
  select c.id from public.categories c
  where public.norm(c.name) = public.norm(p_name)
     or exists (select 1 from public.local_names l where l.kind = 'category' and l.target_id = c.id and public.norm(l.name) = public.norm(p_name))
  order by c.sort limit 1
$$;

-- ---------- 3. Sending a snack in a new category ----------
-- As in migration 011, plus p_new_type. With a new category, p_category is ignored.
drop function if exists public.submit_new_category(int, text, text, text, text, text, text, int, int);
create or replace function public.submit_new_category(p_country int, p_new_category text, p_brand_name text, p_pack_name text,
                                                      p_image_path text default null, p_image_url text default null,
                                                      p_barcode text default null, p_score int default null,
                                                      p_category int default null, p_new_type text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); nc text := public.tidy_case(p_new_category, true); brand text; pack text;
        nt text := nullif(public.tidy_case(coalesce(p_new_type, ''), true), ''); cat int := p_category;
        rid bigint; found_name text; dup jsonb;
begin
  perform public.check_submission_limit(u);
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
  end if;
  if nt is not null then
    if pg_catalog.char_length(nt) > 40 then raise exception 'Keep the category under 40 letters' using errcode = '22023'; end if;
    if public.find_category(nt) is not null then
      raise exception 'Category % is already on TasteRank. Pick it from the list.',
        (select coalesce(public.local_name('category', c.id, p_country), c.name) from public.categories c where c.id = public.find_category(nt))
        using errcode = 'P0001';
    end if;
    cat := null;
  elsif cat is not null and not exists (select 1 from public.categories where id = cat) then
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
  insert into public.item_requests (kind, country_id, category_id, new_type, new_ranking, brand_name, pack_name,
                                    image_path, image_url, barcode, score, user_id)
  values ('category', p_country, cat, nt, nc, brand, pack, p_image_path, p_image_url, p_barcode, p_score, u)
  returning id into rid;
  return rid;
end $$;
revoke execute on function public.submit_new_category(int, text, text, text, text, text, text, int, int, text) from public, anon;
grant execute on function public.submit_new_category(int, text, text, text, text, text, text, int, int, text) to authenticated;

-- ---------- 4. The owner accepts a new category ----------
-- A category by name: the one with that name, else a new one (switched off until a snack is accepted in it, last in order)
create or replace function public.owner_category(p_name text) returns int
language plpgsql security definer set search_path = '' as $$
declare n text := public.tidy_case(coalesce(p_name, ''), true); cid int;
begin
  if n = '' then raise exception 'Name the new category' using errcode = '22023'; end if;
  if pg_catalog.char_length(n) > 40 then raise exception 'Keep the category under 40 letters' using errcode = '22023'; end if;
  cid := public.find_category(n);
  if cid is not null then return cid; end if;
  cid := (select coalesce(max(id), 0) + 1 from public.categories);
  insert into public.categories (id, name, visible, sort) values (cid, n, false, (select coalesce(max(sort), 0) + 1 from public.categories));
  return cid;
end $$;

-- As in migration 011, plus p_new_type: with no category picked, a request's new category (or the name typed here) is created
drop function if exists public.owner_accept(bigint, int, text, text, text, text, text);
create or replace function public.owner_accept(p_request bigint, p_category int default null, p_subcategory text default null,
                                               p_flavour text default null, p_emoji text default null,
                                               p_brand_name text default null, p_pack_name text default null,
                                               p_new_type text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare msg text; r public.item_requests; pack text; cat int := p_category;
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
  if cat is null and r.category_id is null and coalesce(nullif(public.clean(p_new_type), ''), r.new_type) is not null then
    cat := public.owner_category(coalesce(nullif(public.clean(p_new_type), ''), r.new_type));
  end if;
  if cat is not null then
    if not exists (select 1 from public.categories where id = cat) then raise exception 'Pick the category' using errcode = '22023'; end if;
    update public.item_requests set category_id = cat where id = p_request;
  end if;
  msg := public.accept_request(p_request, p_product_name => p_subcategory, p_variant_name => p_flavour,
                               p_emoji => public.owner_emoji(p_emoji), p_category => cat);
  if cat is not null then update public.categories set visible = true where id = cat; end if; -- on home now, even if the subcategory existed
  select * into r from public.item_requests where id = p_request;
  return jsonb_build_object('message', msg, 'item_id', r.item_id, 'pack_name', r.pack_name,
                            'product', (select p.name from public.items i join public.products p on p.id = i.product_id where i.id = r.item_id));
end $$;

-- ---------- 5. Saying the new category ----------
-- As in migration 011, plus new_type
create or replace function public.owner_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'sent', r.created_at, 'country_id', r.country_id,
            'category_id', coalesce(r.category_id, p.category_id), 'new_type', r.new_type, 'new_ranking', r.new_ranking, 'product_id', r.product_id,
            'product', p.name, 'new_variant', r.new_variant, 'brand_name', r.brand_name, 'pack_name', r.pack_name,
            'image_url', r.image_url, 'image_path', r.image_path, 'barcode', r.barcode) order by r.created_at), '[]'::jsonb)
          from public.item_requests r left join public.products p on p.id = r.product_id
          where r.status = 'review');
end $$;

-- As in migration 008, plus new_type
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
             'country_id', r.country_id, 'category_id', r.category_id, 'new_type', r.new_type, 'new_ranking', r.new_ranking,
             'new_category', r.kind = 'category', 'product', r.new_ranking, 'country_flag', pl.flag,
             'status', r.status, 'approvals', 0, 'created_at', r.created_at) j
    from public.item_requests r join public.places pl on pl.id = r.country_id
    where r.user_id = auth.uid() and r.status not in ('accepted', 'withdrawn')   -- once accepted, the snack itself is listed above
  ) x
$$;

-- ---------- 6. Who may call what ----------
grant execute on function public.category_list(int) to anon, authenticated;
revoke execute on function public.find_category(text), public.owner_category(text) from public, anon, authenticated;
revoke execute on function public.owner_accept(bigint, int, text, text, text, text, text, text) from public, anon;
grant execute on function public.owner_accept(bigint, int, text, text, text, text, text, text) to authenticated;
revoke execute on function public.owner_queue(), public.my_submissions() from public, anon;
grant execute on function public.owner_queue(), public.my_submissions() to authenticated;

-- What you should see after pressing Run: every category, and whether it's on home yet.
select c->>'name' as category, (c->>'visible')::boolean as on_home from jsonb_array_elements(public.category_list(1)) c;

commit;
