#!/usr/bin/env node
/**
 * Configures the Capacitor Android project (`android/`) so ElimikaPDF appears in
 * Android's system "Open with" chooser (ACTION_VIEW) and "Share to" sheet (ACTION_SEND)
 * for PDF, Word (.docx/.doc), eBooks (.epub/.kpf/.mobi/.fb2), HTML, Text, and Images.
 *
 * Safe & idempotent: can be re-run on every `npm run cap:sync`.
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
const JAVA_PACKAGE_DIR = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'java',
  'app',
  'elimikapdf',
  'studio'
);
const MAIN_ACTIVITY_PATH = path.join(JAVA_PACKAGE_DIR, 'MainActivity.java');
const PLUGIN_PATH = path.join(JAVA_PACKAGE_DIR, 'ElimikaOpenWithPlugin.java');

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
            <!-- 1. Open With ElimikaPDF (ACTION_VIEW by MIME type for PDF, Word, eBooks, HTML, Text & Images) -->
            <intent-filter android:label="Open with ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/x-pdf" />
                <data android:mimeType="application/acrobat" />
                <data android:mimeType="application/vnd.pdf" />
                <data android:mimeType="text/pdf" />
                <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
                <data android:mimeType="application/msword" />
                <data android:mimeType="application/vnd.oasis.opendocument.text" />
                <data android:mimeType="application/rtf" />
                <data android:mimeType="text/rtf" />
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

            <!-- 2. Open With ElimikaPDF fallback by file extension (handles file managers sending application/octet-stream or */*) -->
            <intent-filter android:label="Open with ElimikaPDF">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
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
                <data android:pathPattern=".*\\.odt" />
                <data android:pathPattern=".*\\.rtf" />
                <data android:pathPattern=".*\\.epub" />
                <data android:pathPattern=".*\\.EPUB" />
                <data android:pathPattern=".*\\.kpf" />
                <data android:pathPattern=".*\\.KPF" />
                <data android:pathPattern=".*\\.mobi" />
                <data android:pathPattern=".*\\.azw3" />
                <data android:pathPattern=".*\\.fb2" />
                <data android:pathPattern=".*\\.html" />
                <data android:pathPattern=".*\\.htm" />
                <data android:pathPattern=".*\\.xhtml" />
                <data android:pathPattern=".*\\.txt" />
                <data android:pathPattern=".*\\.md" />
            </intent-filter>

            <!-- 3. Share to ElimikaPDF (ACTION_SEND from WhatsApp, Gmail, Drive, Downloads, Gallery) -->
            <intent-filter android:label="Open in ElimikaPDF">
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
                <data android:mimeType="application/msword" />
                <data android:mimeType="application/vnd.oasis.opendocument.text" />
                <data android:mimeType="application/rtf" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="text/html" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="image/jpeg" />
                <data android:mimeType="image/png" />
                <data android:mimeType="image/webp" />
                <data android:mimeType="application/octet-stream" />
            </intent-filter>
            <!-- ELIMIKAPDF_OPEN_WITH_END -->`;

function patchAndroidManifest() {
  let xml = fs.readFileSync(MANIFEST_PATH, 'utf8');

  // 1. Ensure MainActivity uses singleTask launchMode so warm-start "Open with" invokes onNewIntent()
  if (!/android:launchMode=/.test(xml)) {
    xml = xml.replace(
      /(<activity[\s\S]*?android:name="\.MainActivity")/,
      '$1\n            android:launchMode="singleTask"'
    );
  } else {
    xml = xml.replace(
      /android:launchMode="[^"]*"/,
      'android:launchMode="singleTask"'
    );
  }

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

  // 3. Inject or update permissions before </manifest>
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
  console.log('[ElimikaPDF Android] Patched AndroidManifest.xml with Open With & Share intent filters.');
}

const PLUGIN_JAVA = `package app.elimikapdf.studio;

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

const MAIN_ACTIVITY_JAVA = `package app.elimikapdf.studio;

import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ElimikaPDF Capacitor MainActivity with native offline Android "Open with" (ACTION_VIEW)
 * and "Share to" (ACTION_SEND) support.
 *
 * Reads content:// and file:// URIs directly through Android's ContentResolver off the main
 * thread and exposes them via the native Capacitor plugin "ElimikaOpenWith" (registered before
 * WebView boot so both cold-start and warm-start intents work with zero race conditions).
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
        // Register our native Capacitor plugin BEFORE super.onCreate() so it is bound prior to WebView load
        registerPlugin(ElimikaOpenWithPlugin.class);
        // BridgeActivity.onCreate() calls load() which automatically invokes onNewIntent(getIntent())
        super.onCreate(savedInstanceState);
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
        if (Intent.ACTION_VIEW.equals(action)) {
            fileUri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                fileUri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                @SuppressWarnings("deprecation")
                Uri legacyUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                fileUri = legacyUri;
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
}
`;

function writeNativeJavaClasses() {
  fs.mkdirSync(JAVA_PACKAGE_DIR, { recursive: true });
  fs.writeFileSync(PLUGIN_PATH, PLUGIN_JAVA, 'utf8');
  fs.writeFileSync(MAIN_ACTIVITY_PATH, MAIN_ACTIVITY_JAVA, 'utf8');
  console.log(
    '[ElimikaPDF Android] Wrote ElimikaOpenWithPlugin.java & MainActivity.java (offline ContentResolver bridge).'
  );
}

patchAndroidManifest();
writeNativeJavaClasses();
