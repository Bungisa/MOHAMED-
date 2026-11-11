import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  FileUp,
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
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<'all' | 'starred'>('all');
  const [isUploading, setIsUploading] = useState(false);
  const [openMenuDocId, setOpenMenuDocId] = useState<string | null>(null);
  const [thumbnailsMap, setThumbnailsMap] = useState<Record<string, string>>({});

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

      {/* Section 1: Unified Top Action Cards (2 Primary Cards) */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1 (Royal Blue): Open / Edit PDF */}
        <button
          onClick={() => pdfInputRef.current?.click()}
          disabled={isUploading}
          className="text-left p-5 sm:p-6 rounded-2xl bg-[#003FE8] hover:bg-[#0033BA] text-white transition-all cursor-pointer flex items-center gap-4 shadow-sm"
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <FileUp className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-bold tracking-tight">
              {isUploading ? 'Opening Document...' : 'Open / Edit PDF'}
            </h2>
            <p className="text-xs sm:text-sm text-white/85 mt-0.5 leading-snug">
              Read, annotate, sign, or watermark any document
            </p>
          </div>
        </button>

        {/* Card 2 (Deep Purple): Scan Document */}
        <button
          onClick={() => onNavigate('scanner')}
          className="text-left p-5 sm:p-6 rounded-2xl bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#7E3AF2] dark:hover:bg-[#6C2BD9] text-white transition-all cursor-pointer flex items-center gap-4 shadow-sm"
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <Camera className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-bold tracking-tight">
              Scan Document
            </h2>
            <p className="text-xs sm:text-sm text-white/85 mt-0.5 leading-snug">
              Use your camera to scan paper exams into crisp PDFs
            </p>
          </div>
        </button>
      </section>

      {/* Section 2: Quick PDF & Word Tools (Single Horizontal Row of 8 Core Tools) */}
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

              return (
                <div
                  key={doc.id}
                  onClick={() => onOpenDocumentInEditor(doc, false)}
                  className="relative rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#0088FF]/50 p-3 shadow-2xs flex items-center gap-3.5 transition-all cursor-pointer"
                >
                  {/* Left: Document Page 1 Miniature Thumbnail inside soft gray rounded frame */}
                  <div className="w-16 h-14 sm:w-20 sm:h-16 rounded-lg bg-[#F1F2F6] dark:bg-[#261F33] p-1 flex items-center justify-center shrink-0 overflow-hidden border border-[#E4DFEC]/70 dark:border-[#342A45]">
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={doc.name}
                        className="w-full h-full object-cover object-top rounded-[4px] bg-white shadow-2xs"
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
                  <div
                    className="flex items-center gap-1 shrink-0"
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

                  {/* Dropdown Action Menu when ••• is clicked */}
                  {isMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-3 top-12 w-52 rounded-xl bg-white dark:bg-[#1E172B] border border-[#E4DFEC] dark:border-[#342A45] shadow-xl py-1.5 z-30 text-xs"
                    >
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

      {/* Floating Bottom-Right Dual-Action Blue Pill Button matching image_597cb37c.png: [ 📷 | + ] */}
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
          title="Import or Open PDF / Document"
          aria-label="Import Document"
          className="h-13 pl-4 pr-5 hover:bg-[#0077E6] active:bg-[#0066CC] transition-colors flex items-center justify-center cursor-pointer"
        >
          <Plus className="w-6 h-6 text-white stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
