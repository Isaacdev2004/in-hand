-- Stripe Connect Express account id for seller payouts.
alter table public.users
  add column if not exists stripe_account_id text;

comment on column public.users.stripe_account_id is 'Stripe Connect Express account id for bank payouts.';

create index if not exists users_stripe_account_id on public.users (stripe_account_id)
  where stripe_account_id is not null;
