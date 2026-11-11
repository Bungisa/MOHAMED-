import React, { useState, useEffect } from 'react';
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
  FileText,
  MoreHorizontal,
} from 'lucide-react';
import {
  StoredDocument,
  DocumentFolder,
  DocumentCategory,
} from '../types/document';
import { formatBytes } from '../services/storageService';
import { renderPdfPage } from '../services/pdfService';
import { formatRelativeTime } from './DashboardView';

interface DocumentsLibraryViewProps {
  documents: StoredDocument[];
  folders: DocumentFolder[];
  onOpenInEditor: (doc: StoredDocument, readerMode?: boolean) => void;
  onRequestOpenWithOptions?: (doc: StoredDocument) => void;
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
  onRequestOpenWithOptions,
  onRenameDocument,
  onToggleStar,
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

  // Inline rename & action menu
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [openMenuDocId, setOpenMenuDocId] = useState<string | null>(null);
  const [thumbnailsMap, setThumbnailsMap] = useState<Record<string, string>>({});

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
          // Ignore thumbnail render error
        }
      }
    };
    generateMissingThumbnails();
    return () => {
      cancelled = true;
    };
  }, [documents, thumbnailsMap]);

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
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] truncate">
            All Files ({documents.length})
          </h1>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
            Tap any file card to Read, Edit, or Share
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowNewFolderInput((v) => !v)}
            className="h-9 px-3 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
            <span className="hidden xs:inline">Folder</span>
          </button>

          <label className="h-9 px-3.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
            <FileUp className="w-4 h-4 shrink-0" />
            <span>Open File</span>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.rtf,.txt,.md,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/rtf,image/png,image/jpeg,image/webp"
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
          className="p-3.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#4A1D5E] dark:border-[#9D5CE5] flex items-center gap-2"
        >
          <Folder className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="New folder name..."
            className="flex-1 text-xs px-3 py-2 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
          />
          <button
            type="submit"
            className="px-3.5 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold cursor-pointer"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowNewFolderInput(false)}
            className="px-2 py-2 text-xs text-[#6E667D] cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Clean Filter Tabs + Search & Sort Bar */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-3 space-y-3">
        {/* Horizontal Filter Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { id: 'all', label: 'All Files', icon: Files },
              { id: 'recent', label: 'Recent', icon: Clock },
              { id: 'starred', label: 'Starred', icon: Star },
            ] as const
          ).map((v) => {
            const Icon = v.icon;
            const active = filterMode === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setFilterMode(v.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                    : 'bg-[#FAF9FB] dark:bg-[#0D0A12] text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{v.label}</span>
              </button>
            );
          })}

          {folders.map((f) => {
            const active = filterMode === f.id;
            return (
              <div
                key={f.id}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                    : 'bg-[#FAF9FB] dark:bg-[#0D0A12] text-[#6E667D] dark:text-[#A39BB5]'
                }`}
              >
                <button
                  onClick={() => setFilterMode(f.id)}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span>{f.name}</span>
                </button>
                <button
                  onClick={() => {
                    if (filterMode === f.id) setFilterMode('all');
                    onDeleteFolder(f.id);
                  }}
                  title="Delete folder"
                  className="ml-1 opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Search & Sort Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#6E667D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
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
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border cursor-pointer whitespace-nowrap ${
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
      </div>

      {/* Card Arrangement matching image_597cb37c.png */}
      {filteredDocs.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-10 text-center space-y-2">
          <p className="text-sm font-bold">No documents found</p>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
            Upload a PDF or clear your search filter.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredDocs.map((doc, idx) => {
            const isRenaming = renamingDocId === doc.id;
            const thumbSrc = doc.thumbnailDataUrl || thumbnailsMap[doc.id];
            const displayTitle = doc.name.replace(/\.pdf$/i, '');
            const isMenuOpen = openMenuDocId === doc.id;
            const showPdfBadge = doc.category !== 'Scans' && idx % 3 === 1;

            return (
              <div
                key={doc.id}
                onClick={() => {
                  if (!isRenaming) {
                    if (onRequestOpenWithOptions) {
                      onRequestOpenWithOptions(doc);
                    } else {
                      onOpenInEditor(doc, false);
                    }
                  }
                }}
                className="relative rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#0088FF]/50 p-3 shadow-2xs flex items-center gap-3.5 transition-all cursor-pointer"
              >
                {/* Left: Page 1 Thumbnail inside soft gray rounded frame */}
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

                {/* Center: Title + Relative Timestamp + Badges Row */}
                <div className="min-w-0 flex-1 space-y-1">
                  {isRenaming ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 flex-1 min-w-0"
                    >
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 min-w-0 px-2.5 py-1 text-xs rounded-lg border border-[#4A1D5E] bg-[#FAF9FB] dark:bg-[#0D0A12]"
                      />
                      <button
                        onClick={async () => {
                          if (renameValue.trim()) {
                            await onRenameDocument(doc, renameValue.trim());
                          }
                          setRenamingDocId(null);
                        }}
                        className="p-1.5 text-[#15803D] cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setRenamingDocId(null)}
                        className="p-1.5 text-[#6E667D] cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm sm:text-[15px] font-medium text-[#434C5E] dark:text-[#F4F1F8] truncate">
                        {displayTitle}
                      </p>
                      <p className="text-xs text-[#7B8394] dark:text-[#A39BB5]">
                        {formatRelativeTime(doc.updatedAt || doc.createdAt)}
                      </p>
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-[5px] border border-[#7B8394]/80 text-[11px] font-semibold text-[#5E6675] dark:text-[#A39BB5] tabular-nums">
                          {doc.pageCount}
                        </span>
                        {showPdfBadge ? (
                          <span className="inline-flex items-center justify-center px-1.5 h-5 rounded-[5px] bg-[#E53935] text-white text-[9px] font-extrabold tracking-tight">
                            PDF
                          </span>
                        ) : (
                          <>
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-[5px] border border-[#C62828]/80 text-[11px] font-bold text-[#B71C1C] dark:text-[#F87171]">
                              N
                            </span>
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
                    </>
                  )}
                </div>

                {/* Right: Three-Dots Menu Button */}
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
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[#5E6675] dark:text-[#A39BB5] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                </div>

                {isMenuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-3 top-12 w-52 rounded-xl bg-white dark:bg-[#1E172B] border border-[#E4DFEC] dark:border-[#342A45] shadow-xl py-1.5 z-30 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuDocId(null);
                        onOpenInEditor(doc, false);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] font-semibold text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                    >
                      <FileEdit className="w-4 h-4 text-[#0088FF]" />
                      <span>Open / Edit PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuDocId(null);
                        onOpenInEditor(doc, true);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                    >
                      <Eye className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                      <span>Read Mode</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuDocId(null);
                        setRenamingDocId(doc.id);
                        setRenameValue(doc.name);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4 text-[#6E667D]" />
                      <span>Rename</span>
                    </button>
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
                      <span>{doc.starred ? 'Remove Star' : 'Star File'}</span>
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
    </div>
  );
};
