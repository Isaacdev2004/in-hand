# Shippo shipping setup (In Hand)

Product decision: use **[Shippo](https://goshippo.com)** (not EasyPost) for USPS labels.

## How In Hand should work

1. **One central Shippo account** owned by In Hand (not per-seller accounts).
2. **Buyer pays shipping at checkout** (included in Stripe Checkout total via Edge Function).
3. **Escrow covers label cost** when the seller generates a label after sale.
4. **Seller flow:** `LabelModal` → return address → confirm → purchase label → tracking stored on `shipments`.

The UI still **simulates** label generation (`handleGenerate` in `src/in-hand-v5.jsx`). Replace that with a server call.

## Credentials (client → developer)

Ask Danny / ops for:

| Secret | Where |
|--------|--------|
| **Shippo API token** (Live for production, Test for dev) | [Shippo → Settings → API](https://goshippo.com/user/settings/api) |
| **Webhook signing** (optional) | Shippo → Webhooks — for `track_updated` / `transaction_created` |

**Do not** put `SHIPPO_API_TOKEN` in `REACT_APP_*` or commit it. Set on Supabase:

```bash
npx supabase secrets set SHIPPO_API_TOKEN=shippo_live_...
```

## Recommended backend shape

Add Edge Function e.g. `supabase/functions/create-shipping-label`:

1. Verify JWT; ensure caller is the seller on the `shipments` row.
2. Load buyer address from profile / checkout metadata (full street, not city-only).
3. Call Shippo:
   - `POST /addresses` (validate from/to)
   - `POST /shipments` with parcel dimensions from listing/shipment
   - `POST /transactions` (buy label) with USPS Ground Advantage (or rate object from shipment)
4. Persist `tracking_number`, `label_url`, `shippo_transaction_id` on `shipments`.
5. Deduct label cost from escrow (existing RPC or ledger entry).

Reference: [Shippo API docs](https://docs.goshippo.com/).

## Webhooks

Register in Shippo dashboard pointing to e.g. `https://<project>.supabase.co/functions/v1/shippo-webhook`:

- `track_updated` → update shipment status, notify buyer
- Handle test vs live mode separately

## Dev vs production

- **Test token:** labels are sandbox; no real postage.
- **Live token:** fund Shippo billing; real USPS charges.

## UI copy

Label modal strings already say **Shippo + USPS**. No frontend API key required.

## Deploy (CLI 403?)

If `npx supabase functions deploy` returns **403**, your Supabase login is not an **Owner/Admin** on project `mmlenzpuuycmvttirhgx`. Fix:

1. Log in as the project owner: `npx supabase login`
2. Link: `npx supabase link --project-ref mmlenzpuuycmvttirhgx`
3. Or ask the owner (Danny / repo owner) to invite you under **Project Settings → Team** with deploy access, then deploy again.

**Dashboard fallback (owner only):** Supabase → **Edge Functions** → create/deploy `create-shipping-label` and paste the code from `supabase/functions/create-shipping-label/index.ts` plus shared helpers. Set secret `SHIPPO_API_TOKEN` under **Edge Functions → Secrets**.

`Docker is not running` is only a warning for local `supabase functions serve`; deploy can still work once permissions are fixed.

## Checklist

- [ ] Shippo account created and billing funded (production)
- [ ] `SHIPPO_API_TOKEN` in Supabase secrets (Dashboard or CLI)
- [ ] Deploy `create-shipping-label` Edge Function (needs project Owner/Admin)
- [x] `LabelModal` calls Edge Function when Supabase is configured
- [ ] Buyer full ship-to address available at label time
- [ ] Webhook for tracking updates
- [ ] Remove simulated `setTimeout` in `handleGenerate`
