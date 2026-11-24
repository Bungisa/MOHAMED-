#!/usr/bin/env node
/**
 * Configures the Capacitor Android project (`android/`) for clean production release builds:
 * 1. Android's system "Open with" chooser (ACTION_VIEW), "Share to" sheet (ACTION_SEND),
 *    and Multi-file Share (ACTION_SEND_MULTIPLE) for PDF, Word (.docx/.doc), eBooks
 *    (.epub/.kpf/.mobi/.fb2), HTML, Text, and Images — using separate valid `<intent-filter>`
 *    blocks (without `CATEGORY_BROWSABLE` on file/content schemes and with `pathSuffix` +
 *    `pathPattern` for Android 10–16 file managers).
 * 2. Offline native ContentResolver plugin (`ElimikaOpenWithPlugin.java` + `MainActivity.java`)
 *    plus dual `@JavascriptInterface` (`window.ElimikaAndroidBridge`) so cold-start and warm-start
 *    file launches always open immediately in Reader Mode.
 * 3. Synchronizes package namespace & Java directory (`com.elimikapdf.www.twa`), release signing
 *    support, R8 shrinking, and ProGuard keep rules.
 *
 * Safe & idempotent: runs automatically on `npm run cap:add:android`, `npm run cap:sync`, and `npm run android:init`.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ANDROID_DIR = path.join(ROOT, 'android');
const MANIFEST_PATH = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'AndroidManifest.xml'
);
const BUILD_GRADLE_PATH = path.join(ANDROID_DIR, 'app', 'build.gradle');
const STRINGS_XML_PATH = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'res',
  'values',
  'strings.xml'
);
const PROGUARD_PATH = path.join(ANDROID_DIR, 'app', 'proguard-rules.pro');

const TARGET_PACKAGE = 'com.elimikapdf.www.twa';
const JAVA_MAIN_ROOT = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java');
const JAVA_PACKAGE_DIR = path.join(
  JAVA_MAIN_ROOT,
  'com',
  'elimikapdf',
  'www',
  'twa'
);
const LEGACY_JAVA_APP_DIR = path.join(JAVA_MAIN_ROOT, 'app');

const MAIN_ACTIVITY_PATH = path.join(JAVA_PACKAGE_DIR, 'MainActivity.java');
const OPEN_WITH_PLUGIN_PATH = path.join(
  JAVA_PACKAGE_DIR,
  'ElimikaOpenWithPlugin.java'
);

if (!fs.existsSync(ANDROID_DIR) || !fs.existsSync(MANIFEST_PATH)) {
  console.log(
    '[ElimikaPDF Android] android/ project not found yet. Run `npm run cap:add:android` first.'
  );
  process.exit(0);
}

const PERMISSIONS_BLOCK = `    <!-- ELIMIKAPDF_PERMISSIONS_START -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
    <!-- ELIMIKAPDF_PERMISSIONS_END -->`;

const INTENT_FILTERS_BLOCK = `            <!-- ELIMIKAPDF_OPEN_WITH_START -->
            <!-- 1. Open With ElimikaPDF — Primary PDF Filter (content:// & file:// without BROWSABLE so Android always shows ElimikaPDF in Open With) -->
            <intent-filter android:label="ElimikaPDF" android:priority="999">
                <action android:name="android.intent.action.VIEW" />
                <action android:name="android.intent.action.EDIT" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/x-pdf" />
                <data android:mimeType="application/acrobat" />
                <data android:mimeType="application/vnd.pdf" />
                <data android:mimeType="text/pdf" />
                <data android:mimeType="text/x-pdf" />
            </intent-filter>

            <!-- 2. Open With ElimikaPDF — Microsoft Word (.docx / .doc), ODT, RTF -->
            <intent-filter android:label="ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <action android:name="android.intent.action.EDIT" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
                <data android:mimeType="application/msword" />
                <data android:mimeType="application/vnd.ms-word" />
                <data android:mimeType="application/vnd.oasis.opendocument.text" />
                <data android:mimeType="application/rtf" />
                <data android:mimeType="text/rtf" />
            </intent-filter>

            <!-- 3. Open With ElimikaPDF — eBooks (.epub / .kpf / .mobi / .fb2), HTML, Text & Images -->
            <intent-filter android:label="ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="application/x-mobipocket-ebook" />
                <data android:mimeType="application/vnd.amazon.ebook" />
                <data android:mimeType="application/x-fictionbook+xml" />
                <data android:mimeType="text/html" />
                <data android:mimeType="application/xhtml+xml" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="text/markdown" />
                <data android:mimeType="image/jpeg" />
                <data android:mimeType="image/png" />
                <data android:mimeType="image/webp" />
            </intent-filter>

            <!-- 4. Open With ElimikaPDF — Generic application/octet-stream (WhatsApp, Telegram, Downloads & third-party File Managers) -->
            <intent-filter android:label="ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/octet-stream" />
            </intent-filter>

            <!-- 5. Open With ElimikaPDF — Wildcard MIME + File Extension matching (pathSuffix + pathPattern for file:// and content://) -->
            <intent-filter android:label="ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
                <data android:pathSuffix=".pdf" />
                <data android:pathSuffix=".PDF" />
                <data android:pathSuffix=".docx" />
                <data android:pathSuffix=".DOCX" />
                <data android:pathSuffix=".doc" />
                <data android:pathSuffix=".DOC" />
                <data android:pathSuffix=".odt" />
                <data android:pathSuffix=".rtf" />
                <data android:pathSuffix=".epub" />
                <data android:pathSuffix=".EPUB" />
                <data android:pathSuffix=".kpf" />
                <data android:pathSuffix=".KPF" />
                <data android:pathSuffix=".mobi" />
                <data android:pathSuffix=".azw3" />
                <data android:pathSuffix=".fb2" />
                <data android:pathSuffix=".html" />
                <data android:pathSuffix=".htm" />
                <data android:pathSuffix=".xhtml" />
                <data android:pathSuffix=".txt" />
                <data android:pathSuffix=".md" />
                <data android:pathPattern=".*\\.pdf" />
                <data android:pathPattern=".*\\..*\\.pdf" />
                <data android:pathPattern=".*\\..*\\..*\\.pdf" />
                <data android:pathPattern=".*\\.PDF" />
                <data android:pathPattern=".*\\.docx" />
                <data android:pathPattern=".*\\..*\\.docx" />
                <data android:pathPattern=".*\\..*\\..*\\.docx" />
                <data android:pathPattern=".*\\.DOCX" />
                <data android:pathPattern=".*\\.doc" />
                <data android:pathPattern=".*\\.DOC" />
                <data android:pathPattern=".*\\.epub" />
                <data android:pathPattern=".*\\.kpf" />
                <data android:pathPattern=".*\\.html" />
                <data android:pathPattern=".*\\.txt" />
            </intent-filter>

            <!-- 6. Open With ElimikaPDF — Direct file:// path matching without MIME type (legacy Android file managers) -->
            <intent-filter android:label="ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:pathSuffix=".pdf" />
                <data android:pathSuffix=".PDF" />
                <data android:pathSuffix=".docx" />
                <data android:pathSuffix=".DOCX" />
                <data android:pathSuffix=".doc" />
                <data android:pathSuffix=".DOC" />
                <data android:pathSuffix=".epub" />
                <data android:pathSuffix=".kpf" />
                <data android:pathPattern=".*\\.pdf" />
                <data android:pathPattern=".*\\.PDF" />
                <data android:pathPattern=".*\\.docx" />
                <data android:pathPattern=".*\\.DOCX" />
                <data android:pathPattern=".*\\.doc" />
                <data android:pathPattern=".*\\.epub" />
                <data android:pathPattern=".*\\.kpf" />
            </intent-filter>

            <!-- 7. Share to ElimikaPDF (ACTION_SEND & ACTION_SEND_MULTIPLE from WhatsApp, Gmail, Drive, Files, Gallery) -->
            <intent-filter android:label="ElimikaPDF">
                <action android:name="android.intent.action.SEND" />
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/x-pdf" />
                <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
                <data android:mimeType="application/msword" />
                <data android:mimeType="application/vnd.oasis.opendocument.text" />
                <data android:mimeType="application/rtf" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="text/html" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="image/*" />
                <data android:mimeType="application/octet-stream" />
            </intent-filter>
            <!-- ELIMIKAPDF_OPEN_WITH_END -->`;

function patchAndroidManifest() {
  let xml = fs.readFileSync(MANIFEST_PATH, 'utf8');

  // 1. Ensure MainActivity uses singleTask launchMode so warm-start "Open with" invokes onNewIntent()
  if (!/android:launchMode=/.test(xml)) {
    xml = xml.replace(
      /(<activity[\s\S]*?android:name="[^"]*MainActivity")/,
      '$1\n            android:launchMode="singleTask"'
    );
  } else {
    xml = xml.replace(
      /android:launchMode="[^"]*"/,
      'android:launchMode="singleTask"'
    );
  }

  // Ensure android:name=".MainActivity"
  xml = xml.replace(
    /android:name="[^"]*MainActivity"/,
    'android:name=".MainActivity"'
  );

  // 2. Inject or update ElimikaPDF Open With intent filters inside MainActivity
  const intentMarkerRegex =
    /[ \t]*<!-- ELIMIKAPDF_OPEN_WITH_START -->[\s\S]*?<!-- ELIMIKAPDF_OPEN_WITH_END -->/;
  if (intentMarkerRegex.test(xml)) {
    xml = xml.replace(intentMarkerRegex, INTENT_FILTERS_BLOCK);
  } else {
    const mainActivityCloseIdx = xml.indexOf('</activity>');
    if (mainActivityCloseIdx === -1) {
      throw new Error(
        'Could not locate closing </activity> tag in AndroidManifest.xml'
      );
    }
    xml =
      xml.slice(0, mainActivityCloseIdx) +
      '\n' +
      INTENT_FILTERS_BLOCK +
      '\n        ' +
      xml.slice(mainActivityCloseIdx);
  }

  // 3. Remove any previous AdMob meta-data block so release has no ad declarations
  xml = xml.replace(
    /\n?[ \t]*<!-- ELIMIKAPDF_ADMOB_META_START -->[\s\S]*?<!-- ELIMIKAPDF_ADMOB_META_END -->\n?/g,
    '\n'
  );

  // 4. Inject or update permissions before </manifest>
  const permMarkerRegex =
    /[ \t]*<!-- ELIMIKAPDF_PERMISSIONS_START -->[\s\S]*?<!-- ELIMIKAPDF_PERMISSIONS_END -->/;
  if (permMarkerRegex.test(xml)) {
    xml = xml.replace(permMarkerRegex, PERMISSIONS_BLOCK);
  } else {
    const manifestCloseIdx = xml.lastIndexOf('</manifest>');
    if (manifestCloseIdx === -1) {
      throw new Error('Could not locate </manifest> tag in AndroidManifest.xml');
    }
    xml =
      xml.slice(0, manifestCloseIdx) +
      '\n' +
      PERMISSIONS_BLOCK +
      '\n' +
      xml.slice(manifestCloseIdx);
  }

  fs.writeFileSync(MANIFEST_PATH, xml, 'utf8');
  console.log(
    '[ElimikaPDF Android] Patched AndroidManifest.xml with 7 Open With & Share intent filters.'
  );
}

function patchBuildGradle() {
  if (!fs.existsSync(BUILD_GRADLE_PATH)) return;
  let gradle = fs.readFileSync(BUILD_GRADLE_PATH, 'utf8');

  // Unify both namespace and applicationId to com.elimikapdf.www.twa and versionCode >= 3
  gradle = gradle.replace(
    /namespace\s*=\s*"[^"]+"/,
    `namespace = "${TARGET_PACKAGE}"`
  );
  gradle = gradle.replace(
    /applicationId\s+"[^"]+"/,
    `applicationId "${TARGET_PACKAGE}"`
  );
  gradle = gradle.replace(/versionCode\s+[12]\b/, 'versionCode 3');
  gradle = gradle.replace(/versionName\s+"1\.0(\.1)?"/, 'versionName "1.0.2"');

  // Remove any previous AdMob dependency
  gradle = gradle.replace(
    /\n?[ \t]*\/\/ ELIMIKAPDF_ADMOB_DEPENDENCY[\s\S]*?play-services-ads:[^"']*["']\n?/g,
    '\n'
  );

  // Add optional keystore.properties release signing config
  const signingBlock = `    // ELIMIKAPDF_RELEASE_SIGNING_START
    def keystorePropertiesFile = rootProject.file("keystore.properties")
    def keystoreProperties = new Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
    }

    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (keystorePropertiesFile.exists()) {
                signingConfig signingConfigs.release
            }
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    // ELIMIKAPDF_RELEASE_SIGNING_END`;

  const markerRegex =
    /[ \t]*\/\/ ELIMIKAPDF_RELEASE_SIGNING_START[\s\S]*?\/\/ ELIMIKAPDF_RELEASE_SIGNING_END/;
  if (markerRegex.test(gradle)) {
    gradle = gradle.replace(markerRegex, signingBlock);
  } else {
    gradle = gradle.replace(
      /[ \t]*buildTypes\s*\{[\s\S]*?proguard-rules\.pro'[\s\S]*?\}\s*\}/,
      signingBlock
    );
  }

  fs.writeFileSync(BUILD_GRADLE_PATH, gradle, 'utf8');
  console.log(
    `[ElimikaPDF Android] Synced namespace & applicationId to ${TARGET_PACKAGE} (versionCode 3) in android/app/build.gradle.`
  );
}

function patchStringsXml() {
  if (!fs.existsSync(STRINGS_XML_PATH)) return;
  let stringsXml = fs.readFileSync(STRINGS_XML_PATH, 'utf8');

  // Remove any previous AdMob string entries
  stringsXml = stringsXml.replace(
    /\n?[ \t]*<!-- ELIMIKAPDF_ADMOB_STRINGS_START -->[\s\S]*?<!-- ELIMIKAPDF_ADMOB_STRINGS_END -->\n?/g,
    '\n'
  );

  // Ensure package_name and custom_url_scheme match TARGET_PACKAGE
  stringsXml = stringsXml.replace(
    /<string name="package_name">[^<]*<\/string>/,
    `<string name="package_name">${TARGET_PACKAGE}</string>`
  );
  stringsXml = stringsXml.replace(
    /<string name="custom_url_scheme">[^<]*<\/string>/,
    `<string name="custom_url_scheme">${TARGET_PACKAGE}</string>`
  );

  fs.writeFileSync(STRINGS_XML_PATH, stringsXml, 'utf8');
}

function patchProguardRules() {
  if (!fs.existsSync(PROGUARD_PATH)) return;
  let rules = fs.readFileSync(PROGUARD_PATH, 'utf8');

  const keepBlock = `# ELIMIKAPDF_PROGUARD_START
-keep class com.elimikapdf.www.twa.** { *; }
-keep class app.elimikapdf.studio.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @android.webkit.JavascriptInterface <methods>;
}
# ELIMIKAPDF_PROGUARD_END`;

  const markerRegex =
    /# ELIMIKAPDF_PROGUARD_START[\s\S]*?# ELIMIKAPDF_PROGUARD_END/;
  if (markerRegex.test(rules)) {
    rules = rules.replace(markerRegex, keepBlock);
  } else {
    rules = `${rules.trimEnd()}\n\n${keepBlock}\n`;
  }

  fs.writeFileSync(PROGUARD_PATH, rules, 'utf8');
}

const OPEN_WITH_PLUGIN_JAVA = `package ${TARGET_PACKAGE};

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native Capacitor Plugin registered before WebView boot so cold-start and warm-start
 * Android "Open with ElimikaPDF" / "Share to ElimikaPDF" files are always delivered reliably.
 */
