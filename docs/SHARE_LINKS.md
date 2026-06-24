# Share links

Shared listings from the **iOS app** use:

`inhand://listing/{listing-id}`

Tapping that link opens **In Hand** directly (custom URL scheme — no extra Apple signing setup).

The **web app** shares:

`https://in-hand-b5gm.vercel.app/listing/{listing-id}`

## Universal Links (optional, later)

To make `https://…` links open the app automatically, Danny must:

1. Apple Developer → **Identifiers** → `com.inhand.collector` → enable **Associated Domains**
2. Regenerate the App Store provisioning profile in Codemagic
3. Re-add `App.entitlements` with `applinks:in-hand-b5gm.vercel.app`

The repo already includes `public/.well-known/apple-app-site-association` on Vercel for when that is enabled.
