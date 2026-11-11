import React, { useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  Trash2,
  RefreshCw,
  Database,
  Camera,
  FileEdit,
  ScanText,
  Layers,
  CheckCircle2,
  Copy,
  Check,
  Download,
  Terminal,
  HardDrive,
} from 'lucide-react';
import { AppPreferences, ScanFilterType, ThemeMode } from '../types/document';
import {
  formatBytes,
  MAX_VAULT_QUOTA_BYTES,
  getDeviceStorageEstimate,
  requestPersistentStorage,
} from '../services/storageService';
import { PWAInstallButton } from './PWAInstallPrompt';

interface SettingsViewProps {
  preferences: AppPreferences;
  onUpdatePreferences: (prefs: AppPreferences) => void;
  totalStorageBytes: number;
  documentCount: number;
  onClearAllStorage: () => Promise<void>;
  onResetSampleDocuments: () => Promise<void>;
  onOpenPrivacyPolicy?: () => void;
}

const PRIVACY_POLICY_STATIC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — ElimikaPDF</title>
  <meta name="description" content="Official Privacy Policy for ElimikaPDF (PDF Reader, Document Scanner, PDF Editor & OCR Studio)." />
  <style>
    :root { --bg: #FAF9FB; --card: #FFFFFF; --text: #14101B; --muted: #6E667D; --border: #E4DFEC; --accent: #4A1D5E; --green: #15803D; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: var(--bg); color: var(--text); line-height: 1.65; padding: 24px 16px 64px; }
    .container { max-width: 820px; margin: 0 auto; background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px 28px; }
    h1 { font-size: 1.6rem; margin: 0; color: var(--accent); }
    h2 { font-size: 1.15rem; color: var(--accent); margin-top: 28px; margin-bottom: 8px; }
    .meta { font-size: 0.85rem; color: var(--muted); margin-top: 4px; margin-bottom: 20px; }
    .highlight-box { background: #F4F1F8; border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; margin: 20px 0; }
    footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--muted); }
  </style>
</head>
<body>
  <div class="container">
    <h1>ElimikaPDF — Privacy Policy</h1>
    <div class="meta">Effective Date: November 10, 2026 &middot; Last Updated: November 10, 2026</div>
    <div class="highlight-box">
      <strong>Summary of Our Privacy Commitment:</strong>
      <p style="margin: 6px 0 0;"><strong>ElimikaPDF</strong> is a local-first PDF Reader, Document Scanner, PDF Editor, Word Converter, and Optical Character Recognition (OCR) application. Your documents, camera scans, PDF annotations, and extracted text are processed and stored <strong>locally on your device</strong>. We do not sell, rent, collect, or transmit your personal documents to any external tracking or advertising servers.</p>
    </div>
    <h2>1. Information We Collect and Process</h2>
    <p>ElimikaPDF is designed to operate without requiring user registration or personal accounts. We do not collect personally identifiable information (PII) such as your name, phone number, physical address, or payment information.</p>
    <ul>
      <li><strong>Documents &amp; Files:</strong> Any PDF files, Word documents (<code>.docx</code>), or images you open, edit, merge, split, compress, or convert are processed locally inside your device's memory and stored in your device's local <code>IndexedDB</code> storage vault.</li>
      <li><strong>Optical Character Recognition (OCR):</strong> Text recognition (English and Kiswahili) runs locally on your device. Extracted text remains inside your local document vault unless you explicitly export or share it.</li>
    </ul>
    <h2>2. Device Permissions We Request</h2>
    <ul>
      <li><strong>Camera Permission (<code>android.permission.CAMERA</code>):</strong> Used strictly when you open the Document Scanner to photograph physical pages, receipts, notes, or contracts for perspective cropping and PDF creation. Camera frames are processed in real time on your device and are never uploaded or streamed to external servers.</li>
      <li><strong>File &amp; Media Access:</strong> Used only when you explicitly pick a PDF, Word file, or image from your device storage and when you save or download edited files back to your device.</li>
      <li><strong>Notifications (Optional):</strong> Used only if you enable local notifications for completed document tasks.</li>
    </ul>
    <h2>3. Data Storage, Retention, and Deletion</h2>
    <ul>
      <li><strong>On-Device Storage:</strong> All stored documents and user preferences are saved locally on your device using browser <code>IndexedDB</code> and <code>localStorage</code>.</li>
      <li><strong>Full User Control &amp; Instant Deletion:</strong> You can delete any individual document at any time or erase all locally stored data at once via <strong>Settings &rarr; Delete All Locally Stored Documents</strong> (or by clearing app data / uninstalling the app).</li>
    </ul>
    <h2>4. Third-Party Sharing &amp; Analytics</h2>
    <p>ElimikaPDF does not include third-party advertising SDKs, behavioral trackers, or data brokers. Your files are only shared with other applications when you explicitly tap Share or Send to Email.</p>
    <h2>5. Children's Privacy</h2>
    <p>ElimikaPDF is a general-audience productivity and educational document utility. We do not knowingly collect any personal information from children under the age of 13.</p>
    <h2>6. Contact Us</h2>
    <p><strong>App Name:</strong> ElimikaPDF<br /><strong>Email:</strong> <a href="mailto:mohamedshabani751@gmail.com">mohamedshabani751@gmail.com</a></p>
    <footer>&copy; 2026 ElimikaPDF. All rights reserved. Compliant with Google Play Store User Data &amp; Privacy Policy Requirements.</footer>
  </div>
