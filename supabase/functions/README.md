# Supabase Edge Functions (Stripe + Shippo)

## One-time secrets (Dashboard → Edge Functions → Secrets, or CLI)

Set:

- `STRIPE_SECRET_KEY` — from Stripe Dashboard (secret key)
- `STRIPE_WEBHOOK_SECRET` — from Stripe → Webhooks → signing secret (after you add the endpoint below)
- `SHIPPO_API_TOKEN` — from [Shippo → Settings → API](https://goshippo.com/user/settings/api) (test or live)

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available automatically to functions when deployed on Supabase.

## Deploy

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy create-shipping-label
```

```bash
npx supabase secrets set SHIPPO_API_TOKEN=shippo_test_...
```

`create-checkout-session` expects **`Authorization: Bearer <user access token>`** (the signed-in buyer’s JWT from `supabase.auth.getSession()`), not the anon key. The Edge function verifies `buyerId` matches that user. The app’s `startStripeCheckout` sends the session access token automatically.

`SUPABASE_ANON_KEY` is available to Edge Functions by default (used to validate the JWT).

## Stripe webhook URL

In Stripe Dashboard → Developers → Webhooks → Add endpoint:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`

Select event: `checkout.session.completed`

## Local testing

```bash
supabase functions serve --env-file ./supabase/.env.local
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
```

Use test keys and the webhook signing secret from `stripe listen`.
