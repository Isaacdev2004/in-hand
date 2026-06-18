# Codemagic setup (Windows / HP laptop — no Mac)

Build and upload **In Hand** to TestFlight from the cloud. You only need a browser.

**Bundle ID:** `com.inhand.collector`  
**Repo:** `https://github.com/Isaacdev2004/in-hand`

---

## Part A — Danny (Apple) — do first

Without this, Codemagic cannot sign the app.

1. **Apple Developer Program** enrolled ($99/yr) — [developer.apple.com/programs](https://developer.apple.com/programs/enroll/)
2. **Register the App ID**
   - [developer.apple.com/account/resources/identifiers](https://developer.apple.com/account/resources/identifiers/list)
   - **+** → App IDs → App → Description: `In Hand` → Bundle ID: **Explicit** → `com.inhand.collector` → Register
3. **App Store Connect API key** (for Codemagic uploads)
   - [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** → **App Store Connect API** → **+**
   - Name: `Codemagic`
   - Access: **App Manager** (minimum)
   - Download the **.p8** file once (you cannot download again)
   - Note **Issuer ID** and **Key ID** on that page
4. **Create the app record** (if not done)
   - App Store Connect → **Apps** → **+** → New App → iOS → Name: **In Hand** → Bundle ID: `com.inhand.collector`
5. **Invite you in App Store Connect** (optional but helpful)
   - Users and Access → **+** → Developer or Admin so you can see TestFlight

Send you (the developer) via a **secure channel** (not WhatsApp plain text if possible):

- Issuer ID  
- Key ID  
- Contents of the `.p8` file  
- Apple Team ID (Developer account → Membership details)

---

## Part B — You (Codemagic account)

### 1. Create Codemagic account

1. Go to [codemagic.io](https://codemagic.io/signup)
2. Sign up with **GitHub**
3. Authorize access to **`Isaacdev2004/in-hand`**

### 2. Add the GitHub app

1. Codemagic → **Applications**
2. Click **Add application** → select **in-hand**
3. Codemagic detects `codemagic.yaml` in the repo root

### 3. App Store Connect integration

1. Team settings (your avatar) → **Integrations** → **App Store Connect**
2. **Connect** → paste:
   - Issuer ID  
   - Key ID  
   - API key (.p8 contents)
3. Save — Codemagic validates the key

**Important:** Note the **API key name** you chose when uploading (e.g. `Codemagic`). It must match `integrations.app_store_connect` in `codemagic.yaml`. If you used a different name, either rename in Team settings or edit the yaml to match.

### 3b. Fix “auth integration requires workflow integrations” error

If [app settings](https://codemagic.io) shows a yaml validation error on `ios-release → publishing`, the workflow needs:

```yaml
integrations:
  app_store_connect: Codemagic   # your key name here
```

This is already in the repo on `main` — pull latest or confirm the name matches yours.

### 4. iOS code signing (automatic)

1. Open the **in-hand** app in Codemagic
2. **Settings** (gear) → **codemagic.yaml** is selected as config source
3. Go to **Distribution** → **iOS code signing**
4. Choose **Automatic**
5. Select Danny’s **Apple Developer Team**
6. Bundle ID: `com.inhand.collector`
7. Distribution type: **App Store**
8. Click **Fetch certificate** / **Generate** if prompted
9. Save

Codemagic stores the certificate and provisioning profile for you.

### 5. Environment variables (same as Vercel)

In the app → **Environment variables** → **Add**:

| Variable | Where to copy from |
|----------|-------------------|
| `REACT_APP_SUPABASE_URL` | Vercel → Project → Settings → Environment Variables |
| `REACT_APP_SUPABASE_ANON_KEY` | same |
| `REACT_APP_STRIPE_PUBLISHABLE_KEY` | same |
| `REACT_APP_STRIPE_CHECKOUT_URL` | same (if set) |

Optional (can leave empty for first TestFlight):

- `REACT_APP_CLOUDINARY_CLOUD_NAME`
- `REACT_APP_EBAY_CLIENT_ID`

Mark all as **Secure**. Apply to workflow **ios-build** and **ios-release**.

> Create React App bakes these into the JS at **build** time. If they’re missing, the app opens but Supabase/auth won’t work.

### 6. First build (IPA only — no TestFlight yet)

1. **Start new build**
2. Select workflow: **`ios-build`** (build only — good for first try)
3. Branch: **main**
4. Start build → wait ~10–15 min (cloud Mac)
5. When green, open build → **Artifacts** → download **.ipa** (optional)

If this fails, open the log on the failed step (usually signing or env).

### 7. TestFlight upload

1. When **ios-build** succeeds, run workflow **`ios-release`**
2. Requires App Store Connect integration (Part B step 3)
3. On success, build is uploaded to TestFlight automatically
4. Danny: App Store Connect → **TestFlight** → **Internal Testing** → add testers

---

## Part C — Troubleshooting

| Error | Fix |
|-------|-----|
| No matching provisioning profile | Re-do **iOS code signing** → Automatic → fetch again for `com.inhand.collector` |
| Bundle ID not found | Danny must register App ID (Part A step 2) |
| App Store Connect auth failed | Regenerate API key; check Key ID + Issuer ID + .p8 |
| App builds but blank / no login | Add `REACT_APP_SUPABASE_*` in Codemagic env vars and rebuild |
| `npm ci` fails | Check `package-lock.json` is committed on `main` |
| Workflow not listed | Ensure `codemagic.yaml` is on **main** at repo root |

---

## Part D — After TestFlight works

1. Danny installs **TestFlight** on iPhone → accept invite
2. Smoke test: sign in → Vault → list figure → Browse → buy flow
3. Replace placeholder app icon (`resources/icon.png` 1024×1024) and rebuild
4. App Store submission: use copy in `docs/APP_STORE.md`

---

## Quick reference

```text
Workflow ios-build     → .ipa artifact (test signing)
Workflow ios-release   → .ipa + upload to TestFlight
Privacy URL            → https://in-hand-b5gm.vercel.app/privacy.html
```

No Mac required on your HP laptop for any of this.
