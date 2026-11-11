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

  // Inline rename
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
    <div className="max-w-6xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8] truncate">
            My Files ({documents.length})
          </h1>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
            Tap any file to Read, Edit, or Share
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

      {/* Clean Mobile & Desktop File List (Zero Horizontal Clipping) */}
      <div className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden">
        {filteredDocs.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-bold">No documents found</p>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Upload a PDF or clear your search filter.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E4DFEC] dark:divide-[#261F33]">
            {filteredDocs.map((doc) => {
              const isRenaming = renamingDocId === doc.id;
              return (
                <div
                  key={doc.id}
                  className="p-3 sm:px-4 flex items-center justify-between gap-2.5 hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/40 transition-colors"
                >
                  {/* Left: Star + Document Name */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      onClick={() => onToggleStar(doc)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6E667D] hover:text-[#D97706] cursor-pointer shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          doc.starred ? 'fill-[#D97706] text-[#D97706]' : ''
                        }`}
                      />
                    </button>

                    {isRenaming ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
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
                      <button
                        onClick={() =>
                          onRequestOpenWithOptions
                            ? onRequestOpenWithOptions(doc)
                            : onOpenInEditor(doc, true)
                        }
                        className="text-left min-w-0 flex-1 cursor-pointer group"
                      >
                        <p className="text-xs sm:text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] group-hover:text-[#4A1D5E] dark:group-hover:text-[#D5B3FF] truncate">
                          {doc.name}
                        </p>
                        <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] font-mono tabular-nums mt-0.5 truncate">
                          {doc.pageCount}p · {formatBytes(doc.sizeBytes)} ·{' '}
                          {new Date(doc.updatedAt).toLocaleDateString()}
                        </p>
                      </button>
                    )}
                  </div>

                  {/* Right: Always-Visible Action Buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onOpenInEditor(doc, true)}
                      title="Open in ElimikaPDF Reader"
                      className="h-9 px-2.5 rounded-lg bg-[#003FE8]/10 text-[#003FE8] dark:bg-[#38BDF8]/20 dark:text-[#38BDF8] hover:bg-[#003FE8] hover:text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span>Read</span>
                    </button>

                    <button
                      onClick={() => onOpenInEditor(doc, false)}
                      title="Edit PDF"
                      className="h-9 px-2.5 rounded-lg bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF] hover:bg-[#4A1D5E] hover:text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <FileEdit className="w-3.5 h-3.5 shrink-0" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={() => {
                        setRenamingDocId(doc.id);
                        setRenameValue(doc.name);
                      }}
                      title="Rename Document"
                      className="hidden sm:flex w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] items-center justify-center text-[#6E667D] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer shrink-0"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDownloadDocument(doc)}
                      title="Download PDF"
                      className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#15803D] dark:text-[#4ADE80] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer shrink-0"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onRequestDeleteDocument(doc)}
                      title="Delete Document"
                      className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
