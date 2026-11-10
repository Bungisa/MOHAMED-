import React, { useState } from 'react';
import {
  Download,
  Share,
  PlusSquare,
  X,
  WifiOff,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

const ELIMIKA_ICON_URL =
  '/assets/aistudio/WhatsApp_Image_2026-11-10_at_8.49.06_AM_2a60a4c2.jpeg';

export function PWAInstallButton({
  variant = 'header',
  onOpenPlayStoreSettings,
}: {
  variant?: 'header' | 'sidebar' | 'card';
  onOpenPlayStoreSettings?: () => void;
}) {
  const {
    isInstalled,
    hasNativePrompt,
    isInIframe,
    showIOSGuide,
    setShowIOSGuide,
    showInstallModal,
    setShowInstallModal,
    promptInstall,
  } = usePWAInstall();

  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (isInstalled && variant !== 'card') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="hidden sm:inline">App Installed</span>
      </div>
    );
  }

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          onClick={promptInstall}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3A154B] text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
          title="Install ElimikaPDF as an offline-ready app"
        >
          <span className="flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>{isInstalled ? 'Installed (PWA Ready)' : 'Install App / Play Store'}</span>
          </span>
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/15 text-emerald-200 font-mono">
            {hasNativePrompt ? 'READY' : 'PWA'}
          </span>
        </button>
      ) : (
        <button
          onClick={promptInstall}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4A1D5E] hover:bg-[#3A154B] text-white shadow-sm transition-all cursor-pointer shrink-0"
          aria-label="Install ElimikaPDF App"
        >
          <Download className="w-3.5 h-3.5 text-emerald-300" />
          <span>Install App</span>
        </button>
      )}

      {/* iOS Safari Installation Modal */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
        >
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-stone-200">
            <button
              onClick={() => setShowIOSGuide(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
              aria-label="Close install instructions"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-3">
              <img
                src={ELIMIKA_ICON_URL}
                alt="ElimikaPDF Icon"
                className="w-11 h-11 rounded-xl object-cover shadow-xs shrink-0"
              />
              <div>
                <h3 id="ios-install-title" className="text-base font-bold text-stone-900">
                  Install ElimikaPDF
                </h3>
                <p className="text-xs text-stone-500">Full-screen offline scanner & PDF editor on iOS</p>
              </div>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-stone-700">
              <li className="flex items-center gap-3 p-2.5 rounded-lg bg-stone-50 border border-stone-200/80">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#4A1D5E]/10 text-[#4A1D5E]">
                  <Share className="w-4 h-4" />
                </span>
                <span>
                  1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex items-center gap-3 p-2.5 rounded-lg bg-stone-50 border border-stone-200/80">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#4A1D5E]/10 text-[#4A1D5E]">
                  <PlusSquare className="w-4 h-4" />
                </span>
                <span>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </span>
              </li>
            </ol>

            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full py-2.5 rounded-xl bg-[#4A1D5E] text-white text-xs font-semibold hover:bg-[#3A154B] cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* Android / Desktop / Google Play Store Guide Modal */}
      {showInstallModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-stone-200">
            <button
              onClick={() => setShowInstallModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <img
                src={ELIMIKA_ICON_URL}
                alt="ElimikaPDF Icon"
                className="w-12 h-12 rounded-xl object-cover shadow-sm shrink-0"
              />
              <div>
                <h3 id="pwa-install-title" className="text-base font-bold text-stone-900">
                  Install ElimikaPDF (PWA & Play Store)
                </h3>
                <p className="text-xs text-stone-500">
                  100% Offline-Ready Web App &bull; Trusted Web Activity Verified
                </p>
              </div>
            </div>

            {isInIframe && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
                <p className="font-semibold">Running inside a preview frame:</p>
                <p className="text-amber-800 leading-relaxed">
                  Browsers require top-level navigation to show the native 1-click{' '}
                  <strong>Add to Home Screen / Install App</strong> prompt. Copy the app URL below
                  and open it directly in Chrome, Edge, or Android Chrome:
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    readOnly
                    value={window.location.origin}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-amber-300 rounded-lg text-stone-700"
                  />
                  <button
                    onClick={handleCopyUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4A1D5E] text-white font-semibold hover:bg-[#3A154B] cursor-pointer shrink-0"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedUrl ? 'Copied' : 'Copy URL'}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2.5 text-xs text-stone-700">
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                <p className="font-semibold text-stone-900 mb-1">
                  Option 1: Direct Install on Android / Desktop Chrome
                </p>
                <p className="text-stone-600 leading-relaxed">
                  Open the app URL in Chrome or Edge and tap the{' '}
                  <strong>Install ElimikaPDF</strong> icon in the address bar or browser menu (
                  <strong>⋮ &rarr; Install app</strong>).
                </p>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-950 mb-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Option 2: Package `.aab` for Google Play Store</span>
                </div>
                <p className="text-emerald-800 leading-relaxed">
                  ElimikaPDF includes a complete Web App Manifest, maskable icons, screenshots,
                  Service Worker, and{' '}
                  <code className="font-mono bg-white/80 px-1 py-0.5 rounded">
                    /.well-known/assetlinks.json
                  </code>{' '}
                  ready for <strong>PWABuilder</strong> or <strong>Bubblewrap CLI</strong>.
                </p>
                {onOpenPlayStoreSettings && (
                  <button
                    onClick={() => {
                      setShowInstallModal(false);
                      onOpenPlayStoreSettings();
                    }}
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Google Play Store Packaging Center</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowInstallModal(false)}
                className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
      <span>Offline Mode — Local Engine Active</span>
    </div>
  );
}
