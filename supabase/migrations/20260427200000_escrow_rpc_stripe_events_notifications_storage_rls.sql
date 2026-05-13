-- Escrow payout RPC (SECURITY DEFINER), Stripe webhook dedupe, notifications RLS,
-- stricter listing write RLS, listing-photos storage bucket.

-- ─── Stripe idempotency (webhook may retry same event.id) ───────────────────
create table if not exists public.stripe_events (
  id            text primary key,
  created_at    timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- No client access; service role bypasses RLS for Edge Functions.
drop policy if exists "stripe_events_no_client" on public.stripe_events;
create policy "stripe_events_no_client" on public.stripe_events
for all to anon, authenticated using (false) with check (false);

-- ─── Escrow: credit seller + complete txn (bypasses per-user wallet RLS) ─────
create or replace function public.try_release_escrow(
  p_shipment_id text,
  p_auto_after_delay boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  s public.shipments%rowtype;
  t public.transactions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  end if;

  if s.funds_released then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  if s.dispute_frozen then
    return jsonb_build_object('ok', false, 'error', 'dispute_frozen');
  end if;

  if s.status is distinct from 'delivered' then
    return jsonb_build_object('ok', false, 'error', 'not_delivered');
  end if;

  if p_auto_after_delay then
    if s.delivered_at is null then
      return jsonb_build_object('ok', false, 'error', 'no_delivered_at');
    end if;
    if s.delivered_at > now() - interval '7 days' then
      return jsonb_build_object('ok', false, 'error', 'auto_delay_not_elapsed');
    end if;
    if v_uid is distinct from s.to_user and v_uid is distinct from s.from_user then
      return jsonb_build_object('ok', false, 'error', 'not_participant');
    end if;
  else
    if v_uid is distinct from s.to_user then
      return jsonb_build_object('ok', false, 'error', 'not_buyer');
    end if;
  end if;

  select * into t from public.transactions where id = s.txn_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'txn_not_found');
  end if;

  if t.status = 'completed' then
    update public.shipments
      set funds_released = true,
          auto_released = coalesce(p_auto_after_delay, false),
          updated_at = now()
      where id = s.id;
    return jsonb_build_object('ok', true, 'idempotent_txn', true);
  end if;

  update public.users
    set wallet_balance = wallet_balance + coalesce(t.net, 0),
        updated_at = now()
    where id = s.from_user;

  update public.transactions set status = 'completed' where id = t.id;

  update public.shipments
    set funds_released = true,
        auto_released = coalesce(p_auto_after_delay, false),
        updated_at = now()
    where id = s.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.try_release_escrow(text, boolean) from public;
grant execute on function public.try_release_escrow(text, boolean) to authenticated;

-- ─── Trade: swap two listings (buyer cannot UPDATE seller rows under owner RLS) ─
create or replace function public.swap_trade_listings(p_take_id text, p_give_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  t_take text;
  t_give text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select owner_id into t_take from public.listings where id = p_take_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'take_listing_not_found');
  end if;

  select owner_id into t_give from public.listings where id = p_give_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'give_listing_not_found');
  end if;

  if t_give is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner_of_give');
  end if;

  if t_take = v_uid then
    return jsonb_build_object('ok', false, 'error', 'cannot_take_own_listing');
  end if;

  update public.listings
    set owner_id = t_take,
        wants_trade = false,
        wants_buy = false,
        updated_at = now()
    where id = p_give_id;

  update public.listings
    set owner_id = v_uid,
        wants_trade = false,
        wants_buy = false,
        updated_at = now()
    where id = p_take_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.swap_trade_listings(text, text) from public;
grant execute on function public.swap_trade_listings(text, text) to authenticated;

-- ─── Notifications RLS ─────────────────────────────────────────────────────
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_recipient" on public.notifications;
create policy "notifications_select_recipient" on public.notifications
for select to authenticated
using (recipient_id = (select auth.uid())::text);

drop policy if exists "notifications_update_recipient" on public.notifications;
create policy "notifications_update_recipient" on public.notifications
for update to authenticated
using (recipient_id = (select auth.uid())::text)
with check (recipient_id = (select auth.uid())::text);

-- Allow any signed-in user to insert notifications (e.g. wishlist match to another user).
-- Tighten later with CHECK on listing ownership if abuse appears.
drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated" on public.notifications
for insert to authenticated
with check (true);

-- ─── Listings: keep broad read; restrict writes to owner ─────────────────────
drop policy if exists "listings_insert_all_dev" on public.listings;
drop policy if exists "listings_update_all_dev" on public.listings;
drop policy if exists "listings_delete_all_dev" on public.listings;

create policy "listings_insert_owner" on public.listings
for insert to authenticated
with check (owner_id = (select auth.uid())::text);

create policy "listings_update_owner" on public.listings
for update to authenticated
using (owner_id = (select auth.uid())::text)
with check (owner_id = (select auth.uid())::text);

create policy "listings_delete_owner" on public.listings
for delete to authenticated
using (
  owner_id = (select auth.uid())::text
  or exists (
    select 1
    from public.transactions t
    where t.card_id = listings.id
      and t.buyer_id = (select auth.uid())::text
      and t.status = 'in_escrow'
  )
);

-- ─── Storage: public listing photos (upload = authenticated) ───────────────
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "listing_photos_public_read" on storage.objects;
create policy "listing_photos_public_read" on storage.objects
for select to public
using (bucket_id = 'listing-photos');

drop policy if exists "listing_photos_auth_insert" on storage.objects;
create policy "listing_photos_auth_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'listing-photos');

drop policy if exists "listing_photos_auth_update" on storage.objects;
create policy "listing_photos_auth_update" on storage.objects
for update to authenticated
using (bucket_id = 'listing-photos')
with check (bucket_id = 'listing-photos');

drop policy if exists "listing_photos_auth_delete" on storage.objects;
create policy "listing_photos_auth_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'listing-photos');
