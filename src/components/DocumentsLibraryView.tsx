import React, { useState } from 'react';
import {
  FolderPlus,
  Folder,
  Star,
  Clock,
  Files,
  Search,
  ArrowUpDown,
  Eye,
  FileEdit,
  Download,
  Trash2,
  Edit3,
  Check,
  X,
  FileUp,
} from 'lucide-react';
import {
  StoredDocument,
  DocumentFolder,
  DocumentCategory,
} from '../types/document';
import { formatBytes } from '../services/storageService';
import { renderPdfPage } from '../services/pdfService';

interface DocumentsLibraryViewProps {
  documents: StoredDocument[];
  folders: DocumentFolder[];
  onOpenInEditor: (doc: StoredDocument, readerMode?: boolean) => void;
  onRenameDocument: (doc: StoredDocument, newName: string) => Promise<void>;
  onToggleStar: (doc: StoredDocument) => Promise<void>;
  onAssignFolder: (
    doc: StoredDocument,
    folderId: string | null
  ) => Promise<void>;
  onChangeCategory: (
    doc: StoredDocument,
    category: DocumentCategory
  ) => Promise<void>;
  onDownloadDocument: (doc: StoredDocument) => void;
  onRequestDeleteDocument: (doc: StoredDocument) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onUploadPdfFiles: (files: FileList | File[]) => Promise<void>;
}

type LibraryFilterMode = 'all' | 'recent' | 'starred' | string; // folderId
type SortField = 'updatedAt' | 'name' | 'sizeBytes';

