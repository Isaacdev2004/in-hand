-- Track Stripe Connect transfers after escrow release (bank payout ~2 business days via Express schedule).
alter table public.transactions
  add column if not exists stripe_transfer_id text;

comment on column public.transactions.stripe_transfer_id is
  'Stripe Transfer id moving escrow net to seller Connect Express account.';

create index if not exists transactions_stripe_transfer_id
  on public.transactions (stripe_transfer_id)
  where stripe_transfer_id is not null;
