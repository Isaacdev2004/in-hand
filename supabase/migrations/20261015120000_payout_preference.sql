-- Seller payout preference: instant (debit) vs standard (bank / Express schedule)
alter table public.users
  add column if not exists payout_preference text default 'standard',
  add column if not exists instant_payout_card jsonb default null;

comment on column public.users.payout_preference is 'instant = Instant Payouts to debit card (Stripe ~1% fee); standard = bank via Connect (~2 business days)';
comment on column public.users.instant_payout_card is 'Saved debit card summary for Instant Payouts { brand, last4, exp_month, exp_year, external_account_id } — never raw PAN';
