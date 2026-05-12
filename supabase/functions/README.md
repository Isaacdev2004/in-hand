# Supabase Edge Functions (Stripe)

## One-time secrets (Dashboard → Edge Functions → Secrets, or CLI)

Set:

- `STRIPE_SECRET_KEY` — from Stripe Dashboard (secret key)
- `STRIPE_WEBHOOK_SECRET` — from Stripe → Webhooks → signing secret (after you add the endpoint below)

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available automatically to functions when deployed on Supabase.

## Deploy

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

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
