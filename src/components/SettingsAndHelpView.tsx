import React, { useState } from 'react';
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
  Smartphone,
  Copy,
  Check,
  Download,
  Terminal,
} from 'lucide-react';
import { AppPreferences, ScanFilterType, ThemeMode } from '../types/document';
import { formatBytes } from '../services/storageService';
import { PWAInstallButton } from './PWAInstallPrompt';

interface SettingsViewProps {
  preferences: AppPreferences;
  onUpdatePreferences: (prefs: AppPreferences) => void;
  totalStorageBytes: number;
  documentCount: number;
  onClearAllStorage: () => Promise<void>;
  onResetSampleDocuments: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  preferences,
  onUpdatePreferences,
  totalStorageBytes,
  documentCount,
  onClearAllStorage,
  onResetSampleDocuments,
}) => {
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [androidPackageId, setAndroidPackageId] = useState('app.elimikapdf.studio');
  const [sha256Fingerprint, setSha256Fingerprint] = useState(
    '6A:03:83:9F:47:2B:08:CA:D2:11:60:29:25:E8:5E:0F:9A:BA:60:3D:2E:18:3C:9D:79:6B:F4:CB:E1:8D:91:DF'
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const assetLinksJson = JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: androidPackageId.trim() || 'app.elimikapdf.studio',
          sha256_cert_fingerprints: [sha256Fingerprint.trim()],
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

  const updatePref = <K extends keyof AppPreferences>(
    key: K,
    val: AppPreferences[K]
  ) => {
    const next = { ...preferences, [key]: val };
    onUpdatePreferences(next);
    setSavedNotice('Preferences updated in local storage.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

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

        {/* Native Android "Open With..." PDF Reader Intent Filter */}
        <div className="p-4 rounded-xl bg-[#003FE8]/5 dark:bg-[#003FE8]/15 border border-[#003FE8]/25 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#003FE8] dark:text-[#60A5FA]">
              Default PDF Reader (&ldquo;Open With ElimikaPDF&rdquo; on Android &amp; Desktop)
            </span>
            <button
              onClick={() =>
                copyText(
                  'intent-filter',
                  `<intent-filter android:label="ElimikaPDF Reader">\n  <action android:name="android.intent.action.VIEW" />\n  <action android:name="android.intent.action.SEND" />\n  <category android:name="android.intent.category.DEFAULT" />\n  <category android:name="android.intent.category.BROWSABLE" />\n  <data android:mimeType="application/pdf" />\n</intent-filter>`
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
                  ? 'Copied Intent Filter'
                  : 'Copy Android Intent Filter'}
              </span>
            </button>
          </div>
          <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
            <strong>Desktop &amp; Android Share Sheet:</strong> Automatically active via Web App Manifest <code>file_handlers</code> and <code>share_target</code> (selecting <strong>Share &rarr; ElimikaPDF</strong> on any PDF in WhatsApp, Gmail, or Files opens it directly in ElimikaPDF Reader). For custom Android Studio / Bubblewrap builds, adding the <code>&lt;intent-filter&gt;</code> above to <code>AndroidManifest.xml</code> also registers ElimikaPDF in Android&apos;s system <strong>&ldquo;Open with...&rdquo;</strong> chooser.
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

      {/* Privacy, Local Storage & Future Cloud Sync */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#15803D] dark:text-[#4ADE80]" />
              <span>Local-First Privacy & IndexedDB Vault</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
              All scanned images, PDFs, annotations, and OCR text outputs are stored strictly inside your browser’s local <code>IndexedDB</code> database (<code>scanpro_studio_db</code>). Private documents are never uploaded to external servers.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-[#6E667D]">Current Footprint</p>
            <p className="text-sm font-bold font-mono tabular-nums">
              {formatBytes(totalStorageBytes)} ({documentCount} docs)
            </p>
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
            Local Mode Active
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