@CapacitorPlugin(name = "ElimikaOpenWith")
public class ElimikaOpenWithPlugin extends Plugin {

    @PluginMethod
    public void consumePendingFile(PluginCall call) {
        JSObject result = new JSObject();
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            MainActivity.PendingDocument doc = activity.consumePendingDocument();
            if (doc != null) {
                result.put("hasFile", doc.base64 != null && !doc.base64.isEmpty());
                if (doc.base64 != null && !doc.base64.isEmpty()) {
                    result.put("base64", doc.base64);
                    result.put("filename", doc.filename);
                    result.put("mimeType", doc.mimeType);
                }
                if (doc.error != null && !doc.error.isEmpty()) {
                    result.put("error", doc.error);
                }
                call.resolve(result);
                return;
            }
        }
        result.put("hasFile", false);
        call.resolve(result);
    }
}
`;

const MAIN_ACTIVITY_JAVA = `package ${TARGET_PACKAGE};

import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ElimikaPDF Capacitor MainActivity with native offline Android "Open with" (ACTION_VIEW),
 * "Edit" (ACTION_EDIT), and "Share to" (ACTION_SEND / ACTION_SEND_MULTIPLE) support.
 *
 * Exposes incoming files through BOTH:
 *   1. Official Capacitor Plugin "ElimikaOpenWith"
 *   2. Direct WebView @JavascriptInterface "window.ElimikaAndroidBridge"
 */
