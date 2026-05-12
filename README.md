# In Hand — Action Figure Exchange

## Quick Start (local)
From the directory that contains `package.json`:
```bash
npm install
cp .env.example .env.local   # optional: set REACT_APP_SUPABASE_* for live data
npm start
```
Opens at http://localhost:3000 (Create React App may open a browser tab automatically).

- **Production check:** `npm run build` — deployable files go in `build/`.
- **Supabase:** With valid keys in `.env.local`, the app loads from your Supabase project; otherwise it uses the built-in seed (and `window.storage` when that API exists).

## Deploy to Vercel
1. Push to GitHub
2. Connect repo on vercel.com
3. Click Deploy

## Developer Handoff
See the comments inside src/in-hand-v5.jsx — every mock function has instructions for the real API it needs to replace:
- Supabase (auth + database)
- Stripe Connect (payments + escrow)
- Cloudinary (photo uploads)
- EasyPost (shipping labels)
- eBay Browse API (market values)
- Firebase FCM (push notifications)
- Resend (transactional emails)

## Supabase database (first-time setup)
1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/20260427120000_initial_schema.sql` (full schema: users, listings, transactions, shipments, disputes, ratings, conversations, notifications).
3. Run `supabase/migrations/20260427191000_listings_rls.sql` to enable listings CRUD with RLS (dev-friendly policy set).
4. Run `supabase/migrations/20260427193000_marketplace_writes_rls.sql` to enable transactions/shipments/messages/disputes/ratings writes.
5. Optional: run `supabase/seed.sql` to load the same demo data as the React mock.
6. Copy `.env.example` to `.env.local` and set `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` from **Project Settings → API**.

With `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` set, `AppShell` **loads** the `db` state from Supabase on startup (and falls back to the built-in seed if the request fails). Persisted writes now include listings + transaction/shipment inserts/updates, messaging thread/message writes, and dispute/rating inserts.

## Environment Variables (add to Vercel)
REACT_APP_SUPABASE_URL=
REACT_APP_SUPABASE_ANON_KEY=
REACT_APP_STRIPE_PUBLISHABLE_KEY=
REACT_APP_STRIPE_CHECKOUT_URL=
REACT_APP_CLOUDINARY_CLOUD_NAME=
REACT_APP_EASYPOST_API_KEY=
REACT_APP_EBAY_CLIENT_ID=
REACT_APP_RESEND_API_KEY=
REACT_APP_FIREBASE_SERVER_KEY=

### Stripe (Supabase Edge Functions)

Card checkout calls **`/functions/v1/create-checkout-session`**, which loads the listing from Postgres, computes fees/shipping server-side, and returns a Stripe Checkout `sessionId`. After payment, **`stripe-webhook`** handles `checkout.session.completed` and inserts the transaction + shipment and removes the listing.

1. Deploy functions: see `supabase/functions/README.md`.
2. Set Edge Function secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
3. In Stripe Dashboard, add webhook URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` and subscribe to `checkout.session.completed`.
