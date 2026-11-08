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
  FileImage,
  Images,
  RotateCw,
  LayoutGrid,
  ScanText,
  Star,
  Download,
  Trash2,
  Eye,
  FolderOpen,
  HardDrive,
  ShieldCheck,
  ArrowUpRight,
  Share2,
} from 'lucide-react';
import {
  StoredDocument,
  ActiveView,
  ToolId,
  DocumentCategory,
} from '../types/document';
import { formatBytes } from '../services/storageService';

interface DashboardViewProps {
  documents: StoredDocument[];
  onNavigate: (view: ActiveView) => void;
  onOpenTool: (tool: ToolId) => void;
  onOpenToolForDocument?: (doc: StoredDocument, tool: ToolId) => void;
  onOpenDocumentInEditor: (doc: StoredDocument, readerMode?: boolean) => void;
  onUploadPdfFiles: (files: FileList | File[]) => Promise<void>;
  onImportImagesToScanner: (files: FileList | File[]) => void;
  onToggleStar: (doc: StoredDocument) => Promise<void>;
  onDownloadDocument: (doc: StoredDocument) => void;
  onRequestDeleteDocument: (doc: StoredDocument) => void;
}

const TOOL_GROUPS: {
  groupTitle: string;
  groupSubtitle: string;
  tools: {
    id: ToolId;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}[] = [
  {
    groupTitle: '01. Capture & Full-Screen Editing',
    groupSubtitle: 'Scan physical pages or edit, annotate, and remove watermarks',
    tools: [
      {
        id: 'scan-to-pdf',
        title: 'Scan to PDF',
        description: 'Auto-corner crop & OCV BLACK filter',
        icon: Camera,
      },
      {
        id: 'edit-pdf',
        title: 'Edit PDF & Watermark',
        description: 'Add text, remove watermarks & filter',
        icon: FileEdit,
      },
      {
        id: 'img-to-pdf',
        title: 'Photos to PDF',
        description: 'Combine device images into A4 PDF',
        icon: FileImage,
      },
    ],
  },
  {
    groupTitle: '02. Page & File Size Tools',
    groupSubtitle: 'Extract page ranges, combine documents, or shrink PDF size',
    tools: [
      {
        id: 'split-pdf',
        title: 'Split / Extract PDF',
        description: 'Extract page ranges & download',
        icon: Scissors,
      },
      {
        id: 'merge-pdf',
        title: 'Merge PDFs',
        description: 'Combine multiple PDFs in order',
        icon: Merge,
      },
      {
        id: 'compress-pdf',
        title: 'Compress PDF',
        description: 'Shrink file size with quality control',
        icon: Minimize2,
      },
      {
        id: 'organize-pdf',
        title: 'Organize & Rotate',
        description: 'Reorder, rotate, or delete pages',
        icon: LayoutGrid,
      },
    ],
  },
  {
    groupTitle: '03. Convert & Text Recognition (OCR)',
    groupSubtitle: 'Export pages as pictures or extract English & Swahili text',
    tools: [
      {
        id: 'pdf-to-img',
        title: 'PDF to Pictures',
        description: 'Save pages as JPG/PNG & add text',
        icon: Images,
      },
      {
        id: 'ocr-pdf',
        title: 'OCR – Extract Text',
        description: 'Recognize English & Swahili text',
        icon: ScanText,
      },
      {
        id: 'rotate-pdf',
        title: 'Rotate Pages',
        description: 'Fix upside-down or sideways pages',
        icon: RotateCw,
      },
    ],
  },
];

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
  const [isUploading, setIsUploading] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUploadChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      e.target.value = '';
      setIsUploading(true);
      try {
        await onUploadPdfFiles(selectedFiles);
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

  const totalStorageBytes = documents.reduce((acc, d) => acc + d.sizeBytes, 0);
  const totalPages = documents.reduce((acc, d) => acc + d.pageCount, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-8">
      {/* Hidden File Inputs */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
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

      {/* Primary Action Hub */}
      <section className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-5 sm:p-7 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <p className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
              On-Device Document Scanner & PDF Studio
            </p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] text-balance">
              What would you like to do with your document today?
            </h1>
          </div>

          {/* Compact Vault Status Summary */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#6E667D] dark:text-[#A39BB5]">
            <span className="font-mono tabular-nums">
              <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                {documents.length}
              </strong>{' '}
              PDFs
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                {totalPages}
              </strong>{' '}
              Pages
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {formatBytes(totalStorageBytes)} used
            </span>
          </div>
        </div>

        {/* 3 Clear Primary Entry Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <button
            onClick={() => onNavigate('scanner')}
            className="text-left p-4 sm:p-5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] transition-colors cursor-pointer flex items-start gap-3.5 shadow-xs"
          >
            <div className="w-11 h-11 rounded-xl bg-white/15 dark:bg-black/15 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold whitespace-nowrap">
                Scan with Camera
              </p>
              <p className="text-xs opacity-85 mt-0.5 leading-snug">
                Auto-detect corners, perspective crop & OCV BLACK
              </p>
            </div>
          </button>

          <button
            onClick={() => pdfInputRef.current?.click()}
            disabled={isUploading}
            className="text-left p-4 sm:p-5 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] dark:hover:bg-[#342B47] text-[#14101B] dark:text-[#F4F1F8] border border-[#E4DFEC] dark:border-[#342B47] transition-colors cursor-pointer flex items-start gap-3.5"
          >
            <div className="w-11 h-11 rounded-xl bg-white dark:bg-[#16111F] flex items-center justify-center shrink-0 text-[#4A1D5E] dark:text-[#D5B3FF]">
              <FileUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold whitespace-nowrap">
                {isUploading ? 'Opening PDF...' : 'Open & Edit PDF'}
              </p>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5 leading-snug">
                Upload a PDF to edit text, remove watermarks & compress
              </p>
            </div>
          </button>

          <button
            onClick={() => imgInputRef.current?.click()}
            className="text-left p-4 sm:p-5 rounded-xl bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] border border-[#E4DFEC] dark:border-[#261F33] transition-colors cursor-pointer flex items-start gap-3.5"
          >
            <div className="w-11 h-11 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33] flex items-center justify-center shrink-0 text-[#4A1D5E] dark:text-[#D5B3FF]">
              <ImagePlus className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold whitespace-nowrap">
                Import Photo to Crop
              </p>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5 leading-snug">
                Pick a photo from gallery for corner detection & PDF scan
              </p>
            </div>
          </button>
        </div>
      </section>

      {/* Recent Documents with Direct One-Tap Contextual Actions */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
              Recent Documents
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Tap any document to open in the Full-Screen Editor, or use quick actions on the right
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-[#6E667D] dark:text-[#A39BB5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Quick find document..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] placeholder-[#6E667D] dark:placeholder-[#A39BB5] focus:outline-none focus:border-[#4A1D5E] dark:focus:border-[#9D5CE5]"
              />
            </div>
            <button
              onClick={() => onNavigate('documents')}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <span>All Files ({documents.length})</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden">
          {filteredDocs.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <FolderOpen className="w-8 h-8 text-[#6E667D] dark:text-[#A39BB5] mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8]">
                  No documents match your search
                </p>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Scan a new document or upload an existing PDF to get started.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#E4DFEC] dark:divide-[#261F33]">
              {filteredDocs.slice(0, 6).map((doc) => (
                <div
                  key={doc.id}
                  className="p-3.5 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => onToggleStar(doc)}
                      title={doc.starred ? 'Remove star' : 'Star document'}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#D97706] hover:bg-[#E4DFEC]/50 dark:hover:bg-[#261F33] cursor-pointer shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          doc.starred ? 'fill-[#D97706] text-[#D97706]' : ''
                        }`}
                      />
                    </button>

                    <button
                      onClick={() => onOpenDocumentInEditor(doc, false)}
                      className="text-left min-w-0 flex-1 cursor-pointer group"
                    >
                      <p className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] group-hover:text-[#4A1D5E] dark:group-hover:text-[#D5B3FF] truncate">
                        {doc.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5 font-mono tabular-nums">
                        <span>{doc.pageCount} pg</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatBytes(doc.sizeBytes)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans">{doc.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(doc.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Direct Contextual Action Strip */}
                  <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                    <button
                      onClick={() => onOpenDocumentInEditor(doc, false)}
                      className="px-3 py-1.5 rounded-lg bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF] hover:bg-[#4A1D5E] hover:text-white dark:hover:bg-[#9D5CE5] dark:hover:text-[#0D0A12] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={() =>
                        onOpenToolForDocument
                          ? onOpenToolForDocument(doc, 'split-pdf')
                          : onOpenTool('split-pdf')
                      }
                      title="Split or extract pages from this PDF"
                      className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-medium text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Scissors className="w-3.5 h-3.5 text-[#6E667D] dark:text-[#A39BB5]" />
                      <span>Split</span>
                    </button>

                    <button
                      onClick={() =>
                        onOpenToolForDocument
                          ? onOpenToolForDocument(doc, 'compress-pdf')
                          : onOpenTool('compress-pdf')
                      }
                      title="Compress this PDF"
                      className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-medium text-[#14101B] dark:text-[#F4F1F8] hidden sm:flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Minimize2 className="w-3.5 h-3.5 text-[#6E667D] dark:text-[#A39BB5]" />
                      <span>Compress</span>
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
                              text: `Sharing PDF from ScanPro Studio: ${doc.name}`,
                              files: [fileObj],
                            });
                            return;
                          } catch {
                            // Fall back to direct download
                          }
                        }
                        onDownloadDocument(doc);
                      }}
                      title="Share PDF via WhatsApp, Google Drive, or Email"
                      className="w-8 h-8 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#2563EB] dark:hover:text-[#60A5FA] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDownloadDocument(doc)}
                      title="Download PDF"
                      className="w-8 h-8 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#15803D] dark:hover:text-[#4ADE80] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onRequestDeleteDocument(doc)}
                      title="Delete Document"
                      className="w-8 h-8 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#6E667D] dark:text-[#A39BB5] hover:text-[#DC2626] dark:hover:text-[#F87171] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
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

      {/* Grouped PDF & Recognition Tools (3 Organized Pillars) */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
              Document Tools by Task
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Organized into 3 clear groups so you can find the right tool immediately
            </p>
          </div>
          <button
            onClick={() => onNavigate('tools')}
            className="text-xs font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Open Workbench</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {TOOL_GROUPS.map((group) => (
            <div
              key={group.groupTitle}
              className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-5 space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="border-b border-[#E4DFEC] dark:border-[#261F33] pb-3">
                  <h3 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    {group.groupTitle}
                  </h3>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5">
                    {group.groupSubtitle}
                  </p>
                </div>

                <div className="space-y-2">
                  {group.tools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.id}
                        onClick={() => onOpenTool(tool.id)}
                        className="w-full group text-left p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12]/60 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] border border-transparent hover:border-[#4A1D5E]/30 dark:hover:border-[#9D5CE5]/40 transition-colors cursor-pointer flex items-center gap-3.5"
                      >
                        <div className="w-10 h-10 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33] group-hover:bg-[#4A1D5E] dark:group-hover:bg-[#9D5CE5] flex items-center justify-center shrink-0 transition-colors">
                          <Icon className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] group-hover:text-white dark:group-hover:text-[#0D0A12] transition-colors" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] group-hover:text-[#4A1D5E] dark:group-hover:text-[#D5B3FF] transition-colors">
                            {tool.title}
                          </p>
                          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
                            {tool.description}
                          </p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-[#6E667D] dark:text-[#A39BB5] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
