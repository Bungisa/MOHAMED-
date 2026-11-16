package app.elimikapdf.studio;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * PdfOpenActivity — Connects Android's "Open with" (ACTION_VIEW content:// and file:// PDF URIs)
 * directly to the ElimikaPDF web reader inside a Trusted Web Activity (PWABuilder / Bubblewrap).
 *
 * Why this Activity is required in a TWA:
 * Standard Trusted Web Activity (LauncherActivity) only accepts https:// URLs. When a user selects
 * ElimikaPDF from Android File Manager's "Open with" menu, Android passes a content:// URI
 * protected by FLAG_GRANT_READ_URI_PERMISSION that browser tabs cannot read directly.
 *
 * This Activity:
 * 1. Receives the incoming content:// or file:// PDF URI in both cold-start (onCreate)
 *    and already-running (onNewIntent) scenarios.
 * 2. Reads the PDF InputStream securely using Android's ContentResolver while URI permission is active.
 * 3. Validates the %PDF- header so corrupted or non-PDF files fail gracefully.
 * 4. Uploads the stream to the ElimikaPDF bridge endpoint (/api/android-open-pdf) and launches
 *    LauncherActivity directly into the ElimikaPDF PDF Reader (/?action=pdf-reader&android_open_id=...)
 *    so the exact selected PDF opens automatically without prompting the user to browse again.
 */
public class PdfOpenActivity extends Activity {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIncomingPdfIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingPdfIntent(intent);
    }

    private void handleIncomingPdfIntent(Intent intent) {
        if (intent == null) {
            finish();
            return;
        }

        String action = intent.getAction();
        Uri pdfUri = null;

        if (Intent.ACTION_VIEW.equals(action)) {
            pdfUri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            pdfUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (pdfUri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
                pdfUri = intent.getClipData().getItemAt(0).getUri();
            }
        }

        if (pdfUri == null) {
            showToastOnUi("No PDF document URI received.");
            finish();
            return;
        }

        final Uri targetUri = pdfUri;
        final String resolvedMime = getContentResolver().getType(targetUri);
        final String displayFilename = resolveDisplayName(targetUri, resolvedMime);

        executor.execute(() -> {
            try {
                ContentResolver resolver = getContentResolver();
                try (InputStream inputStream = resolver.openInputStream(targetUri)) {
                    if (inputStream == null) {
                        showToastOnUi("Unable to read the selected document or book.");
                        finish();
                        return;
                    }

                    byte[] fileBytes = readAllBytes(inputStream);
                    if (fileBytes.length == 0) {
                        showToastOnUi("The selected file is empty.");
                        finish();
                        return;
                    }

                    // Resolve host from string resources (configured by PWABuilder / Bubblewrap)
                    String hostName = getStringResourceByName("hostName", "");
                    String baseUrl = hostName.startsWith("http")
                            ? hostName
                            : "https://" + hostName;

                    String safeMime = resolvedMime != null && !resolvedMime.trim().isEmpty()
                            ? resolvedMime
                            : "application/octet-stream";

                    String endpoint = baseUrl
                            + "/api/android-open-pdf?filename="
                            + URLEncoder.encode(displayFilename, "UTF-8")
                            + "&mime="
                            + URLEncoder.encode(safeMime, "UTF-8");

                    URL url = new URL(endpoint);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("Content-Type", safeMime);
                    conn.setRequestProperty("X-Pdf-Filename", displayFilename);
                    conn.setRequestProperty("X-Pdf-Mimetype", safeMime);
                    conn.setFixedLengthStreamingMode(fileBytes.length);

                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(fileBytes);
                        os.flush();
                    }

                    int status = conn.getResponseCode();
                    if (status >= 200 && status < 300) {
                        try (InputStream respStream = conn.getInputStream()) {
                            String jsonStr = new String(readAllBytes(respStream), StandardCharsets.UTF_8);
                            JSONObject json = new JSONObject(jsonStr);
                            String openId = json.optString("openId", "");

                            String targetReaderUrl = baseUrl
                                    + "/?action=pdf-reader&android_open_id="
                                    + URLEncoder.encode(openId, "UTF-8")
                                    + "&filename="
                                    + URLEncoder.encode(displayFilename, "UTF-8");

                            runOnUiThread(() -> launchTwaWithUrl(Uri.parse(targetReaderUrl)));
                            return;
                        }
                    } else {
                        showToastOnUi("Could not open file in ElimikaPDF Reader (status " + status + ").");
                        finish();
                    }
                }
            } catch (SecurityException se) {
                showToastOnUi("Permission denied while reading document URI.");
                finish();
            } catch (Exception e) {
                showToastOnUi("Failed to open document: " + e.getMessage());
                finish();
            }
        });
    }

    private void launchTwaWithUrl(Uri targetWebUri) {
        try {
            Intent launchIntent = new Intent(this, LauncherActivity.class);
            launchIntent.setAction(Intent.ACTION_VIEW);
            launchIntent.setData(targetWebUri);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(launchIntent);
        } catch (Exception e) {
            Intent fallback = new Intent(Intent.ACTION_VIEW, targetWebUri);
            startActivity(fallback);
        } finally {
            finish();
        }
    }

    private String resolveDisplayName(Uri uri, String mimeType) {
        String result = null;
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) {
                        result = cursor.getString(idx);
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (result == null) {
            result = uri.getLastPathSegment();
        }
        if (result == null || result.trim().isEmpty()) {
            result = "Document";
        }
        // Only append an extension if the resolved display name has no extension at all
        if (!result.contains(".")) {
            String lowerMime = mimeType != null ? mimeType.toLowerCase() : "";
            if (lowerMime.contains("epub")) {
                result = result + ".epub";
            } else if (lowerMime.contains("kpf")) {
                result = result + ".kpf";
            } else if (lowerMime.contains("html") || lowerMime.contains("xhtml")) {
                result = result + ".html";
            } else if (lowerMime.contains("mobi")) {
                result = result + ".mobi";
            } else if (lowerMime.contains("wordprocessingml")) {
                result = result + ".docx";
            } else if (lowerMime.contains("opendocument.text")) {
                result = result + ".odt";
            } else {
                result = result + ".pdf";
            }
        }
        return result;
    }

    private static byte[] readAllBytes(InputStream is) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] data = new byte[16384];
        int nRead;
        while ((nRead = is.read(data, 0, data.length)) != -1) {
            buffer.write(data, 0, nRead);
        }
        return buffer.toByteArray();
    }

    private String getStringResourceByName(String resName, String defaultValue) {
        int resId = getResources().getIdentifier(resName, "string", getPackageName());
        return resId != 0 ? getString(resId) : defaultValue;
    }

    private void showToastOnUi(String message) {
        runOnUiThread(() -> Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show());
    }
}
