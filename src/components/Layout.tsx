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

const PRIMARY_NAV_ITEMS: {
  id: ActiveView;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'dashboard',
    label: 'Home Workspace',
    shortLabel: 'Home',
    icon: LayoutDashboard,
  },
  {
    id: 'scanner',
    label: 'Scan Document',
    shortLabel: 'Scan',
    icon: Camera,
  },
  {
    id: 'editor',
    label: 'PDF Editor',
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
    label: 'My Files',
    shortLabel: 'Files',
    icon: FolderKanban,
  },
];

const SECONDARY_NAV_ITEMS: {
  id: ActiveView;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    icon: Settings,
  },
  {
    id: 'privacy',
    label: 'Privacy Policy',
    shortLabel: 'Privacy',
    icon: ShieldCheck,
  },
  {
    id: 'help',
    label: 'Help & Guide',
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
  const quotaBytes = MAX_VAULT_QUOTA_BYTES;
  const usagePercent = Math.min(
    100,
    Math.max(1, Math.round((totalStorageBytes / quotaBytes) * 100))
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
            className="flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1D5E] dark:focus-visible:ring-[#9D5CE5] rounded cursor-pointer"
          >
            <img
              src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
              alt="ElimikaPDF Icon"
              className="w-8 h-8 rounded-lg object-cover shrink-0 shadow-xs"
            />
            <span className="text-lg font-bold tracking-tight text-[#4A1D5E] dark:text-[#F4F1F8] whitespace-nowrap">
              ElimikaPDF
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

        {/* Core Workspaces Navigation */}
        <nav
          className="flex-1 px-3 py-2 space-y-5 overflow-y-auto"
          aria-label="Sidebar Navigation"
        >
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5]">
              Workspaces
            </p>
            {PRIMARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-[#4A1D5E] text-white dark:bg-[#9D5CE5]/20 dark:text-[#D5B3FF] font-semibold'
                      : 'text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33]/60 hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1 pt-3 border-t border-[#E4DFEC] dark:border-[#261F33]">
            <p className="px-3 pb-1 text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5]">
              Preferences & Support
            </p>
            {SECONDARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-[#4A1D5E] text-white dark:bg-[#9D5CE5]/20 dark:text-[#D5B3FF] font-semibold'
                      : 'text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33]/60 hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Local Storage & Privacy Meter (500 MB High-Capacity Tier) */}
        <div className="p-4 m-3 rounded-lg bg-white/80 dark:bg-[#0D0A12]/60 border border-[#E4DFEC] dark:border-[#261F33] space-y-2.5">
          <div className="flex items-center justify-between text-xs text-[#6E667D] dark:text-[#A39BB5]">
            <span className="flex items-center gap-1.5 font-medium text-[#14101B] dark:text-[#F4F1F8]">
              <HardDrive className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#9D5CE5]" />
              Local Vault
            </span>
            <span className="font-mono tabular-nums">
              {formatBytes(totalStorageBytes)} / 500 MB
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
              500 MB+ Ready
            </span>
          </div>
          <div className="pt-1">
            <PWAInstallButton
              variant="sidebar"
              onOpenPlayStoreSettings={() => onNavigate('settings')}
            />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          activeView === 'editor' ? 'pb-0 h-dvh overflow-hidden' : 'pb-16 lg:pb-0'
        }`}
      >
        {/* Clean, Uncluttered Top Bar (hidden in full-screen Document Editor mode) */}
        {activeView !== 'editor' && (
          <header className="h-14 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-6 bg-white/95 dark:bg-[#16111F]/95 backdrop-blur-md border-b border-[#E4DFEC] dark:border-[#261F33] sticky top-0 z-30">
            {/* Zone 1: Brand icon & wordmark */}
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex items-center gap-2 text-base sm:text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] whitespace-nowrap shrink-0 cursor-pointer focus:outline-none"
            >
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
                alt="ElimikaPDF Icon"
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-cover shrink-0 shadow-xs"
              />
              <span>ElimikaPDF</span>
            </button>

            {/* Zone 2: Desktop single-line navigation links */}
            <nav
              className="hidden md:flex items-center gap-6 text-sm font-medium text-[#6E667D] dark:text-[#A39BB5]"
              aria-label="Primary Workspace Navigation"
            >
              {PRIMARY_NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`hover:text-[#14101B] dark:hover:text-[#F4F1F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeView === item.id
                      ? 'text-[#4A1D5E] dark:text-[#D5B3FF] underline underline-offset-8 decoration-2 font-semibold'
                      : ''
                  }`}
                >
                  {item.shortLabel}
                </button>
              ))}
            </nav>

            {/* Zone 3: Compact, Always-Visible Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <OfflineIndicator />
              <div className="hidden sm:block">
                <PWAInstallButton
                  variant="header"
                  onOpenPlayStoreSettings={() => onNavigate('settings')}
                />
              </div>
              <button
                onClick={cycleTheme}
                title={`Theme: ${theme}`}
                aria-label={`Current theme ${theme}. Click to switch theme`}
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer shrink-0"
              >
                {theme === 'light' && <Sun className="w-4 h-4" />}
                {theme === 'dark' && <Moon className="w-4 h-4" />}
                {theme === 'system' && <Monitor className="w-4 h-4" />}
              </button>
              <button
                onClick={() =>
                  onNavigate(activeView === 'settings' ? 'dashboard' : 'settings')
                }
                title="Settings"
                aria-label="Settings"
                className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0 ${
                  activeView === 'settings'
                    ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF]'
                    : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={onQuickScan}
                className="px-3 sm:px-4 h-9 sm:h-10 text-xs font-semibold text-white dark:text-[#0D0A12] bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span>Scan</span>
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

      {/* Mobile Bottom Navigation: 5 Clear Thumb-Zone Tabs */}
      {activeView !== 'editor' && (
        <nav
          aria-label="Mobile Bottom Navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 h-16 bg-white/95 dark:bg-[#16111F]/95 backdrop-blur-md border-t border-[#E4DFEC] dark:border-[#261F33] grid grid-cols-5 items-center px-1 z-40"
        >
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'text-[#4A1D5E] dark:text-[#D5B3FF] font-bold bg-[#4A1D5E]/8 dark:bg-[#9D5CE5]/15'
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
