import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export type RuntimePlatform = 'android' | 'ios' | 'web';

export interface NativeOpenWithResult {
  hasFile: boolean;
  base64?: string;
  filename?: string;
  mimeType?: string;
  error?: string;
}

interface ElimikaOpenWithPluginInterface {
  consumePendingFile(): Promise<NativeOpenWithResult>;
}

const ElimikaOpenWith =
  registerPlugin<ElimikaOpenWithPluginInterface>('ElimikaOpenWith');

/**
 * Checks the native Android Capacitor plugin (`ElimikaOpenWith`) for a pending file
 * launched via Android's "Open with ElimikaPDF" (ACTION_VIEW) or "Share to ElimikaPDF" (ACTION_SEND).
 */
export async function consumeNativeAndroidOpenWithFile(): Promise<NativeOpenWithResult | null> {
  if (!isNativeApp() || getRuntimePlatform() !== 'android') return null;
  try {
    return await ElimikaOpenWith.consumePendingFile();
  } catch {
    return null;
  }
}

/**
 * Returns true when ElimikaPDF is running inside a native Capacitor Android or iOS shell.
 * Returns false when running as a normal website or installed PWA in a browser.
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Returns the active runtime platform: 'android' | 'ios' | 'web'.
 */
export function getRuntimePlatform(): RuntimePlatform {
  try {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
    return 'web';
  } catch {
    return 'web';
  }
}

/**
 * Resolves relative `/api/...` paths so they work seamlessly on both:
 * - Website / PWA (same-origin relative path)
 * - Capacitor Native App (prefixed with VITE_API_BASE_URL when configured)
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!isNativeApp()) return normalizedPath;

  const configuredBase = (
    (import.meta.env?.VITE_API_BASE_URL as string | undefined) || ''
  )
    .trim()
    .replace(/\/+$/, '');
  if (!configuredBase) return normalizedPath;
  return `${configuredBase}${normalizedPath}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Triggers subtle native haptic feedback on Android/iOS. Silent no-op on Web.
 */
export async function triggerHaptic(
  kind: 'light' | 'medium' | 'success' | 'error' = 'light'
): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (kind === 'success') {
      await Haptics.notification({ type: NotificationType.Success });
    } else if (kind === 'error') {
      await Haptics.notification({ type: NotificationType.Error });
    } else if (kind === 'medium') {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } else {
      await Haptics.impact({ style: ImpactStyle.Light });
    }
  } catch {
    // Ignore on unsupported devices
  }
}

/**
 * Synchronizes the native Android/iOS status bar with ElimikaPDF's Light / Dark theme.
 */
export async function syncNativeStatusBarTheme(isDark: boolean): Promise<void> {
  if (!isNativeApp()) return;
  try {
    // In Capacitor StatusBar:
    // Style.Dark = dark background with light icons/text
    // Style.Light = light background with dark icons/text
    await StatusBar.setStyle({
      style: isDark ? Style.Dark : Style.Light,
    });
    if (getRuntimePlatform() === 'android') {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setBackgroundColor({
        color: isDark ? '#16111F' : '#FFFFFF',
      });
    }
  } catch {
    // StatusBar plugin unavailable
  }
}

export interface CapacitorInitCallbacks {
  onBackButton?: () => boolean; // Return true if handled in-app, false to minimize/exit
  onDeepLinkUrl?: (url: string) => void;
  onAppResume?: () => void;
}

/**
 * Bootstraps native Capacitor runtime hooks (platform CSS classes, SplashScreen handoff,
 * hardware Back button, app resume, and deep links). Safe no-op when running on Web.
 */
export function initCapacitorRuntime(
  callbacks: CapacitorInitCallbacks = {}
): () => void {
  if (typeof document === 'undefined' || !isNativeApp()) {
    return () => {};
  }

  const platform = getRuntimePlatform();
  document.documentElement.classList.add(
    'capacitor-native',
    `capacitor-${platform}`
  );

  // Hide native splash screen once the React UI is mounted
  SplashScreen.hide().catch(() => {});

  const removers: Array<Promise<{ remove: () => Promise<void> }>> = [];

  if (callbacks.onBackButton) {
    const backListener = CapacitorApp.addListener(
      'backButton',
      ({ canGoBack }) => {
        const handled = callbacks.onBackButton?.() ?? false;
        if (handled) return;
        if (canGoBack) {
          window.history.back();
        } else if (platform === 'android') {
          CapacitorApp.minimizeApp().catch(() => {
            CapacitorApp.exitApp().catch(() => {});
          });
        }
      }
    );
    removers.push(backListener);
  }

  if (callbacks.onAppResume) {
    const stateListener = CapacitorApp.addListener(
      'appStateChange',
      ({ isActive }) => {
        if (isActive) {
          callbacks.onAppResume?.();
        }
      }
    );
    const resumeListener = CapacitorApp.addListener('resume', () => {
      callbacks.onAppResume?.();
    });
    removers.push(stateListener, resumeListener);
  }

  if (callbacks.onDeepLinkUrl) {
    const urlListener = CapacitorApp.addListener('appUrlOpen', (event) => {
      if (event?.url) {
        callbacks.onDeepLinkUrl?.(event.url);
      }
    });
    removers.push(urlListener);

    // Check cold-start launch URL
    CapacitorApp.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) {
          callbacks.onDeepLinkUrl?.(launch.url);
        }
      })
      .catch(() => {});
  }

  return () => {
    for (const p of removers) {
      p.then((handle) => handle.remove()).catch(() => {});
    }
  };
}

