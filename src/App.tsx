import { useState, useEffect, useCallback } from 'react';
import {
  ActiveView,
  AppPreferences,
  DocumentCategory,
  DocumentFolder,
  StoredDocument,
  ThemeMode,
  ToolId,
} from './types/document';
import {
  storageService,
  loadPreferences,
  savePreferences,
  seedInitialDocumentsIfEmpty,
} from './services/storageService';
import {
  getPdfPageCount,
  downloadBytesAsFile,
  createPdfFromImages,
  mergePdfs,
  compressPdfDocument,
  removeWatermarksFromPdf,
} from './services/pdfService';
import { formatBytes } from './services/storageService';
import {
  parseUploadedWordFile,
  generatePdfFromWordBlocks,
} from './services/wordConversionService';
import { Layout } from './components/Layout';
import { DashboardView } from './components/DashboardView';
import { ScannerView } from './components/ScannerView';
import { PdfEditorView } from './components/PdfEditorView';
import { PdfToolsView } from './components/PdfToolsView';
import { DocumentsLibraryView } from './components/DocumentsLibraryView';
import {
  SettingsView,
  HelpAndSupportView,
  PrivacyPolicyView,
} from './components/SettingsAndHelpView';
import {
  AlertTriangle,
  X,
  Eye,
  FileEdit,
  FileOutput,
  FileText,
  ScanText,
  Scissors,
} from 'lucide-react';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname.toLowerCase();
      const s = window.location.search.toLowerCase();
      const h = window.location.hash.toLowerCase();
      if (p.includes('privacy') || s.includes('privacy') || h.includes('privacy')) {
        return 'privacy';
      }
    }
    return 'dashboard';
  });
  const [activeTool, setActiveTool] = useState<ToolId>('merge-pdf');
  const [preferences, setPreferences] = useState<AppPreferences>(() =>
    loadPreferences()
  );

  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [activeDocument, setActiveDocument] = useState<StoredDocument | null>(
    null
  );
  const [editorReaderMode, setEditorReaderMode] = useState(false);

  // Imported images routed from Dashboard to Scanner
  const [scannerImportedFiles, setScannerImportedFiles] = useState<
    FileList | File[] | null
  >(null);

  // Delete confirmation modal state (single or multiple selected documents)
  const [docPendingDelete, setDocPendingDelete] =
    useState<StoredDocument | null>(null);
  const [docsPendingBatchDelete, setDocsPendingBatchDelete] = useState<
    StoredDocument[] | null
  >(null);
  const [initialMergeDocIds, setInitialMergeDocIds] = useState<
    string[] | undefined
  >(undefined);

  // "Open PDF With ElimikaPDF..." chooser modal state
  const [openWithPromptDoc, setOpenWithPromptDoc] =
    useState<StoredDocument | null>(null);

  // Loading state when opening an incoming PDF from Android "Open with" menu
  const [externalPdfLoadingLabel, setExternalPdfLoadingLabel] = useState<
    string | null
  >(null);

  // Global toast / error notification
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      setToast({ message, type });
      setTimeout(() => {
        setToast((prev) => (prev?.message === message ? null : prev));
      }, 4000);
    },
    []
  );

  // Apply Light / Dark / System Theme to <html>
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (mode: ThemeMode) => {
      if (mode === 'dark') {
        root.classList.add('dark');
      } else if (mode === 'light') {
        root.classList.remove('dark');
      } else {
        const prefersDark = window.matchMedia(
          '(prefers-color-scheme: dark)'
        ).matches;
        root.classList.toggle('dark', prefersDark);
      }
    };

    applyTheme(preferences.theme);

    if (preferences.theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme('system');
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
  }, [preferences.theme]);

  // Prevent browser-level viewport zoom (Ctrl+Wheel or multi-touch pinch on non-PDF UI) so the app shell stays 100% locked
  useEffect(() => {
    const preventBrowserWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    const preventSafariGestureZoom = (e: Event) => {
      e.preventDefault();
    };
    const preventMultiTouchAppZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('[data-pdf-zoom-stage="true"]')) {
          e.preventDefault();
        }
      }
    };

    window.addEventListener('wheel', preventBrowserWheelZoom, { passive: false });
    window.addEventListener('gesturestart', preventSafariGestureZoom, {
      passive: false,
    });
    window.addEventListener('gesturechange', preventSafariGestureZoom, {
      passive: false,
    });
    document.addEventListener('touchmove', preventMultiTouchAppZoom, {
      passive: false,
    });

    return () => {
      window.removeEventListener('wheel', preventBrowserWheelZoom);
      window.removeEventListener('gesturestart', preventSafariGestureZoom);
      window.removeEventListener('gesturechange', preventSafariGestureZoom);
      document.removeEventListener('touchmove', preventMultiTouchAppZoom);
    };
  }, []);

  const refreshVault = useCallback(async () => {
    const docs = await storageService.getAllDocuments();
    const flds = await storageService.getFolders();
    setDocuments(docs);
    setFolders(flds);
    setActiveDocument((prev) => {
      if (!prev) return docs[0] || null;
      const freshMatch = docs.find((d) => d.id === prev.id);
      return freshMatch || prev;
    });
  }, []);

  useEffect(() => {
    const init = async () => {
      await seedInitialDocumentsIfEmpty();
      await refreshVault();
    };
    init();
  }, [refreshVault]);

  // Synchronize activeView with browser history so mobile hardware '<' Back button returns to Home/Dashboard with saved documents intact
  const navigateToView = useCallback((nextView: ActiveView) => {
    setActiveView((prev) => {
      if (prev !== nextView) {
        try {
          window.history.pushState({ view: nextView }, '', `#${nextView}`);
        } catch {
          // Ignore in restricted iframe contexts
        }
      }
      return nextView;
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const viewParam = params.get('view');
    const pathLower = window.location.pathname.toLowerCase();
    const hashLower = window.location.hash.toLowerCase();

    let initialView: ActiveView = 'dashboard';
    if (
      pathLower.includes('privacy') ||
      viewParam === 'privacy' ||
      params.has('privacy') ||
      hashLower.includes('privacy')
    ) {
      initialView = 'privacy';
      setActiveView('privacy');
    } else if (action === 'scan') {
      initialView = 'scanner';
      setActiveView('scanner');
    } else if (action === 'pdf-reader') {
      initialView = 'editor';
      setEditorReaderMode(true);
      setActiveView('editor');
    } else if (action === 'pdf-editor') {
      initialView = 'editor';
      setEditorReaderMode(false);
      setActiveView('editor');
    } else if (action === 'pdf-tools') {
      initialView = 'tools';
      setActiveTool('word-to-pdf');
      setActiveView('tools');
    }

    try {
      window.history.replaceState({ view: initialView }, '', `#${initialView}`);
    } catch {
      // Ignore in restricted iframe contexts
    }
    const onPopState = (e: PopStateEvent) => {
      if (window.location.hash.toLowerCase().includes('privacy')) {
        setActiveView('privacy');
        return;
      }
      const targetView = (e.state?.view as ActiveView) || 'dashboard';
      setActiveView(targetView);
      refreshVault();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [refreshVault]);

  const handleUpdatePreferences = (next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

  const handleUploadPdfFiles = async (
    files: FileList | File[],
    openInEditorAfter = true,
    openInReaderMode?: boolean
  ) => {
    const fileArray = Array.from(files);
    let lastAdded: StoredDocument | null = null;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      if (file.size === 0) {
        showToast(
          `Cannot open "${file.name}": The selected file is empty (0 bytes).`,
          'error'
        );
        continue;
      }
      if (file.size > 500 * 1024 * 1024) {
        showToast(
          `Skipped "${file.name}": File exceeds 500 MB local storage limit.`,
          'error'
        );
        continue;
      }

      const lower = file.name.toLowerCase();
      const mime = (file.type || '').toLowerCase();

      try {
        const buf = await file.arrayBuffer();
        const rawBytes = new Uint8Array(buf);

        // Check if file is a PDF (by %PDF- magic header, extension, or MIME)
        const isPdfMagic =
          rawBytes.length >= 5 &&
          rawBytes[0] === 0x25 && // %
          rawBytes[1] === 0x50 && // P
          rawBytes[2] === 0x44 && // D
          rawBytes[3] === 0x46; // F

        const isPdf =
          mime === 'application/pdf' || lower.endsWith('.pdf') || isPdfMagic;

        const isImage =
          !isPdfMagic &&
          (mime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lower));

        const isWordOrText =
          !isPdf &&
          !isImage &&
          (/\.(docx?|rtf|txt|md|csv|odt)$/i.test(lower) ||
            mime.includes('word') ||
            mime.includes('officedocument') ||
            mime.includes('rtf') ||
            mime.startsWith('text/'));

        if (isPdf) {
          if (!isPdfMagic) {
            showToast(
              `Cannot open "${file.name}": File does not have a valid PDF header (%PDF-) or is corrupted.`,
              'error'
            );
            continue;
          }
          const pageCount = await getPdfPageCount(rawBytes);
          if (!pageCount || pageCount < 1) {
            showToast(
              `Cannot open "${file.name}": PDF contains 0 readable pages or is corrupted.`,
              'error'
            );
            continue;
          }
          const newDoc: StoredDocument = {
            id: `doc-upload-${Date.now()}-${i}`,
            name: file.name.toLowerCase().endsWith('.pdf')
              ? file.name
              : `${file.name}.pdf`,
            category: 'Other',
            starred: false,
            sizeBytes: rawBytes.byteLength,
            pageCount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            pdfData: rawBytes,
          };
          await storageService.saveDocument(newDoc);
          lastAdded = newDoc;
        } else if (isImage) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Image read error'));
            reader.readAsDataURL(file);
          });
          const pdfBytes = await createPdfFromImages([dataUrl], {
            pageSize: 'A4',
            marginPt: 18,
          });
          const pageCount = await getPdfPageCount(pdfBytes);
          const cleanName = file.name.replace(/\.[^.]+$/, '') + '.pdf';
          const newDoc: StoredDocument = {
            id: `doc-img-${Date.now()}-${i}`,
            name: cleanName,
            category: 'Scans',
            starred: false,
            sizeBytes: pdfBytes.byteLength,
            pageCount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            pdfData: pdfBytes,
          };
          await storageService.saveDocument(newDoc);
          lastAdded = newDoc;
        } else if (isWordOrText) {
          const parsed = await parseUploadedWordFile(file);
          const { pdfBytes, pageCount } = await generatePdfFromWordBlocks(
            parsed.blocks,
            {
              pageSize: 'A4',
              fontFamily: 'helvetica',
              baseFontSize: 11,
              lineSpacing: 1.35,
              addPageNumbers: true,
            }
          );
          const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'Document';
          const newDoc: StoredDocument = {
            id: `doc-word-${Date.now()}-${i}`,
            name: `${baseTitle}.pdf`,
            category: 'Reports',
            starred: false,
            sizeBytes: pdfBytes.byteLength,
            pageCount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            pdfData: pdfBytes,
            ocrText: parsed.plainText,
          };
          await storageService.saveDocument(newDoc);
          lastAdded = newDoc;
        } else {
          showToast(
            `Unsupported file "${file.name}": Please select a valid PDF document (.pdf).`,
            'error'
          );
        }
      } catch {
        showToast(
          `Failed to open "${file.name}". The PDF file appears corrupted, password-locked, or unsupported.`,
          'error'
        );
      }
    }

    if (lastAdded) {
      await refreshVault();
      setActiveDocument(lastAdded);
      if (openInReaderMode === true) {
        setEditorReaderMode(true);
        navigateToView('editor');
        showToast(
          `Opened "${lastAdded.name}" in ElimikaPDF Reader (${lastAdded.pageCount} ${lastAdded.pageCount === 1 ? 'page' : 'pages'}).`
        );
      } else if (openInEditorAfter) {
        setEditorReaderMode(false);
        navigateToView('editor');
        showToast(
          `Opened "${lastAdded.name}" (${lastAdded.pageCount} ${lastAdded.pageCount === 1 ? 'page' : 'pages'}).`
        );
      } else {
        showToast(
          `Added "${lastAdded.name}" (${lastAdded.pageCount} ${lastAdded.pageCount === 1 ? 'page' : 'pages'}).`
        );
      }
    }
  };

  // Handle PDF files opened from Android "Open with" menu (cold-start & already-running warm-start),
  // OS File Handlers (window.launchQueue), or Web Share Target
  useEffect(() => {
    const openExternalPdfDirectlyInReader = async (
      incomingFiles: File[],
      sourceLabel = 'Android File Manager'
    ) => {
      if (!incomingFiles || incomingFiles.length === 0) return;
      const firstFile = incomingFiles[0];
      setExternalPdfLoadingLabel(
        `Opening "${firstFile.name}" from ${sourceLabel}...`
      );
      try {
        // Automatically open directly in ElimikaPDF Reader (openInReaderMode = true) without asking user to browse again
        await handleUploadPdfFiles(incomingFiles, true, true);
      } finally {
        setExternalPdfLoadingLabel(null);
      }
    };

    const decodeBase64PdfAndOpen = async (
      base64Data: string,
      filename = 'Android_Document.pdf'
    ) => {
      if (!base64Data) return;
      setExternalPdfLoadingLabel(`Opening "${filename}" in ElimikaPDF Reader...`);
      try {
        const cleanBase64 = base64Data.includes(',')
          ? base64Data.split(',')[1]
          : base64Data.trim();
        const binaryStr = atob(cleanBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const safeName = filename.toLowerCase().endsWith('.pdf')
          ? filename
          : `${filename}.pdf`;
        const file = new File([bytes], safeName, { type: 'application/pdf' });
        await openExternalPdfDirectlyInReader([file], 'Android Open With');
      } catch {
        setExternalPdfLoadingLabel(null);
        showToast(
          `Could not read "${filename}" from Android URI. The file may be corrupted or unreadable.`,
          'error'
        );
      }
    };

    const fetchAndroidOpenIdAndOpen = async (
      openId: string,
      fallbackName = 'Android_Document.pdf',
      broadcastToExisting = true
    ) => {
      if (!openId) return;
      setExternalPdfLoadingLabel(
        `Loading "${fallbackName}" into ElimikaPDF Reader...`
      );
      try {
        // Notify any already-running ElimikaPDF client window via BroadcastChannel
        if (broadcastToExisting && 'BroadcastChannel' in window) {
          try {
            const bc = new BroadcastChannel('elimikapdf-open-pdf');
            bc.postMessage({
              type: 'ANDROID_OPEN_PDF_ID',
              openId,
              filename: fallbackName,
            });
            bc.close();
          } catch {
            // Ignore BroadcastChannel errors
          }
        }

        const res = await fetch(
          `/api/android-open-pdf/${encodeURIComponent(openId)}`
        );
        if (!res.ok) {
          let errMsg = `Failed to load "${fallbackName}" (status ${res.status}).`;
          try {
            const errJson = await res.json();
            if (errJson?.error) errMsg = errJson.error;
          } catch {
            // Ignore JSON parse error
          }
          showToast(errMsg, 'error');
          return;
        }
        const headerName = res.headers.get('X-Android-Pdf-Filename');
        const finalName = headerName
          ? decodeURIComponent(headerName)
          : fallbackName;
        const blob = await res.blob();
        const file = new File([blob], finalName, { type: 'application/pdf' });
        await openExternalPdfDirectlyInReader([file], 'Android Open With');
      } catch {
        showToast(
          `Could not open "${fallbackName}". Please verify the PDF file is valid.`,
          'error'
        );
      } finally {
        setExternalPdfLoadingLabel(null);
      }
    };

    // 1. Native Android WebView / Capacitor JavascriptInterface Bridge (cold-start + warm-start onNewIntent)
    const win = window as Window & {
      ElimikaAndroidBridge?: {
        hasPendingPdf?: () => boolean;
        consumePendingPdfBase64?: () => string;
        getPendingPdfFilename?: () => string;
      };
      receiveAndroidPdfBase64?: (base64: string, filename?: string) => void;
      launchQueue?: {
        setConsumer: (
          consumer: (launchParams: {
            files?: Array<{ getFile: () => Promise<File> }>;
          }) => void
        ) => void;
      };
    };

    // Expose global callback for Android WebView.evaluateJavascript("window.receiveAndroidPdfBase64(...)")
    win.receiveAndroidPdfBase64 = (base64: string, filename?: string) => {
      decodeBase64PdfAndOpen(base64, filename || 'Android_Document.pdf');
    };

    const checkNativeAndroidBridge = () => {
      try {
        if (
          win.ElimikaAndroidBridge &&
          typeof win.ElimikaAndroidBridge.hasPendingPdf === 'function' &&
          win.ElimikaAndroidBridge.hasPendingPdf()
        ) {
          const filename =
            typeof win.ElimikaAndroidBridge.getPendingPdfFilename === 'function'
              ? win.ElimikaAndroidBridge.getPendingPdfFilename()
              : 'Android_Document.pdf';
          const b64 =
            typeof win.ElimikaAndroidBridge.consumePendingPdfBase64 ===
            'function'
              ? win.ElimikaAndroidBridge.consumePendingPdfBase64()
              : '';
          if (b64) {
            decodeBase64PdfAndOpen(b64, filename);
          }
        }
      } catch {
        // Ignore bridge inspection errors
      }
    };

    // Check immediately on cold start
    checkNativeAndroidBridge();

    // Listen for warm-start custom event dispatched by Android Activity.onNewIntent
    const onAndroidIntentEvent = (e: Event) => {
      const customEvt = e as CustomEvent<{
        base64?: string;
        filename?: string;
        openId?: string;
      }>;
      if (customEvt.detail?.base64) {
        decodeBase64PdfAndOpen(
          customEvt.detail.base64,
          customEvt.detail.filename || 'Android_Document.pdf'
        );
      } else if (customEvt.detail?.openId) {
        fetchAndroidOpenIdAndOpen(
          customEvt.detail.openId,
          customEvt.detail.filename || 'Android_Document.pdf',
          false
        );
      } else {
        checkNativeAndroidBridge();
      }
    };
    window.addEventListener('elimikapdf:android-open-pdf', onAndroidIntentEvent);

    // Also check when app returns to foreground (already-running warm start)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkNativeAndroidBridge();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 2. Listen on BroadcastChannel so an already-running ElimikaPDF instance immediately opens a newly selected PDF
    let broadcastChannel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        broadcastChannel = new BroadcastChannel('elimikapdf-open-pdf');
        broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'ANDROID_OPEN_PDF_ID' && event.data?.openId) {
            fetchAndroidOpenIdAndOpen(
              event.data.openId,
              event.data.filename || 'Android_Document.pdf',
              false
            );
          }
        };
      } catch {
        broadcastChannel = null;
      }
    }

    // 3. OS File Handlers API (window.launchQueue — opens selected PDF directly in ElimikaPDF Reader)
    if (win.launchQueue && typeof win.launchQueue.setConsumer === 'function') {
      win.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files || launchParams.files.length === 0) return;
        try {
          const loadedFiles: File[] = [];
          for (const handle of launchParams.files) {
            const f = await handle.getFile();
            loadedFiles.push(f);
          }
          await openExternalPdfDirectlyInReader(loadedFiles, 'Open With');
        } catch {
          showToast(
            'Permission to read the selected PDF file was denied.',
            'error'
          );
        }
      });
    }

    // 4. Check URL query parameters for TWA Android Open With (?android_open_id=...) or Web Share Target (?shared=1 / ?shared_server_id=...)
    const params = new URLSearchParams(window.location.search);
    const androidOpenId = params.get('android_open_id');
    if (androidOpenId) {
      const rawName = params.get('filename') || 'Android_Document.pdf';
      fetchAndroidOpenIdAndOpen(androidOpenId, rawName, true);
    } else if (params.get('shared') === '1') {
      fetch('/__shared_file_latest')
        .then(async (res) => {
          if (!res.ok) return;
          const rawName =
            res.headers.get('X-Shared-Filename') || 'Shared_Document.pdf';
          const filename = decodeURIComponent(rawName);
          const mimeType =
            res.headers.get('Content-Type') || 'application/pdf';
          const blob = await res.blob();
          const file = new File([blob], filename, { type: mimeType });
          await openExternalPdfDirectlyInReader([file], 'Android Share');
        })
        .catch(() => {
          // Ignore if no shared file was cached
        });
    } else if (params.get('shared_server_id')) {
      const serverId = params.get('shared_server_id')!;
      const rawName = params.get('filename') || 'Shared_Document.pdf';
      const mimeType = params.get('mime') || 'application/pdf';
      fetch(`/api/downloads/${encodeURIComponent(serverId)}`)
        .then(async (res) => {
          if (!res.ok) return;
          const blob = await res.blob();
          const file = new File([blob], rawName, { type: mimeType });
          await openExternalPdfDirectlyInReader([file], 'Android Share');
        })
        .catch(() => {
          // Ignore if expired
        });
    }

    return () => {
      window.removeEventListener(
        'elimikapdf:android-open-pdf',
        onAndroidIntentEvent
      );
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (broadcastChannel) {
        broadcastChannel.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenTool = (toolId: ToolId) => {
    if (toolId === 'scan-to-pdf') {
      navigateToView('scanner');
    } else if (toolId === 'read-pdf') {
      setEditorReaderMode(true);
      navigateToView('editor');
    } else if (toolId === 'edit-pdf') {
      setEditorReaderMode(false);
      navigateToView('editor');
    } else {
      setActiveTool(toolId);
      navigateToView('tools');
    }
  };

  const handleOpenToolForDocument = (doc: StoredDocument, toolId: ToolId) => {
    setActiveDocument(doc);
    handleOpenTool(toolId);
  };

  const handleOpenDocumentInEditor = async (
    doc: StoredDocument,
    readerMode = false
  ) => {
    const updated: StoredDocument = {
      ...doc,
      lastOpenedAt: new Date().toISOString(),
    };
    await storageService.saveDocument(updated);
    await refreshVault();
    setActiveDocument(updated);
    setEditorReaderMode(readerMode);
    navigateToView('editor');
  };

  const handleSaveScannedDocument = async (
    doc: StoredDocument,
    openInEditorAfter: boolean
  ) => {
    await storageService.saveDocument(doc);
    await refreshVault();
    setActiveDocument(doc);
    if (openInEditorAfter) {
      setEditorReaderMode(false);
      navigateToView('editor');
    }
    showToast(`Saved scanned PDF "${doc.name}" (${doc.pageCount} pages).`);
  };

  const handleSaveUpdatedDocument = async (
    doc: StoredDocument,
    silent = false
  ) => {
    await storageService.saveDocument(doc);
    await refreshVault();
    setActiveDocument(doc);
    if (!silent) {
      showToast(`Saved changes to "${doc.name}".`);
    }
  };

  const handleToggleStar = async (doc: StoredDocument) => {
    const updated = { ...doc, starred: !doc.starred };
    await storageService.saveDocument(updated);
    await refreshVault();
  };

  const handleRenameDocument = async (doc: StoredDocument, newName: string) => {
    const finalName = newName.toLowerCase().endsWith('.pdf')
      ? newName
      : `${newName}.pdf`;
    const updated = {
      ...doc,
      name: finalName,
      updatedAt: new Date().toISOString(),
    };
    await storageService.saveDocument(updated);
    await refreshVault();
    showToast(`Renamed document to "${finalName}".`);
  };

  const handleAssignFolder = async (
    doc: StoredDocument,
    folderId: string | null
  ) => {
    const updated = { ...doc, folderId, updatedAt: new Date().toISOString() };
    await storageService.saveDocument(updated);
    await refreshVault();
  };

  const handleChangeCategory = async (
    doc: StoredDocument,
    category: DocumentCategory
  ) => {
    const updated = { ...doc, category, updatedAt: new Date().toISOString() };
    await storageService.saveDocument(updated);
    await refreshVault();
  };

  const handleConfirmDeleteDocument = async () => {
    if (!docPendingDelete) return;
    const deletedName = docPendingDelete.name;
    const deletedId = docPendingDelete.id;
    await storageService.deleteDocument(deletedId);
    setDocPendingDelete(null);
    const remaining = await storageService.getAllDocuments();
    setDocuments(remaining);
    if (activeDocument?.id === deletedId) {
      setActiveDocument(remaining[0] || null);
    }
    showToast(`Deleted "${deletedName}" from Local Vault.`);
  };

  const handleConfirmBatchDeleteDocuments = async () => {
    if (!docsPendingBatchDelete || docsPendingBatchDelete.length === 0) return;
    const count = docsPendingBatchDelete.length;
    const deletedIds = new Set(docsPendingBatchDelete.map((d) => d.id));
    for (const doc of docsPendingBatchDelete) {
      await storageService.deleteDocument(doc.id);
    }
    setDocsPendingBatchDelete(null);
    const remaining = await storageService.getAllDocuments();
    setDocuments(remaining);
    if (activeDocument && deletedIds.has(activeDocument.id)) {
      setActiveDocument(remaining[0] || null);
    }
    showToast(
      `Deleted ${count} selected ${count === 1 ? 'document' : 'documents'} from Local Vault.`
    );
  };

  const handleBatchMergeDocuments = async (
    selectedDocs: StoredDocument[],
    mode: 'instant' | 'studio'
  ) => {
    if (selectedDocs.length < 2) {
      showToast('Select at least 2 PDF files to merge.', 'error');
      return;
    }
    if (mode === 'studio') {
      setInitialMergeDocIds(selectedDocs.map((d) => d.id));
      setActiveTool('merge-pdf');
      navigateToView('tools');
      return;
    }

    try {
      const mergedBytes = await mergePdfs(selectedDocs.map((d) => d.pdfData));
      const totalPages = selectedDocs.reduce((sum, d) => sum + d.pageCount, 0);
      const outName = `Merged_${selectedDocs.length}_Files_${new Date().toISOString().slice(0, 10)}.pdf`;
      const newDoc: StoredDocument = {
        id: `doc-merged-${Date.now()}`,
        name: outName,
        category: 'Other',
        starred: false,
        sizeBytes: mergedBytes.byteLength,
        pageCount: totalPages,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: mergedBytes,
      };
      await storageService.saveDocument(newDoc);
      await refreshVault();
      setActiveDocument(newDoc);
      showToast(
        `Merged ${selectedDocs.length} PDFs into "${outName}" (${totalPages} pages, ${formatBytes(mergedBytes.byteLength)}).`
      );
    } catch {
      showToast('Failed to merge the selected PDF files.', 'error');
    }
  };

  const handleBatchCompressDocuments = async (selectedDocs: StoredDocument[]) => {
    if (selectedDocs.length === 0) return;
    let totalBefore = 0;
    let totalAfter = 0;
    for (const doc of selectedDocs) {
      totalBefore += doc.sizeBytes;
      try {
        const compressed = await compressPdfDocument(doc.pdfData, 'medium');
        totalAfter += compressed.byteLength;
        await storageService.saveDocument({
          ...doc,
          pdfData: compressed,
          sizeBytes: compressed.byteLength,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        totalAfter += doc.sizeBytes;
      }
    }
    await refreshVault();
    showToast(
      `Compressed ${selectedDocs.length} PDF(s) (${formatBytes(totalBefore)} → ${formatBytes(totalAfter)}).`
    );
  };

  const handleBatchRemoveWatermarkDocuments = async (
    selectedDocs: StoredDocument[]
  ) => {
    if (selectedDocs.length === 0) return;
    let cleanedCount = 0;
    for (const doc of selectedDocs) {
      try {
        const cleanedBytes = await removeWatermarksFromPdf(doc.pdfData, {
          preserveColor: true,
          strength: 6,
          contrastBoost: 36,
          removeSolidBanners: false,
        });
        await storageService.saveDocument({
          ...doc,
          pdfData: cleanedBytes,
          sizeBytes: cleanedBytes.byteLength,
          updatedAt: new Date().toISOString(),
        });
        cleanedCount++;
      } catch {
        // continue with remaining docs
      }
    }
    await refreshVault();
    showToast(`Cleaned watermarks from ${cleanedCount} selected PDF(s).`);
  };

  const handleBatchShareDocuments = async (selectedDocs: StoredDocument[]) => {
    if (selectedDocs.length === 0) return;
    const files = selectedDocs.map(
      (doc) =>
        new File([new Uint8Array(doc.pdfData)], doc.name, {
          type: 'application/pdf',
        })
    );
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    if (
      typeof nav.share === 'function' &&
      (!nav.canShare || nav.canShare({ files }))
    ) {
      try {
        await nav.share({
          title: `${selectedDocs.length} PDF Documents`,
          text: `Sharing ${selectedDocs.length} PDF files from ElimikaPDF`,
          files,
        });
        return;
      } catch {
        // fall back to download
      }
    }
    selectedDocs.forEach((doc) => downloadBytesAsFile(doc.pdfData, doc.name));
  };

  const handleBatchDownloadDocuments = (selectedDocs: StoredDocument[]) => {
    selectedDocs.forEach((doc, idx) => {
      setTimeout(() => {
        downloadBytesAsFile(doc.pdfData, doc.name);
      }, idx * 180);
    });
    showToast(`Downloading ${selectedDocs.length} selected PDF(s)...`);
  };

  const totalStorageBytes = documents.reduce((acc, d) => acc + d.sizeBytes, 0);

  return (
    <Layout
      activeView={activeView}
      onNavigate={navigateToView}
      theme={preferences.theme}
      onThemeChange={(theme) =>
        handleUpdatePreferences({ ...preferences, theme })
      }
      totalStorageBytes={totalStorageBytes}
      documentCount={documents.length}
      onQuickScan={() => navigateToView('scanner')}
    >
      {/* Loading Overlay for Incoming Android "Open With" PDF URIs */}
      {externalPdfLoadingLabel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl max-w-sm w-full p-6 flex items-center gap-4 shadow-2xl">
            <div className="w-9 h-9 rounded-full border-3 border-[#003FE8] border-t-transparent animate-spin shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                ElimikaPDF Reader
              </p>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
                {externalPdfLoadingLabel}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 max-w-md px-4 py-3 rounded-xl shadow-lg border flex items-center justify-between gap-3 bg-white dark:bg-[#16111F] border-[#4A1D5E] dark:border-[#9D5CE5] text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8]">
          <span
            className={
              toast.type === 'error'
                ? 'text-[#DC2626] dark:text-[#F87171]'
                : 'text-[#14101B] dark:text-[#F4F1F8]'
            }
          >
            {toast.message}
          </span>
          <button
            onClick={() => setToast(null)}
            className="text-[#6E667D] hover:text-[#14101B] dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Confirmation Modal for Document Deletion */}
      {docPendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[#DC2626]/10 text-[#DC2626] shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Delete Document Permanently?
                </h3>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                  Are you sure you want to permanently delete{' '}
                  <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                    {docPendingDelete.name}
                  </strong>{' '}
                  from your local browser vault? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setDocPendingDelete(null)}
                className="px-4 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteDocument}
                className="px-4 py-2 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold cursor-pointer"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Batch Document Deletion */}
      {docsPendingBatchDelete && docsPendingBatchDelete.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[#DC2626]/10 text-[#DC2626] shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Delete {docsPendingBatchDelete.length} Selected{' '}
                  {docsPendingBatchDelete.length === 1
                    ? 'Document'
                    : 'Documents'}
                  ?
                </h3>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                  Are you sure you want to permanently delete{' '}
                  <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                    {docsPendingBatchDelete.length} selected PDF{' '}
                    {docsPendingBatchDelete.length === 1 ? 'file' : 'files'}
                  </strong>{' '}
                  from your local vault? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setDocsPendingBatchDelete(null)}
                className="px-4 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBatchDeleteDocuments}
                className="px-4 py-2 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold cursor-pointer"
              >
                Delete All ({docsPendingBatchDelete.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Open File With ElimikaPDF..." Options Chooser Modal */}
      {openWithPromptDoc && (
        <div
          onClick={() => setOpenWithPromptDoc(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg"
                  alt="ElimikaPDF Icon"
                  className="w-11 h-11 rounded-xl object-cover shadow-xs shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                    Open with ElimikaPDF
                  </h3>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
                    {openWithPromptDoc.name} &bull; {openWithPromptDoc.pageCount}{' '}
                    {openWithPromptDoc.pageCount === 1 ? 'page' : 'pages'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpenWithPromptDoc(null)}
                className="p-1.5 rounded-lg text-[#6E667D] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={() => {
                  const doc = openWithPromptDoc;
                  setOpenWithPromptDoc(null);
                  handleOpenDocumentInEditor(doc, true);
                }}
                className="w-full p-3.5 rounded-xl bg-[#003FE8] hover:bg-[#0033BA] text-white text-left flex items-center gap-3.5 transition-colors cursor-pointer shadow-xs"
              >
                <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  <Eye className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">ElimikaPDF Reader</span>
                    <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                      RECOMMENDED
                    </span>
                  </div>
                  <p className="text-xs opacity-90 mt-0.5">
                    Read in full-screen Reader Mode with continuous scroll, zoom & print
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  const doc = openWithPromptDoc;
                  setOpenWithPromptDoc(null);
                  handleOpenDocumentInEditor(doc, false);
                }}
                className="w-full p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] border border-[#E4DFEC] dark:border-[#261F33] text-left flex items-center gap-3.5 transition-colors cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF] flex items-center justify-center shrink-0">
                  <FileEdit className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Edit & Annotate PDF
                  </span>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5">
                    Edit text, add signatures, highlight, whiteout & remove watermarks
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  const doc = openWithPromptDoc;
                  setOpenWithPromptDoc(null);
                  handleOpenToolForDocument(doc, 'pdf-to-word');
                }}
                className="w-full p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] border border-[#E4DFEC] dark:border-[#261F33] text-left flex items-center gap-3.5 transition-colors cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center shrink-0">
                  <FileOutput className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Convert PDF to Word (.DOCX)
                  </span>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5">
                    Turn this PDF into an editable Microsoft Word document
                  </p>
                </div>
              </button>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  onClick={() => {
                    const doc = openWithPromptDoc;
                    setOpenWithPromptDoc(null);
                    handleOpenToolForDocument(doc, 'word-to-pdf');
                  }}
                  className="p-2.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] border border-[#E4DFEC] dark:border-[#261F33] text-left flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                    Word Studio
                  </span>
                </button>

                <button
                  onClick={() => {
                    const doc = openWithPromptDoc;
                    setOpenWithPromptDoc(null);
                    handleOpenToolForDocument(doc, 'ocr-pdf');
                  }}
                  className="p-2.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] border border-[#E4DFEC] dark:border-[#261F33] text-left flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <ScanText className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                    OCR Text
                  </span>
                </button>

                <button
                  onClick={() => {
                    const doc = openWithPromptDoc;
                    setOpenWithPromptDoc(null);
                    handleOpenToolForDocument(doc, 'split-pdf');
                  }}
                  className="p-2.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] border border-[#E4DFEC] dark:border-[#261F33] text-left flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Scissors className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                    Split PDF
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Views */}
      {activeView === 'dashboard' && (
        <DashboardView
          documents={documents}
          onNavigate={navigateToView}
          onOpenTool={handleOpenTool}
          onOpenToolForDocument={handleOpenToolForDocument}
          onOpenDocumentInEditor={handleOpenDocumentInEditor}
          onRequestOpenWithOptions={(doc) => setOpenWithPromptDoc(doc)}
          onUploadPdfFiles={handleUploadPdfFiles}
          onImportImagesToScanner={(files) => {
            setScannerImportedFiles(files);
            navigateToView('scanner');
          }}
          onToggleStar={handleToggleStar}
          onDownloadDocument={(doc) =>
            downloadBytesAsFile(doc.pdfData, doc.name)
          }
          onRequestDeleteDocument={(doc) => setDocPendingDelete(doc)}
          onRequestBatchDeleteDocuments={(docs) =>
            setDocsPendingBatchDelete(docs)
          }
          onBatchMergeDocuments={handleBatchMergeDocuments}
          onBatchCompressDocuments={handleBatchCompressDocuments}
          onBatchRemoveWatermarkDocuments={handleBatchRemoveWatermarkDocuments}
          onBatchShareDocuments={handleBatchShareDocuments}
          onBatchDownloadDocuments={handleBatchDownloadDocuments}
        />
      )}

      {activeView === 'scanner' && (
        <ScannerView
          initialImportedFiles={scannerImportedFiles}
          onClearInitialFiles={() => setScannerImportedFiles(null)}
          defaultFilter={preferences.defaultScanFilter}
          defaultPageSize={preferences.defaultPageSize}
          onSaveScannedDocument={handleSaveScannedDocument}
        />
      )}

      {activeView === 'editor' && (
        <PdfEditorView
          activeDocument={activeDocument}
          allDocuments={documents}
          initialReaderMode={editorReaderMode}
          onSelectDocument={(doc) => setActiveDocument(doc)}
          onUploadNewPdf={handleUploadPdfFiles}
          onSaveUpdatedDocument={handleSaveUpdatedDocument}
          onCloseEditor={() => navigateToView('dashboard')}
          onNavigate={navigateToView}
        />
      )}

      {activeView === 'tools' && (
        <PdfToolsView
          initialTool={activeTool}
          activeDocumentId={activeDocument?.id}
          initialMergeDocIds={initialMergeDocIds}
          documents={documents}
          onSaveNewDocument={async (doc) => {
            await storageService.saveDocument(doc);
            await refreshVault();
            setActiveDocument(doc);
          }}
          onUpdateDocument={handleSaveUpdatedDocument}
          onOpenInEditor={(doc) => handleOpenDocumentInEditor(doc, false)}
          onUploadNewPdf={handleUploadPdfFiles}
        />
      )}

      {activeView === 'documents' && (
        <DocumentsLibraryView
          documents={documents}
          folders={folders}
          onOpenInEditor={handleOpenDocumentInEditor}
          onRequestOpenWithOptions={(doc) => setOpenWithPromptDoc(doc)}
          onRenameDocument={handleRenameDocument}
          onToggleStar={handleToggleStar}
          onAssignFolder={handleAssignFolder}
          onChangeCategory={handleChangeCategory}
          onDownloadDocument={(doc) =>
            downloadBytesAsFile(doc.pdfData, doc.name)
          }
          onRequestDeleteDocument={(doc) => setDocPendingDelete(doc)}
          onRequestBatchDeleteDocuments={(docs) =>
            setDocsPendingBatchDelete(docs)
          }
          onBatchMergeDocuments={handleBatchMergeDocuments}
          onBatchCompressDocuments={handleBatchCompressDocuments}
          onBatchRemoveWatermarkDocuments={handleBatchRemoveWatermarkDocuments}
          onBatchShareDocuments={handleBatchShareDocuments}
          onBatchDownloadDocuments={handleBatchDownloadDocuments}
          onCreateFolder={async (name) => {
            await storageService.saveFolder({
              id: `folder-${Date.now()}`,
              name,
              createdAt: new Date().toISOString(),
              color: '#4A1D5E',
            });
            await refreshVault();
            showToast(`Created folder "${name}".`);
          }}
          onDeleteFolder={async (folderId) => {
            await storageService.deleteFolder(folderId);
            await refreshVault();
          }}
          onUploadPdfFiles={handleUploadPdfFiles}
        />
      )}

      {activeView === 'settings' && (
        <SettingsView
          preferences={preferences}
          onUpdatePreferences={handleUpdatePreferences}
          totalStorageBytes={totalStorageBytes}
          documentCount={documents.length}
          onOpenPrivacyPolicy={() => navigateToView('privacy')}
          onClearAllStorage={async () => {
            await storageService.clearAllDocuments();
            setDocuments([]);
            setActiveDocument(null);
            showToast('Cleared all locally stored documents from IndexedDB.');
          }}
          onResetSampleDocuments={async () => {
            await storageService.clearAllDocuments();
            await seedInitialDocumentsIfEmpty();
            await refreshVault();
            showToast('Restored sample PDF documents.');
          }}
        />
      )}

      {activeView === 'privacy' && (
        <PrivacyPolicyView onBack={() => navigateToView('dashboard')} />
      )}

      {activeView === 'help' && <HelpAndSupportView />}
    </Layout>
  );
}
