-- TasteRank migration 018: tidier names that keep each brand's own spelling, and "Wrong photo" reports
-- (design/mockups/photo-zoom.html, 2026-11-22)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run. Run it BEFORE pushing the site update (?v=2026-11-22b).
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- The current site keeps working on it.
--
-- What it does:
--   1. tidy_case(), the rule every saved name goes through: in names with mixed capitals, words in small letters now get a
--      capital ("Walkers smoky bacon crisps" → "Walkers Smoky Bacon Crisps"; small words like "and", "of" stay small) and
--      shouting words of 4+ letters calm down ("KETTLE Chips" → "Kettle Chips"). KitKat, McVitie's, KP, BBQ, M&S, 70% stay.
--      Then, when the name starts with a brand that's already on TasteRank, it takes that brand's saved spelling
--      ("Innocent Smoothie" → "innocent Smoothie"). Category names (sentence style) work as before.
--   2. owner_save_snack(): the brand is saved exactly as the owner types it. Typing an existing brand with different
--      capitals ("innocent" for "Innocent") renames it, and the brand's snacks whose names start with it follow.
--   3. Reports: a new "Wrong photo" reason. It can be sent for live snacks too (only that reason: the other reasons are
--      about whether a snack should join). owner_reports() now includes each snack's photo, so the owner can see it.
-- Nothing already saved is renamed here (every live name already fits the new rule).

begin;

-- ---------- 1. The tidy rule ----------
create or replace function public.tidy_case(t text, p_sentence boolean default false) returns text
language plpgsql stable set search_path = '' as $$
declare c text; caps boolean; mixed boolean; w text; i int := 0; res text := ''; words text[]; n int; bname text;
begin
  c := public.clean(pg_catalog.regexp_replace(pg_catalog.regexp_replace(coalesce(t, ''),
         '\s*[,;|*]+\s*', ' ', 'g'), '\s+[-–—:]+\s+', ' ', 'g'));
  c := pg_catalog.btrim(c, ' ,;:-–—');
  if c = '' then return c; end if;
  mixed := c <> pg_catalog.upper(c) and c <> pg_catalog.lower(c);
  caps := c = pg_catalog.upper(c);
  foreach w in array pg_catalog.string_to_array(c, ' ') loop
    i := i + 1;
    if mixed and not p_sentence then
      if w !~ '[0-9&]' and w = pg_catalog.lower(w) and w <> pg_catalog.upper(w) then      -- smoky → Smoky, "and" stays
        w := case when i > 1 and w in ('and', 'of', 'the', 'with', 'in', 'on', 'a', 'n', 'to') then w else public.cap_first(w) end;
      elsif w !~ '[0-9&]' and w = pg_catalog.upper(w) and w <> pg_catalog.lower(w)
            and pg_catalog.char_length(pg_catalog.regexp_replace(w, '[^[:alpha:]]', '', 'g')) >= 4 then
        w := public.cap_first(w);                                                          -- KETTLE → Kettle; KP, BBQ stay
      end if;
    elsif mixed then  -- sentence style: "Chocolate" after the first word becomes "chocolate"; "KitKat" stays
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
  if not p_sentence then  -- a known brand at the start keeps its own spelling: the longest match, up to 4 words
    words := pg_catalog.string_to_array(res, ' ');
    for n in reverse least(4, pg_catalog.array_length(words, 1))..1 loop
      select b.name into bname from public.brands b where b.name_key = public.norm(pg_catalog.array_to_string(words[1:n], ' '));
      if bname is not null then
        res := bname || coalesce(' ' || nullif(pg_catalog.array_to_string(words[n + 1:], ' '), ''), '');
        exit;
      end if;
    end loop;
  end if;
  return res;
end $$;

