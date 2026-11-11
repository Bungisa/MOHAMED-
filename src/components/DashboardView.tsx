import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Search,
  Merge,
  Scissors,
  Minimize2,
  Images,
  LayoutGrid,
  ScanText,
  Star,
  Trash2,
  FolderOpen,
  Share2,
  FileText,
  FileOutput,
  MoreHorizontal,
  Plus,
  Eye,
  Download,
  Sparkles,
  Check,
  CheckSquare,
  Square,
  X,
  Loader2,
} from 'lucide-react';
import {
  StoredDocument,
  ActiveView,
  ToolId,
} from '../types/document';
import { formatBytes } from '../services/storageService';
import { renderPdfPage } from '../services/pdfService';

interface DashboardViewProps {
  documents: StoredDocument[];
  onNavigate: (view: ActiveView) => void;
  onOpenTool: (tool: ToolId) => void;
  onOpenToolForDocument?: (doc: StoredDocument, tool: ToolId) => void;
  onOpenDocumentInEditor: (doc: StoredDocument, readerMode?: boolean) => void;
  onRequestOpenWithOptions?: (doc: StoredDocument) => void;
  onUploadPdfFiles: (
    files: FileList | File[],
    openInEditorAfter?: boolean,
    openInReaderMode?: boolean
  ) => Promise<void>;
  onImportImagesToScanner: (files: FileList | File[]) => void;
  onToggleStar: (doc: StoredDocument) => Promise<void>;
  onDownloadDocument: (doc: StoredDocument) => void;
  onRequestDeleteDocument: (doc: StoredDocument) => void;
  onRequestBatchDeleteDocuments?: (docs: StoredDocument[]) => void;
  onBatchMergeDocuments?: (
    docs: StoredDocument[],
    mode: 'instant' | 'studio'
  ) => Promise<void>;
  onBatchCompressDocuments?: (docs: StoredDocument[]) => Promise<void>;
  onBatchRemoveWatermarkDocuments?: (docs: StoredDocument[]) => Promise<void>;
  onBatchStarDocuments?: (
    docs: StoredDocument[],
    starred: boolean
  ) => Promise<void>;
  onBatchShareDocuments?: (docs: StoredDocument[]) => Promise<void>;
  onBatchDownloadDocuments?: (docs: StoredDocument[]) => void;
}

const QUICK_TOOLS: {
  id: ToolId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}[] = [
  {
    id: 'pdf-to-word',
    label: 'PDF to Word',
    icon: FileOutput,
    accentClass: 'text-[#2563EB] bg-[#2563EB]/10 dark:bg-[#2563EB]/20',
  },
  {
    id: 'word-to-pdf',
    label: 'Word to PDF',
    icon: FileText,
    accentClass: 'text-[#4A1D5E] dark:text-[#D5B3FF] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20',
  },
  {
    id: 'merge-pdf',
    label: 'Merge PDF',
    icon: Merge,
    accentClass: 'text-[#0284C7] bg-[#0284C7]/10 dark:bg-[#0284C7]/20',
  },
  {
    id: 'split-pdf',
    label: 'Split PDF',
    icon: Scissors,
    accentClass: 'text-[#D97706] bg-[#D97706]/10 dark:bg-[#D97706]/20',
  },
  {
    id: 'compress-pdf',
    label: 'Compress',
    icon: Minimize2,
    accentClass: 'text-[#15803D] dark:text-[#4ADE80] bg-[#15803D]/10 dark:bg-[#15803D]/20',
  },
  {
    id: 'pdf-to-img',
    label: 'PDF to JPG',
    icon: Images,
    accentClass: 'text-[#7C3AED] dark:text-[#C4B5FD] bg-[#7C3AED]/10 dark:bg-[#7C3AED]/20',
  },
  {
    id: 'ocr-pdf',
    label: 'OCR Text',
    icon: ScanText,
    accentClass: 'text-[#EA580C] bg-[#EA580C]/10 dark:bg-[#EA580C]/20',
  },
  {
    id: 'organize-pdf',
    label: 'Organize',
    icon: LayoutGrid,
    accentClass: 'text-[#4A1D5E] dark:text-[#D5B3FF] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20',
  },
];