</body>
</html>`;

export const SettingsView: React.FC<SettingsViewProps> = ({
  preferences,
  onUpdatePreferences,
  totalStorageBytes,
  documentCount,
  onClearAllStorage,
  onResetSampleDocuments,
  onOpenPrivacyPolicy,
}) => {
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [androidPackageId, setAndroidPackageId] = useState('app.elimikapdf.studio');
  const [sha256Fingerprint, setSha256Fingerprint] = useState(
    '96:17:08:76:99:76:3A:CF:57:2D:84:4B:F9:38:69:39:A7:22:8A:1D:AC:BC:46:66:40:44:E9:7C:DB:42:2F:6A'
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{
    quotaBytes: number;
    usageBytes: number;
    persisted: boolean;
  }>({
    quotaBytes: MAX_VAULT_QUOTA_BYTES,
    usageBytes: totalStorageBytes,
    persisted: false,
  });

  useEffect(() => {
    getDeviceStorageEstimate().then((est) => {
      setStorageEstimate(est);
    });
  }, [totalStorageBytes]);

  const assetLinksJson = JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: androidPackageId.trim() || 'app.elimikapdf.studio',
          sha256_cert_fingerprints: [
            sha256Fingerprint.trim(),
            '6A:03:83:9F:47:2B:08:CA:D2:11:60:29:25:E8:5E:0F:9A:BA:60:3D:2E:18:3C:9D:79:6B:F4:CB:E1:8D:91:DF',
          ],
        },
      },
    ],
    null,
    2
  );

  const bubblewrapCmd = `npx @bubblewrap/cli init --manifest=${
    typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'
  }/manifest.webmanifest && npx @bubblewrap/cli build`;

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const downloadAssetLinks = () => {
    const blob = new Blob([assetLinksJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'assetlinks.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPrivacyPolicyHtml = () => {
    const blob = new Blob([PRIVACY_POLICY_STATIC_HTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'privacy-policy.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const updatePref = <K extends keyof AppPreferences>(
    key: K,
    val: AppPreferences[K]
  ) => {
    const next = { ...preferences, [key]: val };
    onUpdatePreferences(next);
    setSavedNotice('Preferences updated in local storage.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const baseOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://ais-pre-xx6h7d5nqmuz77cm5nypac-142058246407.europe-west2.run.app';
  const universalPrivacyUrl = `${baseOrigin}/?view=privacy`;
  const staticPrivacyUrl = `${baseOrigin}/privacy-policy.html`;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6 space-y-2">
        <h1 className="text-xl font-bold tracking-tight">
          Application Settings, PWA & Google Play Store Center
        </h1>
        <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
          Customize appearance, default document scanner profiles, Google Play Store (TWA / PWABuilder) packaging, and local IndexedDB vault storage.
        </p>
        {savedNotice && (
          <p className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80] flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{savedNotice}</span>
          </p>
        )}
      </div>

      {/* Google Play Store (TWA / PWABuilder) & PWA Packaging Center */}
      <div className="bg-white dark:bg-[#16111F] border-2 border-[#4A1D5E]/25 dark:border-[#9D5CE5]/35 rounded-xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
                alt="ElimikaPDF Icon"
                className="w-10 h-10 rounded-xl object-cover shadow-xs shrink-0"
              />
              <div>
                <h2 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  ElimikaPDF — Google Play Store & PWA Packaging Center
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Ready for Android App Bundle (<code>.aab</code>) export via PWABuilder or Bubblewrap Trusted Web Activity (TWA)
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                if (!('Notification' in window)) {
                  setSavedNotice('Notifications are not supported in this browser.');
                  return;
                }
                const perm = await Notification.requestPermission();
                if (perm === 'granted') {
                  if ('serviceWorker' in navigator) {
                    const reg = await navigator.serviceWorker.getRegistration();
                    if (reg && 'showNotification' in reg) {
                      await reg.showNotification('ElimikaPDF Ready', {
                        body: 'Offline Service Worker, File Handlers & Share Target are active.',
                        icon: '/pwa-192x192.png',
                      });
                      setSavedNotice('Sent test notification via ElimikaPDF Service Worker.');
                      setTimeout(() => setSavedNotice(null), 3000);
                      return;
                    }
                  }
                  new Notification('ElimikaPDF Ready', {
                    body: 'Offline Service Worker, File Handlers & Share Target are active.',
                    icon: '/pwa-192x192.png',
                  });
                } else {
                  setSavedNotice('Notification permission was not granted.');
                  setTimeout(() => setSavedNotice(null), 3000);
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold cursor-pointer"
            >
              Test Notification
            </button>
            <PWAInstallButton variant="card" />
          </div>
        </div>

        {/* PWA Compliance & Advanced App Capabilities Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: 'Web App Manifest', detail: 'Standalone + Shortcuts' },
            { label: 'Maskable & Any Icons', detail: '192px & 512px Exact Size' },
            { label: 'Offline Service Worker', detail: 'Cache + Offline Fallback' },
            { label: 'Digital Asset Links', detail: '/.well-known/assetlinks.json' },
            { label: 'File Handlers', detail: 'Open .pdf, .docx & images' },
            { label: 'Web Share Target', detail: 'Receive shared PDFs/images' },
            { label: 'Background & Periodic Sync', detail: 'sw.js sync + periodicsync' },
            { label: 'Push & Launch Handler', detail: 'Single-window + Push API' },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/50 space-y-0.5"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{item.label}</span>
              </div>
              <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 font-mono">
                {item.detail}
              </p>
            </div>
          ))}
        </div>

        {/* Android TWA Configuration & Digital Asset Links Generator */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1">
                Android Application ID (Package Name)
              </label>
              <input
                type="text"
                value={androidPackageId}
                onChange={(e) => setAndroidPackageId(e.target.value)}
                placeholder="app.elimikapdf.studio"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Play App Signing SHA-256 Certificate Fingerprint
              </label>
              <input
                type="text"
                value={sha256Fingerprint}
                onChange={(e) => setSha256Fingerprint(e.target.value)}
                placeholder="FA:C6:17:45:..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
              />
              <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] mt-1">
                Found in Google Play Console &rarr; Setup &rarr; App signing. Verifies fullscreen TWA mode without browser URL bar.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Bubblewrap CLI (Build .aab / .apk)</span>
                </span>
                <button
                  onClick={() => copyText('bubblewrap', bubblewrapCmd)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] hover:underline cursor-pointer"
                >
                  {copiedField === 'bubblewrap' ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedField === 'bubblewrap' ? 'Copied' : 'Copy Command'}</span>
                </button>
              </div>
              <pre className="text-[11px] font-mono text-[#6E667D] dark:text-[#A39BB5] overflow-x-auto whitespace-pre-wrap break-all">
                {bubblewrapCmd}
              </pre>
            </div>
          </div>

          <div className="flex flex-col justify-between p-3.5 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold font-mono text-[#4A1D5E] dark:text-[#D5B3FF]">
                /.well-known/assetlinks.json
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyText('assetlinks', assetLinksJson)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-semibold cursor-pointer"
                >
                  {copiedField === 'assetlinks' ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedField === 'assetlinks' ? 'Copied' : 'Copy JSON'}</span>
                </button>
                <button
                  onClick={downloadAssetLinks}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#4A1D5E] text-white text-[11px] font-semibold cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </button>
              </div>
            </div>
            <pre className="text-[11px] font-mono text-[#14101B] dark:text-[#F4F1F8] bg-white dark:bg-[#16111F] p-2.5 rounded border border-[#E4DFEC] dark:border-[#261F33] overflow-x-auto flex-1">
              {assetLinksJson}
            </pre>
            <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
              You can also package ElimikaPDF in 1 click at <strong>pwabuilder.com</strong> by pasting your deployed app URL and selecting <strong>Package for Store &rarr; Google Play</strong>.
            </p>
          </div>
        </div>

        {/* Native Android "Open With..." PDF, Word & Document Reader Intent Filter */}
        <div className="p-4 rounded-xl bg-[#003FE8]/5 dark:bg-[#003FE8]/15 border border-[#003FE8]/25 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#003FE8] dark:text-[#60A5FA]">
              Default PDF, Word &amp; Document Reader (&ldquo;Open With ElimikaPDF&rdquo;)
            </span>
            <button
              onClick={() =>
                copyText(
                  'intent-filter',
                  `<!-- Add inside your Launcher <activity> in AndroidManifest.xml -->\n<intent-filter android:label="ElimikaPDF Reader">\n  <action android:name="android.intent.action.VIEW" />\n  <action android:name="android.intent.action.EDIT" />\n  <action android:name="android.intent.action.SEND" />\n  <category android:name="android.intent.category.DEFAULT" />\n  <category android:name="android.intent.category.BROWSABLE" />\n  <data android:scheme="content" />\n  <data android:scheme="file" />\n  <data android:mimeType="application/pdf" />\n  <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />\n  <data android:mimeType="application/msword" />\n  <data android:mimeType="application/rtf" />\n  <data android:mimeType="text/plain" />\n  <data android:mimeType="application/vnd.oasis.opendocument.text" />\n</intent-filter>`
                )
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-[#16111F] border border-[#003FE8]/30 text-[11px] font-semibold text-[#003FE8] dark:text-[#60A5FA] cursor-pointer"
            >
              {copiedField === 'intent-filter' ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>
                {copiedField === 'intent-filter'
                  ? 'Copied Multi-Doc Intent Filter'
                  : 'Copy AndroidManifest Intent Filter'}
              </span>
            </button>
          </div>
          <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            <strong>1. Desktop &amp; Android &ldquo;Share&rdquo; Sheet (Active Automatically):</strong> Selecting <strong>Share &rarr; ElimikaPDF</strong> on any <strong>PDF, Word (<code>.docx</code> / <code>.doc</code>), Text (<code>.txt</code> / <code>.rtf</code>), or Image</strong> in WhatsApp, Gmail, or Files opens it immediately in the <strong>Open with ElimikaPDF</strong> chooser modal.
          </p>
          <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            <strong>2. Android Native &ldquo;Open With&rdquo; Dialog (For Google Play <code>.aab</code>):</strong> Paste the <code>&lt;intent-filter&gt;</code> above into your Android project&rsquo;s <code>app/src/main/AndroidManifest.xml</code> before building your <code>.aab</code> so Android lists <strong>ElimikaPDF Reader</strong> whenever a user taps any PDF or Word file directly.
          </p>
        </div>

        {/* Google Play Console Privacy Policy URL Box */}
        <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-300">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Google Play Console — Official Privacy Policy URLs</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => copyText('privacy-url', universalPrivacyUrl)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold cursor-pointer"
              >
                {copiedField === 'privacy-url' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>
                  {copiedField === 'privacy-url'
                    ? 'Copied Universal URL!'
                    : 'Copy Universal Privacy URL'}
                </span>
              </button>
              {onOpenPrivacyPolicy && (
                <button
                  onClick={onOpenPrivacyPolicy}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-[#16111F] border border-emerald-300 dark:border-emerald-800 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 cursor-pointer"
                >
                  <span>Open Policy Page</span>
                </button>
              )}
              <button
                onClick={downloadPrivacyPolicyHtml}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-[#16111F] border border-emerald-300 dark:border-emerald-800 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Download HTML</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-300">
              Option 1 (Recommended — Works on all SPA &amp; PWA routes):
            </p>
            <p className="text-[11px] font-mono text-emerald-900 dark:text-emerald-200 bg-white/80 dark:bg-[#0D0A12] px-3 py-1.5 rounded border border-emerald-200/70 dark:border-emerald-800/40 break-all">
              {universalPrivacyUrl}
            </p>
            <p className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-300 pt-1">
              Option 2 (Direct Static HTML File):
            </p>
            <p className="text-[11px] font-mono text-emerald-900 dark:text-emerald-200 bg-white/80 dark:bg-[#0D0A12] px-3 py-1.5 rounded border border-emerald-200/70 dark:border-emerald-800/40 break-all">
              {staticPrivacyUrl}
            </p>
          </div>

          <p className="text-[11px] text-emerald-800/85 dark:text-emerald-400/85 leading-relaxed">
            <strong>Important:</strong> Make sure you click <strong>Share / Deploy / Update App</strong> in AI Studio first so your public <code>ais-pre-...</code> link has the latest build. Paste Option 1 or Option 2 into <strong>Google Play Console &rarr; Policy &amp; programs &rarr; App content &rarr; Privacy policy</strong>.
          </p>
        </div>
      </div>

      {/* Theme & Appearance */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-bold">Interface Theme</h2>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { id: 'light', label: 'Light Studio', icon: Sun },
              { id: 'dark', label: 'Midnight Plum Dark', icon: Moon },
              { id: 'system', label: 'System Preference', icon: Monitor },
            ] as {
              id: ThemeMode;
              label: string;
              icon: React.ComponentType<{ className?: string }>;
            }[]
          ).map((t) => {
            const Icon = t.icon;
            const active = preferences.theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => updatePref('theme', t.id)}
                className={`p-4 rounded-xl border text-left flex flex-col gap-2 transition-colors cursor-pointer ${
                  active
                    ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/5 dark:bg-[#9D5CE5]/15'
                    : 'border-[#E4DFEC] dark:border-[#261F33]'
                }`}
              >
                <Icon className="w-5 h-5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                <span className="text-xs font-bold">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scanner & OCR Defaults */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6 space-y-5">
        <h2 className="text-sm font-bold">Scanner & PDF Processing Defaults</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5">
              Default Scan Filter
            </label>
            <select
              value={preferences.defaultScanFilter}
              onChange={(e) =>
                updatePref(
                  'defaultScanFilter',
                  e.target.value as ScanFilterType
                )
              }
              className="w-full px-3 py-2 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
            >
              <option value="magic">Magic Color (Auto Contrast)</option>
              <option value="bw">Black & White Adaptive</option>
              <option value="shadow-clean">Shadow Clean</option>
              <option value="grayscale">Grayscale</option>
              <option value="original">Original Unfiltered</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5">
              Default PDF Page Size
            </label>
            <select
              value={preferences.defaultPageSize}
              onChange={(e) =>
                updatePref(
                  'defaultPageSize',
                  e.target.value as 'A4' | 'Letter' | 'Fit'
                )
              }
              className="w-full px-3 py-2 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
            >
              <option value="A4">A4 Standard (210 × 297 mm)</option>
              <option value="Letter">US Letter (8.5 × 11 in)</option>
              <option value="Fit">Fit Original Image Dimensions</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5">
              Default OCR Language
            </label>
            <select
              value={preferences.defaultOcrLang}
              onChange={(e) =>
                updatePref(
                  'defaultOcrLang',
                  e.target.value as 'eng' | 'swa' | 'eng+swa'
                )
              }
              className="w-full px-3 py-2 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
            >
              <option value="eng">English (eng)</option>
              <option value="swa">Swahili / Kiswahili (swa)</option>
              <option value="eng+swa">Bilingual (English + Swahili)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Privacy, 500 MB+ High-Capacity Local Storage & Persistent Vault */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#15803D] dark:text-[#4ADE80]" />
              <span>500 MB+ High-Capacity Local Vault (IndexedDB)</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
              ElimikaPDF allocates <strong>500 MB+</strong> of persistent on-device IndexedDB storage (up to{' '}
              <strong>{formatBytes(storageEstimate.quotaBytes)}</strong> available on your device) so you can store hundreds of multi-page PDFs offline without server limits.
            </p>
          </div>
          <div className="sm:text-right shrink-0">
            <p className="text-xs text-[#6E667D]">Storage Quota</p>
            <p className="text-sm font-bold font-mono tabular-nums">
              {formatBytes(totalStorageBytes)} / 500 MB ({documentCount} files)
            </p>
          </div>
        </div>

        {/* Visual 500 MB Progress Bar */}
        <div className="space-y-2 p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold flex items-center gap-1.5 text-[#14101B] dark:text-[#F4F1F8]">
              <HardDrive className="w-4 h-4 text-[#4A1D5E] dark:text-[#9D5CE5]" />
              <span>Guaranteed Vault Quota: 500 MB (Device Max: {formatBytes(storageEstimate.quotaBytes)})</span>
            </span>
            <span className="font-mono font-bold text-[#15803D] dark:text-[#4ADE80]">
              {storageEstimate.persisted ? 'Persistent Storage Locked' : '500 MB Active'}
            </span>
          </div>
          <div className="w-full h-2.5 bg-[#E4DFEC] dark:bg-[#261F33] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#4A1D5E] dark:bg-[#9D5CE5] rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(1, Math.round((totalStorageBytes / MAX_VAULT_QUOTA_BYTES) * 100))
                )}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
              Supports individual PDF files and downloads up to 500 MB.
            </span>
            <button
              onClick={async () => {
                const granted = await requestPersistentStorage();
                const updated = await getDeviceStorageEstimate();
                setStorageEstimate({ ...updated, persisted: granted || updated.persisted });
                setSavedNotice(
                  granted
                    ? 'Persistent 500 MB+ device storage locked! Android/Chrome will never auto-clear your PDFs.'
                    : '500 MB+ IndexedDB storage is active on this device.'
                );
                setTimeout(() => setSavedNotice(null), 3500);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold cursor-pointer"
            >
              {storageEstimate.persisted
                ? '✓ 500 MB+ Persistent Storage Active'
                : 'Lock 500 MB+ Persistent Storage'}
            </button>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-xs font-bold flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
              <span>Cloud Synchronization Adapter (Supabase Ready)</span>
            </p>
            <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
              ElimikaPDF’s storage layer implements the <code>IDocumentRepository</code> interface so Supabase Auth & Storage buckets can be attached without modifying editor or scanner workflows.
            </p>
          </div>
          <span className="text-[11px] font-mono text-[#6E667D] shrink-0">
            500 MB Local Mode
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={onResetSampleDocuments}
            className="px-4 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Restore Sample Documents</span>
          </button>

          {!confirmClearAll ? (
            <button
              onClick={() => setConfirmClearAll(true)}
              className="px-4 py-2 rounded-lg border border-[#DC2626]/40 text-[#DC2626] hover:bg-[#DC2626]/10 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete All Locally Stored Documents</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[#DC2626]/10 border border-[#DC2626]/30">
              <span className="text-xs font-semibold text-[#DC2626]">
                Permanently erase all {documentCount} local documents?
              </span>
              <button
                onClick={async () => {
                  await onClearAllStorage();
                  setConfirmClearAll(false);
                }}
                className="px-3 py-1 rounded bg-[#DC2626] text-white text-xs font-bold cursor-pointer"
              >
                Confirm Erase
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                className="px-2 py-1 text-xs text-[#6E667D] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const PrivacyPolicyView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-5">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
              alt="ElimikaPDF Icon"
              className="w-11 h-11 rounded-xl object-cover shadow-xs shrink-0"
            />
            <div>
              <h1 className="text-xl font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
                ElimikaPDF — Privacy Policy
              </h1>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                Effective Date: November 10, 2026 &middot; Last Updated: November 10, 2026
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
            100% On-Device Local Privacy
          </span>
        </div>

        <div className="p-4 rounded-xl bg-[#F4F1F8] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-1.5">
          <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
            Summary of Our Privacy Commitment:
          </p>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            <strong>ElimikaPDF</strong> is a local-first PDF Reader, Document Scanner, PDF Editor, Word Converter, and Optical Character Recognition (OCR) application. Your documents, camera scans, PDF annotations, and extracted text are processed and stored <strong>locally on your device</strong>. We do not sell, rent, collect, or transmit your personal documents to any external tracking or advertising servers.
          </p>
        </div>

        <div className="space-y-4 text-xs sm:text-sm text-[#14101B] dark:text-[#F4F1F8] leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              1. Information We Collect and Process
            </h2>
            <p className="text-[#6E667D] dark:text-[#A39BB5]">
              ElimikaPDF is designed to operate without requiring user registration or personal accounts. We do not collect personally identifiable information (PII) such as your name, phone number, physical address, or payment information.
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-[#6E667D] dark:text-[#A39BB5]">
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">Documents &amp; Files:</strong> Any PDF files, Word documents (<code>.docx</code>), or images you open, edit, merge, split, compress, or convert are processed locally inside your device&apos;s memory and stored in your device&apos;s local <code>IndexedDB</code> storage vault (up to 500 MB+ local quota).
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">Optical Character Recognition (OCR):</strong> Text recognition (English and Kiswahili) runs locally on your device. Extracted text remains inside your local document vault unless you explicitly export or share it.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              2. Device Permissions We Request
            </h2>
            <p className="text-[#6E667D] dark:text-[#A39BB5]">
              To provide core document scanning and PDF management features, ElimikaPDF may request the following permissions on your device:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-[#6E667D] dark:text-[#A39BB5]">
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">Camera Permission (<code>android.permission.CAMERA</code>):</strong> Used strictly when you open the Document Scanner to photograph physical pages, receipts, notes, or contracts for perspective cropping and PDF creation. Camera frames are processed in real time on your device and are never uploaded or streamed to external servers.
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">File &amp; Media Access:</strong> Used only when you explicitly pick a PDF, Word file, or image from your device storage (or share a PDF to ElimikaPDF via the system Share / Open With menu) and when you save or download edited files back to your device.
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">Notifications (Optional):</strong> Used only if you enable local notifications for completed document tasks.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              3. Data Storage, Retention, and Deletion
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#6E667D] dark:text-[#A39BB5]">
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">On-Device Storage:</strong> All stored documents and user preferences (such as Light/Dark theme and default scan filters) are saved locally on your device using browser <code>IndexedDB</code> and <code>localStorage</code>.
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">Full User Control &amp; Instant Deletion:</strong> You can delete any individual document at any time by tapping the Delete (trash) icon next to the file, or erase all locally stored data at once by navigating to <strong>Settings &rarr; Delete All Locally Stored Documents</strong> (or by clearing the app data / uninstalling the app on your device).
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              4. Third-Party Sharing &amp; Analytics
            </h2>
            <p className="text-[#6E667D] dark:text-[#A39BB5]">
              ElimikaPDF does <strong>not</strong> include third-party advertising SDKs, behavioral trackers, or data brokers. Your files are only shared with other applications (such as WhatsApp, Gmail, or Google Drive) when you explicitly tap the <strong>Share</strong> or <strong>Send to Email</strong> button on your device.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              5. Children&apos;s Privacy
            </h2>
            <p className="text-[#6E667D] dark:text-[#A39BB5]">
              ElimikaPDF is a general-audience productivity and educational document utility. We do not knowingly collect any personal information from children under the age of 13 (or the applicable age of digital consent in your jurisdiction).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              6. Contact Us
            </h2>
            <p className="text-[#6E667D] dark:text-[#A39BB5]">
              If you have any questions, concerns, or requests regarding this Privacy Policy or how ElimikaPDF handles your data, please contact the developer at:
            </p>
            <p className="font-semibold">
              App Name: ElimikaPDF
              <br />
              Email:{' '}
              <a
                href="mailto:mohamedshabani751@gmail.com"
                className="text-[#4A1D5E] dark:text-[#D5B3FF] underline"
              >
                mohamedshabani751@gmail.com
              </a>
            </p>
          </section>
        </div>

        {onBack && (
          <div className="pt-4 border-t border-[#E4DFEC] dark:border-[#261F33]">
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold cursor-pointer"
            >
              &larr; Back to ElimikaPDF Workspace
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const HelpAndSupportView: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6 space-y-2">
        <h1 className="text-xl font-bold tracking-tight">
          Help, Architecture & User Guide
        </h1>
        <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
          Reference guide for document scanning, perspective correction, overlay vs. native PDF editing, and bilingual OCR.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
            <Camera className="w-4 h-4" />
            <span>1. Document Scanner & Perspective Warp</span>
          </div>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            Use your device camera or upload photos of physical pages. ElimikaPDF runs a Sobel edge gradient detector to locate the 4 page corners. You can fine-tune any corner handle manually before applying a 4-point projective homography warp and adaptive B&W or Shadow Clean filters.
          </p>
        </div>

        <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
            <FileEdit className="w-4 h-4" />
            <span>2. Overlay Annotations vs. Native PDF Text</span>
          </div>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            In the PDF Editor, tools like Add Text, Highlight, Whiteout, Shapes, and Comments create interactive overlay elements. When you click <strong>Save PDF</strong> or <strong>Download</strong>, <code>pdf-lib</code> permanently writes those vector graphics and text layers into the PDF file. To modify existing PDF text, cover the old phrase with a <strong>Whiteout</strong> rectangle and place a new <strong>Text</strong> box over it.
          </p>
        </div>

        <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
            <ScanText className="w-4 h-4" />
            <span>3. English & Swahili OCR Engine</span>
          </div>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            Open <strong>PDF Tools → OCR (English & Swahili)</strong> to recognize printed text inside scanned documents. Choose English (<code>eng</code>), Swahili (<code>swa</code>), or Bilingual (<code>eng+swa</code>) and export the recognized text as a <code>.txt</code> file or save it directly to the document’s searchable index.
          </p>
        </div>

        <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
            <Layers className="w-4 h-4" />
            <span>4. Merge, Split, Compress & Organize</span>
          </div>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            Combine multiple PDFs in custom order, extract page ranges, compare original vs. compressed PDF sizes across three quality profiles, or convert between PDF pages and high-resolution PNG/JPG images.
          </p>
        </div>
      </div>
    </div>
  );
};
