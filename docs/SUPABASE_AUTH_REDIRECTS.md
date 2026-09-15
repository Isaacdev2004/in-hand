# Supabase auth redirects (email confirmation → app)

Add these under **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**:

```
inhand://auth/callback
https://in-hand-b5gm.vercel.app/auth/callback
```

**Site URL** can remain: `https://in-hand-b5gm.vercel.app`

After saving, new signup / resend confirmation / **forgot-password** emails use `inhand://auth/callback` on the native app and the Vercel URL on web.

Password reset links must include this redirect so the app opens the in-app “Update password” screen (`type=recovery`).
