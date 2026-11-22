package app.elimikapdf.studio;

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
