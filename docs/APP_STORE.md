# In Hand — App Store & TestFlight checklist

## App identity (locked for build)

| Field | Value |
|--------|--------|
| Display name | **In Hand** |
| Bundle ID | `com.inhand.collector` |
| Category | **Shopping** (primary) |
| Age rating | 4+ / no objectionable content |

## Privacy policy URL (required)

Host `public/privacy.html` on production, e.g.:

- `https://in-hand-b5gm.vercel.app/privacy.html`

Enter that exact URL in App Store Connect → App Privacy → Privacy Policy URL.

Update the support email in `privacy.html` before submission.

## Store listing copy (draft for Danny)

**Subtitle (30 chars)**  
Buy, sell & trade collectibles

**Promotional text (170 chars)**  
List figures from your vault, match with collectors, buy with escrow, or propose trades—all in one marketplace built for vintage toy collectors.

**Description (short)**  
In Hand is the collector marketplace for vintage figures—G.I. Joe, Transformers, Star Wars, MOTU, TMNT, and more. Browse listings, list from your vault, message sellers, buy with protected checkout, or trade figure-for-figure with optional cash sweeteners.

**Keywords (100 chars, comma-free for ASC)**  
collectibles,vintage toys,trading,GI Joe,Transformers,Star Wars,MOTU,TMNT,marketplace,figures

**Support URL**  
`https://in-hand-b5gm.vercel.app` (or dedicated support page)

## Screenshots

Capture on iPhone 15 Pro Max simulator (6.7") or device:

1. Browse / listings  
2. Listing detail + Buy  
3. Vault + Add figure  
4. Trades  
5. Wallet / escrow  
6. Shipping tracking  
7. Account / profile  

Minimum 3 screenshots; recommend 5–8.

## App icon

1. Export a **1024×1024 PNG** (no transparency) to `resources/icon.png`.  
2. Optional splash: `resources/splash.png` (2732×2732 or 1284×2778).  
3. Run on Mac: `npx @capacitor/assets generate --ios`  
4. Then: `npm run build:mobile`

## Danny — start Apple today

1. Enroll: https://developer.apple.com/programs/enroll ($99/yr). Personal = ~24h; Company needs D-U-N-S (~1–2 days).  
2. App Store Connect → Users → invite developer with **Admin** (upload builds + TestFlight).  
3. Confirm bundle ID `com.inhand.collector` in Certificates, Identifiers & Profiles.  
4. Create app record in App Store Connect with name **In Hand** and bundle ID above.

## Developer — iOS build (requires macOS)

```bash
npm ci
npm run build:mobile
npx cap open ios
```

In Xcode:

1. Signing & Capabilities → Team = Danny’s Apple Developer team.  
2. Product → Archive → Distribute → App Store Connect → Upload.  
3. TestFlight → add internal testers → smoke test full flow.

**Windows / HP laptop:** use Codemagic — full steps in **`docs/CODEMAGIC_SETUP.md`** (`codemagic.yaml` in repo).

## Smoke test before TestFlight

- [ ] Sign up / sign in (Supabase auth)  
- [ ] List a figure (Vault → + Add) → appears in Browse for another user  
- [ ] Buy flow (Stripe test mode)  
- [ ] Message seller  
- [ ] Shipping label / tracking UI  
- [ ] Push notification toggles (Account)  
- [ ] Safe area: header + bottom nav clear of notch/home indicator  

## Timeline

| Day | Milestone |
|-----|-----------|
| 1 | Capacitor iOS project in repo; Danny enrolls Apple |
| 2 | Signed build → TestFlight internal |
| 3–5 | Client + 2 testers on TestFlight |
| 6 | Submit for App Store review |
| 7–10 | Live on App Store (review ~24–48h) |
