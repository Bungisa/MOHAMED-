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
  onOpenDocumentInEditor: (doc: StoredDocument, readerMode?: boolean) => void;
  onUploadPdfFiles: (files: FileList | File[]) => Promise<void>;
  onImportImagesToScanner: (files: FileList | File[]) => void;
  onToggleStar: (doc: StoredDocument) => Promise<void>;
  onDownloadDocument: (doc: StoredDocument) => void;
  onRequestDeleteDocument: (doc: StoredDocument) => void;
}

const QUICK_TOOLS: {
  id: ToolId;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'scan-to-pdf',
    title: 'Scan to PDF',
    description: 'Camera capture with edge warp',
    icon: Camera,
  },
  {
    id: 'edit-pdf',
    title: 'Edit PDF',
    description: 'Annotate, whiteout & watermark',
    icon: FileEdit,
  },
  {
    id: 'merge-pdf',
    title: 'Merge PDF',
    description: 'Combine multiple files in order',
    icon: Merge,
  },
  {
    id: 'split-pdf',
    title: 'Split PDF',
    description: 'Extract ranges or burst pages',
    icon: Scissors,
  },
  {
    id: 'compress-pdf',
    title: 'Compress PDF',
    description: 'Reduce file size with quality control',
    icon: Minimize2,
  },
  {
    id: 'img-to-pdf',
    title: 'Convert Image to PDF',
    description: 'Batch images into A4/Letter PDF',
    icon: FileImage,
  },
  {
    id: 'pdf-to-img',
    title: 'PDF to Images',
    description: 'Render pages as PNG or JPG',
    icon: Images,
  },
  {
    id: 'rotate-pdf',
    title: 'Rotate PDF',
    description: 'Fix page orientation permanently',
    icon: RotateCw,
  },
  {
    id: 'organize-pdf',
    title: 'Organize Pages',
    description: 'Reorder, insert blank, or delete',
    icon: LayoutGrid,
  },
  {
    id: 'ocr-pdf',
    title: 'OCR – Extract Text',
    description: 'Recognize English & Swahili text',
    icon: ScanText,
  },
];

