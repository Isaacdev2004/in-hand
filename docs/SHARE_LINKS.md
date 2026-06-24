# Share links

Shared listings use a **clickable HTTPS link**:

`https://in-hand-b5gm.vercel.app/listing/{listing-id}`

Works in WhatsApp, iMessage, SMS, etc.

## Opening the app

When someone taps the link on a phone:

1. The web page loads briefly
2. It redirects to `inhand://listing/{id}` to open **In Hand**
3. If the app is not installed, the listing opens in the web app instead

## Universal Links (optional, later)

For links to open the app **without** a browser flash, enable **Associated Domains** on the Apple App ID and re-add entitlements (see prior build notes).