-- ---------- 2. The owner's brand spelling ----------
-- Change a snack. p_photo: null keeps it, '' removes it, an Open Food Facts link, or a photo uploaded to the owner's own folder.
-- As in migration 011, except: the brand is saved as typed (spaces tidied only), a brand typed with new capitals is renamed,
-- and the name is tidied after that, so it starts with the brand's new spelling.
create or replace function public.owner_save_snack(p_item bigint, p_pack_name text, p_brand_name text, p_country int,
                                                   p_category int, p_subcategory text, p_flavour text,
                                                   p_photo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_owner(); i public.items; pack text; bn text := public.clean(p_brand_name); bid bigint;
        old_name text; pid int; vid int; url text; path text; k int;
begin
  select * into i from public.items where id = p_item for update;
  if not found or i.status = 'withdrawn' then raise exception 'That snack isn''t here any more' using errcode = 'P0001'; end if;
  if public.tidy_case(p_pack_name) = '' then raise exception 'Type the name on the pack' using errcode = '22023'; end if;
  if bn = '' then raise exception 'Add the brand' using errcode = '22023'; end if;
  if pg_catalog.char_length(bn) > 60 then raise exception 'Keep the brand under 60 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.places pl where pl.id = p_country and pl.level = 'country') then
    raise exception 'Pick the country it''s sold in' using errcode = '22023';
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

-- ---------- 3. "Wrong photo" reports ----------
alter table public.item_reports drop constraint if exists item_reports_reason_check;
alter table public.item_reports add constraint item_reports_reason_check
  check (reason in ('not_sold', 'wrong_list', 'wrong_name', 'wrong_photo', 'duplicate', 'other'));

create or replace function public.report_item(p_item bigint, p_reason text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); i public.items; n text := nullif(btrim(coalesce(p_note, '')), ''); st text;
begin
  if p_reason is null or p_reason not in ('not_sold', 'wrong_list', 'wrong_name', 'wrong_photo', 'duplicate', 'other') then
    raise exception 'Pick what''s not right' using errcode = '22023';
  end if;
  if char_length(n) > 200 then raise exception 'Please keep the note under 200 letters' using errcode = '22023'; end if;
  select * into i from public.items where id = p_item;
  st := case when found then public.status_now(i.status, i.created_at) end;
  if st is null or not (st = 'pending' or (st = 'live' and p_reason = 'wrong_photo')) then
    raise exception 'This snack isn''t waiting for approval any more' using errcode = 'P0001';
  end if;
  if st = 'pending' and i.submitted_by = u then
    raise exception 'You added this one. You can withdraw it from your profile.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.item_reports where user_id = u and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot of reports for one day. Thanks! Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.item_reports (item_id, user_id, reason, note) values (p_item, u, p_reason, n)
  on conflict (item_id, user_id) do update set reason = excluded.reason, note = excluded.note, status = 'open', created_at = now();
  return jsonb_build_object('ok', true, 'pack_name', i.pack_name);
end $$;

-- For the owner: as in migration 015, plus each snack's photo (image_url or image_path)
create or replace function public.owner_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(x.j order by x.last_at desc), '[]'::jsonb) from (
    select max(r.created_at) as last_at, jsonb_build_object('item_id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
             'product_id', i.product_id, 'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name),
             'emoji', p.emoji, 'image_url', i.image_url, 'image_path', i.image_path,
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

-- ---------- Who may call what (as before) ----------
revoke execute on function public.tidy_case(text, boolean) from public, anon, authenticated;
revoke execute on function public.owner_save_snack(bigint, text, text, int, int, text, text, text),
  public.report_item(bigint, text, text), public.owner_reports() from public, anon;
grant execute on function public.owner_save_snack(bigint, text, text, int, int, text, text, text),
  public.report_item(bigint, text, text), public.owner_reports() to authenticated;

commit;

-- What you should see after pressing Run: the new rule on three examples, and no live names it would change.
select public.tidy_case('Walkers smoky bacon crisps') as small_letters,
       public.tidy_case('KETTLE Chips Mature Cheddar') as shouting,
       public.tidy_case('KitKat Chunky BBQ 70%') as kept,
       (select count(*) from public.items where status = 'live' and pack_name <> public.tidy_case(pack_name)) as live_names_to_tidy;
