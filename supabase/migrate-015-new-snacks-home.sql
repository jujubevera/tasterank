-- TasteRank migration 015: new snacks to check on home, and "Not right?" reports
-- (design/mockups/waiting-on-home.html round 4, design/mockups/cat-preview.html)
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It runs as one transaction: if anything fails, nothing changes. It is safe to run again.
-- Run it BEFORE pushing the site update (?v=2026-11-05a). The live site keeps working on it.
--
-- What it does:
--   1. home_waiting(country): every snack in the vote in one country, for the "New snacks to check" section on home,
--      closest to going live first, then closing soonest. Says whether you approved or reported each, or added it;
--      never who else did.
--   2. Reports ("Not right?"): a small table only these functions can reach, report_item() to send one
--      (one per person per snack; a second one replaces the first), and for the owner: owner_reports(),
--      owner_resolve_report() (clear them, or take the snack out of the vote), and the count in owner_status().
--   3. Toffee's emoji becomes 🍮, so it no longer looks the same as Jelly sweets (🍬) on home.

begin;

-- ---------- The reports table (section 2 uses it; home_waiting reads it too) ----------
create table if not exists public.item_reports (
  id bigserial primary key,
  item_id bigint not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('not_sold', 'wrong_list', 'wrong_name', 'duplicate', 'other')),
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'cleared')),
  created_at timestamptz not null default now(),
  unique (item_id, user_id)
);
alter table public.item_reports enable row level security;   -- no policies: only the functions below reach it
revoke all on table public.item_reports from anon, authenticated;

-- ---------- 1. New snacks to check ----------
create or replace function public.home_waiting(p_country int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'pack_name', w.pack_name, 'brand', w.brand,
           'product_id', w.product_id, 'product', w.product, 'type_id', w.category_id, 'emoji', w.emoji, 'variant_id', w.variant_id,
           'approvals', w.approvals, 'days_left', w.days_left, 'approved', w.approved, 'reported', w.reported, 'mine', w.mine)
         order by w.mine, w.approvals desc, w.days_left, w.id), '[]'::jsonb)
  from (
    select i.id, i.pack_name, b.name as brand, i.product_id, i.variant_id, p.category_id, p.emoji,
           coalesce(public.local_name('product', p.id, p_country), p.name) as product,
           (select count(*) from public.approvals a where a.item_id = i.id)::int as approvals,
           greatest(0, (public.app_settings()->>'close_after_days')::int - extract(day from now() - i.created_at)::int) as days_left,
           exists (select 1 from public.approvals a where a.item_id = i.id and a.user_id = auth.uid()) as approved,
           exists (select 1 from public.item_reports r where r.item_id = i.id and r.user_id = auth.uid()) as reported,
           coalesce(i.submitted_by = auth.uid(), false) as mine
    from public.items i
    join public.brands b on b.id = i.brand_id
    join public.products p on p.id = i.product_id
    join public.categories c on c.id = p.category_id and c.visible
    where i.country_id = p_country and public.status_now(i.status, i.created_at) = 'pending'
  ) w
$$;

-- ---------- 2. Reports ----------

create or replace function public.report_item(p_item bigint, p_reason text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); i public.items; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_reason is null or p_reason not in ('not_sold', 'wrong_list', 'wrong_name', 'duplicate', 'other') then
    raise exception 'Pick what''s not right' using errcode = '22023';
  end if;
  if char_length(n) > 200 then raise exception 'Please keep the note under 200 letters' using errcode = '22023'; end if;
  select * into i from public.items where id = p_item;
  if not found or public.status_now(i.status, i.created_at) <> 'pending' then
    raise exception 'This snack isn''t waiting for approval any more' using errcode = 'P0001';
  end if;
  if i.submitted_by = u then
    raise exception 'You added this one. You can withdraw it from your profile.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.item_reports where user_id = u and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot of reports for one day. Thanks! Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.item_reports (item_id, user_id, reason, note) values (p_item, u, p_reason, n)
  on conflict (item_id, user_id) do update set reason = excluded.reason, note = excluded.note, status = 'open', created_at = now();
  return jsonb_build_object('ok', true, 'pack_name', i.pack_name);
end $$;

-- For the owner: one entry per snack with open reports, newest first. Counts per reason and the notes; never who sent them.
create or replace function public.owner_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_owner();
  return (select coalesce(jsonb_agg(x.j order by x.last_at desc), '[]'::jsonb) from (
    select max(r.created_at) as last_at, jsonb_build_object('item_id', i.id, 'pack_name', i.pack_name, 'brand', b.name,
             'product_id', i.product_id, 'product', coalesce(public.local_name('product', i.product_id, i.country_id), p.name),
             'emoji', p.emoji, 'country_id', i.country_id, 'status', public.status_now(i.status, i.created_at),
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

-- Clear a snack's reports ('clear': keep it as it is, or after fixing it), or take it out of the vote ('hide')
create or replace function public.owner_resolve_report(p_item bigint, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_owner();
  if p_action = 'hide' then perform public.owner_set_status(p_item, 'hide');
  elsif p_action <> 'clear' then raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
  update public.item_reports set status = 'cleared' where item_id = p_item and status = 'open';
  return jsonb_build_object('ok', true);
end $$;

-- The gear menu's count: additions to check, plus snacks with open reports
create or replace function public.owner_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_owner()
    then jsonb_build_object('owner', true, 'to_check', (select count(*) from public.item_requests where status = 'review'),
           'reports', (select count(distinct r.item_id) from public.item_reports r join public.items i on i.id = r.item_id
                       where r.status = 'open' and i.status not in ('withdrawn', 'hidden')))
    else jsonb_build_object('owner', false) end
$$;

-- ---------- 3. Toffee's emoji ----------
update public.products set emoji = '🍮' where name = 'Toffee' and emoji = '🍬';

-- ---------- Who may call what ----------
grant execute on function public.home_waiting(int) to anon, authenticated;
revoke execute on function public.report_item(bigint, text, text), public.owner_reports(),
  public.owner_resolve_report(bigint, text) from public, anon;
grant execute on function public.report_item(bigint, text, text), public.owner_reports(),
  public.owner_resolve_report(bigint, text) to authenticated;

-- What you should see after pressing Run: the UK snacks waiting for approval, closest to going live first.
select w->>'pack_name' as snack, w->>'product' as list, (w->>'approvals')::int as approvals, (w->>'days_left')::int as days_left
from jsonb_array_elements(public.home_waiting(1)) w;

commit;
