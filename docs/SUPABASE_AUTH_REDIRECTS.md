# Supabase auth redirects (email confirmation → app)

Add these under **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**:

```
inhand://auth/callback
https://in-hand-b5gm.vercel.app/auth/callback
```

**Site URL** can remain: `https://in-hand-b5gm.vercel.app`

After saving, new signup / resend confirmation emails use `inhand://auth/callback` on the native app and the Vercel URL on web.
