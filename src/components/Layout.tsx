import React, { useState } from 'react';
import {
  Settings,
  HelpCircle,
  Sun,
  Moon,
  ShieldCheck,
  HardDrive,
  X,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Camera,
  Lock,
} from 'lucide-react';
import { ActiveView, ThemeMode } from '../types/document';
import { formatBytes, MAX_VAULT_QUOTA_BYTES } from '../services/storageService';
import { PWAInstallButton, OfflineIndicator } from './PWAInstallPrompt';

interface LayoutProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  totalStorageBytes: number;
  documentCount: number;
  onQuickScan: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  activeView,
  onNavigate,
  theme,
  onThemeChange,
  totalStorageBytes,
  documentCount,
  children,
}) => {
  const [showHelpPrivacyModal, setShowHelpPrivacyModal] = useState(false);

  const quotaBytes = MAX_VAULT_QUOTA_BYTES;
  const usagePercent = Math.min(
    100,
    Math.max(1, Math.round((totalStorageBytes / quotaBytes) * 100))
  );

  const isDarkActive =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleTheme = () => {
    onThemeChange(isDarkActive ? 'light' : 'dark');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9FB] dark:bg-[#0D0A12] text-[#14101B] dark:text-[#F4F1F8] transition-colors duration-150">
      {/* Single Sticky Top Navbar (hidden only when inside full-screen PDF Editor canvas) */}
      {activeView !== 'editor' && (
        <header className="sticky top-0 z-50 w-full bg-white/95 dark:bg-[#16111F]/95 backdrop-blur-md border-b border-[#E4DFEC] dark:border-[#261F33]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
            {/* Left Side: ONE ElimikaPDF Logo & Brand Title (+ Back button when inside a sub-view) */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => onNavigate('dashboard')}
                className="flex items-center gap-2.5 text-base sm:text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] whitespace-nowrap shrink-0 cursor-pointer focus:outline-none"
              >
                <img
                  src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
                  alt="ElimikaPDF Icon"
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover shrink-0 shadow-xs"
                />
                <span>ElimikaPDF</span>
              </button>

              {activeView !== 'dashboard' && (
                <button
                  onClick={() => onNavigate('dashboard')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] dark:hover:bg-[#342A45] text-xs font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] transition-colors cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Home</span>
                </button>
              )}
            </div>

            {/* Right Side: [Install App], [Theme Toggle ☀️/🌙], [Settings ⚙️], [Help / Privacy ❓] */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <OfflineIndicator />

              <PWAInstallButton
                variant="header"
                onOpenPlayStoreSettings={() => onNavigate('settings')}
              />

              <button
                onClick={toggleTheme}
                title={isDarkActive ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                aria-label="Toggle Light or Dark Theme"
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer shrink-0"
              >
                {isDarkActive ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={() =>
                  onNavigate(activeView === 'settings' ? 'dashboard' : 'settings')
                }
                title="Settings"
                aria-label="Settings"
                className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl border transition-colors cursor-pointer shrink-0 ${
                  activeView === 'settings'
                    ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF]'
                    : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                onClick={() => setShowHelpPrivacyModal(true)}
                title="Help & Privacy Policy"
                aria-label="Help and Privacy Policy"
                className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl border transition-colors cursor-pointer shrink-0 ${
                  showHelpPrivacyModal || activeView === 'help' || activeView === 'privacy'
                    ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF]'
                    : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                }`}
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area — Full-Width Unobstructed Workspace */}
      <main
        className={`flex-1 w-full ${
          activeView === 'editor' ? 'h-dvh overflow-hidden' : ''
        }`}
      >
        {children}
      </main>

      {/* Help & Privacy Policy Modal */}
      {showHelpPrivacyModal && (
        <div
          onClick={() => setShowHelpPrivacyModal(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-privacy-modal-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
                  alt="ElimikaPDF Icon"
                  className="w-10 h-10 rounded-xl object-cover shadow-xs shrink-0"
                />
                <div>
                  <h2
                    id="help-privacy-modal-title"
                    className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]"
                  >
                    Help, Storage &amp; Privacy Policy
                  </h2>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    ElimikaPDF — Offline-First PDF, Word &amp; Scanner Studio
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHelpPrivacyModal(false)}
                className="p-1.5 rounded-lg text-[#6E667D] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Usage Guide */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E667D] dark:text-[#A39BB5]">
                Quick Start Guide
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#003FE8] dark:text-[#60A5FA]">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span>Open &amp; Edit PDFs</span>
                  </div>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                    Tap <strong>Open / Edit PDF</strong> to view, highlight, sign, whiteout, or watermark any document.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
                    <Camera className="w-3.5 h-3.5 shrink-0" />
                    <span>Scan Paper Exams</span>
                  </div>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                    Tap <strong>Scan Document</strong> to photograph pages, auto-crop borders, and apply Magic Color filters.
                  </p>
                </div>
              </div>
            </div>

            {/* Local Storage Meter */}
            <div className="p-3.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  <HardDrive className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#9D5CE5]" />
                  <span>Local Device Vault</span>
                </span>
                <span className="font-mono text-[11px] text-[#6E667D] dark:text-[#A39BB5] tabular-nums">
                  {formatBytes(totalStorageBytes)} / 500 MB ({documentCount} files)
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#E4DFEC] dark:bg-[#261F33] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#4A1D5E] dark:bg-[#9D5CE5] rounded-full transition-all duration-300"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>All files are stored 100% locally on your device in IndexedDB.</span>
              </p>
            </div>

            {/* Privacy Commitment */}
            <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/50 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-300">
                <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>100% On-Device Privacy Guarantee</span>
              </div>
              <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/80 leading-relaxed">
                ElimikaPDF processes your PDFs, Word documents, camera scans, and OCR text locally in your browser. We never upload, sell, or track your personal documents.
              </p>
            </div>

            {/* Footer Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowHelpPrivacyModal(false);
                    onNavigate('privacy');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Full Privacy Policy</span>
                </button>
                <button
                  onClick={() => {
                    setShowHelpPrivacyModal(false);
                    onNavigate('help');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Detailed User Guide</span>
                </button>
              </div>

              <button
                onClick={() => setShowHelpPrivacyModal(false)}
                className="px-4 py-2 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