export const DocumentsLibraryView: React.FC<DocumentsLibraryViewProps> = ({
  documents,
  folders,
  onOpenInEditor,
  onRenameDocument,
  onToggleStar,
  onAssignFolder,
  onChangeCategory,
  onDownloadDocument,
  onRequestDeleteDocument,
  onCreateFolder,
  onDeleteFolder,
  onUploadPdfFiles,
}) => {
  const [filterMode, setFilterMode] = useState<LibraryFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortAsc, setSortAsc] = useState(false);

  // Folder creation
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Inline rename
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Quick Preview Drawer
  const [previewDoc, setPreviewDoc] = useState<StoredDocument | null>(null);
  const [previewImgUrl, setPreviewImgUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const handleOpenQuickPreview = async (doc: StoredDocument) => {
    setPreviewDoc(doc);
    if (doc.thumbnailDataUrl) {
      setPreviewImgUrl(doc.thumbnailDataUrl);
      return;
    }
    setIsLoadingPreview(true);
    try {
      const rendered = await renderPdfPage(doc.pdfData, 1, 1.2);
      setPreviewImgUrl(rendered.dataUrl);
    } catch {
      setPreviewImgUrl(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setShowNewFolderInput(false);
  };

  const filteredDocs = documents
    .filter((doc) => {
      const q = searchQuery.trim().toLowerCase();
      if (
        q &&
        !doc.name.toLowerCase().includes(q) &&
        !doc.category.toLowerCase().includes(q) &&
        !(doc.ocrText && doc.ocrText.toLowerCase().includes(q))
      ) {
        return false;
      }

      if (filterMode === 'all') return true;
      if (filterMode === 'starred') return doc.starred;
      if (filterMode === 'recent') {
        const sevenDaysAgo = Date.now() - 86400000 * 7;
        return new Date(doc.lastOpenedAt).getTime() >= sevenDaysAgo;
      }
      return doc.folderId === filterMode;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'sizeBytes') {
        cmp = a.sizeBytes - b.sizeBytes;
      } else {
        cmp =
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return sortAsc ? cmp : -cmp;
    });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
            Document Library & Local Vault
          </h1>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
            Organize documents into folders, search indexed OCR text, preview pages, or export PDFs
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowNewFolderInput(true)}
            className="px-3.5 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
            <span>New Folder</span>
          </button>

          <label className="px-4 py-2 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer">
            <FileUp className="w-4 h-4" />
            <span>Upload PDF</span>
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const filesSnapshot = Array.from(e.target.files);
                  e.target.value = '';
                  onUploadPdfFiles(filesSnapshot);
                }
              }}
            />
          </label>
        </div>
      </div>

      {showNewFolderInput && (
        <form
          onSubmit={handleCreateFolderSubmit}
          className="p-4 rounded-xl bg-white dark:bg-[#16111F] border border-[#4A1D5E] dark:border-[#9D5CE5] flex items-center gap-3"
        >
          <Folder className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Enter new folder name (e.g. Tax Receipts 2026)..."
            className="flex-1 text-xs px-3 py-2 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold cursor-pointer"
          >
            Create Folder
          </button>
          <button
            type="button"
            onClick={() => setShowNewFolderInput(false)}
            className="px-3 py-2 text-xs text-[#6E667D] cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Views & Folders Sidebar (3 cols) */}
        <div className="lg:col-span-3 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-3 space-y-4">
          <div className="space-y-1">
            <p className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#6E667D] dark:text-[#A39BB5]">
              Views
            </p>
            {(
              [
                { id: 'all', label: 'All Documents', icon: Files },
                { id: 'recent', label: 'Recently Opened', icon: Clock },
                { id: 'starred', label: 'Starred Documents', icon: Star },
              ] as const
            ).map((v) => {
              const Icon = v.icon;
              const active = filterMode === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setFilterMode(v.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-semibold'
                      : 'text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" />
                    <span>{v.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1 pt-2 border-t border-[#E4DFEC] dark:border-[#261F33]">
            <p className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#6E667D] dark:text-[#A39BB5]">
              Folders ({folders.length})
            </p>
            {folders.map((f) => {
              const active = filterMode === f.id;
              const count = documents.filter((d) => d.folderId === f.id).length;
              return (
                <div
                  key={f.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-semibold'
                      : 'text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                  }`}
                >
                  <button
                    onClick={() => setFilterMode(f.id)}
                    className="flex-1 flex items-center gap-2 text-left truncate cursor-pointer"
                  >
                    <Folder className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] tabular-nums">
                      {count}
                    </span>
                    <button
                      onClick={() => {
                        if (filterMode === f.id) setFilterMode('all');
                        onDeleteFolder(f.id);
                      }}
                      title="Delete folder"
                      className="opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center/Right Document Table & Preview (9 cols) */}
        <div className="lg:col-span-9 space-y-4">
          {/* Search & Sort Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6E667D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search filenames, categories, or recognized OCR text..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                Sort by:
              </span>
              {(['updatedAt', 'name', 'sizeBytes'] as const).map((field) => (
                <button
                  key={field}
                  onClick={() => {
                    if (sortField === field) {
                      setSortAsc(!sortAsc);
                    } else {
                      setSortField(field);
                      setSortAsc(field === 'name');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border cursor-pointer ${
                    sortField === field
                      ? 'border-[#4A1D5E] dark:border-[#9D5CE5] text-[#4A1D5E] dark:text-[#D5B3FF] font-semibold'
                      : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D]'
                  }`}
                >
                  <span>
                    {field === 'updatedAt'
                      ? 'Date'
                      : field === 'name'
                        ? 'Name'
                        : 'Size'}
                  </span>
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              ))}
            </div>
          </div>

          {/* Document Table */}
          <div className="rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden">
            {filteredDocs.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-bold">No documents in this view</p>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Try clearing your search filter or uploading a new PDF.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                      <th className="py-3 pl-4 pr-2 w-8"></th>
                      <th className="py-3 px-3">Document</th>
                      <th className="py-3 px-3 hidden md:table-cell">
                        Folder & Category
                      </th>
                      <th className="py-3 px-3 text-right hidden sm:table-cell">
                        Size & Pages
                      </th>
                      <th className="py-3 pl-3 pr-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4DFEC] dark:divide-[#261F33] text-xs">
                    {filteredDocs.map((doc) => {
                      const isRenaming = renamingDocId === doc.id;
                      return (
                        <tr
                          key={doc.id}
                          className="hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/40 transition-colors"
                        >
                          <td className="py-3 pl-4 pr-2">
                            <button
                              onClick={() => onToggleStar(doc)}
                              className="text-[#6E667D] hover:text-[#D97706] cursor-pointer"
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

                          <td className="py-3 px-3">
                            {isRenaming ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) =>
                                    setRenameValue(e.target.value)
                                  }
                                  className="px-2 py-1 text-xs rounded border border-[#4A1D5E] bg-[#FAF9FB] dark:bg-[#0D0A12]"
                                />
                                <button
                                  onClick={async () => {
                                    if (renameValue.trim()) {
                                      await onRenameDocument(
                                        doc,
                                        renameValue.trim()
                                      );
                                    }
                                    setRenamingDocId(null);
                                  }}
                                  className="p-1 text-[#15803D] cursor-pointer"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setRenamingDocId(null)}
                                  className="p-1 text-[#6E667D] cursor-pointer"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div>
                                <button
                                  onClick={() => onOpenInEditor(doc, false)}
                                  className="font-bold text-sm text-[#14101B] dark:text-[#F4F1F8] hover:text-[#4A1D5E] dark:hover:text-[#D5B3FF] text-left cursor-pointer"
                                >
                                  {doc.name}
                                </button>
                                <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] font-mono tabular-nums mt-0.5">
                                  Updated{' '}
                                  {new Date(doc.updatedAt).toLocaleDateString()}
                                  {doc.isProtected ? ' · Protected' : ''}
                                </p>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <select
                                value={doc.folderId || ''}
                                onChange={(e) =>
                                  onAssignFolder(doc, e.target.value || null)
                                }
                                className="px-2 py-1 rounded border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] text-[11px]"
                              >
                                <option value="">No Folder</option>
                                {folders.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>

                              <select
                                value={doc.category}
                                onChange={(e) =>
                                  onChangeCategory(
                                    doc,
                                    e.target.value as DocumentCategory
                                  )
                                }
                                className="px-2 py-1 rounded border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] text-[11px]"
                              >
                                {(
                                  [
                                    'Scans',
                                    'Contracts',
                                    'Receipts',
                                    'Reports',
                                    'Forms',
                                    'Other',
                                  ] as const
                                ).map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right hidden sm:table-cell font-mono tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                            <div>{formatBytes(doc.sizeBytes)}</div>
                            <div className="text-[10px]">
                              {doc.pageCount} pages
                            </div>
                          </td>

                          <td className="py-3 pl-3 pr-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenQuickPreview(doc)}
                                title="Preview Document"
                                className="p-1.5 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] cursor-pointer"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => onOpenInEditor(doc, false)}
                                title="Open in PDF Editor"
                                className="p-1.5 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] text-[#4A1D5E] dark:text-[#D5B3FF] cursor-pointer"
                              >
                                <FileEdit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setRenamingDocId(doc.id);
                                  setRenameValue(doc.name);
                                }}
                                title="Rename Document"
                                className="p-1.5 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] cursor-pointer"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => onDownloadDocument(doc)}
                                title="Download PDF"
                                className="p-1.5 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] text-[#15803D] cursor-pointer"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => onRequestDeleteDocument(doc)}
                                title="Delete Document"
                                className="p-1.5 rounded hover:bg-[#DC2626]/10 text-[#DC2626] cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Document Preview Card when selected */}
          {previewDoc && (
            <div className="rounded-xl bg-white dark:bg-[#16111F] border border-[#4A1D5E] dark:border-[#9D5CE5] p-5 flex flex-col sm:flex-row items-start gap-5">
              <div className="w-40 h-52 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                {isLoadingPreview ? (
                  <span className="text-[11px] text-[#6E667D]">
                    Rendering...
                  </span>
                ) : previewImgUrl ? (
                  <img
                    src={previewImgUrl}
                    alt={previewDoc.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[11px] text-[#6E667D]">No preview</span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold">{previewDoc.name}</h3>
                    <p className="text-xs text-[#6E667D] font-mono tabular-nums">
                      {previewDoc.pageCount} pages ·{' '}
                      {formatBytes(previewDoc.sizeBytes)} · Category:{' '}
                      {previewDoc.category}
                    </p>
                  </div>
                  <button
                    onClick={() => setPreviewDoc(null)}
                    className="p-1 text-[#6E667D] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {previewDoc.ocrText && (
                  <div className="p-2.5 rounded bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-mono max-h-24 overflow-y-auto">
                    {previewDoc.ocrText}
                  </div>
                )}

                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => onOpenInEditor(previewDoc, true)}
                    className="px-3.5 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold cursor-pointer"
                  >
                    Open in Clean Reader
                  </button>
                  <button
                    onClick={() => onOpenInEditor(previewDoc, false)}
                    className="px-3.5 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold cursor-pointer"
                  >
                    Edit & Annotate PDF
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