const CATEGORIES: ('All' | DocumentCategory | 'Starred')[] = [
  'All',
  'Starred',
  'Scans',
  'Contracts',
  'Receipts',
  'Reports',
  'Forms',
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  documents,
  onNavigate,
  onOpenTool,
  onOpenDocumentInEditor,
  onUploadPdfFiles,
  onImportImagesToScanner,
  onToggleStar,
  onDownloadDocument,
  onRequestDeleteDocument,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<
    'All' | DocumentCategory | 'Starred'
  >('All');
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
    const matchesSearch =
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.category.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (activeCategory === 'All') return true;
    if (activeCategory === 'Starred') return doc.starred;
    return doc.category === activeCategory;
  });

  const totalStorageBytes = documents.reduce((acc, d) => acc + d.sizeBytes, 0);
  const totalPages = documents.reduce((acc, d) => acc + d.pageCount, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
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

      {/* Welcome & Primary Capture Action Deck */}
      <section className="rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
              Local-First Document Studio · IndexedDB Encrypted Vault
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] text-balance">
              Capture, rectify, edit, and archive documents without leaving your browser.
            </h1>
            <p className="text-sm text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
              Scan physical pages with perspective correction, annotate or reorganize multi-page PDFs, and run bilingual Optical Character Recognition locally on your device.
            </p>
          </div>

          {/* 3 Primary Action Buttons */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
            <button
              onClick={() => onNavigate('scanner')}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-5 py-3 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] font-semibold text-sm shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Scan Document</span>
            </button>

            <button
              onClick={() => pdfInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] dark:hover:bg-[#342B47] text-[#14101B] dark:text-[#F4F1F8] font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileUp className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
              <span>{isUploading ? 'Importing...' : 'Upload PDF'}</span>
            </button>

            <button
              onClick={() => imgInputRef.current?.click()}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ImagePlus className="w-4 h-4 text-[#6E667D] dark:text-[#A39BB5] shrink-0" />
              <span>Import Image</span>
            </button>
          </div>
        </div>

        {/* Summary Metrics Strip */}
        <div className="mt-6 pt-6 border-t border-[#E4DFEC] dark:border-[#261F33] grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">Stored Documents</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-[#14101B] dark:text-[#F4F1F8]">
              {documents.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">Total Indexed Pages</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-[#14101B] dark:text-[#F4F1F8]">
              {totalPages}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">Local Vault Footprint</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-[#14101B] dark:text-[#F4F1F8]">
              {formatBytes(totalStorageBytes)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">Processing Engine</p>
            <p className="mt-1 text-sm font-semibold text-[#15803D] dark:text-[#4ADE80] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>100% On-Device Sandbox</span>
            </p>
          </div>
        </div>
      </section>

      {/* Quick PDF Tools (10 Functional Modules) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
              Quick PDF & Recognition Tools
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Launch any specialized document processor directly
            </p>
          </div>
          <button
            onClick={() => onNavigate('tools')}
            className="text-xs font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Open All Tools</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {QUICK_TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => onOpenTool(tool.id)}
                className="group text-left p-4 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E] dark:hover:border-[#9D5CE5] transition-colors cursor-pointer flex flex-col justify-between gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] group-hover:bg-[#4A1D5E] dark:group-hover:bg-[#9D5CE5] flex items-center justify-center transition-colors">
                  <Icon className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] group-hover:text-white dark:group-hover:text-[#0D0A12] transition-colors" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] group-hover:text-[#4A1D5E] dark:group-hover:text-[#D5B3FF] transition-colors">
                    {tool.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-[#6E667D] dark:text-[#A39BB5] line-clamp-1">
                    {tool.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent Documents & Search/Category Filter */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
              Recent Documents
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Stored persistently in browser IndexedDB
            </p>
          </div>

          {/* Search input */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-[#6E667D] dark:text-[#A39BB5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by file name or category..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] placeholder-[#6E667D] dark:placeholder-[#A39BB5] focus:outline-none focus:border-[#4A1D5E] dark:focus:border-[#9D5CE5]"
              />
            </div>
            <button
              onClick={() => onNavigate('documents')}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Manage Library
            </button>
          </div>
        </div>

        {/* Interactive Category Segmented Filter Bar */}
        <div className="flex items-center gap-1 p-1 bg-[#F2EFF6] dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg overflow-x-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeCategory === cat
                  ? 'bg-white dark:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] shadow-xs font-semibold'
                  : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* High-Density Document Table */}
        <div className="rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden">
          {filteredDocs.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <FolderOpen className="w-8 h-8 text-[#6E667D] dark:text-[#A39BB5] mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8]">
                  No matching documents found
                </p>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Scan a new document with your camera or upload an existing PDF to get started.
                </p>
              </div>
              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  onClick={() => onNavigate('scanner')}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] cursor-pointer"
                >
                  Launch Scanner
                </button>
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-[#E4DFEC] dark:border-[#261F33] cursor-pointer"
                >
                  Upload PDF
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                    <th className="py-3 pl-4 pr-2 w-8"></th>
                    <th className="py-3 px-3">Document Name</th>
                    <th className="py-3 px-3 hidden sm:table-cell">Metadata</th>
                    <th className="py-3 px-3 text-right hidden md:table-cell">Pages</th>
                    <th className="py-3 px-3 text-right hidden sm:table-cell">Size</th>
                    <th className="py-3 px-3 text-right hidden lg:table-cell">Modified</th>
                    <th className="py-3 pl-3 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4DFEC] dark:divide-[#261F33] text-sm">
                  {filteredDocs.slice(0, 8).map((doc) => (
                    <tr
                      key={doc.id}
                      className="hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/40 transition-colors group"
                    >
                      <td className="py-3 pl-4 pr-2">
                        <button
                          onClick={() => onToggleStar(doc)}
                          title={doc.starred ? 'Remove star' : 'Star document'}
                          className="text-[#6E667D] dark:text-[#A39BB5] hover:text-[#D97706] cursor-pointer"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              doc.starred
                                ? 'fill-[#D97706] text-[#D97706]'
                                : ''
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-3 px-3 font-medium text-[#14101B] dark:text-[#F4F1F8]">
                        <button
                          onClick={() => onOpenDocumentInEditor(doc, false)}
                          className="text-left hover:text-[#4A1D5E] dark:hover:text-[#D5B3FF] transition-colors cursor-pointer truncate max-w-[220px] sm:max-w-xs block"
                        >
                          {doc.name}
                        </button>
                      </td>
                      <td className="py-3 px-3 hidden sm:table-cell text-xs text-[#6E667D] dark:text-[#A39BB5]">
                        <span>{doc.category}</span>
                        {doc.annotations && doc.annotations.length > 0 && (
                          <>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{doc.annotations.length} annotations</span>
                          </>
                        )}
                        {doc.ocrText && (
                          <>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>OCR Indexed</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right hidden md:table-cell font-mono text-xs tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                        {doc.pageCount}
                      </td>
                      <td className="py-3 px-3 text-right hidden sm:table-cell font-mono text-xs tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                        {formatBytes(doc.sizeBytes)}
                      </td>
                      <td className="py-3 px-3 text-right hidden lg:table-cell font-mono text-xs tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                        {new Date(doc.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 pl-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onOpenDocumentInEditor(doc, true)}
                            title="Open in Clean Reader"
                            className="p-1.5 rounded-md text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33] cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onOpenDocumentInEditor(doc, false)}
                            title="Edit PDF & Annotate"
                            className="p-1.5 rounded-md text-[#6E667D] dark:text-[#A39BB5] hover:text-[#4A1D5E] dark:hover:text-[#D5B3FF] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33] cursor-pointer"
                          >
                            <FileEdit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDownloadDocument(doc)}
                            title="Download PDF"
                            className="p-1.5 rounded-md text-[#6E667D] dark:text-[#A39BB5] hover:text-[#15803D] dark:hover:text-[#4ADE80] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33] cursor-pointer"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onRequestDeleteDocument(doc)}
                            title="Delete Document"
                            className="p-1.5 rounded-md text-[#6E667D] dark:text-[#A39BB5] hover:text-[#DC2626] dark:hover:text-[#F87171] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33] cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
