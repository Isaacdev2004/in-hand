-- Stripe Customer for saved payment methods + trade top-up PI tracking
alter table public.users
  add column if not exists stripe_customer_id text;

comment on column public.users.stripe_customer_id is 'Stripe Customer id for saved cards (SetupIntent). Never store raw card numbers.';

create index if not exists users_stripe_customer_id on public.users (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.trade_proposals
  add column if not exists topup_payment_intent_id text,
  add column if not exists topup_paid_at timestamptz;

comment on column public.trade_proposals.topup_payment_intent_id is 'Stripe PaymentIntent for cash top-up held in escrow until both figures deliver.';
comment on column public.trade_proposals.topup_paid_at is 'When top-up PaymentIntent succeeded.';
