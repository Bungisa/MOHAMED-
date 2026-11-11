import React, { useState, useRef } from 'react';
import {
  Camera,
  FileUp,
  ImagePlus,
  Search,
  FileEdit,
  Merge,
  Scissors,
  Minimize2,
  Images,
  LayoutGrid,
  ScanText,
  Star,
  Trash2,
  Eye,
  FolderOpen,
  ArrowUpRight,
  Share2,
  FileText,
  FileOutput,
} from 'lucide-react';
import {
  StoredDocument,
  ActiveView,
  ToolId,
} from '../types/document';
import { formatBytes } from '../services/storageService';

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

export const DashboardView: React.FC<DashboardViewProps> = ({
  documents,
  onNavigate,
  onOpenTool,
  onOpenDocumentInEditor,
  onRequestOpenWithOptions,
  onUploadPdfFiles,
  onImportImagesToScanner,
  onToggleStar,
  onDownloadDocument,
  onRequestDeleteDocument,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfReaderInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

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

  const handlePdfReaderUploadChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      e.target.value = '';
      setIsUploading(true);
      try {
        await onUploadPdfFiles(selectedFiles, true, true);
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

  const filteredDocs = documents.filter((doc) => {
    if (!searchQuery.trim()) return true;
    return (
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="max-w-6xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5">
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
        ref={pdfReaderInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.rtf,.txt,.md,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/rtf,image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handlePdfReaderUploadChange}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleImageUploadChange}
      />

      {/* Section 1: 4 Simple, Prominent Action Tiles (2x2 on Phone, 4 columns on Desktop) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <button
          onClick={() => pdfReaderInputRef.current?.click()}
          disabled={isUploading}
          className="text-left p-3.5 sm:p-4 rounded-2xl bg-[#003FE8] hover:bg-[#0033BA] text-white transition-colors cursor-pointer flex items-center gap-3 shadow-xs"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Eye className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold truncate">Read File</p>
            <p className="text-[11px] opacity-85 truncate">PDF, Word & Docs</p>
          </div>
        </button>

        <button
          onClick={() => onNavigate('scanner')}
          className="text-left p-3.5 sm:p-4 rounded-2xl bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] transition-colors cursor-pointer flex items-center gap-3 shadow-xs"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/15 dark:bg-black/15 flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold truncate">Scan Page</p>
            <p className="text-[11px] opacity-85 truncate">Camera & Crop</p>
          </div>
        </button>

        <button
          onClick={() => pdfInputRef.current?.click()}
          disabled={isUploading}
          className="text-left p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] border border-[#E4DFEC] dark:border-[#261F33] transition-colors cursor-pointer flex items-center gap-3"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33] flex items-center justify-center shrink-0 text-[#4A1D5E] dark:text-[#D5B3FF]">
            <FileUp className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold truncate">
              {isUploading ? 'Opening...' : 'Open & Edit'}
            </p>
            <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] truncate">
              PDF, Word & Docs
            </p>
          </div>
        </button>

        <button
          onClick={() => imgInputRef.current?.click()}
          className="text-left p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] border border-[#E4DFEC] dark:border-[#261F33] transition-colors cursor-pointer flex items-center gap-3"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33] flex items-center justify-center shrink-0 text-[#4A1D5E] dark:text-[#D5B3FF]">
            <ImagePlus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold truncate">Photo to PDF</p>
            <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] truncate">
              Gallery to A4
            </p>
          </div>
        </button>
      </section>

      {/* Section 2: Clean 8-Icon Quick Tools Grid (4x2 on Phone, 8x1 on Desktop) */}
      <section className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
            Quick PDF & Word Tools
          </h2>
          <button
            onClick={() => onNavigate('tools')}
            className="text-xs font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>All Tools</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
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

      {/* Section 3: Recent Documents (Simple, Clean Mobile Rows with Visible Buttons) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] whitespace-nowrap">
            Recent Files ({documents.length})
          </h2>

          <div className="flex items-center gap-2 flex-1 max-w-xs justify-end">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#6E667D] dark:text-[#A39BB5] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] placeholder-[#6E667D] focus:outline-none focus:border-[#4A1D5E]"
              />
            </div>
            <button
              onClick={() => onNavigate('documents')}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              All Files
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden">
          {filteredDocs.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <FolderOpen className="w-7 h-7 text-[#6E667D] dark:text-[#A39BB5] mx-auto" />
              <p className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8]">
                No PDF files found
              </p>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                Tap Read PDF or Scan Page above to get started.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4DFEC] dark:divide-[#261F33]">
              {filteredDocs.slice(0, 8).map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 sm:px-4 flex items-center justify-between gap-2.5 hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/40 transition-colors"
                >
                  {/* Left: Star + Document Name & Info (Tap to open action sheet) */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      onClick={() => onToggleStar(doc)}
                      title={doc.starred ? 'Remove star' : 'Star document'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#D97706] cursor-pointer shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          doc.starred ? 'fill-[#D97706] text-[#D97706]' : ''
                        }`}
                      />
                    </button>

                    <button
                      onClick={() =>
                        onRequestOpenWithOptions
                          ? onRequestOpenWithOptions(doc)
                          : onOpenDocumentInEditor(doc, true)
                      }
                      className="text-left min-w-0 flex-1 cursor-pointer group"
                    >
                      <p className="text-xs sm:text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] group-hover:text-[#4A1D5E] dark:group-hover:text-[#D5B3FF] truncate">
                        {doc.name}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#6E667D] dark:text-[#A39BB5] mt-0.5 font-mono tabular-nums">
                        <span>{doc.pageCount}p</span>
                        <span>·</span>
                        <span>{formatBytes(doc.sizeBytes)}</span>
                      </div>
                    </button>
                  </div>

                  {/* Right: Compact, Always-Visible Actions (Read, Edit, Share/Download, Delete) */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onOpenDocumentInEditor(doc, true)}
                      title="Read PDF"
                      className="h-9 px-2.5 sm:px-3 rounded-lg bg-[#003FE8]/10 text-[#003FE8] dark:bg-[#38BDF8]/20 dark:text-[#38BDF8] hover:bg-[#003FE8] hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span>Read</span>
                    </button>

                    <button
                      onClick={() => onOpenDocumentInEditor(doc, false)}
                      title="Edit PDF"
                      className="h-9 px-2.5 sm:px-3 rounded-lg bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF] hover:bg-[#4A1D5E] hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FileEdit className="w-3.5 h-3.5 shrink-0" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={async () => {
                        const fileObj = new File(
                          [new Uint8Array(doc.pdfData)],
                          doc.name,
                          { type: 'application/pdf' }
                        );
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
                      }}
                      title="Share or Download PDF"
                      className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#2563EB] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer shrink-0"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onRequestDeleteDocument(doc)}
                      title="Delete File"
                      className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#DC2626] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
