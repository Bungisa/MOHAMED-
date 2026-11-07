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
} from 'lucide-react';
import { AppPreferences, ScanFilterType, ThemeMode } from '../types/document';
import { formatBytes } from '../services/storageService';

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
          Application Settings & Privacy Controls
        </h1>
        <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
          Customize appearance, default document scanner profiles, OCR languages, and local IndexedDB vault storage.
        </p>
        {savedNotice && (
          <p className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80] flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{savedNotice}</span>
          </p>
        )}
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
              ScanPro’s storage layer implements the <code>IDocumentRepository</code> interface so Supabase Auth & Storage buckets can be attached without modifying editor or scanner workflows.
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
            Use your device camera or upload photos of physical pages. ScanPro runs a Sobel edge gradient detector to locate the 4 page corners. You can fine-tune any corner handle manually before applying a 4-point projective homography warp and adaptive B&W or Shadow Clean filters.
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
