import React from 'react';
import {
  LayoutDashboard,
  Camera,
  FileEdit,
  Wrench,
  FolderKanban,
  Settings,
  HelpCircle,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  HardDrive,
} from 'lucide-react';
import { ActiveView, ThemeMode } from '../types/document';
import { formatBytes } from '../services/storageService';

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

const NAV_ITEMS: {
  id: ActiveView;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Home',
    icon: LayoutDashboard,
  },
  {
    id: 'scanner',
    label: 'Scanner Studio',
    shortLabel: 'Scan',
    icon: Camera,
  },
  {
    id: 'editor',
    label: 'PDF Editor & Viewer',
    shortLabel: 'Editor',
    icon: FileEdit,
  },
  {
    id: 'tools',
    label: 'PDF Tools & OCR',
    shortLabel: 'Tools',
    icon: Wrench,
  },
  {
    id: 'documents',
    label: 'My Documents',
    shortLabel: 'Library',
    icon: FolderKanban,
  },
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    icon: Settings,
  },
  {
    id: 'help',
    label: 'Help & Support',
    shortLabel: 'Help',
    icon: HelpCircle,
  },
];

export const Layout: React.FC<LayoutProps> = ({
  activeView,
  onNavigate,
  theme,
  onThemeChange,
  totalStorageBytes,
  documentCount,
  onQuickScan,
  children,
}) => {
  // Max local quota visualization reference (50 MB nominal tier)
  const quotaBytes = 50 * 1024 * 1024;
  const usagePercent = Math.min(
    100,
    Math.max(2, Math.round((totalStorageBytes / quotaBytes) * 100))
  );

  const cycleTheme = () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    onThemeChange(next);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAF9FB] dark:bg-[#0D0A12] text-[#14101B] dark:text-[#F4F1F8] transition-colors duration-150">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#F2EFF6] dark:bg-[#16111F] border-r border-[#E4DFEC] dark:border-[#261F33] select-none">
        <div className="h-16 px-6 flex items-center justify-between border-b border-[#E4DFEC] dark:border-[#261F33]">
          <button
            onClick={() => onNavigate('dashboard')}
            className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1D5E] dark:focus-visible:ring-[#9D5CE5] rounded"
          >
            <span className="text-lg font-bold tracking-tight text-[#4A1D5E] dark:text-[#F4F1F8] whitespace-nowrap">
              ScanPro Studio
            </span>
          </button>
        </div>

        {/* Primary Action CTA in Sidebar */}
        <div className="p-4">
          <button
            onClick={onQuickScan}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] font-semibold text-sm shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>New Document Scan</span>
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto" aria-label="Sidebar Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-[#4A1D5E] text-white dark:bg-[#9D5CE5]/20 dark:text-[#D5B3FF]'
                    : 'text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33]/60 hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Local Storage & Privacy Meter */}
        <div className="p-4 m-3 rounded-lg bg-white/80 dark:bg-[#0D0A12]/60 border border-[#E4DFEC] dark:border-[#261F33] space-y-2.5">
          <div className="flex items-center justify-between text-xs text-[#6E667D] dark:text-[#A39BB5]">
            <span className="flex items-center gap-1.5 font-medium text-[#14101B] dark:text-[#F4F1F8]">
              <HardDrive className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#9D5CE5]" />
              Local Vault
            </span>
            <span className="font-mono tabular-nums">
              {formatBytes(totalStorageBytes)}
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#E4DFEC] dark:bg-[#261F33] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#4A1D5E] dark:bg-[#9D5CE5] rounded-full transition-all duration-300"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
            <span className="tabular-nums">{documentCount} files stored</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-[#15803D] dark:text-[#4ADE80]" />
              On-device
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          activeView === 'editor' ? 'pb-0 h-dvh overflow-hidden' : 'pb-16 lg:pb-0'
        }`}
      >
        {/* Strict 3-Zone Top Bar Contract (hidden in full-screen Document Editor mode) */}
        {activeView !== 'editor' && (
          <header className="h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8 bg-white/90 dark:bg-[#16111F]/90 backdrop-blur-md border-b border-[#E4DFEC] dark:border-[#261F33] sticky top-0 z-30">
            {/* Zone 1: Single text element wordmark / breadcrumb */}
            <button
              onClick={() => onNavigate('dashboard')}
              className="text-base sm:text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] whitespace-nowrap shrink-0 cursor-pointer focus:outline-none"
            >
              ScanPro Studio
            </button>

            {/* Zone 2: 4-5 concise single-line navigation links */}
            <nav
              className="hidden md:flex items-center gap-6 text-sm font-medium text-[#6E667D] dark:text-[#A39BB5]"
              aria-label="Primary Workspace Navigation"
            >
              <button
                onClick={() => onNavigate('dashboard')}
                className={`hover:text-[#14101B] dark:hover:text-[#F4F1F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'dashboard'
                    ? 'text-[#4A1D5E] dark:text-[#D5B3FF] underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => onNavigate('scanner')}
                className={`hover:text-[#14101B] dark:hover:text-[#F4F1F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'scanner'
                    ? 'text-[#4A1D5E] dark:text-[#D5B3FF] underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                Scanner
              </button>
              <button
                onClick={() => onNavigate('editor')}
                className="hover:text-[#14101B] dark:hover:text-[#F4F1F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                PDF Editor
              </button>
              <button
                onClick={() => onNavigate('tools')}
                className={`hover:text-[#14101B] dark:hover:text-[#F4F1F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'tools'
                    ? 'text-[#4A1D5E] dark:text-[#D5B3FF] underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                PDF Tools
              </button>
              <button
                onClick={() => onNavigate('documents')}
                className={`hover:text-[#14101B] dark:hover:text-[#F4F1F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'documents'
                    ? 'text-[#4A1D5E] dark:text-[#D5B3FF] underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                Library
              </button>
            </nav>

            {/* Zone 3: Theme cycle & Primary Action */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={cycleTheme}
                title={`Theme: ${theme} (click to switch)`}
                aria-label={`Current theme ${theme}. Click to switch theme`}
                className="p-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer"
              >
                {theme === 'light' && <Sun className="w-4 h-4" />}
                {theme === 'dark' && <Moon className="w-4 h-4" />}
                {theme === 'system' && <Monitor className="w-4 h-4" />}
              </button>
              <button
                onClick={onQuickScan}
                className="px-4 py-2 text-xs font-semibold text-white dark:text-[#0D0A12] bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Scan Document
              </button>
            </div>
          </header>
        )}

        {/* Main Workspace Viewport */}
        <main
          className={`flex-1 min-h-0 ${
            activeView === 'editor' ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation (hidden in full-screen Document Editor mode because Editor has its own bottom dock) */}
      {activeView !== 'editor' && (
        <nav
          aria-label="Mobile Bottom Navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 h-16 bg-white/95 dark:bg-[#16111F]/95 backdrop-blur-md border-t border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-around px-2 z-40"
        >
          {NAV_ITEMS.slice(0, 6).map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'text-[#4A1D5E] dark:text-[#D5B3FF] font-semibold'
                    : 'text-[#6E667D] dark:text-[#A39BB5]'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5 shrink-0" />
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};
