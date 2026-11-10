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
import { getPdfPageCount, downloadBytesAsFile } from './services/pdfService';
import { Layout } from './components/Layout';
import { DashboardView } from './components/DashboardView';
import { ScannerView } from './components/ScannerView';
import { PdfEditorView } from './components/PdfEditorView';
import { PdfToolsView } from './components/PdfToolsView';
import { DocumentsLibraryView } from './components/DocumentsLibraryView';
import {
  SettingsView,
  HelpAndSupportView,
} from './components/SettingsAndHelpView';
import { AlertTriangle, X } from 'lucide-react';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
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

  // Delete confirmation modal state
  const [docPendingDelete, setDocPendingDelete] =
    useState<StoredDocument | null>(null);

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
    let initialView: ActiveView = 'dashboard';
    if (action === 'scan') {
      initialView = 'scanner';
      setActiveView('scanner');
    } else if (action === 'pdf-editor') {
      initialView = 'editor';
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
    openInEditorAfter = true
  ) => {
    const fileArray = Array.from(files);
    let lastAdded: StoredDocument | null = null;
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      if (
        file.type !== 'application/pdf' &&
        !file.name.toLowerCase().endsWith('.pdf')
      ) {
        showToast(
          `Skipped "${file.name}": Only valid PDF files are supported here.`,
          'error'
        );
        continue;
      }
      if (file.size > 100 * 1024 * 1024) {
        showToast(
          `Skipped "${file.name}": File exceeds 100 MB local processing limit.`,
          'error'
        );
        continue;
      }

      try {
        const buf = await file.arrayBuffer();
        const pdfBytes = new Uint8Array(buf);
        const pageCount = await getPdfPageCount(pdfBytes);

        const newDoc: StoredDocument = {
          id: `doc-upload-${Date.now()}-${i}`,
          name: file.name,
          category: 'Other',
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
      } catch {
        showToast(
          `Failed to load "${file.name}". The PDF file appears corrupted or unsupported.`,
          'error'
        );
      }
    }

    if (lastAdded) {
      await refreshVault();
      setActiveDocument(lastAdded);
      if (openInEditorAfter) {
        setEditorReaderMode(false);
        navigateToView('editor');
      }
      showToast(
        `Opened "${lastAdded.name}" (${lastAdded.pageCount} ${lastAdded.pageCount === 1 ? 'page' : 'pages'}).`
      );
    }
  };

  // Handle files opened via OS File Handlers (window.launchQueue) or Android/Desktop Web Share Target
  useEffect(() => {
    const ingestExternalFile = async (file: File) => {
      const lower = file.name.toLowerCase();
      if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
        await handleUploadPdfFiles([file], true);
      } else if (
        lower.endsWith('.docx') ||
        lower.endsWith('.doc') ||
        file.type.includes('word')
      ) {
        setActiveTool('word-to-pdf');
        navigateToView('tools');
        showToast(`Opened "${file.name}" in Word to PDF Converter.`);
      } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lower)) {
        setScannerImportedFiles([file]);
        navigateToView('scanner');
        showToast(`Imported shared image "${file.name}" into Document Scanner.`);
      }
    };

    // 1. OS File Handlers API (window.launchQueue)
    const win = window as Window & {
      launchQueue?: {
        setConsumer: (
          consumer: (launchParams: {
            files?: Array<{ getFile: () => Promise<File> }>;
          }) => void
        ) => void;
      };
    };

    if (win.launchQueue && typeof win.launchQueue.setConsumer === 'function') {
      win.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files || launchParams.files.length === 0) return;
        try {
          const fileHandle = launchParams.files[0];
          const file = await fileHandle.getFile();
          await ingestExternalFile(file);
        } catch {
          // Ignore if file handle permission was cancelled
        }
      });
    }

    // 2. Web Share Target API (/?shared=1 redirected from Service Worker POST /?share-target=1)
    const params = new URLSearchParams(window.location.search);
    if (params.get('shared') === '1') {
      fetch('/__shared_file_latest')
        .then(async (res) => {
          if (!res.ok) return;
          const rawName = res.headers.get('X-Shared-Filename') || 'Shared_Document.pdf';
          const filename = decodeURIComponent(rawName);
          const mimeType = res.headers.get('Content-Type') || 'application/pdf';
          const blob = await res.blob();
          const file = new File([blob], filename, { type: mimeType });
          await ingestExternalFile(file);
        })
        .catch(() => {
          // Ignore if no shared file was cached
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenTool = (toolId: ToolId) => {
    if (toolId === 'scan-to-pdf') {
      navigateToView('scanner');
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

      {/* Main Views */}
      {activeView === 'dashboard' && (
        <DashboardView
          documents={documents}
          onNavigate={navigateToView}
          onOpenTool={handleOpenTool}
          onOpenToolForDocument={handleOpenToolForDocument}
          onOpenDocumentInEditor={handleOpenDocumentInEditor}
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
          onRenameDocument={handleRenameDocument}
          onToggleStar={handleToggleStar}
          onAssignFolder={handleAssignFolder}
          onChangeCategory={handleChangeCategory}
          onDownloadDocument={(doc) =>
            downloadBytesAsFile(doc.pdfData, doc.name)
          }
          onRequestDeleteDocument={(doc) => setDocPendingDelete(doc)}
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

      {activeView === 'help' && <HelpAndSupportView />}
    </Layout>
  );
}
