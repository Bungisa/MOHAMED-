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
        final String displayFilename = resolveDisplayName(targetUri);

        executor.execute(() -> {
            try {
                ContentResolver resolver = getContentResolver();
                try (InputStream inputStream = resolver.openInputStream(targetUri)) {
                    if (inputStream == null) {
                        showToastOnUi("Unable to read the selected PDF file.");
                        finish();
                        return;
                    }

                    // Read and verify %PDF- signature first
                    byte[] pdfBytes = readAllBytes(inputStream);
                    if (pdfBytes.length < 5
                            || pdfBytes[0] != '%'
                            || pdfBytes[1] != 'P'
                            || pdfBytes[2] != 'D'
                            || pdfBytes[3] != 'F'
                            || pdfBytes[4] != '-') {
                        showToastOnUi("Unsupported or corrupted PDF file.");
                        finish();
                        return;
                    }

                    // Resolve host from string resources (configured by PWABuilder / Bubblewrap)
                    String hostName = getStringResourceByName("hostName", "");
                    String baseUrl = hostName.startsWith("http")
                            ? hostName
                            : "https://" + hostName;

                    String endpoint = baseUrl
                            + "/api/android-open-pdf?filename="
                            + URLEncoder.encode(displayFilename, "UTF-8");

                    URL url = new URL(endpoint);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("Content-Type", "application/pdf");
                    conn.setRequestProperty("X-Pdf-Filename", displayFilename);
                    conn.setFixedLengthStreamingMode(pdfBytes.length);

                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(pdfBytes);
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
                        showToastOnUi("Could not open PDF in ElimikaPDF (status " + status + ").");
                        finish();
                    }
                }
            } catch (SecurityException se) {
                showToastOnUi("Permission denied while reading PDF URI.");
                finish();
            } catch (Exception e) {
                showToastOnUi("Failed to open PDF: " + e.getMessage());
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

    private String resolveDisplayName(Uri uri) {
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
            result = "Document.pdf";
        }
        if (!result.toLowerCase().endsWith(".pdf")) {
            result = result + ".pdf";
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
