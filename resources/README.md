# App icon & splash (Capacitor Assets)

Place source images here, then generate iOS/Android assets on a Mac:

```bash
npm install -D @capacitor/assets
# 1024×1024 PNG, no alpha channel
# resources/icon.png
# Optional: resources/splash.png (recommended 2732×2732)
npx capacitor-assets generate --ios
npm run build:mobile
```

Until `icon.png` exists, Xcode uses default Capacitor placeholder icons—replace before App Store submission.