/**
 * Saves binary document bytes (PDF, DOCX, XLSX, PNG, JPEG, TXT, JSON) on Capacitor Native
 * using `@capacitor/filesystem` (Documents/ElimikaPDF/<filename>), falling back to Cache + Share sheet
 * if scoped storage restricts direct Documents writes.
 * Returns true if handled natively, false if caller should execute standard Web browser download.
 */
export async function saveFileNativelyIfCapacitor(
  bytes: Uint8Array,
  filename: string
): Promise<boolean> {
  if (!isNativeApp()) return false;

  const base64Data = uint8ArrayToBase64(bytes);
  const safeFile = filename.replace(/[\\/:*?"<>|]+/g, '_');

  try {
    await Filesystem.writeFile({
      path: `ElimikaPDF/${safeFile}`,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true,
    });
    await triggerHaptic('success');

    // Also offer quick OS share/open sheet on iOS where Documents isn't always directly browsable without Files app
    if (getRuntimePlatform() === 'ios') {
      const uriRes = await Filesystem.getUri({
        path: `ElimikaPDF/${safeFile}`,
        directory: Directory.Documents,
      });
      if (uriRes?.uri) {
        await Share.share({
          title: safeFile,
          url: uriRes.uri,
          files: [uriRes.uri],
          dialogTitle: `Save or Share ${safeFile}`,
        }).catch(() => {});
      }
    }
    return true;
  } catch {
    // Scoped storage fallback: write to Cache and invoke native OS Share / Save-to-Files sheet
    try {
      const cachePath = `exports/${Date.now()}_${safeFile}`;
      await Filesystem.writeFile({
        path: cachePath,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      const uriRes = await Filesystem.getUri({
        path: cachePath,
        directory: Directory.Cache,
      });
      if (uriRes?.uri) {
        await Share.share({
          title: safeFile,
          url: uriRes.uri,
          files: [uriRes.uri],
          dialogTitle: `Save or Share ${safeFile}`,
        });
        await triggerHaptic('success');
        return true;
      }
    } catch {
      // Fall back to standard browser download
    }
  }
  return false;
}

/**
 * Shares a generated document (PDF, DOCX, image) via the native Android/iOS Share Sheet
 * using `@capacitor/filesystem` + `@capacitor/share`.
 * Returns true if handled natively, false if caller should use Web Share API / download.
 */
export async function shareFileNativelyIfCapacitor(
  bytes: Uint8Array,
  filename: string
): Promise<boolean> {
  if (!isNativeApp()) return false;

  const base64Data = uint8ArrayToBase64(bytes);
  const safeFile = filename.replace(/[\\/:*?"<>|]+/g, '_');
  const cachePath = `shared/${Date.now()}_${safeFile}`;

  try {
    await Filesystem.writeFile({
      path: cachePath,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    const uriRes = await Filesystem.getUri({
      path: cachePath,
      directory: Directory.Cache,
    });
    if (uriRes?.uri) {
      await Share.share({
        title: safeFile,
        url: uriRes.uri,
        files: [uriRes.uri],
        dialogTitle: `Share ${safeFile}`,
      });
      await triggerHaptic('light');
      return true;
    }
  } catch (err) {
    // Treat user cancellation as handled
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('cancel') || msg.includes('abort')) {
      return true;
    }
  }
  return false;
}

/**
 * Captures a high-resolution document photo via `@capacitor/camera` when running on native Android/iOS.
 * Returns a data URL (e.g., `data:image/jpeg;base64,...`) or null if cancelled/unavailable.
 */
export async function capturePhotoWithNativeCamera(
  source: 'camera' | 'photos' = 'camera'
): Promise<string | null> {
  if (!isNativeApp()) return null;

  try {
    const photo = await Camera.getPhoto({
      quality: 95,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: source === 'photos' ? CameraSource.Photos : CameraSource.Camera,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (photo.dataUrl) {
      await triggerHaptic('medium');
      return photo.dataUrl;
    }
  } catch {
    // User cancelled or camera permission denied
  }
  return null;
}
