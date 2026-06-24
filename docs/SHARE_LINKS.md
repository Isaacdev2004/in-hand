# Share links & Universal Links

Shared listings use:

`https://in-hand-b5gm.vercel.app/listing/{listing-id}`

On iOS with the app installed, this opens **In Hand** directly (Universal Links).

## Requirements

1. **Vercel** deploy includes `public/.well-known/apple-app-site-association`
2. **iOS app** includes Associated Domains entitlement (`applinks:in-hand-b5gm.vercel.app`)
3. User must install a build that includes the entitlement (build **3+**)

## Custom scheme (fallback)

`inhand://listing/{listing-id}` also opens the listing inside the app.

## If links still open Safari

- Delete and reinstall the app after a new TestFlight build
- Universal Links can take a few minutes to propagate after first install
- Long-press the link → should show “Open in In Hand” when configured correctly
