package com.elimikapdf.www.twa;

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
                setPendingError("Cannot open \"" + filename + "\": the file is empty.");
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
        name = name.replaceAll("[\\\\/:*?\"<>|]+", "_").trim();

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
