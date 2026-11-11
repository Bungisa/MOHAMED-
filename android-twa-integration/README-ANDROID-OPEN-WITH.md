# Android "Open With" PDF Integration Guide (PWABuilder / Bubblewrap TWA)

## Why Website-Only Changes or `AndroidManifest.xml` Edits Alone Are Not Enough
1. **Why a Website/PWA Alone Cannot Appear in Android File Manager's "Open with" Menu**:
   - The W3C `file_handlers` field in `manifest.webmanifest` is only supported on **desktop** operating systems (Windows, macOS, ChromeOS, Linux). Android Chrome/WebAPK/TWA does **not** convert `file_handlers` into Android `<intent-filter>` entries for `android.intent.action.VIEW`.
2. **Why Editing `AndroidManifest.xml` Alone on `LauncherActivity` Fails**:
   - When a user selects a PDF in Android File Manager and taps **Open with → ElimikaPDF**, Android sends an `Intent` with `action = android.intent.action.VIEW` and a `content://...` URI (e.g., `content://com.android.providers.downloads.documents/document/1234`) protected by temporary `FLAG_GRANT_READ_URI_PERMISSION`.
   - Standard Trusted Web Activity (`com.googlebrowserhelper.trusted.LauncherActivity`) expects an `https://` URL and cannot read `content://` streams directly inside Chrome.
3. **How Our Solution Works**:
   - **`PdfOpenActivity.java`** receives the `android.intent.action.VIEW` (`application/pdf`) intent on both **cold start** (`onCreate`) and **warm start / already running** (`onNewIntent`).
   - It reads the `content://` (or `file://`) `InputStream` securely using Android's `ContentResolver` while the URI read permission is active, verifies the `%PDF-` magic header, streams the PDF to `/api/android-open-pdf`, and launches `LauncherActivity` at `/?action=pdf-reader&android_open_id=<openId>`.
   - **`src/App.tsx`** automatically fetches `/api/android-open-pdf/<openId>` (and broadcasts over `BroadcastChannel('elimikapdf-open-pdf')` if ElimikaPDF is already running), validates the PDF, saves it to IndexedDB, and opens it **automatically in the ElimikaPDF Reader** without asking the user to browse for the file again.

---

## Step-by-Step Instructions to Build the Signed APK / AAB for Google Play

### Step 1: Download the Android Project with Source Code from PWABuilder
1. Deploy your latest ElimikaPDF app to your public Cloud Run / production domain.
2. Open [PWABuilder.com](https://www.pwabuilder.com), enter your public HTTPS URL, and click **Package for stores → Android → All Settings**.
3. Check the **"Include source code"** checkbox in PWABuilder's Android settings.
4. Under **Signing key**, select **Use mine** and upload your existing `signing.keystore` file (so your SHA-256 certificate fingerprint stays identical: `96:17:08:76:99:76:3A:CF:57:2D:84:4B:F9:38:69:39:A7:22:8A:1D:AC:BC:46:66:40:44:E9:7C:DB:42:2F:6A`).
5. Download and unzip the generated PWABuilder package, then unzip the inner **`...-source.zip`** folder.

### Step 2: Copy the 2 Android Integration Files into the Android Project
1. Copy `android-twa-integration/PdfOpenActivity.java` into:
   ```text
   app/src/main/java/app/elimikapdf/studio/PdfOpenActivity.java
   ```
   *(If your package name in `build.gradle` is different from `app.elimikapdf.studio`, update the `package ...;` line at the top of `PdfOpenActivity.java` to match your package name.)*
2. Open `app/src/main/AndroidManifest.xml` and add the `<activity android:name=".PdfOpenActivity" ...>` block from `android-twa-integration/AndroidManifest.xml` inside `<application>...</application>`.

### Step 3: Build the Signed `.aab` and `.apk`
Open the project folder in **Android Studio** (or run from terminal):
```bash
./gradlew bundleRelease assembleRelease
```
- Your signed **Google Play App Bundle (`.aab`)** will be generated at:
  `app/build/outputs/bundle/release/app-release.aab`
- Your signed **Android APK (`.apk`)** for local phone testing will be generated at:
  `app/build/outputs/apk/release/app-release.apk`
