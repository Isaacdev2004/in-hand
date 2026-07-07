-- Trade proposals (v1.6) + multi-figure bundle swap RPCs

-- ─── Trade proposals ───────────────────────────────────────────────────────────
create table if not exists public.trade_proposals (
  id                  text primary key,
  proposer_id         text not null references public.users (id) on delete cascade,
  receiver_id         text not null references public.users (id) on delete cascade,
  target_card_id      text not null references public.listings (id) on delete cascade,
  offered_card_ids    text[] not null default '{}',
  topup_suggested     numeric(10,2) not null default 0,
  topup_agreed        numeric(10,2) not null default 0,
  topup_counter_round integer not null default 0,
  topup_status        text not null default 'none',
  last_topup_by       text references public.users (id) on delete set null,
  status              text not null default 'pending',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint trade_proposals_topup_status_check check (
    topup_status in ('none', 'pending', 'countered', 'accepted', 'declined')
  ),
  constraint trade_proposals_status_check check (
    status in ('pending', 'accepted', 'declined', 'withdrawn', 'completed')
  )
);

create index if not exists trade_proposals_proposer on public.trade_proposals (proposer_id);
create index if not exists trade_proposals_receiver on public.trade_proposals (receiver_id);
create index if not exists trade_proposals_status on public.trade_proposals (status);

alter table public.trade_proposals enable row level security;

drop policy if exists "trade_proposals_select_participant" on public.trade_proposals;
create policy "trade_proposals_select_participant" on public.trade_proposals
for select to authenticated
using (
  proposer_id = (select auth.uid())::text
  or receiver_id = (select auth.uid())::text
);

drop policy if exists "trade_proposals_insert_proposer" on public.trade_proposals;
create policy "trade_proposals_insert_proposer" on public.trade_proposals
for insert to authenticated
with check (proposer_id = (select auth.uid())::text);

drop policy if exists "trade_proposals_update_participant" on public.trade_proposals;
create policy "trade_proposals_update_participant" on public.trade_proposals
for update to authenticated
using (
  proposer_id = (select auth.uid())::text
  or receiver_id = (select auth.uid())::text
)
with check (
  proposer_id = (select auth.uid())::text
  or receiver_id = (select auth.uid())::text
);

comment on table public.trade_proposals is 'Figure-for-figure trade proposals with optional top-up negotiation (v1.6).';

-- ─── Bundle swap: proposer gives N listings, receives one ────────────────────
create or replace function public.swap_trade_bundle(p_take_id text, p_give_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  t_take text;
  g_id text;
  g_owner text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_give_ids is null or array_length(p_give_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no_give_listings');
  end if;

  select owner_id into t_take from public.listings where id = p_take_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'take_listing_not_found');
  end if;

  if t_take = v_uid then
    return jsonb_build_object('ok', false, 'error', 'cannot_take_own_listing');
  end if;

  foreach g_id in array p_give_ids loop
    select owner_id into g_owner from public.listings where id = g_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'give_listing_not_found', 'listing_id', g_id);
    end if;
    if g_owner is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'not_owner_of_give', 'listing_id', g_id);
    end if;
  end loop;

  update public.listings
    set owner_id = t_take,
        wants_trade = false,
        wants_buy = false,
        updated_at = now()
    where id = any(p_give_ids);

  update public.listings
    set owner_id = v_uid,
        wants_trade = false,
        wants_buy = false,
        updated_at = now()
    where id = p_take_id;

  return jsonb_build_object('ok', true, 'swapped', array_length(p_give_ids, 1) + 1);
end;
$$;

revoke all on function public.swap_trade_bundle(text, text[]) from public;
grant execute on function public.swap_trade_bundle(text, text[]) to authenticated;

-- ─── Accept a pending proposal (receiver only) — multi-figure atomic swap ───
create or replace function public.execute_trade_proposal(p_proposal_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  p public.trade_proposals%rowtype;
  g_id text;
  t_owner text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into p from public.trade_proposals where id = p_proposal_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  end if;

  if p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'proposal_not_pending');
  end if;

  if p.receiver_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'only_receiver_can_accept');
  end if;

  if p.offered_card_ids is null or array_length(p.offered_card_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no_offered_listings');
  end if;

  select owner_id into t_owner from public.listings where id = p.target_card_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'target_listing_not_found');
  end if;

  if t_owner <> p.receiver_id then
    return jsonb_build_object('ok', false, 'error', 'target_not_owned_by_receiver');
  end if;

  foreach g_id in array p.offered_card_ids loop
    if not exists (
      select 1 from public.listings
      where id = g_id and owner_id = p.proposer_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'offered_not_owned_by_proposer', 'listing_id', g_id);
    end if;
  end loop;

  -- Lock offered rows
  perform 1 from public.listings where id = any(p.offered_card_ids) for update;

  update public.listings
    set owner_id = p.proposer_id,
        wants_trade = false,
        wants_buy = false,
        updated_at = now()
    where id = p.target_card_id;

  update public.listings
    set owner_id = p.receiver_id,
        wants_trade = false,
        wants_buy = false,
        updated_at = now()
    where id = any(p.offered_card_ids);

  update public.trade_proposals
    set status = 'completed',
        topup_agreed = case when p.topup_suggested > 0 then p.topup_suggested else topup_agreed end,
        topup_status = case
          when p.topup_suggested > 0 and topup_status in ('pending', 'countered') then 'accepted'
          else topup_status
        end,
        updated_at = now()
    where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.execute_trade_proposal(text) from public;
grant execute on function public.execute_trade_proposal(text) to authenticated;