public class MainActivity extends BridgeActivity {

    public static final class PendingDocument {
        public final String base64;
        public final String filename;
        public final String mimeType;
        public final String error;

        public PendingDocument(String base64, String filename, String mimeType, String error) {
            this.base64 = base64;
            this.filename = filename;
            this.mimeType = mimeType;
            this.error = error;
        }
    }

    private static final int MAX_DOCUMENT_BYTES = 45 * 1024 * 1024; // 45 MB safety cap

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Object pendingLock = new Object();

    private String pendingBase64 = null;
    private String pendingFilename = "Android_Document.pdf";
    private String pendingMimeType = "application/octet-stream";
    private String pendingError = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 1. Register our native Capacitor plugin BEFORE super.onCreate() so it is bound prior to WebView load
        registerPlugin(ElimikaOpenWithPlugin.class);
        // 2. BridgeActivity.onCreate() calls load() which automatically invokes onNewIntent(getIntent())
        super.onCreate(savedInstanceState);

        // 3. Also attach direct WebView @JavascriptInterface fallback ("window.ElimikaAndroidBridge")
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(
                new ElimikaAndroidBridge(),
                "ElimikaAndroidBridge"
            );
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null) {
            setIntent(intent);
            handleIncomingDocumentIntent(intent);
        }
    }

    @Override
    public void onDestroy() {
        ioExecutor.shutdownNow();
        super.onDestroy();
    }

    public PendingDocument consumePendingDocument() {
        synchronized (pendingLock) {
            if ((pendingBase64 == null || pendingBase64.isEmpty())
                && (pendingError == null || pendingError.isEmpty())) {
                return null;
            }
            PendingDocument doc = new PendingDocument(
                pendingBase64,
                pendingFilename,
                pendingMimeType,
                pendingError
            );
            pendingBase64 = null;
            pendingError = null;
            return doc;
        }
    }

    private void handleIncomingDocumentIntent(Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        Uri fileUri = null;
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            fileUri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                fileUri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                @SuppressWarnings("deprecation")
                Uri legacyUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                fileUri = legacyUri;
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                @SuppressWarnings("deprecation")
                ArrayList<Uri> legacyUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                uris = legacyUris;
            }
            if (uris != null && !uris.isEmpty()) {
                fileUri = uris.get(0);
            }
        }

        // Fallback to ClipData (used by several Android file managers and WhatsApp/Gmail attachments)
        if (fileUri == null) {
            ClipData clipData = intent.getClipData();
            if (clipData != null && clipData.getItemCount() > 0) {
                fileUri = clipData.getItemAt(0).getUri();
            }
        }

        if (fileUri == null) return;

        // Clear action so configuration changes / activity recreation do not re-import the same intent
        intent.setAction(null);

        final Uri targetUri = fileUri;
        final String intentMime = intent.getType();

        // Read ContentResolver stream off the main thread to keep UI fluid
        ioExecutor.execute(() -> readUriIntoBridge(targetUri, intentMime));
    }

    private void readUriIntoBridge(Uri uri, String intentMime) {
        try {
            String resolvedMime = getContentResolver().getType(uri);
            if (resolvedMime == null || resolvedMime.trim().isEmpty()) {
                resolvedMime = (intentMime != null && !intentMime.trim().isEmpty())
                    ? intentMime
                    : "application/octet-stream";
            }

            String filename = resolveDisplayName(uri, resolvedMime);

            byte[] bytes;
            try (InputStream is = getContentResolver().openInputStream(uri)) {
                if (is == null) {
                    setPendingError("ElimikaPDF could not access the selected file.");
                    notifyWebView();
                    return;
                }
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[16384];
                int total = 0;
                int read;
                while ((read = is.read(chunk)) != -1) {
                    total += read;
                    if (total > MAX_DOCUMENT_BYTES) {
                        setPendingError("File is larger than 45 MB. Please import it directly inside ElimikaPDF.");
                        notifyWebView();
                        return;
                    }
                    buffer.write(chunk, 0, read);
                }
                bytes = buffer.toByteArray();
            }

            if (bytes.length == 0) {
                setPendingError("Cannot open \\"" + filename + "\\": the file is empty.");
                notifyWebView();
                return;
            }

            String encoded = Base64.encodeToString(bytes, Base64.NO_WRAP);
            synchronized (pendingLock) {
                pendingBase64 = encoded;
                pendingFilename = filename;
                pendingMimeType = resolvedMime;
                pendingError = null;
            }

            notifyWebView();
        } catch (SecurityException se) {
            setPendingError("Permission denied while opening file from Android.");
            notifyWebView();
        } catch (Throwable t) {
            setPendingError("Could not read the selected file from Android.");
            notifyWebView();
        }
    }

    private void setPendingError(String message) {
        synchronized (pendingLock) {
            pendingError = message;
        }
    }

    private void notifyWebView() {
        runOnUiThread(() -> {
            if (this.bridge == null) return;
            WebView webView = this.bridge.getWebView();
            if (webView == null) return;
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('elimikapdf:android-open-pdf'));",
                null
            );
        });
    }

    private String resolveDisplayName(Uri uri, String mimeType) {
        String name = null;

        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(
                uri,
                new String[]{ OpenableColumns.DISPLAY_NAME },
                null,
                null,
                null
            )) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) {
                        name = cursor.getString(idx);
                    }
                }
            } catch (Exception ignored) {
                // Fall back to URI last path segment
            }
        }

        if (name == null || name.trim().isEmpty()) {
            String segment = uri.getLastPathSegment();
            if (segment != null && !segment.trim().isEmpty()) {
                int slash = segment.lastIndexOf('/');
                name = slash >= 0 ? segment.substring(slash + 1) : segment;
                int colon = name.lastIndexOf(':');
                if (colon >= 0 && colon < name.length() - 1) {
                    name = name.substring(colon + 1);
                }
            }
        }

        if (name == null || name.trim().isEmpty()) {
            name = "Android_Document";
        }

        // Sanitize illegal filename characters
        name = name.replaceAll("[\\\\\\\\/:*?\\"<>|]+", "_").trim();

        // Append inferred extension if missing
        if (!name.contains(".")) {
            String ext = null;
            if (mimeType != null && !mimeType.equals("*/*") && !mimeType.equals("application/octet-stream")) {
                ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            }
            if (ext == null || ext.isEmpty()) {
                ext = "pdf";
            }
            name = name + "." + ext;
        }

        return name;
    }

    private final class ElimikaAndroidBridge {
        @JavascriptInterface
        public boolean hasPendingPdf() {
            synchronized (pendingLock) {
                return pendingBase64 != null && !pendingBase64.isEmpty();
            }
        }

        @JavascriptInterface
        public String getPendingPdfFilename() {
            synchronized (pendingLock) {
                return pendingFilename != null ? pendingFilename : "Android_Document.pdf";
            }
        }

        @JavascriptInterface
        public String getPendingPdfMimeType() {
            synchronized (pendingLock) {
                return pendingMimeType != null ? pendingMimeType : "application/octet-stream";
            }
        }

        @JavascriptInterface
        public String consumePendingPdfBase64() {
            synchronized (pendingLock) {
                String data = pendingBase64;
                pendingBase64 = null;
                return data != null ? data : "";
            }
        }

        @JavascriptInterface
        public String consumePendingError() {
            synchronized (pendingLock) {
                String err = pendingError;
                pendingError = null;
                return err != null ? err : "";
            }
        }
    }
}
`;

function writeNativeJavaClasses() {
  // Remove old app/elimikapdf/studio package directory if present so there are no duplicate MainActivity classes
  if (fs.existsSync(LEGACY_JAVA_APP_DIR)) {
    fs.rmSync(LEGACY_JAVA_APP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(JAVA_PACKAGE_DIR, { recursive: true });
  fs.writeFileSync(OPEN_WITH_PLUGIN_PATH, OPEN_WITH_PLUGIN_JAVA, 'utf8');
  fs.writeFileSync(MAIN_ACTIVITY_PATH, MAIN_ACTIVITY_JAVA, 'utf8');
  console.log(
    `[ElimikaPDF Android] Wrote ElimikaOpenWithPlugin.java & MainActivity.java in package ${TARGET_PACKAGE}.`
  );
}

function pruneAndroidChatAssets() {
  const keep = new Set([
    'WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg',
  ]);
  const dirs = [
    path.join(ROOT, 'dist', 'assets', 'aistudio'),
    path.join(
      ANDROID_DIR,
      'app',
      'src',
      'main',
      'assets',
      'public',
      'assets',
      'aistudio'
    ),
  ];
  let removedCount = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!keep.has(file)) {
        try {
          fs.rmSync(path.join(dir, file), { force: true, recursive: true });
          removedCount++;
        } catch {
          // Ignore removal errors
        }
      }
    }
  }
  if (removedCount > 0) {
    console.log(
      `[ElimikaPDF Android] Stripped ${removedCount} unused chat screenshot files.`
    );
  }
}

patchAndroidManifest();
patchBuildGradle();
patchStringsXml();
patchProguardRules();
writeNativeJavaClasses();
pruneAndroidChatAssets();
