# ElimikaPDF — Dual Website & Capacitor Native App Guide

ElimikaPDF runs from a **single codebase** as both:
1. **Website & Offline PWA** (`npm run build` / `npm run dev`)
2. **Native Android & iOS Mobile App** powered by **Capacitor SDK** (`capacitor.config.ts`)

---

## 1. Run & Deploy as a Website (Web / PWA)

```bash
npm install
npm run dev       # Local development server on http://localhost:3000
npm run build     # Production Website + PWA build into dist/
npm run start     # Serve full-stack app via server.ts
```

When running in a browser:
- Service Worker (`/sw.js`) and Web App Manifest (`/manifest.webmanifest`) are active.
- File downloads use direct browser download / Web Share API.
- API calls use same-origin `/api/*` routes.

---

## 2. Build & Run as a Native Mobile App (Capacitor SDK)

### App Identifiers (`capacitor.config.ts`)
- **App Name:** `ElimikaPDF`
- **App ID (Bundle ID / Package Name):** `app.elimikapdf.studio`
- **Web Assets Directory:** `dist`

### Step A — Optional Backend API URL for Cloud/Server Routes
If your native app needs to reach server-side `/api/*` endpoints (such as Dropbox OAuth callbacks or temporary shared links), set your hosted web URL in `.env`:

```env
VITE_API_BASE_URL="https://your-hosted-elimikapdf-domain.com"
```

*(All core PDF reading, scanning, OCR, editing, Word conversion, and local vault storage work 100% offline on-device without a backend.)*

### Step B — Add Native Platforms (One-Time Setup)

```bash
# 1. Build the Capacitor web bundle (disables redundant Service Worker inside WebView)
npm run build:cap

# 2. Generate native Android and/or iOS projects
npm run cap:add:android
npm run cap:add:ios
```

### Step C — Sync Web Code & Open in Android Studio / Xcode

```bash
# Rebuild dist/ and copy assets + native plugins into android/ and ios/
npm run cap:sync

# Open native IDEs to sign, test, and export .aab / .apk / .ipa
npm run cap:open:android
npm run cap:open:ios
```

### Step D — Native Permissions Checklist

#### Android (`android/app/src/main/AndroidManifest.xml`)
Ensure these permissions are declared inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
```

You can also merge the `<intent-filter>` blocks from `android-twa-integration/AndroidManifest.xml` into `MainActivity` to appear in Android's **"Open with ElimikaPDF"** menu for `.pdf`, `.docx`, `.doc`, `.epub`, `.kpf`, and `.html` files.

#### iOS (`ios/App/App/Info.plist`)
Add the standard Apple privacy usage descriptions:

```xml
<key>NSCameraUsageDescription</key>
<string>ElimikaPDF uses your camera to scan physical documents, exams, and receipts into PDFs.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>ElimikaPDF accesses your photo library so you can import document photos into PDFs.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>ElimikaPDF saves scanned images and exported pages to your library when requested.</string>
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

---

## 3. Native Plugins Included & Wired (`src/services/capacitorBridge.ts`)

| Plugin | Native Behavior (Android / iOS) | Website Fallback |
| --- | --- | --- |
| `@capacitor/filesystem` | Saves PDFs, Word `.docx`, and images into `Documents/ElimikaPDF/` (or Cache + Share fallback for Android Scoped Storage) | Standard `<a download>` |
| `@capacitor/share` | Native Android/iOS OS Share Sheet with cached file URI | `navigator.share` / download |
| `@capacitor/camera` | Direct native high-resolution camera capture in Document Scanner | WebRTC `getUserMedia` / file input |
| `@capacitor/status-bar` | Syncs status bar background and light/dark icons with ElimikaPDF theme | CSS `theme-color` meta tag |
| `@capacitor/splash-screen` | Smooth handoff from native launch screen once React mounts | Instant web render |
| `@capacitor/app` | Android hardware Back button navigates to Home before minimizing; handles deep links (`appUrlOpen`) | Browser `history.popstate` & URL query params |
| `@capacitor/haptics` | Tactile feedback on capture and file exports | Silent no-op |
