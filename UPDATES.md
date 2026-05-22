# In Hand updates

## v1.2.0 — Trade disputes

- **Database:** `disputes.type` (`purchase` | `trade`) and `disputes.against_user` (counterparty username at filing time). Migration: `20260514120000_disputes_trade_type_against_user.sql`.
- **Purchases:** Unchanged flow — buyer disputes after delivery; escrow freeze + `transactions.status = disputed` when a shipment exists.
- **Trades:** From **Wallet**, completed **trade** transactions show **Report trade issue** (30-day window from trade date). Filing records a trade dispute without freezing shipment/escrow (trades do not use the same delivery record as purchases).
- **Admin → Disputes:** Shows **Purchase** / **Trade** chip and stored counterparty name.

Apply migration: `npx supabase db push --linked` (or run the SQL in the Supabase SQL editor).

## Wallet model (launch)

- **Purchases:** Card only via Stripe Checkout (no prepaid wallet top-up).
- **Wallet balance:** Sale earnings after escrow release; optional for trade sweeteners only.
- Removed demo **Add Funds** / **Withdraw** UI.

## Shipping provider — Shippo

- Product uses **[Shippo](https://goshippo.com)** instead of EasyPost.
- UI: `LabelModal` copy updated; label generation still simulated until Edge Function is wired.
- Developer guide: `SHIPPO_SETUP.md`. Token is **server-side only** (`SHIPPO_API_TOKEN` on Supabase, not `REACT_APP_*`).