export function formatRelativeTime(isoDate: string): string {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) return 'Recently';
  const diffMs = Date.now() - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours <= 0) {
      const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
      return diffMins <= 2 ? 'Just now' : `${diffMins} mins ago`;
    }
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} months ago`;
  return new Date(isoDate).toLocaleDateString();
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  documents,
  onNavigate,
  onOpenTool,
  onOpenToolForDocument,
  onOpenDocumentInEditor,
  onUploadPdfFiles,
  onImportImagesToScanner,
  onToggleStar,
  onDownloadDocument,
  onRequestDeleteDocument,
  onRequestBatchDeleteDocuments,
  onBatchMergeDocuments,
  onBatchCompressDocuments,
  onBatchRemoveWatermarkDocuments,
  onBatchStarDocuments,
  onBatchShareDocuments,
  onBatchDownloadDocuments,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<'all' | 'starred'>('all');
  const [isUploading, setIsUploading] = useState(false);
  const [openMenuDocId, setOpenMenuDocId] = useState<string | null>(null);
  const [thumbnailsMap, setThumbnailsMap] = useState<Record<string, string>>({});

  // Long-press multi-selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [batchBusyLabel, setBatchBusyLabel] = useState<string | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Lazily render Page 1 thumbnail for documents that don't have thumbnailDataUrl cached yet
  useEffect(() => {
    let cancelled = false;
    const generateMissingThumbnails = async () => {
      for (const doc of documents) {
        if (cancelled) break;
        if (doc.thumbnailDataUrl || thumbnailsMap[doc.id]) continue;
        try {
          const rendered = await renderPdfPage(
            doc.pdfData,
            1,
            0.35,
            'image/jpeg',
            0.72
          );
          if (!cancelled && rendered.dataUrl) {
            setThumbnailsMap((prev) => ({
              ...prev,
              [doc.id]: rendered.dataUrl,
            }));
          }
        } catch {
          // Ignore thumbnail error for individual file
        }
      }
    };
    generateMissingThumbnails();
    return () => {
      cancelled = true;
    };
  }, [documents, thumbnailsMap]);

  const handlePdfUploadChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      e.target.value = '';
      setIsUploading(true);
      try {
        await onUploadPdfFiles(selectedFiles, true, false);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleImageUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      e.target.value = '';
      onImportImagesToScanner(selectedFiles);
    }
  };

  const handleShareDoc = async (doc: StoredDocument) => {
    const fileObj = new File([new Uint8Array(doc.pdfData)], doc.name, {
      type: 'application/pdf',
    });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    if (
      typeof nav.share === 'function' &&
      (!nav.canShare || nav.canShare({ files: [fileObj] }))
    ) {
      try {
        await nav.share({
          title: doc.name,
          text: `Sharing PDF from ElimikaPDF: ${doc.name}`,
          files: [fileObj],
        });
        return;
      } catch {
        // Fall back to direct download
      }
    }
    onDownloadDocument(doc);
  };

  const filteredDocs = documents.filter((doc) => {
    if (fileFilter === 'starred' && !doc.starred) return false;
    if (!searchQuery.trim()) return true;
    return (
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  // Clean up selected IDs if documents were deleted
  useEffect(() => {
    const validIds = new Set(documents.map((d) => d.id));
    setSelectedDocIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      if (next.length === 0 && isSelectionMode && prev.length > 0) {
        setIsSelectionMode(false);
      }
      return next;
    });
  }, [documents, isSelectionMode]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    docId: string
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    longPressTriggeredRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setOpenMenuDocId(null);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(35);
        } catch {
          // ignore vibrate error
        }
      }
      setIsSelectionMode(true);
      setSelectedDocIds((prev) =>
        prev.includes(docId) ? prev : [...prev, docId]
      );
    }, 420);
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartPosRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartPosRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPressTimer();
    }
  };

  const handleCardPointerUpOrCancel = () => {
    clearLongPressTimer();
    pointerStartPosRef.current = null;
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) => {
      const exists = prev.includes(docId);
      const next = exists ? prev.filter((id) => id !== docId) : [...prev, docId];
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredDocs.map((d) => d.id);
    const allSelected =
      allFilteredIds.length > 0 &&
      allFilteredIds.every((id) => selectedDocIds.includes(id));
    if (allSelected) {
      setSelectedDocIds([]);
    } else {
      setSelectedDocIds(allFilteredIds);
    }
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedDocIds([]);
  };

  const selectedDocuments = selectedDocIds
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is StoredDocument => Boolean(d));

  const totalSelectedPages = selectedDocuments.reduce(
    (sum, d) => sum + d.pageCount,
    0
  );
  const totalSelectedBytes = selectedDocuments.reduce(
    (sum, d) => sum + d.sizeBytes,
    0
  );
  const allFilteredSelected =
    filteredDocs.length > 0 &&
    filteredDocs.every((d) => selectedDocIds.includes(d.id));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 space-y-6">
      {/* Hidden File Inputs (Accept PDF, Word .docx/.doc, Text .txt/.rtf, and Images) */}
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.rtf,.txt,.md,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/rtf,image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handlePdfUploadChange}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleImageUploadChange}
      />

      {/* Quick PDF & Word Tools (Single Horizontal Row of 8 Core Tools) */}
      <section className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
            Quick PDF &amp; Word Tools
          </h2>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
          {QUICK_TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => onOpenTool(tool.id)}
                className="p-2.5 sm:p-3 rounded-xl hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer flex flex-col items-center justify-center text-center gap-1.5"
              >
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tool.accentClass}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-semibold text-[#14101B] dark:text-[#F4F1F8] leading-tight whitespace-nowrap">
                  {tool.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 3: Unified File Manager ("All Files" Card Arrangement matching image_597cb37c.png) */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] whitespace-nowrap">
            All Files ({filteredDocs.length})
          </h2>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1 sm:max-w-lg sm:justify-end">
            {/* Live Search Input */}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-[#6E667D] dark:text-[#A39BB5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] placeholder-[#6E667D] focus:outline-none focus:border-[#4A1D5E]"
              />
            </div>

            {/* 2-Pill Filter Toggle: [All Files] and [⭐ Starred] */}
            <div
              className="inline-flex items-center p-1 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] shrink-0"
              role="group"
              aria-label="Filter files"
            >
              <button
                onClick={() => setFileFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  fileFilter === 'all'
                    ? 'bg-[#4A1D5E] text-white dark:bg-[#9D5CE5] dark:text-[#0D0A12]'
                    : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                }`}
              >
                All Files
              </button>
              <button
                onClick={() => setFileFilter('starred')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                  fileFilter === 'starred'
                    ? 'bg-[#4A1D5E] text-white dark:bg-[#9D5CE5] dark:text-[#0D0A12]'
                    : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                }`}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    fileFilter === 'starred'
                      ? 'fill-amber-400 text-amber-400 dark:fill-[#0D0A12] dark:text-[#0D0A12]'
                      : 'fill-[#D97706] text-[#D97706]'
                  }`}
                />
                <span>Starred</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sticky Multi-Select Header Bar (Appears on Long-Press) */}
        {isSelectionMode && (
          <div className="sticky top-16 z-30 rounded-2xl bg-[#003FE8] text-white p-3 sm:px-4 shadow-lg flex flex-wrap items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={exitSelectionMode}
                title="Cancel selection"
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold leading-tight">
                  {selectedDocuments.length}{' '}
                  {selectedDocuments.length === 1 ? 'File' : 'Files'} Selected
                </p>
                <p className="text-[11px] text-white/80 truncate">
                  {selectedDocuments.length > 0
                    ? `${totalSelectedPages} pages • ${formatBytes(totalSelectedBytes)} • Tap files to select/deselect`
                    : 'Tap files below or tap Select All'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="px-3 py-1.5 rounded-xl bg-white text-[#003FE8] hover:bg-blue-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                {allFilteredSelected ? (
                  <>
                    <CheckSquare className="w-4 h-4" />
                    <span>Deselect All</span>
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4" />
                    <span>Select All ({filteredDocs.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {filteredDocs.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-8 text-center space-y-2">
            <FolderOpen className="w-7 h-7 text-[#6E667D] dark:text-[#A39BB5] mx-auto" />
            <p className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8]">
              {fileFilter === 'starred'
                ? 'No starred files yet'
                : 'No PDF files found'}
            </p>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              {fileFilter === 'starred'
                ? 'Tap the menu button on any file card to star it.'
                : 'Tap Open / Edit PDF or Scan Document above to get started.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredDocs.map((doc, idx) => {
              const thumbSrc = doc.thumbnailDataUrl || thumbnailsMap[doc.id];
              const displayTitle = doc.name.replace(/\.pdf$/i, '');
              const isMenuOpen = openMenuDocId === doc.id;
              const showPdfBadge =
                doc.category !== 'Scans' && idx % 3 === 1;
              const isSelected = selectedDocIds.includes(doc.id);
              const selectionOrder = selectedDocIds.indexOf(doc.id) + 1;

              return (
                <div
                  key={doc.id}
                  onPointerDown={(e) => handleCardPointerDown(e, doc.id)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerUpOrCancel}
                  onPointerCancel={handleCardPointerUpOrCancel}
                  onPointerLeave={handleCardPointerUpOrCancel}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setOpenMenuDocId(null);
                    setIsSelectionMode(true);
                    setSelectedDocIds((prev) =>
                      prev.includes(doc.id) ? prev : [...prev, doc.id]
                    );
                  }}
                  onClick={() => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    if (isSelectionMode) {
                      toggleDocSelection(doc.id);
                    } else {
                      onOpenDocumentInEditor(doc, false);
                    }
                  }}
                  className={`relative rounded-xl border p-3 shadow-2xs flex items-center gap-3.5 transition-all cursor-pointer select-none ${
                    isSelected
                      ? 'bg-[#0088FF]/8 dark:bg-[#0088FF]/15 border-[#0088FF] ring-1 ring-[#0088FF]'
                      : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33] hover:border-[#0088FF]/50'
                  }`}
                >
                  {/* Selection Checkbox Indicator when in Selection Mode */}
                  {isSelectionMode && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDocSelection(doc.id);
                      }}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-[#0088FF] text-white shadow-xs'
                          : 'border-2 border-[#7B8394] dark:border-[#A39BB5] bg-white dark:bg-[#16111F]'
                      }`}
                    >
                      {isSelected &&
                        (selectedDocIds.length > 1 ? (
                          <span className="text-[11px] font-extrabold tabular-nums">
                            {selectionOrder}
                          </span>
                        ) : (
                          <Check className="w-4 h-4 stroke-[3]" />
                        ))}
                    </div>
                  )}

                  {/* Left: Document Page 1 Miniature Thumbnail inside soft gray rounded frame */}
                  <div className="w-16 h-14 sm:w-20 sm:h-16 rounded-lg bg-[#F1F2F6] dark:bg-[#261F33] p-1 flex items-center justify-center shrink-0 overflow-hidden border border-[#E4DFEC]/70 dark:border-[#342A45]">
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={doc.name}
                        draggable={false}
                        className="w-full h-full object-cover object-top rounded-[4px] bg-white shadow-2xs pointer-events-none"
                      />
                    ) : (
                      <div className="w-full h-full rounded-[4px] bg-white dark:bg-[#1A1425] flex flex-col items-center justify-center p-1">
                        <FileText className="w-5 h-5 text-[#0088FF]" />
                      </div>
                    )}
                  </div>

                  {/* Center: Title + Relative Timestamp + Badges Row ([5] [N] [Doc] or [5] [PDF]) */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm sm:text-[15px] font-medium text-[#434C5E] dark:text-[#F4F1F8] truncate">
                      {displayTitle}
                    </p>
                    <p className="text-xs text-[#7B8394] dark:text-[#A39BB5]">
                      {formatRelativeTime(doc.updatedAt || doc.createdAt)}
                    </p>
                    <div className="flex items-center gap-2 pt-0.5">
                      {/* Page Count Square Badge */}
                      <span
                        title={`${doc.pageCount} pages`}
                        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-[5px] border border-[#7B8394]/80 text-[11px] font-semibold text-[#5E6675] dark:text-[#A39BB5] tabular-nums"
                      >
                        {doc.pageCount}
                      </span>

                      {showPdfBadge ? (
                        /* Red PDF Icon Badge */
                        <span className="inline-flex items-center justify-center px-1.5 h-5 rounded-[5px] bg-[#E53935] text-white text-[9px] font-extrabold tracking-tight">
                          PDF
                        </span>
                      ) : (
                        <>
                          {/* Red Outlined [N] Badge */}
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-[5px] border border-[#C62828]/80 text-[11px] font-bold text-[#B71C1C] dark:text-[#F87171]">
                            N
                          </span>
                          {/* Blue Document Lines Icon */}
                          <FileText className="w-4 h-4 text-[#0088FF] shrink-0" />
                        </>
                      )}

                      {doc.starred && (
                        <Star className="w-3.5 h-3.5 fill-[#D97706] text-[#D97706] shrink-0" />
                      )}

                      <span className="hidden sm:inline text-[11px] text-[#7B8394] dark:text-[#A39BB5] font-mono ml-1">
                        {formatBytes(doc.sizeBytes)}
                      </span>
                    </div>
                  </div>

                  {/* Right: Three-Dots Action Button (•••) */}
                  {!isSelectionMode && (
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuDocId((prev) =>
                            prev === doc.id ? null : doc.id
                          )
                        }
                        title="Document options"
                        aria-label="Document options"
                        className="w-9 h-9 rounded-full flex items-center justify-center text-[#5E6675] dark:text-[#A39BB5] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <MoreHorizontal className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {/* Dropdown Action Menu when ••• is clicked */}
                  {isMenuOpen && !isSelectionMode && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-3 top-12 w-52 rounded-xl bg-white dark:bg-[#1E172B] border border-[#E4DFEC] dark:border-[#342A45] shadow-xl py-1.5 z-30 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          setIsSelectionMode(true);
                          setSelectedDocIds([doc.id]);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] font-semibold text-[#003FE8] dark:text-[#60A5FA] cursor-pointer"
                      >
                        <CheckSquare className="w-4 h-4" />
                        <span>Select / Multi-Select</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          onOpenDocumentInEditor(doc, false);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] font-semibold text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-[#0088FF]" />
                        <span>Open / Edit PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          onOpenDocumentInEditor(doc, true);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                      >
                        <Eye className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                        <span>Read Mode</span>
                      </button>
                      {onOpenToolForDocument && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuDocId(null);
                              onOpenToolForDocument(doc, 'remove-watermark');
                            }}
                            className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#15803D] dark:text-[#4ADE80] font-semibold cursor-pointer"
                          >
                            <Sparkles className="w-4 h-4 text-[#15803D]" />
                            <span>Remove Watermark</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuDocId(null);
                              onOpenToolForDocument(doc, 'split-pdf');
                            }}
                            className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                          >
                            <Scissors className="w-4 h-4 text-[#D97706]" />
                            <span>Split PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuDocId(null);
                              onOpenToolForDocument(doc, 'organize-pdf');
                            }}
                            className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                          >
                            <LayoutGrid className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                            <span>Organize Pages</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          onToggleStar(doc);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            doc.starred
                              ? 'fill-[#D97706] text-[#D97706]'
                              : 'text-[#D97706]'
                          }`}
                        />
                        <span>
                          {doc.starred ? 'Remove Star' : 'Add to Starred'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          handleShareDoc(doc);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                      >
                        <Share2 className="w-4 h-4 text-[#2563EB]" />
                        <span>Share PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          onDownloadDocument(doc);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-[#15803D]" />
                        <span>Download PDF</span>
                      </button>
                      <div className="my-1 border-t border-[#E4DFEC] dark:border-[#342A45]" />
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuDocId(null);
                          onRequestDeleteDocument(doc);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#DC2626]/10 text-[#DC2626] font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Delete File</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom Floating Batch Multi-PDF Action Bar when in Selection Mode */}
      {isSelectionMode ? (
        <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-3xl z-40 rounded-2xl bg-[#14101B]/95 dark:bg-[#1E172B]/98 backdrop-blur-md text-white border border-white/15 shadow-2xl p-3 space-y-2.5 animate-in slide-in-from-bottom-4 duration-150">
          {batchBusyLabel && (
            <div className="flex items-center justify-center gap-2 py-1 text-xs font-semibold text-blue-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{batchBusyLabel}</span>
            </div>
          )}

          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 sm:gap-2">
            {/* 1. Instant Merge PDFs (2+ files) */}
            <button
              type="button"
              disabled={selectedDocuments.length < 2 || Boolean(batchBusyLabel)}
              onClick={async () => {
                if (!onBatchMergeDocuments || selectedDocuments.length < 2)
                  return;
                setBatchBusyLabel(
                  `Merging ${selectedDocuments.length} PDFs...`
                );
                try {
                  await onBatchMergeDocuments(selectedDocuments, 'instant');
                  exitSelectionMode();
                } finally {
                  setBatchBusyLabel(null);
                }
              }}
              title="Combine selected PDFs into one PDF immediately"
              className="p-2 rounded-xl bg-[#0088FF] hover:bg-[#0077E6] disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
            >
              <Merge className="w-4 h-4" />
              <span className="text-[10px] font-bold leading-tight text-center">
                Merge Now
              </span>
            </button>

            {/* 2. Open in Merge Studio (Reorder & Merge) */}
            <button
              type="button"
              disabled={selectedDocuments.length < 2 || Boolean(batchBusyLabel)}
              onClick={async () => {
                if (!onBatchMergeDocuments || selectedDocuments.length < 2)
                  return;
                await onBatchMergeDocuments(selectedDocuments, 'studio');
                exitSelectionMode();
              }}
              title="Open selected PDFs in Merge Studio to reorder before merging"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
            >
              <LayoutGrid className="w-4 h-4 text-sky-300" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                Merge Studio
              </span>
            </button>

            {/* 3. Compress Selected PDFs */}
            <button
              type="button"
              disabled={selectedDocuments.length < 1 || Boolean(batchBusyLabel)}
              onClick={async () => {
                if (!onBatchCompressDocuments || selectedDocuments.length < 1)
                  return;
                setBatchBusyLabel(
                  `Compressing ${selectedDocuments.length} PDF(s)...`
                );
                try {
                  await onBatchCompressDocuments(selectedDocuments);
                  exitSelectionMode();
                } finally {
                  setBatchBusyLabel(null);
                }
              }}
              title="Compress all selected PDFs"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
            >
              <Minimize2 className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                Compress
              </span>
            </button>

            {/* 4. Remove Watermarks from Selected PDFs */}
            <button
              type="button"
              disabled={selectedDocuments.length < 1 || Boolean(batchBusyLabel)}
              onClick={async () => {
                if (
                  !onBatchRemoveWatermarkDocuments ||
                  selectedDocuments.length < 1
                )
                  return;
                setBatchBusyLabel(
                  `Removing watermarks from ${selectedDocuments.length} PDF(s)...`
                );
                try {
                  await onBatchRemoveWatermarkDocuments(selectedDocuments);
                  exitSelectionMode();
                } finally {
                  setBatchBusyLabel(null);
                }
              }}
              title="Clean watermarks from all selected PDFs"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                Clean Mark
              </span>
            </button>

            {/* 5. Share Selected PDFs */}
            <button
              type="button"
              disabled={selectedDocuments.length < 1 || Boolean(batchBusyLabel)}
              onClick={async () => {
                if (!onBatchShareDocuments || selectedDocuments.length < 1)
                  return;
                await onBatchShareDocuments(selectedDocuments);
              }}
              title="Share all selected PDFs"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
            >
              <Share2 className="w-4 h-4 text-blue-300" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                Share ({selectedDocuments.length})
              </span>
            </button>

            {/* 6. Download Selected PDFs */}
            <button
              type="button"
              disabled={selectedDocuments.length < 1 || Boolean(batchBusyLabel)}
              onClick={() => {
                if (onBatchDownloadDocuments && selectedDocuments.length > 0) {
                  onBatchDownloadDocuments(selectedDocuments);
                  exitSelectionMode();
                }
              }}
              title="Download all selected PDFs"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
            >
              <Download className="w-4 h-4 text-green-300" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                Download
              </span>
            </button>

            {/* 7. Delete Selected PDFs */}
            <button
              type="button"
              disabled={selectedDocuments.length < 1 || Boolean(batchBusyLabel)}
              onClick={() => {
                if (
                  onRequestBatchDeleteDocuments &&
                  selectedDocuments.length > 0
                ) {
                  onRequestBatchDeleteDocuments(selectedDocuments);
                  exitSelectionMode();
                } else if (selectedDocuments.length === 1) {
                  onRequestDeleteDocument(selectedDocuments[0]);
                  exitSelectionMode();
                }
              }}
              title="Delete all selected PDFs"
              className="p-2 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-40 text-white flex flex-col items-center justify-center gap-1 cursor-pointer transition-all col-span-2 sm:col-span-1"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-[10px] font-bold leading-tight text-center">
                Delete ({selectedDocuments.length})
              </span>
            </button>
          </div>
        </div>
      ) : (
        /* Floating Bottom-Right Dual-Action Blue Pill Button matching image_597cb37c.png: [ 📷 | + ] */
        <div className="fixed bottom-6 right-6 z-40 rounded-full bg-[#0088FF] text-white shadow-xl flex items-center overflow-hidden border border-white/15">
          <button
            type="button"
            onClick={() => onNavigate('scanner')}
            title="Scan with Full-Screen Camera"
            aria-label="Scan Document with Camera"
            className="h-13 pl-5 pr-4 hover:bg-[#0077E6] active:bg-[#0066CC] transition-colors flex items-center justify-center cursor-pointer"
          >
            <Camera className="w-6 h-6 text-white" />
          </button>
          <div className="w-px h-6 bg-white/40 shrink-0" />
          <button
            type="button"
            onClick={() => pdfInputRef.current?.click()}
            disabled={isUploading}
            title="Import or Open PDF / Document"
            aria-label="Import Document"
            className="h-13 pl-4 pr-5 hover:bg-[#0077E6] active:bg-[#0066CC] disabled:opacity-60 transition-colors flex items-center justify-center cursor-pointer"
          >
            <Plus className="w-6 h-6 text-white stroke-[2.5]" />
          </button>
        </div>
      )}
    </div>
  );
};
