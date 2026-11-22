import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  Search,
  FileText,
  Check,
  X,
  Loader2,
  ExternalLink,
  LogOut,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
} from 'lucide-react';
import { resolveApiUrl } from '../services/capacitorBridge';
import {
  CloudFileEntry,
  GoogleAccountProfile,
  initGoogleDriveAuth,
  googleDriveSignIn,
  googleDriveSignOut,
  isGoogleDriveSignInInProgress,
  getGoogleDriveAccessToken,
  getGoogleDriveAccessTokenSync,
  getCurrentGoogleUser,
  listGoogleDriveFiles,
  downloadGoogleDriveFile,
  uploadFileToGoogleDrive,
  getDropboxAccessToken,
  setDropboxAccessToken,
  getDropboxAccountName,
  fetchDropboxAccountProfile,
  dropboxSignOut,
  listDropboxFiles,
  downloadDropboxFile,
  uploadFileToDropbox,
} from '../services/cloudStorageService';
import { formatBytes } from '../services/storageService';

export interface CloudExportFilePayload {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
}

interface CloudStorageModalProps {
  isOpen: boolean;
  initialMode: 'import' | 'export';
  initialProvider?: 'google-drive' | 'dropbox';
  allowProviderSwitch?: boolean;
  exportPayloads?: CloudExportFilePayload[];
  onClose: () => void;
  onImportFiles: (files: File[]) => Promise<void>;
  onOpenLocalFilePicker?: () => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export const CloudStorageModal: React.FC<CloudStorageModalProps> = ({
  isOpen,
  initialMode,
  initialProvider = 'google-drive',
  allowProviderSwitch = false,
  exportPayloads = [],
  onClose,
  onImportFiles,
  onToast,
}) => {
  const [mode, setMode] = useState<'import' | 'export'>(initialMode);
  const [provider, setProvider] = useState<'google-drive' | 'dropbox'>(
    initialProvider
  );

  // Google Drive Auth State
  const [googleUser, setGoogleUser] = useState<GoogleAccountProfile | null>(
    () => getCurrentGoogleUser()
  );
  const [googleNeedsAuth, setGoogleNeedsAuth] = useState<boolean>(
    () => !getGoogleDriveAccessTokenSync()
  );
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState<boolean>(() =>
    isGoogleDriveSignInInProgress()
  );

  // Dropbox Auth State
  const [dropboxConnected, setDropboxConnected] = useState<boolean>(() =>
    Boolean(getDropboxAccessToken())
  );
  const [dropboxAccountName, setDropboxAccountName] = useState<string | null>(
    () => getDropboxAccountName()
  );
  const [isDropboxConnecting, setIsDropboxConnecting] = useState(false);
  const [dropboxConfigHelp, setDropboxConfigHelp] = useState<{
    redirectUri: string;
    message: string;
  } | null>(null);

  // Cloud File Browser State (Import Mode)
  const [searchQuery, setSearchQuery] = useState('');
  const [cloudFiles, setCloudFiles] = useState<CloudFileEntry[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cloud Export State & Mandatory Confirmation
  const [hasConfirmedExport, setHasConfirmedExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResults, setExportResults] = useState<
    Array<{ name: string; link?: string; pathDisplay?: string }>
  >([]);

  // Initialize Google Drive Auth Listener (syncs with direct onClick sign-in)
  useEffect(() => {
    const unsubscribe = initGoogleDriveAuth(
      (user) => {
        setGoogleUser(user);
        setGoogleNeedsAuth(false);
        setErrorMessage(null);
      },
      () => {
        setGoogleUser(null);
        setGoogleNeedsAuth(true);
      },
      (signingIn) => {
        setIsGoogleSigningIn(signingIn);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen for Dropbox 3P OAuth popup completion via postMessage
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }

      if (
        event.data?.type === 'OAUTH_AUTH_SUCCESS' &&
        event.data?.provider === 'dropbox' &&
        event.data?.accessToken
      ) {
        setDropboxAccessToken(event.data.accessToken);
        setDropboxConnected(true);
        setIsDropboxConnecting(false);
        setDropboxConfigHelp(null);
        setErrorMessage(null);
        const profileName = await fetchDropboxAccountProfile();
        setDropboxAccountName(profileName);
        if (onToast) {
          onToast('Connected to Dropbox!', 'success');
        }
      } else if (
        event.data?.type === 'OAUTH_AUTH_ERROR' &&
        event.data?.provider === 'dropbox'
      ) {
        setIsDropboxConnecting(false);
        setErrorMessage(
          event.data.error || 'Dropbox sign-in was cancelled or failed.'
        );
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onToast]);

  const handleGoogleLogin = useCallback(async () => {
    setIsGoogleSigningIn(true);
    setErrorMessage(null);
    try {
      const result = await googleDriveSignIn();
      if (result) {
        setGoogleUser(result.user);
        setGoogleNeedsAuth(false);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to sign in with Google. Please try again.';
      setErrorMessage(msg);
    } finally {
      setIsGoogleSigningIn(false);
    }
  }, []);

  const handleDropboxConnect = useCallback(async () => {
    setIsDropboxConnecting(true);
    setErrorMessage(null);
    setDropboxConfigHelp(null);
    try {
      const origin = window.location.origin;
      const res = await fetch(
        resolveApiUrl(`/api/dropbox/auth-url?origin=${encodeURIComponent(origin)}`)
      );
      const data = (await res.json()) as {
        configured?: boolean;
        url?: string;
        redirectUri?: string;
        error?: string;
      };

      if (!res.ok || !data.configured || !data.url) {
        setDropboxConfigHelp({
          redirectUri: data.redirectUri || `${origin}/auth/callback`,
          message:
            data.error ||
            'Configure DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET in AI Studio environment variables to connect Dropbox OAuth.',
        });
        setIsDropboxConnecting(false);
        return;
      }

      const popup = window.open(
        data.url,
        'dropbox_oauth_popup',
        'width=600,height=700'
      );
      if (!popup) {
        setErrorMessage(
          'Popup was blocked by your browser. Tap "Sign in with Dropbox" below to open sign-in.'
        );
        setIsDropboxConnecting(false);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to initiate Dropbox authentication.'
      );
      setIsDropboxConnecting(false);
    }
  }, []);

  // Sync state when modal opens (does NOT duplicate signInWithPopup if already triggered on click)
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode(initialMode);
    setProvider(initialProvider);
    setErrorMessage(null);
    setExportResults([]);
    setHasConfirmedExport(false);
    setSelectedFileIds([]);

    if (initialProvider === 'google-drive') {
      const existingToken = getGoogleDriveAccessTokenSync();
      if (existingToken) {
        setGoogleNeedsAuth(false);
        setGoogleUser(getCurrentGoogleUser());
      } else {
        setGoogleNeedsAuth(true);
        setIsGoogleSigningIn(isGoogleDriveSignInInProgress());
      }
    } else {
      const existingDropbox = getDropboxAccessToken();
      setDropboxConnected(Boolean(existingDropbox));
    }
  }, [isOpen, initialMode, initialProvider]);

  const fetchFiles = useCallback(
    async (queryText = '') => {
      setErrorMessage(null);
      if (provider === 'google-drive') {
        const token = await getGoogleDriveAccessToken();
        if (!token) {
          setGoogleNeedsAuth(true);
          return;
        }
        setIsLoadingFiles(true);
        try {
          const files = await listGoogleDriveFiles(queryText);
          setCloudFiles(files);
          setGoogleNeedsAuth(false);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          if (msg === 'AUTH_REQUIRED') {
            setGoogleNeedsAuth(true);
          } else {
            setErrorMessage(msg || 'Failed to load files from Google Drive.');
          }
        } finally {
          setIsLoadingFiles(false);
        }
      } else {
        const token = getDropboxAccessToken();
        if (!token) {
          setDropboxConnected(false);
          return;
        }
        setIsLoadingFiles(true);
        try {
          const files = await listDropboxFiles(queryText);
          setCloudFiles(files);
          setDropboxConnected(true);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          if (msg === 'DROPBOX_AUTH_REQUIRED') {
            setDropboxConnected(false);
          } else {
            setErrorMessage(msg || 'Failed to load files from Dropbox.');
          }
        } finally {
          setIsLoadingFiles(false);
        }
      }
    },
    [provider]
  );

  // Automatically load files when in Import mode and authenticated
  useEffect(() => {
    if (!isOpen || mode !== 'import') return;
    if (provider === 'google-drive' && !googleNeedsAuth) {
      fetchFiles(searchQuery);
    } else if (provider === 'dropbox' && dropboxConnected) {
      fetchFiles(searchQuery);
    } else {
      setCloudFiles([]);
    }
  }, [
    isOpen,
    mode,
    provider,
    googleNeedsAuth,
    dropboxConnected,
    fetchFiles,
    searchQuery,
  ]);

  if (!isOpen) return null;

  const handleGoogleLogout = async () => {
    await googleDriveSignOut();
    setGoogleUser(null);
    setGoogleNeedsAuth(true);
    setCloudFiles([]);
    setSelectedFileIds([]);
  };

  const handleDropboxLogout = () => {
    dropboxSignOut();
    setDropboxConnected(false);
    setDropboxAccountName(null);
    setCloudFiles([]);
    setSelectedFileIds([]);
  };

  const toggleSelectFile = (id: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleImportSelected = async (entriesToImport?: CloudFileEntry[]) => {
    const targets =
      entriesToImport ||
      cloudFiles.filter((f) => selectedFileIds.includes(f.id));
    if (targets.length === 0) return;

    setIsImporting(true);
    setErrorMessage(null);
    try {
      const downloadedFiles: File[] = [];
      for (const entry of targets) {
        const file =
          entry.provider === 'google-drive'
            ? await downloadGoogleDriveFile(entry)
            : await downloadDropboxFile(entry);
        downloadedFiles.push(file);
      }
      await onImportFiles(downloadedFiles);
      if (onToast) {
        onToast(
          `Imported ${downloadedFiles.length} ${
            downloadedFiles.length === 1 ? 'document' : 'documents'
          } from ${provider === 'google-drive' ? 'Google Drive' : 'Dropbox'}!`,
          'success'
        );
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'AUTH_REQUIRED') {
        setGoogleNeedsAuth(true);
      } else if (msg === 'DROPBOX_AUTH_REQUIRED') {
        setDropboxConnected(false);
      } else {
        setErrorMessage(
          msg || 'Failed to import selected file(s) from cloud.'
        );
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmedCloudExport = async () => {
    if (exportPayloads.length === 0) return;
    setIsExporting(true);
    setErrorMessage(null);
    try {
      const results: Array<{
        name: string;
        link?: string;
        pathDisplay?: string;
      }> = [];

      for (const item of exportPayloads) {
        if (provider === 'google-drive') {
          const uploaded = await uploadFileToGoogleDrive(
            item.name,
            item.bytes,
            item.mimeType || 'application/pdf'
          );
          results.push({
            name: uploaded.name,
            link: uploaded.webViewLink,
          });
        } else {
          const uploaded = await uploadFileToDropbox(item.name, item.bytes);
          results.push({
            name: uploaded.name,
            pathDisplay: uploaded.pathDisplay,
          });
        }
      }

      setExportResults(results);
      if (onToast) {
        onToast(
          `Uploaded ${results.length} ${
            results.length === 1 ? 'document' : 'documents'
          } to ${provider === 'google-drive' ? 'Google Drive' : 'Dropbox'}!`,
          'success'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'AUTH_REQUIRED') {
        setGoogleNeedsAuth(true);
      } else if (msg === 'DROPBOX_AUTH_REQUIRED') {
        setDropboxConnected(false);
      } else {
        setErrorMessage(
          msg || 'Failed to upload document(s) to cloud storage.'
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  const isCurrentProviderAuthed =
    provider === 'google-drive' ? !googleNeedsAuth : dropboxConnected;
  const providerLabel =
    provider === 'google-drive' ? 'Google Drive' : 'Dropbox';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-storage-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] text-[#14101B] dark:text-[#F4F1F8]"
      >
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0088FF]/10 text-[#0088FF] flex items-center justify-center shrink-0">
              {mode === 'import' ? (
                <CloudDownload className="w-5 h-5" />
              ) : (
                <CloudUpload className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="cloud-storage-modal-title"
                className="text-base font-bold truncate"
              >
                {mode === 'import'
                  ? `Import from ${providerLabel}`
                  : `Export to ${providerLabel}`}
              </h2>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
                {provider === 'google-drive' && !googleNeedsAuth
                  ? `Signed in as ${googleUser?.email || googleUser?.displayName || 'Google Account'}`
                  : provider === 'dropbox' && dropboxConnected
                    ? `Connected to ${dropboxAccountName || 'Dropbox'}`
                    : `Sign in to your ${provider === 'google-drive' ? 'Google Account' : 'Dropbox Account'} to continue`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {provider === 'google-drive' && !googleNeedsAuth && (
              <button
                type="button"
                onClick={handleGoogleLogout}
                title="Sign out of Google Account"
                className="p-2 rounded-lg text-[#6E667D] hover:text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
            {provider === 'dropbox' && dropboxConnected && (
              <button
                type="button"
                onClick={handleDropboxLogout}
                title="Disconnect Dropbox"
                className="p-2 rounded-lg text-[#6E667D] hover:text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6E667D] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
              aria-label="Close cloud modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Optional Provider Switcher */}
        {allowProviderSwitch && (
          <div className="px-5 py-2.5 bg-[#FAF9FB] dark:bg-[#110D18] border-b border-[#E4DFEC] dark:border-[#261F33] flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setProvider('google-drive');
                setErrorMessage(null);
                setHasConfirmedExport(false);
                setExportResults([]);
                if (!getGoogleDriveAccessTokenSync()) {
                  void handleGoogleLogin();
                }
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                provider === 'google-drive'
                  ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                  : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#5A5565] dark:text-[#A39BB5]'
              }`}
            >
              <Cloud className="w-4 h-4 text-[#4285F4]" />
              <span>Google Drive</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setProvider('dropbox');
                setErrorMessage(null);
                setHasConfirmedExport(false);
                setExportResults([]);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                provider === 'dropbox'
                  ? 'bg-[#0061FF] text-white'
                  : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#5A5565] dark:text-[#A39BB5]'
              }`}
            >
              <Cloud className="w-4 h-4 text-[#0061FF] dark:text-[#60A5FA]" />
              <span>Dropbox</span>
            </button>
          </div>
        )}

        {/* Main Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/30 text-[#DC2626] dark:text-[#F87171] text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{errorMessage}</span>
            </div>
          )}

          {/* 1. DIRECT GOOGLE ACCOUNT / DROPBOX SIGN-IN STATE */}
          {!isCurrentProviderAuthed ? (
            <div className="py-8 px-4 rounded-2xl bg-[#FAF9FB] dark:bg-[#110D18] border border-[#E4DFEC] dark:border-[#261F33] text-center space-y-4">
              {provider === 'google-drive' ? (
                <>
                  {isGoogleSigningIn ? (
                    <div className="py-3 space-y-3">
                      <Loader2 className="w-8 h-8 animate-spin text-[#4285F4] mx-auto" />
                      <div className="space-y-1 max-w-sm mx-auto">
                        <h3 className="text-sm font-bold">
                          Signing in to your Google Account...
                        </h3>
                        <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                          Select your Google Account in the sign-in window to{' '}
                          {mode === 'import'
                            ? 'browse and import your Google Drive files'
                            : 'save your document to Google Drive'}
                          .
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-w-sm mx-auto">
                      <h3 className="text-sm font-bold">
                        Sign in with your Google Account
                      </h3>
                      <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                        Sign in to your Google Account to{' '}
                        {mode === 'import'
                          ? 'access and import your PDFs, Excel spreadsheets, Word docs, eBooks, and HTML files from Google Drive'
                          : 'upload your document directly to your Google Drive'}
                        .
                      </p>
                    </div>
                  )}

                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={isGoogleSigningIn}
                      className="gsi-material-button inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-white dark:bg-[#1E172B] border border-neutral-300 dark:border-[#342A45] shadow-xs hover:shadow-md text-xs sm:text-sm font-semibold text-[#1f1f1f] dark:text-white cursor-pointer disabled:opacity-60 transition-all"
                    >
                      <div className="gsi-material-button-icon w-4 h-4 shrink-0">
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          className="w-4 h-4 block"
                        >
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                          <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        {isGoogleSigningIn
                          ? 'Waiting for Google Sign-In...'
                          : 'Sign in with Google'}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {isDropboxConnecting ? (
                    <div className="py-4 space-y-3">
                      <Loader2 className="w-7 h-7 animate-spin text-[#0061FF] mx-auto" />
                      <p className="text-xs font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                        Completing Dropbox Sign-In in popup window...
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1 max-w-sm mx-auto">
                      <h3 className="text-sm font-bold">Sign in to Dropbox</h3>
                      <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                        Sign in with your Dropbox account to{' '}
                        {mode === 'import'
                          ? 'browse and import your PDFs, Excel, and Word documents'
                          : 'upload your document directly to Dropbox'}
                        .
                      </p>
                    </div>
                  )}

                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={handleDropboxConnect}
                      disabled={isDropboxConnecting}
                      className="px-5 py-2.5 rounded-full bg-[#0061FF] hover:bg-[#0051D5] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-60"
                    >
                      {isDropboxConnecting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Cloud className="w-4 h-4" />
                      )}
                      <span>
                        {isDropboxConnecting
                          ? 'Signing in to Dropbox...'
                          : 'Sign in with Dropbox'}
                      </span>
                    </button>
                  </div>

                  {dropboxConfigHelp && (
                    <div className="mt-4 p-3.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-left text-xs space-y-2">
                      <p className="font-bold text-[#14101B] dark:text-[#F4F1F8]">
                        Dropbox OAuth Setup Instructions:
                      </p>
                      <p className="text-[#6E667D] dark:text-[#A39BB5]">
                        1. Open the{' '}
                        <a
                          href="https://www.dropbox.com/developers/apps"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0061FF] underline"
                        >
                          Dropbox App Console
                        </a>{' '}
                        and add this Redirect URI:
                      </p>
                      <code className="block p-2 rounded bg-[#FAF9FB] dark:bg-[#110D18] border border-[#E4DFEC] dark:border-[#261F33] font-mono text-[11px] break-all select-all">
                        {dropboxConfigHelp.redirectUri}
                      </code>
                      <p className="text-[#6E667D] dark:text-[#A39BB5]">
                        2. Set <code>DROPBOX_CLIENT_ID</code> and{' '}
                        <code>DROPBOX_CLIENT_SECRET</code> in your AI Studio
                        environment variables.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : mode === 'import' ? (
            /* 2. CLOUD IMPORT FILE BROWSER */
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-[#6E667D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search PDFs, Excel, Word & eBooks in ${providerLabel}...`}
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-[#FAF9FB] dark:bg-[#110D18] border border-[#E4DFEC] dark:border-[#261F33] focus:outline-none focus:border-[#4A1D5E]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => fetchFiles(searchQuery)}
                  disabled={isLoadingFiles}
                  title="Refresh cloud files"
                  className="p-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>

              {isLoadingFiles ? (
                <div className="py-10 text-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4A1D5E] dark:text-[#D5B3FF] mx-auto" />
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    Loading your documents from {providerLabel}...
                  </p>
                </div>
              ) : cloudFiles.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <FolderOpen className="w-7 h-7 text-[#6E667D] mx-auto" />
                  <p className="text-xs font-semibold">
                    No matching PDF, Excel, Word, or eBook files found.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[52dvh] overflow-y-auto pr-1">
                  {cloudFiles.map((file) => {
                    const isSelected = selectedFileIds.includes(file.id);
                    return (
                      <div
                        key={file.id}
                        onClick={() => toggleSelectFile(file.id)}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#0088FF]/10 border-[#0088FF]'
                            : 'bg-[#FAF9FB] dark:bg-[#110D18] border-[#E4DFEC] dark:border-[#261F33] hover:border-[#0088FF]/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div
                            className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-[#0088FF] text-white'
                                : 'border border-neutral-400 dark:border-neutral-600 bg-white dark:bg-[#16111F]'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                          </div>
                          <FileText className="w-4 h-4 text-[#0088FF] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-[#6E667D] dark:text-[#A39BB5]">
                              {file.sizeBytes
                                ? formatBytes(file.sizeBytes)
                                : file.mimeType.includes('spreadsheet')
                                  ? 'Google Sheet (.XLSX)'
                                  : 'Google Doc'}{' '}
                              {file.modifiedTime
                                ? `• ${new Date(
                                    file.modifiedTime
                                  ).toLocaleDateString()}`
                                : ''}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isImporting}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleImportSelected([file]);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-[11px] font-bold shrink-0 cursor-pointer hover:opacity-90 disabled:opacity-50"
                        >
                          Import
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* 3. CLOUD EXPORT WITH MANDATORY USER CONFIRMATION */
            <div className="space-y-4">
              {exportResults.length > 0 ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>
                      Successfully uploaded {exportResults.length}{' '}
                      {exportResults.length === 1 ? 'document' : 'documents'} to{' '}
                      {providerLabel}!
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {exportResults.map((res, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold truncate">
                          {res.name}
                        </span>
                        {res.link ? (
                          <a
                            href={res.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[#0088FF] font-bold hover:underline shrink-0"
                          >
                            <span>Open in Drive</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] font-mono">
                            {res.pathDisplay}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-3.5 rounded-xl bg-[#FAF9FB] dark:bg-[#110D18] border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
                    <p className="text-xs font-bold">
                      {exportPayloads.length === 1
                        ? 'Document to Upload:'
                        : `Documents to Upload (${exportPayloads.length}):`}
                    </p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {exportPayloads.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-[#0088FF] shrink-0" />
                            <span className="font-semibold truncate">
                              {item.name}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] shrink-0 ml-2">
                            {formatBytes(item.bytes.byteLength)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Mandatory Confirmation Box before writing to user's Cloud Storage */}
                  {!hasConfirmedExport ? (
                    <div className="p-4 rounded-xl bg-[#0088FF]/8 border border-[#0088FF]/25 space-y-3">
                      <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                        Confirm Upload to {providerLabel}
                      </p>
                      <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                        Are you sure you want to upload{' '}
                        <strong>
                          {exportPayloads.length === 1
                            ? `"${exportPayloads[0].name}"`
                            : `${exportPayloads.length} PDF files`}
                        </strong>{' '}
                        to your {providerLabel} account
                        {provider === 'dropbox' ? ' (in /ElimikaPDF/)' : ''}?
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={onClose}
                          className="px-3.5 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHasConfirmedExport(true);
                            handleConfirmedCloudExport();
                          }}
                          disabled={isExporting}
                          className="px-4 py-2 rounded-xl bg-[#0088FF] hover:bg-[#0077E6] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <CloudUpload className="w-4 h-4" />
                          <span>Confirm &amp; Upload to {providerLabel}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    isExporting && (
                      <div className="py-6 text-center space-y-2">
                        <Loader2 className="w-6 h-6 animate-spin text-[#0088FF] mx-auto" />
                        <p className="text-xs font-semibold">
                          Uploading to {providerLabel}...
                        </p>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#FAF9FB] dark:bg-[#110D18] border-t border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-2 shrink-0">
          {mode === 'import' && isCurrentProviderAuthed ? (
            <>
              <span className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                {selectedFileIds.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectedFileIds.length === 0 || isImporting}
                  onClick={() => handleImportSelected()}
                  className="px-4 py-2 rounded-xl bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Importing...</span>
                    </>
                  ) : (
                    <>
                      <CloudDownload className="w-3.5 h-3.5" />
                      <span>
                        Import Selected ({selectedFileIds.length || 0})
                      </span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
