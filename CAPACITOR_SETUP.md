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
- **App ID (Bundle ID / Package Name):** `com.elimikapdf.www.twa`
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

#### Android — Built-in "Open with ElimikaPDF" & "Share to ElimikaPDF"
Running `npm run cap:add:android` or `npm run cap:sync` automatically executes `scripts/setup-android-open-with.mjs`, which configures:

1. **`android/app/src/main/AndroidManifest.xml`**:
   - Sets `MainActivity` to `android:launchMode="singleTask"` so opening a new file while ElimikaPDF is already running loads directly without spawning duplicate windows.
   - Registers **`ACTION_VIEW` ("Open with ElimikaPDF")** for `content://` and `file://` URIs across **PDF (`.pdf`), Word (`.docx`, `.doc`), ODT/RTF, eBooks (`.epub`, `.kpf`, `.mobi`, `.azw3`, `.fb2`), HTML, Text/Markdown, and Images (`.jpg`, `.png`, `.webp`)** — including a file-extension fallback for Android file managers that emit `application/octet-stream` or `*/*`.
   - Registers **`ACTION_SEND` ("Share to ElimikaPDF")** so files can be sent directly from WhatsApp, Gmail, Google Drive, Telegram, Chrome Downloads, and Gallery.
   - Declares `CAMERA`, `READ_MEDIA_IMAGES`, and legacy storage permissions.
2. **`android/app/src/main/java/app/elimikapdf/studio/MainActivity.java`**:
   - Reads incoming `content://` and `file://` URIs **100% offline** via Android's `ContentResolver` on a background thread.
   - Passes the bytes, original filename (`OpenableColumns.DISPLAY_NAME`), and MIME type directly to the web app via `window.ElimikaAndroidBridge`, opening the file immediately in Reading Mode on both cold-start and warm-start.

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
| `ElimikaOpenWith` (Custom Native) | Reads Android "Open with" & "Share" `content://` / `file://` URIs 100% offline | OS `window.launchQueue` / Web Share Target |

---

## 4. Building an Android Release (`.aab` / `.apk`) in Android Studio

ElimikaPDF's Android project is pre-configured for Google Play releases:
- **Package Name (`applicationId`):** `com.elimikapdf.www.twa`
- **Min SDK:** API 24 (Android 7.0+)
- **Compile & Target SDK:** API 36 (Android 16)
- **Clean ad-free permissions** (no AdMob SDK or Advertising ID declarations)

### Step 1 — Build & Sync the Latest Production Web Bundle
```bash
npm run cap:sync
npm run cap:open:android
```
*(Or in Android Studio: **File → Open** → select the **`android/`** folder.)*

### Step 2 — Wait for Gradle Sync & Verify Version Number
1. Let Android Studio finish **Gradle Sync** at the bottom status bar.
2. Open **`android/app/build.gradle`** and verify `versionCode` (increment by 1 for every Google Play upload) and `versionName` (e.g., `"1.0.0"`).

### Step 3 — Generate Signed Release App Bundle (`.aab`) or APK (`.apk`)
1. In Android Studio's top menu, click **Build → Generate Signed App Bundle / APK...**
2. Choose:
   - **Android App Bundle (`.aab`)** — required for uploading to **Google Play Console**.
   - **APK (`.apk`)** — for direct sideloading/testing on Android phones.
3. Click **Create new...** under Key store path (if you don't already have one):
   - Save the `.jks` file in a safe backup location outside the repo (never lose this file!).
   - Enter a Key store password, Key alias (e.g. `elimikapdf`), Key password, and your name/organization.
4. Click **Next**, select the **`release`** build variant, and click **Create**.
5. When finished, click **locate** in the notification toast:
   - Signed Play Store Bundle: `android/app/release/app-release.aab`
   - Signed Direct-Install APK: `android/app/release/app-release.apk`


