-- Snapshot buyer/seller addresses on the shipment so Shippo labels
-- use the parties' info from checkout, not a platform default.

alter table public.shipments
  add column if not exists ship_to jsonb,
  add column if not exists ship_from jsonb;

comment on column public.shipments.ship_to is 'Buyer ship-to captured at Stripe Checkout.';
comment on column public.shipments.ship_from is 'Seller return address used when the USPS label was purchased.';
