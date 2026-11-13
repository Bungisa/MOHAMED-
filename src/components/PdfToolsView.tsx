import React, { useState, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import {
  Merge,
  Scissors,
  Minimize2,
  FileImage,
  Images,
  RotateCw,
  LayoutGrid,
  ScanText,
  Shield,
  Upload,
  ArrowUp,
  ArrowDown,
  Trash2,
  Download,
  Save,
  Copy,
  Check,
  PlusSquare,
  Info,
  Type,
  Undo2,
  Bold,
  Italic,
  Move,
  Share2,
  FileText,
  FileOutput,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Plus,
  Crown,
  CircleArrowRight,
} from 'lucide-react';
import { StoredDocument, ToolId } from '../types/document';
import {
  mergePdfs,
  extractPdfPages,
  compressPdfDocument,
  createPdfFromImages,
  renderPdfPage,
  extractAllPdfText,
  organizePdfPages,
  bakeAnnotationsIntoPdf,
  downloadBytesAsFile,
  prepareServerDownloadUrl,
  sanitizeDownloadFilename,
  shareOrDownloadBytesAsFile,
  getPdfPageCount,
  RenderedPageInfo,
  PictureTextBoxOverlay,
  compositeTextBoxesOntoImageDataUrl,
  removeWatermarksFromPdf,
} from '../services/pdfService';
import { applyImageEnhancements } from '../services/imageProcessingService';
import {
  parseUploadedWordFile,
  plainTextToWordBlocks,
  generatePdfFromWordBlocks,
  extractPdfPagesForWord,
  buildDocxFromPdfPages,
  DOCX_MIME_TYPE,
  WordContentBlock,
  PdfPageWordContent,
  PdfToWordMode,
} from '../services/wordConversionService';
import { formatBytes } from '../services/storageService';

interface PdfToolsViewProps {
  initialTool?: ToolId;
  activeDocumentId?: string;
  initialMergeDocIds?: string[];
  documents: StoredDocument[];
  onSaveNewDocument: (doc: StoredDocument) => Promise<void>;
  onUpdateDocument: (doc: StoredDocument) => Promise<void>;
  onOpenInEditor?: (doc: StoredDocument) => void;
  onUploadNewPdf?: (
    files: FileList | File[],
    openInEditorAfter?: boolean
  ) => Promise<void>;
}

const TOOL_CATEGORIES: {
  category: string;
  items: {
    id: ToolId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}[] = [
  {
    category: 'Page Structure',
    items: [
      { id: 'split-pdf', label: 'Split PDF', icon: Scissors },
      { id: 'merge-pdf', label: 'Merge PDF', icon: Merge },
      { id: 'organize-pdf', label: 'Organize & Rotate', icon: LayoutGrid },
    ],
  },
  {
    category: 'Size & Format',
    items: [
      { id: 'compress-pdf', label: 'Compress PDF', icon: Minimize2 },
      { id: 'pdf-to-word', label: 'PDF to Word', icon: FileOutput },
      { id: 'word-to-pdf', label: 'Word to PDF', icon: FileText },
      { id: 'pdf-to-img', label: 'PDF to Pictures', icon: Images },
      { id: 'img-to-pdf', label: 'Photos to PDF', icon: FileImage },
    ],
  },
  {
    category: 'OCR & Security',
    items: [
      { id: 'remove-watermark', label: 'Watermark Remover', icon: Sparkles },
      { id: 'ocr-pdf', label: 'OCR Text (EN/SW)', icon: ScanText },
      { id: 'security-pdf', label: 'PDF Security', icon: Shield },
    ],
  },
];

export const PdfToolsView: React.FC<PdfToolsViewProps> = ({
  initialTool = 'merge-pdf',
  activeDocumentId,
  initialMergeDocIds,
  documents,
  onSaveNewDocument,
  onUpdateDocument,
  onOpenInEditor,
  onUploadNewPdf,
}) => {
  const normalizedInitial =
    initialTool === 'rotate-pdf'
      ? 'organize-pdf'
      : initialTool === 'scan-to-pdf' || initialTool === 'edit-pdf'
        ? 'split-pdf'
        : initialTool;

  const [activeTool, setActiveTool] = useState<ToolId>(normalizedInitial);
  const [selectedDocId, setSelectedDocId] = useState<string>(
    activeDocumentId || documents[0]?.id || ''
  );
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialTool &&
      initialTool !== 'scan-to-pdf' &&
      initialTool !== 'edit-pdf'
    ) {
      setActiveTool(
        initialTool === 'rotate-pdf' ? 'organize-pdf' : initialTool
      );
    }
  }, [initialTool]);

  useEffect(() => {
    if (activeDocumentId) {
      setSelectedDocId(activeDocumentId);
    }
  }, [activeDocumentId]);

  useEffect(() => {
    if (!selectedDocId && documents.length > 0) {
      setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId]);

  const selectedDoc =
    documents.find((d) => d.id === selectedDocId) || documents[0] || null;

  // 1. MERGE PDF STATE
  const [mergeList, setMergeList] = useState<
    { id: string; name: string; bytes: Uint8Array; pages: number }[]
  >([]);

  useEffect(() => {
    if (initialMergeDocIds && initialMergeDocIds.length > 0) {
      const selectedForMerge = initialMergeDocIds
        .map((id) => documents.find((d) => d.id === id))
        .filter((d): d is StoredDocument => Boolean(d));
      if (selectedForMerge.length > 0) {
        setMergeList(
          selectedForMerge.map((d) => ({
            id: `${d.id}-${Math.random()}`,
            name: d.name,
            bytes: d.pdfData,
            pages: d.pageCount,
          }))
        );
        return;
      }
    }
    if (mergeList.length === 0 && documents.length >= 2) {
      setMergeList(
        documents.slice(0, 2).map((d) => ({
          id: `${d.id}-${Math.random()}`,
          name: d.name,
          bytes: d.pdfData,
          pages: d.pageCount,
        }))
      );
    }
  }, [documents, initialMergeDocIds, mergeList.length]);

  const handleAddDocToMerge = (doc: StoredDocument) => {
    setMergeList((prev) => [
      ...prev,
      {
        id: `${doc.id}-${Date.now()}-${Math.random()}`,
        name: doc.name,
        bytes: doc.pdfData,
        pages: doc.pageCount,
      },
    ]);
  };

  const handleUploadFilesForMerge = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!e.target.files) return;
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const count = await getPdfPageCount(bytes);
      setMergeList((prev) => [
        ...prev,
        {
          id: `upload-${Date.now()}-${i}`,
          name: file.name,
          bytes,
          pages: count,
        },
      ]);
    }
    e.target.value = '';
  };

  const handleRunMerge = async (downloadImmediately: boolean) => {
    if (mergeList.length < 2) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const mergedBytes = await mergePdfs(mergeList.map((m) => m.bytes));
      const totalPages = mergeList.reduce((acc, m) => acc + m.pages, 0);
      const outName = `Merged_${new Date().toISOString().slice(0, 10)}.pdf`;
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
      await onSaveNewDocument(newDoc);
      if (downloadImmediately) {
        downloadBytesAsFile(mergedBytes, outName);
      }
      setFeedback(
        `Combined ${mergeList.length} PDFs (${totalPages} total pages, ${formatBytes(mergedBytes.byteLength)}) and saved to Local Vault.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // 2. SPLIT PDF STATE (Matches Split UI: Range [Custom / Fixed / Smart], Pages, Size)
  const [splitTopTab, setSplitTopTab] = useState<'range' | 'pages' | 'size'>(
    'range'
  );
  const [splitRangeSubMode, setSplitRangeSubMode] = useState<
    'custom' | 'fixed' | 'smart'
  >('custom');
  const [customRanges, setCustomRanges] = useState<
    { id: string; from: number; to: number }[]
  >([{ id: 'range-1', from: 1, to: 2 }]);
  const [mergeAllRanges, setMergeAllRanges] = useState<boolean>(false);
  const [fixedRangeStep, setFixedRangeStep] = useState<number>(2);
  const [splitRangeInput, setSplitRangeInput] = useState('1');
  const [splitMode, setSplitMode] = useState<'range' | 'each-page'>('range');
  const [maxSplitSizeValue, setMaxSplitSizeValue] = useState<number>(1);
  const [maxSplitSizeUnit, setMaxSplitSizeUnit] = useState<'MB' | 'KB'>('MB');
  const [actualSplitPageCount, setActualSplitPageCount] = useState<number>(
    selectedDoc?.pageCount || 1
  );
  const [splitResults, setSplitResults] = useState<
    {
      id: string;
      name: string;
      bytes: Uint8Array;
      downloadUrl: string;
      pageCount: number;
      pagesLabel: string;
    }[]
  >([]);

  // Ensure actualSplitPageCount always reflects the true number of pages in selectedDoc.pdfData
  useEffect(() => {
    let cancelled = false;
    if (!selectedDoc) {
      setActualSplitPageCount(1);
      setSplitResults([]);
      return;
    }
    setSplitResults([]);
    const fallbackCount = Math.max(1, selectedDoc.pageCount || 1);
    setActualSplitPageCount(fallbackCount);
    setCustomRanges([
      { id: 'range-1', from: 1, to: Math.min(2, fallbackCount) },
    ]);
    (async () => {
      try {
        const realCount = await getPdfPageCount(selectedDoc.pdfData);
        if (!cancelled && realCount > 0) {
          setActualSplitPageCount(realCount);
          setSplitRangeInput(
            realCount > 1 ? `1-${Math.min(2, realCount)}` : '1'
          );
          setCustomRanges([
            { id: 'range-1', from: 1, to: Math.min(2, realCount) },
          ]);
        }
      } catch {
        // Ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDoc?.id]);

  const handleAddCustomRange = () => {
    setCustomRanges((prev) => {
      const last = prev[prev.length - 1];
      const nextFrom = last
        ? Math.min(actualSplitPageCount, last.to + 1)
        : 1;
      const nextTo = Math.min(actualSplitPageCount, nextFrom + 1);
      return [
        ...prev,
        {
          id: `range-${Date.now()}-${prev.length + 1}`,
          from: nextFrom,
          to: Math.max(nextFrom, nextTo),
        },
      ];
    });
  };

  const handleUpdateCustomRange = (
    id: string,
    field: 'from' | 'to',
    rawVal: number
  ) => {
    const clamped = Math.max(
      1,
      Math.min(actualSplitPageCount, Math.round(rawVal || 1))
    );
    setCustomRanges((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (field === 'from') {
          return { ...r, from: clamped, to: Math.max(clamped, r.to) };
        }
        return { ...r, to: Math.max(r.from, clamped) };
      })
    );
  };

  const handleRemoveCustomRange = (id: string) => {
    setCustomRanges((prev) =>
      prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)
    );
  };

  const handleGenerateSmartRanges = () => {
    const total = Math.max(1, actualSplitPageCount);
    if (total <= 2) {
      setCustomRanges([
        { id: 'smart-1', from: 1, to: 1 },
        ...(total === 2 ? [{ id: 'smart-2', from: 2, to: 2 }] : []),
      ]);
      return;
    }
    const targetSections = Math.min(4, Math.max(2, Math.ceil(total / 3)));
    const stepSize = Math.ceil(total / targetSections);
    const smartList: { id: string; from: number; to: number }[] = [];
    for (let start = 1, idx = 1; start <= total; start += stepSize, idx++) {
      const end = Math.min(total, start + stepSize - 1);
      smartList.push({
        id: `smart-${idx}-${Date.now()}`,
        from: start,
        to: end,
      });
    }
    setCustomRanges(smartList);
  };

  const parsePageRanges = (input: string, maxPages: number): number[] => {
    const safeMax = Math.max(1, maxPages);
    const set = new Set<number>();
    const parts = input.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!Number.isNaN(start) && !Number.isNaN(end)) {
          for (
            let p = Math.min(start, end);
            p <= Math.max(start, end);
            p++
          ) {
            if (p >= 1 && p <= safeMax) set.add(p);
          }
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (!Number.isNaN(p) && p >= 1 && p <= safeMax) set.add(p);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  };

  const handleToggleSplitPageNumber = (pageNum: number) => {
    const currentList = parsePageRanges(splitRangeInput, actualSplitPageCount);
    const exists = currentList.includes(pageNum);
    const nextList = exists
      ? currentList.filter((p) => p !== pageNum)
      : [...currentList, pageNum].sort((a, b) => a - b);
    setSplitRangeInput(nextList.length > 0 ? nextList.join(', ') : '1');
  };

  const handleUploadPdfForSplit = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const count = await getPdfPageCount(bytes);
      const newDoc: StoredDocument = {
        id: `doc-upload-split-${Date.now()}`,
        name: file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`,
        category: 'Other',
        starred: false,
        sizeBytes: bytes.byteLength,
        pageCount: count,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: bytes,
      };
      await onSaveNewDocument(newDoc);
      setSelectedDocId(newDoc.id);
      setActualSplitPageCount(count);
      setSplitRangeInput(count > 1 ? `1-${Math.min(2, count)}` : '1');
      setCustomRanges([
        { id: 'range-1', from: 1, to: Math.min(2, count) },
      ]);
      setFeedback(
        `Loaded "${newDoc.name}" (${count} pages) for splitting.`
      );
    } catch (err) {
      console.error('Upload for split failed:', err);
      setFeedback('Could not load the selected PDF file.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunSplitExtract = async () => {
    if (!selectedDoc) return;
    const maxPages = Math.max(
      1,
      actualSplitPageCount || selectedDoc.pageCount || 1
    );
    const baseTitle = selectedDoc.name.replace(/\.pdf$/i, '');

    setIsBusy(true);
    setFeedback(null);
    try {
      const generated: {
        id: string;
        name: string;
        bytes: Uint8Array;
        downloadUrl: string;
        pageCount: number;
        pagesLabel: string;
      }[] = [];

      // Helper to build a range list of 1-indexed page numbers
      const expandRange = (from: number, to: number): number[] => {
        const s = Math.max(1, Math.min(maxPages, Math.min(from, to)));
        const e = Math.max(1, Math.min(maxPages, Math.max(from, to)));
        const arr: number[] = [];
        for (let p = s; p <= e; p++) arr.push(p);
        return arr;
      };

      if (splitTopTab === 'range') {
        let activeRanges: { from: number; to: number }[] = [];

        if (splitRangeSubMode === 'custom' || splitRangeSubMode === 'smart') {
          activeRanges = customRanges.map((r) => ({
            from: Math.max(1, Math.min(maxPages, r.from)),
            to: Math.max(1, Math.min(maxPages, r.to)),
          }));
        } else if (splitRangeSubMode === 'fixed') {
          const step = Math.max(1, Math.min(maxPages, fixedRangeStep || 1));
          for (let start = 1; start <= maxPages; start += step) {
            activeRanges.push({
              from: start,
              to: Math.min(maxPages, start + step - 1),
            });
          }
        }

        if (mergeAllRanges && activeRanges.length > 0) {
          const allPages: number[] = [];
          for (const r of activeRanges) {
            allPages.push(...expandRange(r.from, r.to));
          }
          const splitBytes = await extractPdfPages(
            selectedDoc.pdfData,
            allPages
          );
          const outName = sanitizeDownloadFilename(
            `${baseTitle}_Merged_Ranges.pdf`,
            'application/pdf'
          );
          const downloadUrl = await prepareServerDownloadUrl(
            splitBytes,
            outName,
            'application/pdf'
          );
          generated.push({
            id: `split-merged-${Date.now()}`,
            name: outName,
            bytes: splitBytes,
            downloadUrl,
            pageCount: allPages.length,
            pagesLabel: `${activeRanges.length} Merged Range(s)`,
          });
        } else {
          for (let i = 0; i < activeRanges.length; i++) {
            const r = activeRanges[i];
            const rangePages = expandRange(r.from, r.to);
            const splitBytes = await extractPdfPages(
              selectedDoc.pdfData,
              rangePages
            );
            const labelSuffix =
              r.from === r.to ? `Page_${r.from}` : `Pages_${r.from}-${r.to}`;
            const outName = sanitizeDownloadFilename(
              `${baseTitle}_Range_${i + 1}_${labelSuffix}.pdf`,
              'application/pdf'
            );
            const downloadUrl = await prepareServerDownloadUrl(
              splitBytes,
              outName,
              'application/pdf'
            );
            generated.push({
              id: `split-r${i + 1}-${Date.now()}`,
              name: outName,
              bytes: splitBytes,
              downloadUrl,
              pageCount: rangePages.length,
              pagesLabel:
                r.from === r.to
                  ? `Range ${i + 1} (Page ${r.from})`
                  : `Range ${i + 1} (Pages ${r.from}–${r.to})`,
            });
          }
        }
      } else if (splitTopTab === 'pages') {
        if (splitMode === 'each-page') {
          for (let p = 1; p <= maxPages; p++) {
            const splitBytes = await extractPdfPages(selectedDoc.pdfData, [p]);
            const outName = sanitizeDownloadFilename(
              `${baseTitle}_Page_${p}.pdf`,
              'application/pdf'
            );
            const downloadUrl = await prepareServerDownloadUrl(
              splitBytes,
              outName,
              'application/pdf'
            );
            generated.push({
              id: `split-p${p}-${Date.now()}`,
              name: outName,
              bytes: splitBytes,
              downloadUrl,
              pageCount: 1,
              pagesLabel: `Page ${p}`,
            });
          }
        } else {
          const pagesToExtract = parsePageRanges(splitRangeInput, maxPages);
          if (pagesToExtract.length === 0) {
            setFeedback(
              `Please select or enter valid page numbers between 1 and ${maxPages}.`
            );
            setIsBusy(false);
            return;
          }
          if (mergeAllRanges) {
            const splitBytes = await extractPdfPages(
              selectedDoc.pdfData,
              pagesToExtract
            );
            const outName = sanitizeDownloadFilename(
              `${baseTitle}_Pages_${pagesToExtract.join('-')}.pdf`,
              'application/pdf'
            );
            const downloadUrl = await prepareServerDownloadUrl(
              splitBytes,
              outName,
              'application/pdf'
            );
            generated.push({
              id: `split-sel-${Date.now()}`,
              name: outName,
              bytes: splitBytes,
              downloadUrl,
              pageCount: pagesToExtract.length,
              pagesLabel: `Pages ${pagesToExtract.join(', ')}`,
            });
          } else {
            for (const p of pagesToExtract) {
              const splitBytes = await extractPdfPages(selectedDoc.pdfData, [
                p,
              ]);
              const outName = sanitizeDownloadFilename(
                `${baseTitle}_Page_${p}.pdf`,
                'application/pdf'
              );
              const downloadUrl = await prepareServerDownloadUrl(
                splitBytes,
                outName,
                'application/pdf'
              );
              generated.push({
                id: `split-p${p}-${Date.now()}`,
                name: outName,
                bytes: splitBytes,
                downloadUrl,
                pageCount: 1,
                pagesLabel: `Page ${p}`,
              });
            }
          }
        }
      } else if (splitTopTab === 'size') {
        const targetMaxBytes = Math.max(
          20 * 1024,
          (maxSplitSizeValue || 1) *
            (maxSplitSizeUnit === 'MB' ? 1024 * 1024 : 1024)
        );
        const avgPageBytes = Math.max(
          4096,
          Math.ceil(selectedDoc.sizeBytes / maxPages)
        );
        const pagesPerChunk = Math.max(
          1,
          Math.floor(targetMaxBytes / avgPageBytes)
        );
        let partIndex = 1;
        for (let start = 1; start <= maxPages; start += pagesPerChunk) {
          const end = Math.min(maxPages, start + pagesPerChunk - 1);
          const chunkPages = expandRange(start, end);
          const splitBytes = await extractPdfPages(
            selectedDoc.pdfData,
            chunkPages
          );
          const outName = sanitizeDownloadFilename(
            `${baseTitle}_Part_${partIndex}_Pages_${start}-${end}.pdf`,
            'application/pdf'
          );
          const downloadUrl = await prepareServerDownloadUrl(
            splitBytes,
            outName,
            'application/pdf'
          );
          generated.push({
            id: `split-size-${partIndex}-${Date.now()}`,
            name: outName,
            bytes: splitBytes,
            downloadUrl,
            pageCount: chunkPages.length,
            pagesLabel: `Part ${partIndex} (Pages ${start}–${end})`,
          });
          partIndex++;
        }
      }

      setSplitResults(generated);

      if (generated.length > 0) {
        const a = document.createElement('a');
        a.href = generated[0].downloadUrl;
        a.download = generated[0].name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      for (const item of generated) {
        await onSaveNewDocument({
          id: `doc-${item.id}`,
          name: item.name,
          category: selectedDoc.category,
          starred: false,
          sizeBytes: item.bytes.byteLength,
          pageCount: item.pageCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
          pdfData: item.bytes,
        });
      }

      setFeedback(
        `Created ${generated.length} split PDF file(s) from "${selectedDoc.name}" and saved to My Files!`
      );
    } catch (err) {
      console.error('Error splitting PDF:', err);
      setFeedback('Could not split the selected PDF pages. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  // 3. COMPRESS PDF STATE
  const [compressionLevel, setCompressionLevel] = useState<
    'low' | 'medium' | 'extreme'
  >('medium');
  const [compressionResult, setCompressionResult] = useState<{
    originalBytes: number;
    compressedBytes: number;
    data: Uint8Array;
    name: string;
  } | null>(null);

  const handleRunCompress = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setCompressionResult(null);
    try {
      const compressed = await compressPdfDocument(
        selectedDoc.pdfData,
        compressionLevel
      );
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Compressed.pdf`;
      setCompressionResult({
        originalBytes: selectedDoc.sizeBytes,
        compressedBytes: compressed.byteLength,
        data: compressed,
        name: outName,
      });

      const newDoc: StoredDocument = {
        id: `doc-compress-${Date.now()}`,
        name: outName,
        category: selectedDoc.category,
        starred: false,
        sizeBytes: compressed.byteLength,
        pageCount: selectedDoc.pageCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: compressed,
      };
      await onSaveNewDocument(newDoc);

      setFeedback(
        `Compression complete: ${formatBytes(selectedDoc.sizeBytes)} → ${formatBytes(compressed.byteLength)} (Saved to My Files).`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // 4. IMAGES TO PDF STATE
  const [uploadedImages, setUploadedImages] = useState<
    { id: string; name: string; dataUrl: string }[]
  >([]);
  const [imgPageSize, setImgPageSize] = useState<'A4' | 'Letter' | 'Fit'>('A4');

  const handleSelectImagesForPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedImages((prev) => [
          ...prev,
          {
            id: `img-${Date.now()}-${Math.random()}`,
            name: file.name,
            dataUrl: reader.result as string,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleConvertImagesToPdf = async () => {
    if (uploadedImages.length === 0) return;
    setIsBusy(true);
    try {
      const pdfBytes = await createPdfFromImages(
        uploadedImages.map((i) => i.dataUrl),
        { pageSize: imgPageSize, marginPt: 20 }
      );
      const outName = `Images_Bundle_${new Date().toISOString().slice(0, 10)}.pdf`;
      const newDoc: StoredDocument = {
        id: `doc-img2pdf-${Date.now()}`,
        name: outName,
        category: 'Scans',
        starred: false,
        sizeBytes: pdfBytes.byteLength,
        pageCount: uploadedImages.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: pdfBytes,
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(pdfBytes, outName);
      setFeedback(
        `Converted ${uploadedImages.length} image(s) into "${outName}" and downloaded.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // 5. PDF TO IMAGES & EXTRACT TEXT + WRITE TEXT OVER CONVERTED PICTURES STATE
  const [exportFormat, setExportFormat] = useState<'image/png' | 'image/jpeg'>(
    'image/jpeg'
  );
  const [renderedImages, setRenderedImages] = useState<RenderedPageInfo[]>([]);
  const [extractedPagesText, setExtractedPagesText] = useState<
    { pageNumber: number; text: string }[]
  >([]);

  // Text boxes placed over converted PDF pictures (indexed by pageNumber)
  // Default: Blue background (#2563EB) + White text (#FFFFFF) + "Type here" placeholder
  const [pictureTextBoxesByPage, setPictureTextBoxesByPage] = useState<
    Record<number, PictureTextBoxOverlay[]>
  >({});
  const [pictureTextBoxUndoStack, setPictureTextBoxUndoStack] = useState<
    Record<number, PictureTextBoxOverlay[]>[]
  >([]);
  const [selectedPicTextBox, setSelectedPicTextBox] = useState<{
    pageNumber: number;
    id: string;
  } | null>(null);
  const [defaultPicTextColor, setDefaultPicTextColor] = useState('#FFFFFF');
  const [defaultPicBoxBgColor, setDefaultPicBoxBgColor] = useState('#2563EB');
  const [defaultPicBoxBorderColor, setDefaultPicBoxBorderColor] =
    useState('transparent');
  const [draggingPicBox, setDraggingPicBox] = useState<{
    pageNumber: number;
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    containerRect: DOMRect;
  } | null>(null);

  // Global window pointer listeners so dragging written text boxes on converted PDF pictures is 100% smooth
  useEffect(() => {
    if (!draggingPicBox) return;
    const onWinPointerMove = (e: PointerEvent) => {
      const dx =
        (e.clientX - draggingPicBox.startX) /
        Math.max(1, draggingPicBox.containerRect.width);
      const dy =
        (e.clientY - draggingPicBox.startY) /
        Math.max(1, draggingPicBox.containerRect.height);

      if (
        Math.hypot(
          e.clientX - draggingPicBox.startX,
          e.clientY - draggingPicBox.startY
        ) < 3
      ) {
        return;
      }

      setPictureTextBoxesByPage((prev) => ({
        ...prev,
        [draggingPicBox.pageNumber]: (
          prev[draggingPicBox.pageNumber] || []
        ).map((b) => {
          if (b.id !== draggingPicBox.id) return b;
          if (draggingPicBox.mode === 'move') {
            return {
              ...b,
              x: Math.max(
                0,
                Math.min(1 - b.width, draggingPicBox.origX + dx)
              ),
              y: Math.max(
                0,
                Math.min(1 - b.height, draggingPicBox.origY + dy)
              ),
            };
          } else {
            return {
              ...b,
              width: Math.max(
                0.08,
                Math.min(1 - b.x, draggingPicBox.origW + dx)
              ),
              height: Math.max(
                0.04,
                Math.min(1 - b.y, draggingPicBox.origH + dy)
              ),
            };
          }
        }),
      }));
    };
    const onWinPointerUp = () => {
      setDraggingPicBox(null);
    };
    window.addEventListener('pointermove', onWinPointerMove, { passive: true });
    window.addEventListener('pointerup', onWinPointerUp);
    window.addEventListener('pointercancel', onWinPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerUp);
    };
  }, [draggingPicBox]);

  const pushPictureTextBoxesWithUndo = (
    next: Record<number, PictureTextBoxOverlay[]>
  ) => {
    setPictureTextBoxUndoStack((prev) => [
      ...prev.slice(-19),
      pictureTextBoxesByPage,
    ]);
    setPictureTextBoxesByPage(next);
  };

  const handleUndoPictureTextBox = () => {
    if (pictureTextBoxUndoStack.length === 0) return;
    const prev = pictureTextBoxUndoStack[pictureTextBoxUndoStack.length - 1];
    setPictureTextBoxUndoStack((s) => s.slice(0, -1));
    setPictureTextBoxesByPage(prev);
    setSelectedPicTextBox(null);
  };

  const handleAddTextBoxToConvertedPicture = (
    pageNumber: number,
    clickX = 0.18,
    clickY = 0.22
  ) => {
    const newId = `pic-txt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const newBox: PictureTextBoxOverlay = {
      id: newId,
      x: Math.max(0.03, Math.min(0.62, clickX)),
      y: Math.max(0.03, Math.min(0.84, clickY)),
      width: 0.36,
      height: 0.1,
      text: '',
      textColor: defaultPicTextColor,
      boxBgColor: defaultPicBoxBgColor,
      boxBorderColor: defaultPicBoxBorderColor,
      fontSize: 16,
      fontWeight: 'bold',
      fontStyle: 'normal',
    };
    const existing = pictureTextBoxesByPage[pageNumber] || [];
    pushPictureTextBoxesWithUndo({
      ...pictureTextBoxesByPage,
      [pageNumber]: [...existing, newBox],
    });
    setSelectedPicTextBox({ pageNumber, id: newId });
  };

  const updateSelectedPicTextBox = (
    updates: Partial<PictureTextBoxOverlay>
  ) => {
    if (!selectedPicTextBox) return;
    const { pageNumber, id } = selectedPicTextBox;
    setPictureTextBoxesByPage((prev) => ({
      ...prev,
      [pageNumber]: (prev[pageNumber] || []).map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    }));
  };

  const removeSelectedPicTextBox = (pageNumber: number, id: string) => {
    const list = pictureTextBoxesByPage[pageNumber] || [];
    pushPictureTextBoxesWithUndo({
      ...pictureTextBoxesByPage,
      [pageNumber]: list.filter((b) => b.id !== id),
    });
    if (selectedPicTextBox?.id === id) {
      setSelectedPicTextBox(null);
    }
  };

  const handleDownloadConvertedPictureWithText = async (
    img: RenderedPageInfo
  ) => {
    const ext = exportFormat === 'image/png' ? 'png' : 'jpg';
    const boxes = pictureTextBoxesByPage[img.pageNumber] || [];
    const finalDataUrl = await compositeTextBoxesOntoImageDataUrl(
      img.dataUrl,
      boxes,
      exportFormat,
      0.94
    );
    const a = document.createElement('a');
    a.href = finalDataUrl;
    a.download = `${(selectedDoc?.name || 'Document').replace(/\.pdf$/i, '')}_Page_${img.pageNumber}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSaveConvertedPicturesWithTextAsPdf = async () => {
    if (renderedImages.length === 0 || !selectedDoc) return;
    setIsBusy(true);
    try {
      const compositedUrls: string[] = [];
      for (const img of renderedImages) {
        const boxes = pictureTextBoxesByPage[img.pageNumber] || [];
        const dataUrl = await compositeTextBoxesOntoImageDataUrl(
          img.dataUrl,
          boxes,
          'image/png',
          0.95
        );
        compositedUrls.push(dataUrl);
      }
      const pdfBytes = await createPdfFromImages(compositedUrls, {
        pageSize: 'Fit',
        marginPt: 0,
      });
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Pictures_Edited.pdf`;
      const newDoc: StoredDocument = {
        id: `doc-pic-pdf-${Date.now()}`,
        name: outName,
        category: selectedDoc.category,
        starred: false,
        sizeBytes: pdfBytes.byteLength,
        pageCount: renderedImages.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: pdfBytes,
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(pdfBytes, outName);
      setFeedback(
        `Saved ${renderedImages.length} converted PDF picture(s) with your custom text boxes into "${outName}" and downloaded.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleRenderPdfToImagesAndText = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    try {
      const realPageCount = await getPdfPageCount(selectedDoc.pdfData);
      const imgs: RenderedPageInfo[] = [];
      for (let i = 1; i <= realPageCount; i++) {
        const pageInfo = await renderPdfPage(
          selectedDoc.pdfData,
          i,
          1.25,
          exportFormat,
          0.88
        );
        imgs.push(pageInfo);
      }
      setRenderedImages(imgs);
      const texts = await extractAllPdfText(selectedDoc.pdfData);
      setExtractedPagesText(texts);
      setFeedback(
        `Converted ${imgs.length} PDF page(s) into pictures. Click anywhere on a picture (or click "+ Add Text Box") to write text!`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // Auto-convert PDF to pictures when opening the 'pdf-to-img' tab so pictures are immediately ready for writing text
  useEffect(() => {
    if (activeTool === 'pdf-to-img' && selectedDoc) {
      handleRenderPdfToImagesAndText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedDoc?.id]);

  // 6. ORGANIZE & ROTATE PAGES STATE
  const [orgSpecs, setOrgSpecs] = useState<
    {
      id: string;
      sourcePageNumber?: number;
      isBlank?: boolean;
      addRotationDeg: number;
      thumbUrl?: string;
    }[]
  >([]);
  const [draggedOrgIdx, setDraggedOrgIdx] = useState<number | null>(null);

  useEffect(() => {
    if (activeTool === 'organize-pdf' && selectedDoc) {
      let cancelled = false;
      const loadThumbs = async () => {
        setIsBusy(true);
        try {
          const totalCount = await getPdfPageCount(selectedDoc.pdfData);
          const list: {
            id: string;
            sourcePageNumber?: number;
            isBlank?: boolean;
            addRotationDeg: number;
            thumbUrl?: string;
          }[] = [];
          for (let i = 1; i <= totalCount; i++) {
            const p = await renderPdfPage(selectedDoc.pdfData, i, 0.7);
            list.push({
              id: `org-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sourcePageNumber: i,
              addRotationDeg: 0,
              thumbUrl: p.dataUrl,
            });
          }
          if (!cancelled) setOrgSpecs(list);
        } finally {
          if (!cancelled) setIsBusy(false);
        }
      };
      loadThumbs();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedDoc?.id]);

  const moveOrgPage = (fromIndex: number, toIndex: number) => {
    setOrgSpecs((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const duplicateOrgPage = (idx: number) => {
    setOrgSpecs((prev) => {
      const target = prev[idx];
      if (!target) return prev;
      const copy = {
        ...target,
        id: `org-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const handleSaveOrganizedPdf = async (openInEditorAfterSave = false) => {
    if (!selectedDoc || orgSpecs.length === 0) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const updatedBytes = await organizePdfPages(
        selectedDoc.pdfData,
        orgSpecs
      );
      const updatedDoc: StoredDocument = {
        ...selectedDoc,
        pageCount: orgSpecs.length,
        sizeBytes: updatedBytes.byteLength,
        updatedAt: new Date().toISOString(),
        pdfData: updatedBytes,
      };
      await onUpdateDocument(updatedDoc);

      // Refresh orgSpecs sourcePageNumber mapping to match the newly saved PDF page order (1..N)
      setOrgSpecs((prev) =>
        prev.map((s, idx) => ({
          ...s,
          sourcePageNumber: idx + 1,
          isBlank: false,
          addRotationDeg: 0,
        }))
      );

      if (openInEditorAfterSave && onOpenInEditor) {
        onOpenInEditor(updatedDoc);
        return;
      }

      downloadBytesAsFile(updatedBytes, updatedDoc.name);
      setFeedback(
        `Applied new page arrangement (${orgSpecs.length} pages) to "${updatedDoc.name}" and downloaded!`
      );
    } catch (err) {
      console.error('Error organizing PDF pages:', err);
      setFeedback('Could not apply page arrangement. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  // 7. OCR – EXTRACT TEXT (TESSERACT.JS) STATE
  const [ocrLang, setOcrLang] = useState<'eng' | 'swa' | 'eng+swa'>('eng');
  const [ocrPageNum, setOcrPageNum] = useState(1);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrStatusText, setOcrStatusText] = useState<string>('');
  const [ocrResultText, setOcrResultText] = useState<string>('');
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [copiedOcr, setCopiedOcr] = useState(false);

  const handleRunOcr = async (customImageDataUrl?: string) => {
    if (!selectedDoc && !customImageDataUrl) return;
    setIsBusy(true);
    setOcrProgress(5);
    setOcrStatusText('Initializing Tesseract OCR Engine...');
    setOcrConfidence(null);

    try {
      let targetDataUrl = customImageDataUrl;
      if (!targetDataUrl && selectedDoc) {
        setOcrStatusText(`Rendering PDF Page ${ocrPageNum} at high DPI...`);
        const rendered = await renderPdfPage(
          selectedDoc.pdfData,
          Math.min(ocrPageNum, selectedDoc.pageCount),
          2.0
        );
        targetDataUrl = rendered.dataUrl;
      }

      if (!targetDataUrl) return;

      const worker = await createWorker(ocrLang, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
            setOcrStatusText(
              `Recognizing printed text (${Math.round(m.progress * 100)}%)...`
            );
          } else if (m.status) {
            setOcrStatusText(m.status);
          }
        },
      });

      const ret = await worker.recognize(targetDataUrl);
      setOcrResultText(ret.data.text || '');
      setOcrConfidence(Math.round(ret.data.confidence || 0));
      await worker.terminate();
      setOcrProgress(100);
      setOcrStatusText('OCR Recognition Complete');

      if (selectedDoc && ret.data.text) {
        await onUpdateDocument({
          ...selectedDoc,
          ocrText: ret.data.text,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('OCR Error:', err);
      // Fallback to native text extraction if offline sandbox blocks remote traineddata fetch
      if (selectedDoc) {
        const nativePages = await extractAllPdfText(selectedDoc.pdfData);
        const fallbackText =
          nativePages.find((p) => p.pageNumber === ocrPageNum)?.text || '';
        setOcrResultText(
          fallbackText ||
            'Could not download remote language traineddata in offline environment.'
        );
        setOcrStatusText(
          'Extracted embedded document text stream (offline fallback).'
        );
      }
    } finally {
      setIsBusy(false);
    }
  };

  // 8. PDF SECURITY & PROTECTION STATE
  const [securityWatermark, setSecurityWatermark] = useState(
    'CONFIDENTIAL · AUTHORIZED USE ONLY'
  );
  const [vaultPassphrase, setVaultPassphrase] = useState('');

  const handleApplySecurityProtection = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    try {
      const stampedBytes = await bakeAnnotationsIntoPdf(
        selectedDoc.pdfData,
        selectedDoc.annotations || [],
        {
          watermarkText: securityWatermark,
          watermarkOpacity: 0.18,
          addPageNumbers: true,
          pageNumberPosition: 'bottom-right',
        }
      );

      const updated: StoredDocument = {
        ...selectedDoc,
        pdfData: stampedBytes,
        sizeBytes: stampedBytes.byteLength,
        isProtected: Boolean(vaultPassphrase.trim()),
        protectionHint: vaultPassphrase.trim()
          ? `Protected (${vaultPassphrase.trim().length} chars)`
          : undefined,
        updatedAt: new Date().toISOString(),
      };
      await onUpdateDocument(updated);
      downloadBytesAsFile(
        stampedBytes,
        `${selectedDoc.name.replace(/\.pdf$/i, '')}_Protected.pdf`
      );
      setFeedback(
        `Applied permanent security watermark and updated Local Vault protection settings.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // 8B. SMART COLOR-PRESERVING WATERMARK REMOVER STATE & HANDLERS
  const [wmRemovePreserveColor, setWmRemovePreserveColor] = useState(true);
  const [wmRemoveStrength, setWmRemoveStrength] = useState(0); // -30 (Gentle) to +45 (Max)
  const [wmTextClarityBoost, setWmTextClarityBoost] = useState(32); // 0 to 60 (Darkens & sharpens faint words)
  const [wmRemoveSolidBanners, setWmRemoveSolidBanners] = useState(false);
  const [wmTargetRgb, setWmTargetRgb] = useState<[number, number, number] | null>(
    null
  );
  const [wmPreviewPage, setWmPreviewPage] = useState(1);
  const [wmOriginalPreviewUrl, setWmOriginalPreviewUrl] = useState<string>('');
  const [wmCleanedPreviewUrl, setWmCleanedPreviewUrl] = useState<string>('');
  const [wmIsRenderingPreview, setWmIsRenderingPreview] = useState(false);
  const [wmProgressText, setWmProgressText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (activeTool !== 'remove-watermark' || !selectedDoc) return;

    const clampedPage = Math.max(
      1,
      Math.min(selectedDoc.pageCount || 1, wmPreviewPage)
    );

    setWmIsRenderingPreview(true);
    (async () => {
      try {
        const sourceBytes = selectedDoc.basePdfData || selectedDoc.pdfData;
        const pageInfo = await renderPdfPage(
          sourceBytes,
          clampedPage,
          2.0,
          'image/jpeg',
          0.96
        );
        if (cancelled) return;
        setWmOriginalPreviewUrl(pageInfo.dataUrl);

        const cleanedUrl = await applyImageEnhancements(pageInfo.dataUrl, {
          filter: wmRemovePreserveColor ? 'clean-watermark' : 'ocv-black',
          brightness: wmRemoveStrength,
          contrast: wmTextClarityBoost,
          rotation: 0,
          targetWatermarkRgb: wmTargetRgb,
        });
        if (!cancelled) {
          setWmCleanedPreviewUrl(cleanedUrl);
        }
      } catch (err) {
        console.error('Watermark preview error:', err);
      } finally {
        if (!cancelled) {
          setWmIsRenderingPreview(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTool,
    selectedDoc?.id,
    wmPreviewPage,
    wmRemovePreserveColor,
    wmRemoveStrength,
    wmTextClarityBoost,
    wmTargetRgb,
  ]);

  const handleSampleWatermarkPixel = (
    e: React.MouseEvent<HTMLImageElement>
  ) => {
    const imgEl = e.currentTarget;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth || 600;
    canvas.height = imgEl.naturalHeight || 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
    const px = Math.max(
      0,
      Math.min(canvas.width - 1, Math.floor(clickX * canvas.width))
    );
    const py = Math.max(
      0,
      Math.min(canvas.height - 1, Math.floor(clickY * canvas.height))
    );
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

    if (lum < 55) {
      setFeedback(
        'That point looks like dark document text. Click directly on a grey or colored watermark area to sample its tint.'
      );
      return;
    }

    setWmTargetRgb([r, g, b]);
    setFeedback(
      `Sampled watermark tint RGB(${r}, ${g}, ${b}). All matching watermark pixels are now targeted for removal while preserving document words and other colors!`
    );
  };

  const handleExecuteWatermarkRemoval = async (
    openInEditorAfterSave = false
  ) => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    setWmProgressText(`Analyzing & cleaning page 1 of ${selectedDoc.pageCount}...`);
    try {
      const sourceBytes = selectedDoc.basePdfData || selectedDoc.pdfData;
      const cleanedPdfBytes = await removeWatermarksFromPdf(sourceBytes, {
        preserveColor: wmRemovePreserveColor,
        strength: wmRemoveStrength,
        contrastBoost: wmTextClarityBoost,
        targetWatermarkRgb: wmTargetRgb,
        removeSolidBanners: wmRemoveSolidBanners,
        onProgress: (cur, tot) => {
          setWmProgressText(`Cleaning & sharpening page ${cur} of ${tot}...`);
        },
      });

      const updatedDoc: StoredDocument = {
        ...selectedDoc,
        pdfData: cleanedPdfBytes,
        basePdfData: cleanedPdfBytes,
        watermarkText: '',
        appliedFilter: 'original',
        appliedBrightness: 0,
        appliedContrast: 0,
        sizeBytes: cleanedPdfBytes.byteLength,
        updatedAt: new Date().toISOString(),
        thumbnailDataUrl: wmCleanedPreviewUrl || selectedDoc.thumbnailDataUrl,
      };

      await onUpdateDocument(updatedDoc);

      if (openInEditorAfterSave && onOpenInEditor) {
        onOpenInEditor(updatedDoc);
        return;
      }

      const cleanFileName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Clean.pdf`;
      downloadBytesAsFile(cleanedPdfBytes, cleanFileName);
      setFeedback(
        `Removed watermarks across all ${selectedDoc.pageCount} pages while preserving document words, sharpness, and colors! Saved & downloaded "${cleanFileName}".`
      );
    } catch (err) {
      console.error('Failed to remove watermarks from PDF:', err);
      setFeedback('Could not process watermark removal. Please try again.');
    } finally {
      setWmProgressText(null);
      setIsBusy(false);
    }
  };

  // 9. WORD TO PDF (.DOCX / .DOC / .RTF / .TXT -> .PDF) STATE & HANDLERS
  const [wordFileName, setWordFileName] = useState<string>(
    'Business_Proposal_2026'
  );
  const [wordBlocks, setWordBlocks] = useState<WordContentBlock[]>([]);
  const [wordPlainText, setWordPlainText] = useState<string>('');
  const [wordTextEdited, setWordTextEdited] = useState<boolean>(false);
  const [wordPageSize, setWordPageSize] = useState<'A4' | 'Letter' | 'Legal'>(
    'A4'
  );
  const [wordFontFamily, setWordFontFamily] = useState<
    'helvetica' | 'times' | 'courier'
  >('helvetica');
  const [wordBaseFontSize, setWordBaseFontSize] = useState<number>(11.5);
  const [wordAddPageNumbers, setWordAddPageNumbers] = useState<boolean>(true);
  const [convertedWordPdfResult, setConvertedWordPdfResult] = useState<{
    bytes: Uint8Array;
    name: string;
    pageCount: number;
    doc: StoredDocument;
  } | null>(null);

  const handleUploadWordDocument = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsBusy(true);
    setFeedback(null);
    setConvertedWordPdfResult(null);
    try {
      const parsed = await parseUploadedWordFile(file);
      const baseName = file.name.replace(/\.(docx|doc|rtf|txt)$/i, '');
      setWordFileName(baseName || 'Converted_Word_Document');
      setWordBlocks(parsed.blocks);
      setWordPlainText(parsed.plainText);
      setWordTextEdited(false);

      // Immediately generate the PDF preview and save to Local Vault so it's ready right away
      const { pdfBytes, pageCount } = await generatePdfFromWordBlocks(
        parsed.blocks,
        {
          pageSize: wordPageSize,
          fontFamily: wordFontFamily,
          baseFontSize: wordBaseFontSize,
          lineSpacing: 1.4,
          addPageNumbers: wordAddPageNumbers,
        }
      );
      const outName = `${baseName || 'Converted_Word'}.pdf`;
      const newDoc: StoredDocument = {
        id: `doc-word2pdf-${Date.now()}`,
        name: outName,
        category: 'Reports',
        starred: false,
        sizeBytes: pdfBytes.byteLength,
        pageCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: pdfBytes,
      };
      await onSaveNewDocument(newDoc);
      setConvertedWordPdfResult({
        bytes: pdfBytes,
        name: outName,
        pageCount,
        doc: newDoc,
      });
      setFeedback(
        `Converted "${file.name}" into "${outName}" (${pageCount} ${pageCount === 1 ? 'page' : 'pages'}, ${formatBytes(pdfBytes.byteLength)}) and saved to My Files.`
      );
    } catch (err) {
      console.error('Error converting Word file:', err);
      setFeedback(
        'Could not parse this Word file. Please upload a valid .docx, .doc, .rtf, or .txt document.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadSampleWordDoc = () => {
    const sampleText = `# PROJECT SERVICE AGREEMENT & INVOICE SUMMARY

## 1. Executive Overview
This Word-to-PDF document demonstrates instant on-device conversion of Microsoft Word (.DOCX) headings, paragraphs, bulleted lists, and formatted content into a clean, print-ready A4 PDF document.

## 2. Key Deliverables & Scope
* High-accuracy document scanning with Outside-In paper boundary detection
* Full-screen PDF editing with movable text boxes and one-swipe watermark removal
* Bidirectional Microsoft Word (.DOCX) to PDF and PDF to Word conversion
* Bilingual Optical Character Recognition (OCR) supporting English and Kiswahili

## 3. Schedule & Sign-Off
Prepared by: ElimikaPDF Document Engineering
Date: ${new Date().toISOString().slice(0, 10)}
Status: Approved for Production Distribution`;

    setWordFileName('Service_Agreement_2026');
    setWordPlainText(sampleText);
    setWordBlocks(plainTextToWordBlocks(sampleText));
    setWordTextEdited(false);
    setConvertedWordPdfResult(null);
  };

  const handleBuildPdfFromWord = async (
    action: 'save-only' | 'download' | 'share' | 'open-editor'
  ) => {
    const blocksToUse =
      wordTextEdited || wordBlocks.length === 0
        ? plainTextToWordBlocks(wordPlainText || 'Word Document')
        : wordBlocks;

    if (blocksToUse.length === 0) return;
    setIsBusy(true);
    try {
      const { pdfBytes, pageCount } = await generatePdfFromWordBlocks(
        blocksToUse,
        {
          pageSize: wordPageSize,
          fontFamily: wordFontFamily,
          baseFontSize: wordBaseFontSize,
          lineSpacing: 1.4,
          addPageNumbers: wordAddPageNumbers,
        }
      );
      const cleanName = wordFileName.trim().toLowerCase().endsWith('.pdf')
        ? wordFileName.trim()
        : `${wordFileName.trim() || 'Converted_Word'}.pdf`;

      const newDoc: StoredDocument = {
        id: convertedWordPdfResult?.doc.id || `doc-word2pdf-${Date.now()}`,
        name: cleanName,
        category: 'Reports',
        starred: false,
        sizeBytes: pdfBytes.byteLength,
        pageCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: pdfBytes,
      };
      await onSaveNewDocument(newDoc);
      setConvertedWordPdfResult({
        bytes: pdfBytes,
        name: cleanName,
        pageCount,
        doc: newDoc,
      });

      if (action === 'download') {
        downloadBytesAsFile(pdfBytes, cleanName, 'application/pdf');
        setFeedback(
          `Converted & downloaded "${cleanName}" (${pageCount} pages, ${formatBytes(pdfBytes.byteLength)}). Saved in My Files.`
        );
      } else if (action === 'share') {
        await shareOrDownloadBytesAsFile(pdfBytes, cleanName, 'application/pdf');
        setFeedback(`Shared "${cleanName}" and saved in My Files.`);
      } else if (action === 'open-editor' && onOpenInEditor) {
        onOpenInEditor(newDoc);
      } else {
        setFeedback(
          `Saved "${cleanName}" (${pageCount} pages, ${formatBytes(pdfBytes.byteLength)}) to My Files.`
        );
      }
    } finally {
      setIsBusy(false);
    }
  };

  // 10. PDF TO WORD (.PDF -> .DOCX) STATE & HANDLERS
  const [pdfToWordMode, setPdfToWordMode] =
    useState<PdfToWordMode>('editable');
  const [pdfToWordPages, setPdfToWordPages] = useState<PdfPageWordContent[]>(
    []
  );
  const [pdfToWordDocxResult, setPdfToWordDocxResult] = useState<{
    bytes: Uint8Array;
    name: string;
    pageCount: number;
  } | null>(null);
  const [pdfToWordProgress, setPdfToWordProgress] = useState<string | null>(
    null
  );
  const [autoOcrScannedPages, setAutoOcrScannedPages] = useState<boolean>(true);

  // Reset PDF to Word state when switching documents
  useEffect(() => {
    setPdfToWordPages([]);
    setPdfToWordDocxResult(null);
    setPdfToWordProgress(null);
  }, [selectedDoc?.id]);

  const handleExtractAndConvertPdfToWord = async (
    downloadImmediately = true
  ) => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    setPdfToWordProgress('Extracting pages & text structure from PDF...');
    try {
      let extractedPages = pdfToWordPages;
      if (extractedPages.length === 0) {
        extractedPages = await extractPdfPagesForWord(
          selectedDoc.pdfData,
          (curr, total) => {
            setPdfToWordProgress(`Analyzing PDF page ${curr} of ${total}...`);
          }
        );

        // If any page has almost no native text (scanned image PDF) and autoOcrScannedPages is enabled, run OCR on up to 5 scanned pages
        const scannedIndices = extractedPages
          .map((p, i) =>
            p.paragraphs.reduce((acc, pr) => acc + pr.text.length, 0) < 12 &&
            p.imageDataUrl
              ? i
              : -1
          )
          .filter((i) => i !== -1);

        if (autoOcrScannedPages && scannedIndices.length > 0) {
          const pagesToOcr = scannedIndices.slice(0, 5);
          const worker = await createWorker('eng');
          try {
            for (let k = 0; k < pagesToOcr.length; k++) {
              const pIdx = pagesToOcr[k];
              const pg = extractedPages[pIdx];
              if (!pg.imageDataUrl) continue;
              setPdfToWordProgress(
                `Running OCR on scanned page ${pg.pageNumber} (${k + 1}/${pagesToOcr.length})...`
              );
              const {
                data: { text },
              } = await worker.recognize(pg.imageDataUrl);
              if (text && text.trim()) {
                const lines = text
                  .replace(/\r\n/g, '\n')
                  .split(/\n{2,}/)
                  .map((s) => s.replace(/\s+/g, ' ').trim())
                  .filter(Boolean);
                pg.paragraphs = lines.map((line) => ({
                  text: line,
                  isHeading:
                    line.length < 60 &&
                    line === line.toUpperCase() &&
                    /[A-Z]/.test(line),
                  fontSize: 11.5,
                }));
              }
            }
          } finally {
            await worker.terminate();
          }
        }

        setPdfToWordPages(extractedPages);
      }

      setPdfToWordProgress('Building Microsoft Word (.DOCX) file...');
      const baseTitle = selectedDoc.name.replace(/\.pdf$/i, '');
      const docxBytes = await buildDocxFromPdfPages(
        extractedPages,
        pdfToWordMode,
        baseTitle
      );
      const docxFilename = `${baseTitle}.docx`;
      setPdfToWordDocxResult({
        bytes: docxBytes,
        name: docxFilename,
        pageCount: extractedPages.length,
      });

      if (downloadImmediately) {
        downloadBytesAsFile(docxBytes, docxFilename, DOCX_MIME_TYPE);
      }

      setFeedback(
        `Converted "${selectedDoc.name}" into Microsoft Word "${docxFilename}" (${formatBytes(docxBytes.byteLength)}).`
      );
    } catch (err) {
      console.error('Error converting PDF to Word:', err);
      setFeedback('Failed to convert PDF to Word (.DOCX).');
    } finally {
      setPdfToWordProgress(null);
      setIsBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Compact Header & Tool Grid */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
            PDF & Word Tools
          </h1>

          {/* Active File Selector (for single-doc tools) */}
          {activeTool !== 'merge-pdf' &&
            activeTool !== 'img-to-pdf' &&
            activeTool !== 'word-to-pdf' && (
              <div className="flex items-center gap-2 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-1.5">
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="text-xs font-bold bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#342B47] rounded-lg px-2 py-1.5 text-[#14101B] dark:text-[#F4F1F8] flex-1 min-w-0 max-w-[200px] sm:max-w-xs truncate cursor-pointer"
                >
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} ({doc.pageCount}p)
                    </option>
                  ))}
                </select>

                {onUploadNewPdf && (
                  <label className="px-2.5 py-1.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          const files = Array.from(e.target.files);
                          e.target.value = '';
                          await onUploadNewPdf(files, false);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            )}
        </div>

        {/* Clean 5-Column (3-Column on Phone) Tool Switcher Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 sm:gap-2">
          {TOOL_CATEGORIES.flatMap((g) => g.items).map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTool(t.id);
                  setFeedback(null);
                }}
                className={`px-2 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer truncate ${
                  active
                    ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-bold shadow-xs'
                    : 'bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-lg bg-[#15803D]/10 border border-[#15803D]/30 text-[#15803D] dark:text-[#4ADE80] text-xs font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Tool Workspace */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-6">
        {/* 1. MERGE PDF */}
        {activeTool === 'merge-pdf' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Merge Multiple PDF Documents
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Select PDFs from your library or upload from your device, arrange their order, and combine them into one file.
                </p>
              </div>
              <label className="px-4 py-2 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] text-xs font-semibold flex items-center gap-2 cursor-pointer self-start">
                <Upload className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                <span>Upload External PDFs</span>
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={handleUploadFilesForMerge}
                />
              </label>
            </div>

            {/* Quick Add from Library */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                Click a stored document to append to merge queue:
              </p>
              <div className="flex flex-wrap gap-2">
                {documents.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleAddDocToMerge(d)}
                    className="px-3 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>+ {d.name}</span>
                    <span className="font-mono text-[11px] text-[#6E667D]">
                      ({d.pageCount}p)
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Merge Queue List */}
            <div className="space-y-2">
              {mergeList.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{item.name}</p>
                      <p className="text-[11px] text-[#6E667D] font-mono tabular-nums">
                        {item.pages} pages · {formatBytes(item.bytes.byteLength)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={idx === 0}
                      onClick={() =>
                        setMergeList((prev) => {
                          const copy = [...prev];
                          [copy[idx - 1], copy[idx]] = [
                            copy[idx],
                            copy[idx - 1],
                          ];
                          return copy;
                        })
                      }
                      className="p-1.5 rounded border border-[#E4DFEC] dark:border-[#261F33] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      disabled={idx === mergeList.length - 1}
                      onClick={() =>
                        setMergeList((prev) => {
                          const copy = [...prev];
                          [copy[idx + 1], copy[idx]] = [
                            copy[idx],
                            copy[idx + 1],
                          ];
                          return copy;
                        })
                      }
                      className="p-1.5 rounded border border-[#E4DFEC] dark:border-[#261F33] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        setMergeList((prev) =>
                          prev.filter((m) => m.id !== item.id)
                        )
                      }
                      className="p-1.5 rounded text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => handleRunMerge(true)}
                disabled={isBusy || mergeList.length < 2}
                className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 disabled:opacity-40 cursor-pointer"
              >
                <Merge className="w-4 h-4" />
                <span>Merge & Download Combined PDF</span>
              </button>
              <button
                onClick={() => handleRunMerge(false)}
                disabled={isBusy || mergeList.length < 2}
                className="px-4 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-2 disabled:opacity-40 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Merge & Save to Vault Only</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. SPLIT PDF (Exact Range / Pages / Size Studio matching Image 1) */}
        {activeTool === 'split-pdf' && selectedDoc && (
          <div className="max-w-xl mx-auto space-y-6">
            {/* Top Bar with Active File Info + Upload Another PDF */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E4DFEC] dark:border-[#261F33]">
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] truncate">
                Document: <strong className="text-[#14101B] dark:text-[#F4F1F8]">{selectedDoc.name}</strong> ({actualSplitPageCount} pages · {formatBytes(selectedDoc.sizeBytes)})
              </p>
              <label className="px-3 py-1.5 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0">
                <Upload className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                <span>Change PDF</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleUploadPdfForSplit}
                />
              </label>
            </div>

            {/* Split Studio Card */}
            <div className="rounded-2xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] shadow-xs overflow-hidden">
              {/* Centered "Split" Title */}
              <div className="py-4 text-center border-b border-[#E4DFEC] dark:border-[#261F33]">
                <h2 className="text-xl font-bold text-[#2D3139] dark:text-[#F4F1F8]">
                  Split
                </h2>
              </div>

              {/* 3-Column Mode Tabs: Range | Pages | Size */}
              <div className="grid grid-cols-3 border-b border-[#E4DFEC] dark:border-[#261F33]">
                {/* Tab 1: Range */}
                <button
                  type="button"
                  onClick={() => setSplitTopTab('range')}
                  className={`relative py-4 px-2 flex flex-col items-center justify-center gap-2 border-r border-[#E4DFEC] dark:border-[#261F33] transition-colors cursor-pointer ${
                    splitTopTab === 'range'
                      ? 'bg-white dark:bg-[#16111F] text-[#14101B] dark:text-[#F4F1F8]'
                      : 'bg-[#F8F9FA] dark:bg-[#0D0A12] text-[#878D99]'
                  }`}
                >
                  {splitTopTab === 'range' && (
                    <span className="absolute top-2.5 left-2.5 w-5 h-5 rounded-full bg-[#3ECF8E] text-white flex items-center justify-center shadow-2xs">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </span>
                  )}
                  <div className="w-10 h-8 border-2 border-dashed border-current rounded flex items-center justify-center gap-1 px-1">
                    <span className="w-2.5 h-4 border border-current rounded-[1px]" />
                    <span className="w-1 h-0.5 bg-current" />
                    <span className="w-2.5 h-4 border border-current rounded-[1px]" />
                  </div>
                  <span className="text-sm font-medium">Range</span>
                </button>

                {/* Tab 2: Pages */}
                <button
                  type="button"
                  onClick={() => setSplitTopTab('pages')}
                  className={`relative py-4 px-2 flex flex-col items-center justify-center gap-2 border-r border-[#E4DFEC] dark:border-[#261F33] transition-colors cursor-pointer ${
                    splitTopTab === 'pages'
                      ? 'bg-white dark:bg-[#16111F] text-[#14101B] dark:text-[#F4F1F8]'
                      : 'bg-[#F8F9FA] dark:bg-[#0D0A12] text-[#878D99]'
                  }`}
                >
                  {splitTopTab === 'pages' && (
                    <span className="absolute top-2.5 left-2.5 w-5 h-5 rounded-full bg-[#3ECF8E] text-white flex items-center justify-center shadow-2xs">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </span>
                  )}
                  <LayoutGrid className="w-7 h-7 stroke-[1.6]" />
                  <span className="text-sm font-medium">Pages</span>
                </button>

                {/* Tab 3: Size */}
                <button
                  type="button"
                  onClick={() => setSplitTopTab('size')}
                  className={`relative py-4 px-2 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer ${
                    splitTopTab === 'size'
                      ? 'bg-white dark:bg-[#16111F] text-[#14101B] dark:text-[#F4F1F8]'
                      : 'bg-[#F8F9FA] dark:bg-[#0D0A12] text-[#878D99]'
                  }`}
                >
                  {splitTopTab === 'size' && (
                    <span className="absolute top-2.5 left-2.5 w-5 h-5 rounded-full bg-[#3ECF8E] text-white flex items-center justify-center shadow-2xs">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </span>
                  )}
                  <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-[#FBBF24] text-[#14101B] flex items-center justify-center shadow-2xs">
                    <Crown className="w-3 h-3 fill-current" />
                  </span>
                  <FileOutput className="w-7 h-7 stroke-[1.6]" />
                  <span className="text-sm font-medium">Size</span>
                </button>
              </div>

              {/* Tab Content Body */}
              <div className="p-5 sm:p-6 space-y-5">
                {/* TAB 1: RANGE */}
                {splitTopTab === 'range' && (
                  <div className="space-y-5">
                    <div className="space-y-2.5">
                      <p className="text-sm font-bold text-[#2D3139] dark:text-[#F4F1F8]">
                        Range mode:
                      </p>
                      <div className="grid grid-cols-3 gap-2.5">
                        <button
                          type="button"
                          onClick={() => setSplitRangeSubMode('custom')}
                          className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                            splitRangeSubMode === 'custom'
                              ? 'border-2 border-[#E5322D] text-[#E5322D] bg-white dark:bg-[#16111F] font-semibold shadow-2xs'
                              : 'border border-transparent bg-[#F2F3F7] dark:bg-[#261F33] text-[#6E7582] dark:text-[#A39BB5]'
                          }`}
                        >
                          Custom
                        </button>
                        <button
                          type="button"
                          onClick={() => setSplitRangeSubMode('fixed')}
                          className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                            splitRangeSubMode === 'fixed'
                              ? 'border-2 border-[#E5322D] text-[#E5322D] bg-white dark:bg-[#16111F] font-semibold shadow-2xs'
                              : 'border border-transparent bg-[#F2F3F7] dark:bg-[#261F33] text-[#6E7582] dark:text-[#A39BB5]'
                          }`}
                        >
                          Fixed
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSplitRangeSubMode('smart');
                            handleGenerateSmartRanges();
                          }}
                          className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1 ${
                            splitRangeSubMode === 'smart'
                              ? 'border-2 border-[#E5322D] text-[#E5322D] bg-white dark:bg-[#16111F] font-semibold shadow-2xs'
                              : 'border border-transparent bg-[#F2F3F7] dark:bg-[#261F33] text-[#6E7582] dark:text-[#A39BB5]'
                          }`}
                        >
                          <span>Smart</span>
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Custom or Smart Range List */}
                    {(splitRangeSubMode === 'custom' ||
                      splitRangeSubMode === 'smart') && (
                      <div className="space-y-4">
                        {customRanges.map((range, idx) => (
                          <div
                            key={range.id}
                            className="space-y-2 pb-3 border-b border-[#E4DFEC]/70 dark:border-[#261F33] last:border-b-0"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <ArrowUpDown className="w-4 h-4 text-[#5A6270]" />
                                <span className="text-sm font-medium text-[#2D3139] dark:text-[#F4F1F8]">
                                  Range
                                </span>
                                <span className="px-2 py-0.5 rounded bg-[#EAECEF] dark:bg-[#261F33] text-xs font-semibold text-[#2D3139] dark:text-[#F4F1F8]">
                                  {idx + 1}
                                </span>
                              </div>
                              {customRanges.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRemoveCustomRange(range.id)
                                  }
                                  className="text-xs font-semibold text-[#E5322D] hover:underline cursor-pointer"
                                >
                                  Remove
                                </button>
                              )}
                            </div>

                            <div className="space-y-1.5">
                              {/* "from page" split input box */}
                              <div className="flex items-center border border-[#8E95A2] dark:border-[#3E3452] rounded-md overflow-hidden max-w-[260px] bg-white dark:bg-[#0D0A12]">
                                <span className="px-3 py-2 text-xs font-medium text-[#2D3139] dark:text-[#D5CEE0] border-r border-[#8E95A2] dark:border-[#3E3452] whitespace-nowrap">
                                  from page
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={actualSplitPageCount}
                                  value={range.from}
                                  onChange={(e) =>
                                    handleUpdateCustomRange(
                                      range.id,
                                      'from',
                                      Number(e.target.value)
                                    )
                                  }
                                  className="w-full px-3 py-2 text-right text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] bg-transparent focus:outline-none"
                                />
                              </div>

                              {/* "to" split input box */}
                              <div className="flex items-center border border-[#8E95A2] dark:border-[#3E3452] rounded-md overflow-hidden max-w-[200px] bg-white dark:bg-[#0D0A12]">
                                <span className="px-3.5 py-2 text-xs font-medium text-[#2D3139] dark:text-[#D5CEE0] border-r border-[#8E95A2] dark:border-[#3E3452] whitespace-nowrap">
                                  to
                                </span>
                                <input
                                  type="number"
                                  min={range.from}
                                  max={actualSplitPageCount}
                                  value={range.to}
                                  onChange={(e) =>
                                    handleUpdateCustomRange(
                                      range.id,
                                      'to',
                                      Number(e.target.value)
                                    )
                                  }
                                  className="w-full px-3 py-2 text-right text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] bg-transparent focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* + Add Range Button */}
                        <div className="pt-2 text-center border-t border-[#E4DFEC] dark:border-[#261F33]">
                          <button
                            type="button"
                            onClick={handleAddCustomRange}
                            className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg border border-[#E5322D] text-[#E5322D] hover:bg-[#E5322D]/5 text-xs font-bold transition-colors cursor-pointer"
                          >
                            <Plus className="w-4 h-4 stroke-[2.5]" />
                            <span>Add Range</span>
                          </button>
                        </div>

                        {customRanges.length > 1 && (
                          <label className="flex items-center gap-2.5 pt-1 text-xs font-medium text-[#2D3139] dark:text-[#D5CEE0] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={mergeAllRanges}
                              onChange={(e) =>
                                setMergeAllRanges(e.target.checked)
                              }
                              className="w-4 h-4 accent-[#E5322D] rounded"
                            />
                            <span>Merge all ranges in one PDF file.</span>
                          </label>
                        )}
                      </div>
                    )}

                    {/* Fixed Range Mode */}
                    {splitRangeSubMode === 'fixed' && (
                      <div className="space-y-3">
                        <div className="flex items-center border border-[#8E95A2] dark:border-[#3E3452] rounded-md overflow-hidden max-w-[280px] bg-white dark:bg-[#0D0A12]">
                          <span className="px-3 py-2.5 text-xs font-medium text-[#2D3139] dark:text-[#D5CEE0] border-r border-[#8E95A2] dark:border-[#3E3452] whitespace-nowrap">
                            Split into page ranges of:
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={actualSplitPageCount}
                            value={fixedRangeStep}
                            onChange={(e) =>
                              setFixedRangeStep(
                                Math.max(
                                  1,
                                  Math.min(
                                    actualSplitPageCount,
                                    Number(e.target.value) || 1
                                  )
                                )
                              )
                            }
                            className="w-full px-3 py-2.5 text-right text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] bg-transparent focus:outline-none"
                          />
                        </div>
                        <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] bg-[#F8F9FA] dark:bg-[#0D0A12] p-3 rounded-lg border border-[#E4DFEC] dark:border-[#261F33]">
                          This PDF will be split into files of{' '}
                          <strong>{fixedRangeStep}</strong> page(s) each.{' '}
                          <strong>
                            {Math.ceil(
                              actualSplitPageCount / Math.max(1, fixedRangeStep)
                            )}{' '}
                            PDF(s)
                          </strong>{' '}
                          will be created.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: PAGES */}
                {splitTopTab === 'pages' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-sm font-bold text-[#2D3139] dark:text-[#F4F1F8]">
                        Extract mode:
                      </p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => setSplitMode('each-page')}
                          className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                            splitMode === 'each-page'
                              ? 'border-2 border-[#E5322D] text-[#E5322D] bg-white dark:bg-[#16111F] font-semibold'
                              : 'border border-transparent bg-[#F2F3F7] dark:bg-[#261F33] text-[#6E7582] dark:text-[#A39BB5]'
                          }`}
                        >
                          Extract all pages
                        </button>
                        <button
                          type="button"
                          onClick={() => setSplitMode('range')}
                          className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                            splitMode === 'range'
                              ? 'border-2 border-[#E5322D] text-[#E5322D] bg-white dark:bg-[#16111F] font-semibold'
                              : 'border border-transparent bg-[#F2F3F7] dark:bg-[#261F33] text-[#6E7582] dark:text-[#A39BB5]'
                          }`}
                        >
                          Select pages
                        </button>
                      </div>
                    </div>

                    {splitMode === 'each-page' ? (
                      <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] bg-[#F8F9FA] dark:bg-[#0D0A12] p-3 rounded-lg border border-[#E4DFEC] dark:border-[#261F33]">
                        Selected pages will be converted into separate PDF files.{' '}
                        <strong>{actualSplitPageCount} PDF(s)</strong> will be created.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-[#2D3139] dark:text-[#F4F1F8]">
                            Pages to extract:
                          </label>
                          <input
                            type="text"
                            value={splitRangeInput}
                            onChange={(e) => setSplitRangeInput(e.target.value)}
                            placeholder={`e.g. 1, 3-${actualSplitPageCount}`}
                            className="w-full px-3.5 py-2 text-sm font-mono rounded-lg bg-white dark:bg-[#0D0A12] border border-[#8E95A2] dark:border-[#3E3452]"
                          />
                        </div>

                        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2.5 rounded-xl bg-[#F8F9FA] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]">
                          {Array.from(
                            { length: actualSplitPageCount },
                            (_, idx) => idx + 1
                          ).map((pNum) => {
                            const selectedList = parsePageRanges(
                              splitRangeInput,
                              actualSplitPageCount
                            );
                            const isPicked = selectedList.includes(pNum);
                            return (
                              <button
                                key={pNum}
                                type="button"
                                onClick={() => handleToggleSplitPageNumber(pNum)}
                                className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold transition-colors cursor-pointer ${
                                  isPicked
                                    ? 'bg-[#E5322D] text-white'
                                    : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D]'
                                }`}
                              >
                                {pNum}
                              </button>
                            );
                          })}
                        </div>

                        <label className="flex items-center gap-2.5 text-xs font-medium text-[#2D3139] dark:text-[#D5CEE0] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={mergeAllRanges}
                            onChange={(e) =>
                              setMergeAllRanges(e.target.checked)
                            }
                            className="w-4 h-4 accent-[#E5322D] rounded"
                          />
                          <span>Merge extracted pages into one PDF file.</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: SIZE */}
                {splitTopTab === 'size' && (
                  <div className="space-y-4">
                    <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                      Split this document ({formatBytes(selectedDoc.sizeBytes)}) into smaller PDF files, each no larger than the maximum size specified below:
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-[#8E95A2] dark:border-[#3E3452] rounded-md overflow-hidden flex-1 max-w-[240px] bg-white dark:bg-[#0D0A12]">
                        <span className="px-3 py-2 text-xs font-medium text-[#2D3139] dark:text-[#D5CEE0] border-r border-[#8E95A2] dark:border-[#3E3452] whitespace-nowrap">
                          Max size:
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={maxSplitSizeValue}
                          onChange={(e) =>
                            setMaxSplitSizeValue(
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="w-full px-3 py-2 text-right text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8] bg-transparent focus:outline-none"
                        />
                      </div>
                      <div className="inline-flex rounded-md border border-[#8E95A2] dark:border-[#3E3452] overflow-hidden">
                        {(['KB', 'MB'] as const).map((unit) => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setMaxSplitSizeUnit(unit)}
                            className={`px-3 py-2 text-xs font-bold cursor-pointer ${
                              maxSplitSizeUnit === unit
                                ? 'bg-[#E5322D] text-white'
                                : 'bg-white dark:bg-[#0D0A12] text-[#6E667D]'
                            }`}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Primary Red "Split PDF ->" Button */}
                <button
                  type="button"
                  onClick={handleRunSplitExtract}
                  disabled={isBusy}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#E5322D] hover:bg-[#C92520] text-white text-base sm:text-lg font-bold flex items-center justify-center gap-3 shadow-md transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>{isBusy ? 'Splitting PDF...' : 'Split PDF'}</span>
                  <CircleArrowRight className="w-6 h-6 stroke-[2]" />
                </button>
              </div>
            </div>

            {/* Persistent Download Split PDF Result Cards */}
            {splitResults.length > 0 && (
              <div className="p-4 rounded-xl bg-[#15803D]/10 border-2 border-[#15803D]/40 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-[#15803D] dark:text-[#4ADE80]">
                    Ready to Download ({splitResults.length} Split PDF{' '}
                    {splitResults.length === 1 ? 'File' : 'Files'})
                  </p>
                  {splitResults.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        splitResults.forEach((item, idx) => {
                          setTimeout(() => {
                            const a = document.createElement('a');
                            a.href = item.downloadUrl;
                            a.download = item.name;
                            a.rel = 'noopener';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          }, idx * 350);
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download All ({splitResults.length})</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {splitResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                          {item.name}
                        </p>
                        <p className="text-[11px] font-mono text-[#6E667D] dark:text-[#A39BB5]">
                          {item.pagesLabel} · {item.pageCount}{' '}
                          {item.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                          {formatBytes(item.bytes.byteLength)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
                        <a
                          href={item.downloadUrl}
                          download={item.name}
                          rel="noopener"
                          className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs no-underline"
                        >
                          <Download className="w-4 h-4" />
                          <span>Download Split PDF</span>
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            shareOrDownloadBytesAsFile(
                              item.bytes,
                              item.name,
                              'application/pdf'
                            )
                          }
                          className="px-3 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Save / Share</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. COMPRESS PDF */}
        {activeTool === 'compress-pdf' && selectedDoc && (
          <div className="space-y-6 max-w-3xl">
            <div>
              <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Compress PDF File Size
              </h2>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                Choose a compression profile and compare exact before-and-after byte sizes.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  {
                    id: 'low',
                    title: 'Stream Optimization',
                    desc: 'Lossless object stream packing; preserves 100% vector sharpness.',
                  },
                  {
                    id: 'medium',
                    title: 'Balanced Studio (Recommended)',
                    desc: '140 DPI page rasterization at 68% JPEG quality for email attachments.',
                  },
                  {
                    id: 'extreme',
                    title: 'Maximum Compression',
                    desc: '96 DPI compact rasterization at 45% quality for minimum bandwidth.',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setCompressionLevel(opt.id)}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    compressionLevel === opt.id
                      ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/5 dark:bg-[#9D5CE5]/15'
                      : 'border-[#E4DFEC] dark:border-[#261F33]'
                  }`}
                >
                  <p className="text-xs font-bold">{opt.title}</p>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] mt-1 leading-relaxed">
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>

            <button
              onClick={handleRunCompress}
              disabled={isBusy}
              className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Minimize2 className="w-4 h-4" />
              <span>
                {isBusy ? 'Compressing PDF...' : 'Run PDF Compression'}
              </span>
            </button>

            {compressionResult && (
              <div className="p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold">Compression Comparison</p>
                  <p className="text-xs font-mono tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                    Original: {formatBytes(compressionResult.originalBytes)} →
                    Resulting: {formatBytes(compressionResult.compressedBytes)}
                  </p>
                </div>
                <button
                  onClick={() =>
                    downloadBytesAsFile(
                      compressionResult.data,
                      compressionResult.name
                    )
                  }
                  className="px-4 py-2 rounded-lg bg-[#15803D] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer self-start"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Resulting PDF</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4. CONVERT IMAGES TO PDF */}
        {activeTool === 'img-to-pdf' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-base font-bold">
                  Convert Images (PNG / JPG / WebP) to PDF
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Import multiple images and compile them into a standardized PDF packet.
                </p>
              </div>
              <label className="px-4 py-2.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer self-start">
                <Upload className="w-4 h-4" />
                <span>Select Images</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleSelectImagesForPdf}
                />
              </label>
            </div>

            {uploadedImages.length > 0 && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {uploadedImages.map((img, i) => (
                    <div
                      key={img.id}
                      className="p-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] space-y-1.5"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-28 object-cover rounded"
                      />
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-bold">#{i + 1}</span>
                        <button
                          onClick={() =>
                            setUploadedImages((prev) =>
                              prev.filter((x) => x.id !== img.id)
                            )
                          }
                          className="text-[#DC2626] cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {(['A4', 'Letter', 'Fit'] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setImgPageSize(sz)}
                        className={`px-3 py-1.5 rounded text-xs font-semibold border cursor-pointer ${
                          imgPageSize === sz
                            ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                            : 'border-[#E4DFEC] dark:border-[#261F33]'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleConvertImagesToPdf}
                    disabled={isBusy}
                    className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Build & Download PDF</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 5. PDF TO PNG / JPG & WRITE TEXT OVER CONVERTED PICTURES */}
        {activeTool === 'pdf-to-img' && selectedDoc && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold">
                  Convert PDF to Pictures (PNG / JPG) & Write Text Over Pictures
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Click anywhere on a converted PDF picture (or click <strong>+ Add Text Box</strong>) to write text over it and customize Text Color &amp; Text Box Color.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {pictureTextBoxUndoStack.length > 0 && (
                  <button
                    type="button"
                    onClick={handleUndoPictureTextBox}
                    className="px-3 py-2 rounded-lg border border-[#4A1D5E] dark:border-[#9D5CE5] text-[#4A1D5E] dark:text-[#D5B3FF] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Undo ({pictureTextBoxUndoStack.length})</span>
                  </button>
                )}

                <select
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(
                      e.target.value as 'image/png' | 'image/jpeg'
                    )
                  }
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12]"
                >
                  <option value="image/png">PNG (Lossless)</option>
                  <option value="image/jpeg">JPG (Compact)</option>
                </select>

                <button
                  onClick={handleRenderPdfToImagesAndText}
                  disabled={isBusy}
                  className="px-3.5 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold cursor-pointer"
                >
                  {isBusy ? 'Rendering...' : 'Re-Render Pictures'}
                </button>

                {renderedImages.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveConvertedPicturesWithTextAsPdf}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Pictures with Text as PDF</span>
                  </button>
                )}
              </div>
            </div>

            {/* Text & Text Box Color Formatting Toolbar for Converted Pictures */}
            <div className="p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Text Color Picker */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Text Color:
                  </span>
                  {[
                    '#14101B',
                    '#FFFFFF',
                    '#4A1D5E',
                    '#DC2626',
                    '#2563EB',
                    '#15803D',
                    '#D97706',
                    '#FACC15',
                  ].map((hex) => {
                    const activeBox = selectedPicTextBox
                      ? (
                          pictureTextBoxesByPage[
                            selectedPicTextBox.pageNumber
                          ] || []
                        ).find((b) => b.id === selectedPicTextBox.id)
                      : null;
                    const currentColor = activeBox
                      ? activeBox.textColor
                      : defaultPicTextColor;
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => {
                          setDefaultPicTextColor(hex);
                          updateSelectedPicTextBox({ textColor: hex });
                        }}
                        style={{ backgroundColor: hex }}
                        title={`Text color ${hex}`}
                        className={`w-5 h-5 rounded-full border cursor-pointer ${
                          currentColor === hex
                            ? 'ring-2 ring-offset-1 ring-[#4A1D5E] dark:ring-[#9D5CE5]'
                            : 'border-neutral-300 dark:border-neutral-600'
                        }`}
                      />
                    );
                  })}
                  <input
                    type="color"
                    value={defaultPicTextColor}
                    onChange={(e) => {
                      setDefaultPicTextColor(e.target.value);
                      updateSelectedPicTextBox({ textColor: e.target.value });
                    }}
                    title="Custom Text Color"
                    className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer"
                  />
                </div>

                <span className="h-5 w-px bg-[#E4DFEC] dark:bg-[#261F33]" />

                {/* Text Box Background Color Picker */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Text Box Color:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultPicBoxBgColor('transparent');
                      updateSelectedPicTextBox({ boxBgColor: 'transparent' });
                    }}
                    className={`px-2 py-0.5 rounded text-xs font-semibold border cursor-pointer ${
                      defaultPicBoxBgColor === 'transparent'
                        ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                        : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D]'
                    }`}
                  >
                    Transparent
                  </button>
                  {[
                    '#FFFFFF',
                    '#FEF08A',
                    '#DBEAFE',
                    '#DCFCE7',
                    '#FCE7F3',
                    '#F3E8FF',
                    '#14101B',
                    '#4A1D5E',
                    '#DC2626',
                    '#2563EB',
                  ].map((hex) => {
                    const activeBox = selectedPicTextBox
                      ? (
                          pictureTextBoxesByPage[
                            selectedPicTextBox.pageNumber
                          ] || []
                        ).find((b) => b.id === selectedPicTextBox.id)
                      : null;
                    const currentBg = activeBox
                      ? activeBox.boxBgColor
                      : defaultPicBoxBgColor;
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => {
                          setDefaultPicBoxBgColor(hex);
                          updateSelectedPicTextBox({ boxBgColor: hex });
                        }}
                        style={{ backgroundColor: hex }}
                        title={`Text box background color ${hex}`}
                        className={`w-5 h-5 rounded border cursor-pointer ${
                          currentBg === hex
                            ? 'ring-2 ring-offset-1 ring-[#4A1D5E] dark:ring-[#9D5CE5]'
                            : 'border-neutral-300 dark:border-neutral-600'
                        }`}
                      />
                    );
                  })}
                  <input
                    type="color"
                    value={
                      defaultPicBoxBgColor.startsWith('#')
                        ? defaultPicBoxBgColor
                        : '#FFFFFF'
                    }
                    onChange={(e) => {
                      setDefaultPicBoxBgColor(e.target.value);
                      updateSelectedPicTextBox({ boxBgColor: e.target.value });
                    }}
                    title="Custom Text Box Color"
                    className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer"
                  />
                </div>

                {/* Border color toggle */}
                <span className="h-5 w-px bg-[#E4DFEC] dark:bg-[#261F33]" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Box Border:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultPicBoxBorderColor('transparent');
                      updateSelectedPicTextBox({
                        boxBorderColor: 'transparent',
                      });
                    }}
                    className={`px-2 py-0.5 rounded text-xs font-semibold border cursor-pointer ${
                      defaultPicBoxBorderColor === 'transparent'
                        ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                        : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D]'
                    }`}
                  >
                    None
                  </button>
                  {['#14101B', '#4A1D5E', '#DC2626', '#2563EB'].map((bHex) => (
                    <button
                      key={bHex}
                      type="button"
                      onClick={() => {
                        setDefaultPicBoxBorderColor(bHex);
                        updateSelectedPicTextBox({ boxBorderColor: bHex });
                      }}
                      style={{ backgroundColor: bHex }}
                      className={`w-4 h-4 rounded border cursor-pointer ${
                        defaultPicBoxBorderColor === bHex
                          ? 'ring-2 ring-offset-1 ring-[#4A1D5E]'
                          : 'border-neutral-300'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {selectedPicTextBox && (
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const activeBox = (
                      pictureTextBoxesByPage[selectedPicTextBox.pageNumber] ||
                      []
                    ).find((b) => b.id === selectedPicTextBox.id);
                    if (!activeBox) return null;
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedPicTextBox({
                              fontWeight:
                                activeBox.fontWeight === 'bold'
                                  ? 'normal'
                                  : 'bold',
                            })
                          }
                          className={`p-1.5 rounded border cursor-pointer ${
                            activeBox.fontWeight === 'bold'
                              ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                              : 'border-[#E4DFEC] dark:border-[#261F33]'
                          }`}
                          title="Bold"
                        >
                          <Bold className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedPicTextBox({
                              fontStyle:
                                activeBox.fontStyle === 'italic'
                                  ? 'normal'
                                  : 'italic',
                            })
                          }
                          className={`p-1.5 rounded border cursor-pointer ${
                            activeBox.fontStyle === 'italic'
                              ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                              : 'border-[#E4DFEC] dark:border-[#261F33]'
                          }`}
                          title="Italic"
                        >
                          <Italic className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min={10}
                          max={64}
                          value={activeBox.fontSize}
                          onChange={(e) =>
                            updateSelectedPicTextBox({
                              fontSize: Number(e.target.value),
                            })
                          }
                          className="w-14 px-2 py-1 text-xs font-mono border border-[#E4DFEC] dark:border-[#261F33] rounded text-center bg-white dark:bg-[#16111F]"
                          title="Font size"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            removeSelectedPicTextBox(
                              selectedPicTextBox.pageNumber,
                              selectedPicTextBox.id
                            )
                          }
                          className="px-2.5 py-1 rounded bg-[#DC2626] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove Box</span>
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {renderedImages.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {renderedImages.map((img) => {
                  const ext = exportFormat === 'image/png' ? 'png' : 'jpg';
                  const pageBoxes =
                    pictureTextBoxesByPage[img.pageNumber] || [];
                  const pageText =
                    extractedPagesText.find(
                      (t) => t.pageNumber === img.pageNumber
                    )?.text || '';
                  return (
                    <div
                      key={img.pageNumber}
                      className="p-4 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold font-mono">
                          Page {img.pageNumber} Picture ({ext.toUpperCase()})
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleAddTextBoxToConvertedPicture(img.pageNumber)
                            }
                            className="px-2.5 py-1 rounded bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Type className="w-3 h-3" />
                            <span>+ Add Text Box</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadConvertedPictureWithText(img)
                            }
                            className="px-2.5 py-1 rounded border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>Download .{ext}</span>
                          </button>
                        </div>
                      </div>

                      {/* Interactive Picture Canvas where user can click or drag text boxes over the converted PDF picture */}
                      <div
                        onClick={(e) => {
                          if (e.target === e.currentTarget) {
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const cx = (e.clientX - rect.left) / rect.width;
                            const cy = (e.clientY - rect.top) / rect.height;
                            handleAddTextBoxToConvertedPicture(
                              img.pageNumber,
                              cx,
                              cy
                            );
                          }
                        }}
                        onPointerMove={(e) => {
                          if (
                            !draggingPicBox ||
                            draggingPicBox.pageNumber !== img.pageNumber
                          )
                            return;
                          const dx =
                            (e.clientX - draggingPicBox.startX) /
                            draggingPicBox.containerRect.width;
                          const dy =
                            (e.clientY - draggingPicBox.startY) /
                            draggingPicBox.containerRect.height;
                          setPictureTextBoxesByPage((prev) => ({
                            ...prev,
                            [img.pageNumber]: (prev[img.pageNumber] || []).map(
                              (b) => {
                                if (b.id !== draggingPicBox.id) return b;
                                if (draggingPicBox.mode === 'move') {
                                  return {
                                    ...b,
                                    x: Math.max(
                                      0,
                                      Math.min(
                                        1 - b.width,
                                        draggingPicBox.origX + dx
                                      )
                                    ),
                                    y: Math.max(
                                      0,
                                      Math.min(
                                        1 - b.height,
                                        draggingPicBox.origY + dy
                                      )
                                    ),
                                  };
                                } else {
                                  return {
                                    ...b,
                                    width: Math.max(
                                      0.08,
                                      Math.min(
                                        1 - b.x,
                                        draggingPicBox.origW + dx
                                      )
                                    ),
                                    height: Math.max(
                                      0.04,
                                      Math.min(
                                        1 - b.y,
                                        draggingPicBox.origH + dy
                                      )
                                    ),
                                  };
                                }
                              }
                            ),
                          }));
                        }}
                        onPointerUp={() => setDraggingPicBox(null)}
                        title="Click anywhere on this picture to add a text box"
                        className="relative w-full bg-white rounded-lg border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden cursor-crosshair select-none"
                      >
                        <img
                          src={img.dataUrl}
                          alt={`Page ${img.pageNumber}`}
                          referrerPolicy="no-referrer"
                          draggable={false}
                          className="w-full h-auto block pointer-events-none"
                        />

                        {pageBoxes.map((box) => {
                          const isBoxSelected =
                            selectedPicTextBox?.pageNumber === img.pageNumber &&
                            selectedPicTextBox?.id === box.id;
                          return (
                            <div
                              key={box.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPicTextBox({
                                  pageNumber: img.pageNumber,
                                  id: box.id,
                                });
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setSelectedPicTextBox({
                                  pageNumber: img.pageNumber,
                                  id: box.id,
                                });
                                const parentRect =
                                  e.currentTarget.parentElement?.getBoundingClientRect();
                                if (!parentRect) return;
                                setPictureTextBoxUndoStack((prev) => [
                                  ...prev,
                                  pictureTextBoxesByPage,
                                ]);
                                setDraggingPicBox({
                                  pageNumber: img.pageNumber,
                                  id: box.id,
                                  mode: 'move',
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  origX: box.x,
                                  origY: box.y,
                                  origW: box.width,
                                  origH: box.height,
                                  containerRect: parentRect,
                                });
                              }}
                              style={{
                                left: `${box.x * 100}%`,
                                top: `${box.y * 100}%`,
                                width: `${box.width * 100}%`,
                                height: `${box.height * 100}%`,
                                backgroundColor:
                                  box.boxBgColor &&
                                  box.boxBgColor !== 'transparent'
                                    ? box.boxBgColor
                                    : 'transparent',
                                borderColor:
                                  box.boxBorderColor &&
                                  box.boxBorderColor !== 'transparent'
                                    ? box.boxBorderColor
                                    : 'transparent',
                                borderWidth:
                                  box.boxBorderColor &&
                                  box.boxBorderColor !== 'transparent'
                                    ? '1.5px'
                                    : '0px',
                                  borderStyle: 'solid',
                                  color: box.textColor,
                                  fontSize: `${box.fontSize}px`,
                                  fontWeight: box.fontWeight || 'normal',
                                  fontStyle: box.fontStyle || 'normal',
                                  touchAction: 'none',
                                }}
                                className={`absolute p-1.5 rounded-xs cursor-grab active:cursor-grabbing touch-none ${
                                  isBoxSelected
                                    ? 'ring-2 ring-[#2563EB] z-20'
                                    : 'hover:ring-1 hover:ring-[#2563EB]/60 z-10'
                                }`}
                              >
                                <textarea
                                  value={box.text}
                                  placeholder="Type here"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedPicTextBox({
                                      pageNumber: img.pageNumber,
                                      id: box.id,
                                    });
                                  }}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPictureTextBoxesByPage((prev) => ({
                                      ...prev,
                                      [img.pageNumber]: (
                                        prev[img.pageNumber] || []
                                      ).map((b) =>
                                        b.id === box.id
                                          ? { ...b, text: val }
                                          : b
                                      ),
                                    }));
                                  }}
                                  style={{
                                    color: box.textColor,
                                    backgroundColor: 'transparent',
                                    fontWeight: box.fontWeight || 'normal',
                                    fontStyle: box.fontStyle || 'normal',
                                  }}
                                  className="w-full h-full resize-none focus:outline-none leading-snug placeholder:opacity-80 placeholder:text-current cursor-grab active:cursor-grabbing"
                                />

                                {isBoxSelected && (
                                  <>
                                    <div
                                      title="Drag anywhere on this box or handle to move smoothly"
                                      className="absolute -bottom-6 left-0 px-2 py-0.5 rounded-full bg-[#2563EB] text-white text-[10px] font-bold shadow flex items-center gap-1 pointer-events-none whitespace-nowrap"
                                    >
                                      <Move className="w-3 h-3" />
                                      <span>Drag to Move</span>
                                    </div>
                                    <button
                                      type="button"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeSelectedPicTextBox(
                                          img.pageNumber,
                                          box.id
                                        );
                                      }}
                                      className="absolute -top-6 right-0 px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold shadow cursor-pointer"
                                    >
                                      Remove
                                    </button>
                                    <div
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        const parentRect =
                                          e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                                        if (!parentRect) return;
                                        setDraggingPicBox({
                                          pageNumber: img.pageNumber,
                                          id: box.id,
                                          mode: 'resize',
                                          startX: e.clientX,
                                          startY: e.clientY,
                                          origX: box.x,
                                          origY: box.y,
                                          origW: box.width,
                                          origH: box.height,
                                          containerRect: parentRect,
                                        });
                                      }}
                                      style={{ touchAction: 'none' }}
                                      className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#2563EB] border-2 border-white cursor-nwse-resize touch-none"
                                    />
                                  </>
                                )}
                              </div>
                          );
                        })}
                      </div>

                      {pageText && (
                        <div className="p-2 rounded bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-mono text-[#6E667D] max-h-24 overflow-y-auto whitespace-pre-wrap">
                          {pageText}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 6. ORGANIZE & ROTATE PAGES (Full Reordering, Position Jump, Drag & Drop, Rotate, Duplicate, Blank, Delete) */}
        {activeTool === 'organize-pdf' && selectedDoc && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Organize, Reorder, Rotate, or Delete PDF Pages
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Use the <strong>← / →</strong> arrows, choose a target <strong>Page #</strong> from the dropdown, or drag cards to change page order, then click <strong>Apply &amp; Save PDF</strong>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOrgSpecs((prev) => [...prev].reverse())}
                  className="px-3 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>Reverse Order</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOrgSpecs((prev) =>
                      prev.map((s) => ({
                        ...s,
                        addRotationDeg: (s.addRotationDeg + 90) % 360,
                      }))
                    )
                  }
                  className="px-3 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Rotate All 90°</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOrgSpecs((prev) => [
                      ...prev,
                      {
                        id: `blank-${Date.now()}`,
                        isBlank: true,
                        addRotationDeg: 0,
                      },
                    ])
                  }
                  className="px-3 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <PlusSquare className="w-3.5 h-3.5" />
                  <span>+ Blank Page</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveOrganizedPdf(false)}
                  disabled={isBusy || orgSpecs.length === 0}
                  className="px-4 py-2 rounded-lg bg-[#003FE8] hover:bg-[#0033BA] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isBusy ? 'Saving Order...' : 'Apply & Download PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveOrganizedPdf(true)}
                  disabled={isBusy || orgSpecs.length === 0}
                  className="px-4 py-2 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <span>Apply &amp; Open in Editor</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {orgSpecs.map((spec, idx) => (
                <div
                  key={spec.id}
                  draggable
                  onDragStart={() => setDraggedOrgIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedOrgIdx !== null && draggedOrgIdx !== idx) {
                      moveOrgPage(draggedOrgIdx, idx);
                    }
                    setDraggedOrgIdx(null);
                  }}
                  onDragEnd={() => setDraggedOrgIdx(null)}
                  className={`p-3 rounded-xl border transition-all bg-[#FAF9FB] dark:bg-[#0D0A12] space-y-2.5 ${
                    draggedOrgIdx === idx
                      ? 'opacity-50 border-[#003FE8] ring-2 ring-[#003FE8]'
                      : 'border-[#E4DFEC] dark:border-[#261F33]'
                  }`}
                >
                  {/* Top Bar: Position Selector + Original Page Info */}
                  <div className="flex items-center justify-between gap-1 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-bold text-[#6E667D] dark:text-[#A39BB5]">
                        Pos:
                      </span>
                      <select
                        value={idx}
                        onChange={(e) => moveOrgPage(idx, Number(e.target.value))}
                        aria-label={`Move page ${idx + 1} to position`}
                        className="px-1.5 py-0.5 rounded bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold text-[#003FE8] dark:text-[#60A5FA] cursor-pointer"
                      >
                        {orgSpecs.map((_, posIdx) => (
                          <option key={posIdx} value={posIdx}>
                            #{posIdx + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="font-mono text-[10px] text-[#6E667D] dark:text-[#A39BB5]">
                      {spec.sourcePageNumber
                        ? `Orig p.${spec.sourcePageNumber}`
                        : 'Blank Page'}
                    </span>
                  </div>

                  {/* Page Thumbnail Preview */}
                  <div className="h-40 bg-white rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center overflow-hidden relative">
                    {spec.isBlank ? (
                      <span className="text-xs text-[#6E667D] font-mono">
                        [Blank A4 Page]
                      </span>
                    ) : (
                      <img
                        src={spec.thumbUrl}
                        alt={`Page ${spec.sourcePageNumber}`}
                        referrerPolicy="no-referrer"
                        style={{
                          transform: `rotate(${spec.addRotationDeg}deg)`,
                        }}
                        className="max-h-full max-w-full object-contain transition-transform"
                      />
                    )}
                  </div>

                  {/* Action Controls Row: Move Left, Move Right, Rotate, Duplicate, Delete */}
                  <div className="flex items-center justify-between gap-1 pt-0.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveOrgPage(idx, idx - 1)}
                        title="Move page earlier (Left / Up)"
                        className="px-2 py-1.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#003FE8] hover:text-white disabled:opacity-30 cursor-pointer flex items-center gap-0.5 text-[11px] font-bold transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === orgSpecs.length - 1}
                        onClick={() => moveOrgPage(idx, idx + 1)}
                        title="Move page later (Right / Down)"
                        className="px-2 py-1.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#003FE8] hover:text-white disabled:opacity-30 cursor-pointer flex items-center gap-0.5 text-[11px] font-bold transition-colors"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOrgSpecs((prev) =>
                            prev.map((s, i) =>
                              i === idx
                                ? {
                                    ...s,
                                    addRotationDeg:
                                      (s.addRotationDeg + 90) % 360,
                                  }
                                : s
                            )
                          )
                        }
                        title="Rotate 90°"
                        className="p-1.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateOrgPage(idx)}
                        title="Duplicate page"
                        className="p-1.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={orgSpecs.length <= 1}
                        onClick={() =>
                          setOrgSpecs((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        title="Delete page"
                        className="p-1.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#DC2626] hover:bg-[#DC2626]/10 disabled:opacity-30 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. OCR – EXTRACT TEXT (ENGLISH & SWAHILI) */}
        {activeTool === 'ocr-pdf' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Optical Character Recognition (OCR) — English & Swahili
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Recognize printed text in scanned PDF pages or uploaded photographs using Tesseract.js.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={ocrLang}
                  onChange={(e) =>
                    setOcrLang(e.target.value as 'eng' | 'swa' | 'eng+swa')
                  }
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12]"
                >
                  <option value="eng">English (eng)</option>
                  <option value="swa">Swahili / Kiswahili (swa)</option>
                  <option value="eng+swa">Bilingual (English + Swahili)</option>
                </select>

                {selectedDoc && (
                  <select
                    value={ocrPageNum}
                    onChange={(e) => setOcrPageNum(Number(e.target.value))}
                    className="px-3 py-2 text-xs font-mono rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12]"
                  >
                    {Array.from(
                      { length: selectedDoc.pageCount },
                      (_, i) => i + 1
                    ).map((n) => (
                      <option key={n} value={n}>
                        Page {n} of {selectedDoc.pageCount}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={() => handleRunOcr()}
                  disabled={isBusy || !selectedDoc}
                  className="px-4 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <ScanText className="w-4 h-4" />
                  <span>{isBusy ? 'Running OCR...' : 'Recognize PDF Page'}</span>
                </button>
              </div>
            </div>

            {ocrStatusText && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#4A1D5E] dark:text-[#D5B3FF]">
                    {ocrStatusText}
                  </span>
                  <span className="font-mono tabular-nums">{ocrProgress}%</span>
                </div>
                <div className="w-full h-2 bg-[#E4DFEC] dark:bg-[#261F33] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4A1D5E] dark:bg-[#9D5CE5] transition-all duration-200"
                    style={{ width: `${ocrProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold">
                    Recognized Searchable Text Output
                  </span>
                  {ocrConfidence !== null && (
                    <span className="text-xs font-mono tabular-nums text-[#15803D] dark:text-[#4ADE80]">
                      Confidence: {ocrConfidence}%
                    </span>
                  )}
                </div>

                {ocrResultText && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(ocrResultText);
                        setCopiedOcr(true);
                        setTimeout(() => setCopiedOcr(false), 2000);
                      }}
                      className="px-3 py-1 rounded border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedOcr ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Text</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        const bytes = new TextEncoder().encode(ocrResultText);
                        downloadBytesAsFile(
                          bytes,
                          `${selectedDoc?.name.replace(/\.pdf$/i, '') || 'OCR'}_Text.txt`,
                          'text/plain'
                        );
                      }}
                      className="px-3 py-1 rounded bg-[#F2EFF6] dark:bg-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .TXT</span>
                    </button>
                  </div>
                )}
              </div>

              <textarea
                rows={10}
                value={ocrResultText}
                onChange={(e) => setOcrResultText(e.target.value)}
                placeholder="Click 'Recognize PDF Page' above to run Tesseract OCR and populate selectable text here..."
                className="w-full p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] font-mono text-xs leading-relaxed text-[#14101B] dark:text-[#F4F1F8] focus:outline-none focus:border-[#4A1D5E]"
              />
            </div>
          </div>
        )}

        {/* 7B. SMART COLOR-PRESERVING WATERMARK REMOVER STUDIO */}
        {activeTool === 'remove-watermark' && selectedDoc && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#15803D]" />
                  <span>
                    Smart Watermark Remover — Preserve Words, Quality &amp; Color
                  </span>
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5">
                  Uses multi-scale local contrast, edge-gradient protection, and subpixel alpha unmixing to remove diagonal, grey, or colored watermarks without affecting document words or colors.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenInEditor && (
                  <button
                    type="button"
                    onClick={() => handleExecuteWatermarkRemoval(true)}
                    disabled={isBusy}
                    className="px-4 py-2.5 rounded-xl bg-[#0088FF] hover:bg-[#0077E6] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {isBusy
                        ? wmProgressText || 'Cleaning...'
                        : 'Clean All Pages & Open in Editor'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleExecuteWatermarkRemoval(false)}
                  disabled={isBusy}
                  className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {isBusy
                      ? wmProgressText || 'Processing PDF...'
                      : `Remove Watermark & Download (${selectedDoc.pageCount}p)`}
                  </span>
                </button>
              </div>
            </div>

            {/* Controls Bar: Mode + Sensitivity Presets + Target Color Eyedropper */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
              {/* 1. Color Preservation Mode */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  1. Watermark Removal Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWmRemovePreserveColor(true)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      wmRemovePreserveColor
                        ? 'border-[#15803D] bg-[#15803D]/10 text-[#15803D] dark:text-[#4ADE80]'
                        : 'border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-[#6E667D]'
                    }`}
                  >
                    <p className="text-xs font-bold">Keep Original Colors</p>
                    <p className="text-[10px] opacity-85 mt-0.5">
                      Preserves colored headings, logos, diagrams &amp; sharp text
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWmRemovePreserveColor(false)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      !wmRemovePreserveColor
                        ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/10 text-[#4A1D5E] dark:text-[#D5B3FF]'
                        : 'border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-[#6E667D]'
                    }`}
                  >
                    <p className="text-xs font-bold">Jet-Black Ink (B&amp;W)</p>
                    <p className="text-[10px] opacity-85 mt-0.5">
                      Converts all text to crisp black &amp; removes dark banners
                    </p>
                  </button>
                </div>
              </div>

              {/* 2. Sensitivity & Word Clarity Boost */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    2. Watermark Removal &amp; Word Clarity
                  </label>
                  <span className="text-[11px] font-mono font-bold text-[#15803D] dark:text-[#4ADE80]">
                    WM: {wmRemoveStrength > 0 ? `+${wmRemoveStrength}` : wmRemoveStrength} | Text: +{wmTextClarityBoost}%
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { label: 'Gentle', val: -15, clarity: 28 },
                      { label: 'Balanced HD', val: 0, clarity: 35 },
                      { label: 'Strong', val: 15, clarity: 42 },
                      { label: 'Max Clarity', val: 25, clarity: 55 },
                    ] as const
                  ).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setWmRemoveStrength(preset.val);
                        setWmTextClarityBoost(preset.clarity);
                      }}
                      className={`flex-1 py-1.5 px-1.5 rounded-lg text-[10px] font-bold border cursor-pointer transition-colors ${
                        wmRemoveStrength === preset.val &&
                        wmTextClarityBoost === preset.clarity
                          ? 'bg-[#15803D] text-white border-[#15803D]'
                          : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-[#6E667D] dark:text-[#A39BB5]">
                    <span>Watermark Removal Sensitivity</span>
                    <span>{wmRemoveStrength}</span>
                  </div>
                  <input
                    type="range"
                    min={-30}
                    max={45}
                    step={3}
                    value={wmRemoveStrength}
                    onChange={(e) => setWmRemoveStrength(Number(e.target.value))}
                    className="w-full accent-[#15803D] cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-[#6E667D] dark:text-[#A39BB5]">
                    <span>Word Sharpness &amp; Ink Darkness Boost</span>
                    <span>+{wmTextClarityBoost}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={4}
                    value={wmTextClarityBoost}
                    onChange={(e) =>
                      setWmTextClarityBoost(Number(e.target.value))
                    }
                    className="w-full accent-[#0088FF] cursor-pointer"
                  />
                </div>
              </div>

              {/* 3. Target Watermark Tint Sampler & Solid Banner Option */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  3. Precision Watermark Tint Target
                </label>
                <div className="p-2.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-2">
                  {wmTargetRgb ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-6 h-6 rounded-md border border-black/20 shrink-0"
                        style={{
                          backgroundColor: `rgb(${wmTargetRgb[0]}, ${wmTargetRgb[1]}, ${wmTargetRgb[2]})`,
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          Targeted RGB({wmTargetRgb.join(', ')})
                        </p>
                        <p className="text-[10px] text-[#6E667D] truncate">
                          Removing this exact watermark color
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] leading-snug">
                      Click directly on any watermark in the <strong>Before</strong> preview below to sample its exact color!
                    </p>
                  )}

                  {wmTargetRgb && (
                    <button
                      type="button"
                      onClick={() => setWmTargetRgb(null)}
                      className="px-2.5 py-1 rounded-lg bg-[#DC2626]/10 text-[#DC2626] text-[11px] font-bold cursor-pointer shrink-0"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs text-[#6E667D] dark:text-[#A39BB5] cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={wmRemoveSolidBanners}
                    onChange={(e) => setWmRemoveSolidBanners(e.target.checked)}
                    className="accent-[#15803D]"
                  />
                  <span>Also erase solid dark rectangular stamp banners</span>
                </label>
              </div>
            </div>

            {/* Page Selector & Live Before / After Comparison */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Live High-DPI Comparison (Page {wmPreviewPage} of{' '}
                    {selectedDoc.pageCount})
                  </span>
                  {wmIsRenderingPreview && (
                    <span className="text-xs text-[#15803D] font-semibold animate-pulse">
                      Updating live preview...
                    </span>
                  )}
                </div>

                {selectedDoc.pageCount > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={wmPreviewPage <= 1}
                      onClick={() =>
                        setWmPreviewPage((p) => Math.max(1, p - 1))
                      }
                      className="px-2.5 py-1 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      ← Prev Page
                    </button>
                    <button
                      type="button"
                      disabled={wmPreviewPage >= selectedDoc.pageCount}
                      onClick={() =>
                        setWmPreviewPage((p) =>
                          Math.min(selectedDoc.pageCount, p + 1)
                        )
                      }
                      className="px-2.5 py-1 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      Next Page →
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* BEFORE (Click to Sample Watermark Color) */}
                <div className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#6E667D] dark:text-[#A39BB5]">
                      BEFORE (Original — Click watermark to sample color)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#E4DFEC]/60 dark:bg-[#261F33] text-[10px] font-semibold">
                      Eyedropper Active
                    </span>
                  </div>
                  <div className="bg-[#181322] rounded-xl p-3 flex items-center justify-center min-h-[380px] overflow-hidden">
                    {wmOriginalPreviewUrl ? (
                      <img
                        src={wmOriginalPreviewUrl}
                        alt="Original page with watermark"
                        onClick={handleSampleWatermarkPixel}
                        title="Click directly on the watermark to sample its exact RGB color"
                        className="max-h-[480px] w-auto rounded shadow-md cursor-crosshair"
                      />
                    ) : (
                      <span className="text-xs text-white/70">
                        Rendering original page...
                      </span>
                    )}
                  </div>
                </div>

                {/* AFTER (Cleaned Page — Words & Colors Preserved) */}
                <div className="rounded-2xl border-2 border-[#15803D]/40 bg-[#FAF9FB] dark:bg-[#0D0A12] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#15803D] dark:text-[#4ADE80]">
                      AFTER (Watermark Removed — Words &amp; Color Preserved)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#15803D]/15 text-[#15803D] dark:text-[#4ADE80] text-[10px] font-bold">
                      High-Resolution Unmixing
                    </span>
                  </div>
                  <div className="bg-[#181322] rounded-xl p-3 flex items-center justify-center min-h-[380px] overflow-hidden">
                    {wmCleanedPreviewUrl ? (
                      <img
                        src={wmCleanedPreviewUrl}
                        alt="Cleaned page without watermark"
                        className="max-h-[480px] w-auto rounded shadow-md"
                      />
                    ) : (
                      <span className="text-xs text-white/70">
                        Generating clean preview...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 8. PDF SECURITY & PROTECTION */}
        {activeTool === 'security-pdf' && selectedDoc && (
          <div className="space-y-6 max-w-2xl">
            <div className="p-4 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33]/50 border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
                <Info className="w-4 h-4 shrink-0" />
                <span>Honest Browser-Side PDF Security Notice</span>
              </div>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                Pure client-side JavaScript PDF libraries (<code>pdf-lib</code>) do not natively write AES-256 stream encryption dictionaries without server-side or WebAssembly C++ binaries. ElimikaPDF provides two genuine client-side protections: (1) <strong>Local Vault Passphrase Lock</strong> before opening/exporting from IndexedDB, and (2) <strong>Permanent Vector Security Watermarking</strong> baked across all pages.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Permanent Security Watermark Stamp
                </label>
                <input
                  type="text"
                  value={securityWatermark}
                  onChange={(e) => setSecurityWatermark(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Local Vault Access Passphrase (Optional)
                </label>
                <input
                  type="password"
                  value={vaultPassphrase}
                  onChange={(e) => setVaultPassphrase(e.target.value)}
                  placeholder="Enter passphrase to mark document protected in Local Vault"
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>

              <button
                onClick={handleApplySecurityProtection}
                disabled={isBusy}
                className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                <span>Apply Protection & Download Stamped PDF</span>
              </button>
            </div>
          </div>
        )}

        {/* 9. WORD TO PDF (.DOCX / .DOC / .RTF / .TXT -> .PDF) */}
        {activeTool === 'word-to-pdf' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Word to PDF Converter (.DOCX, .DOC, .RTF, .TXT → .PDF)
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Upload a Microsoft Word document from your phone or computer—or paste/edit text below—and convert it into a formatted multi-page PDF.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-start">
                <label className="px-4 py-2.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs">
                  <Upload className="w-4 h-4" />
                  <span>Upload Word File (.DOCX / .DOC)</span>
                  <input
                    type="file"
                    accept=".docx,.doc,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/rtf"
                    className="hidden"
                    onChange={handleUploadWordDocument}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleLoadSampleWordDoc}
                  className="px-3.5 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Load Sample Word Doc</span>
                </button>
              </div>
            </div>

            {/* Formatting & Page Layout Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]">
              <div>
                <label className="block text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5] mb-1">
                  Output PDF Filename
                </label>
                <input
                  type="text"
                  value={wordFileName}
                  onChange={(e) => setWordFileName(e.target.value)}
                  placeholder="Document_Name"
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5] mb-1">
                  PDF Page Size
                </label>
                <div className="flex items-center gap-1">
                  {(['A4', 'Letter', 'Legal'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setWordPageSize(sz)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                        wordPageSize === sz
                          ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] border-[#4A1D5E]'
                          : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33]'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5] mb-1">
                  Typography Font
                </label>
                <select
                  value={wordFontFamily}
                  onChange={(e) =>
                    setWordFontFamily(
                      e.target.value as 'helvetica' | 'times' | 'courier'
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                >
                  <option value="helvetica">Helvetica / Sans-Serif</option>
                  <option value="times">Times New Roman / Serif</option>
                  <option value="courier">Courier / Monospace</option>
                </select>
              </div>

              <div className="flex items-end justify-between gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-[#6E667D] dark:text-[#A39BB5] mb-1">
                    Font Size ({wordBaseFontSize}pt)
                  </label>
                  <input
                    type="range"
                    min={9.5}
                    max={15}
                    step={0.5}
                    value={wordBaseFontSize}
                    onChange={(e) =>
                      setWordBaseFontSize(Number(e.target.value))
                    }
                    className="w-full accent-[#4A1D5E] cursor-pointer"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs font-semibold pb-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wordAddPageNumbers}
                    onChange={(e) => setWordAddPageNumbers(e.target.checked)}
                    className="rounded accent-[#4A1D5E]"
                  />
                  <span>Page #</span>
                </label>
              </div>
            </div>

            {/* Ready-to-Download Result Card when converted */}
            {convertedWordPdfResult && (
              <div className="p-4 rounded-xl bg-[#15803D]/10 border-2 border-[#15803D]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#15803D] dark:text-[#4ADE80]">
                    ✓ PDF Ready & Saved in My Files: {convertedWordPdfResult.name}
                  </p>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] font-mono mt-0.5">
                    {convertedWordPdfResult.pageCount}{' '}
                    {convertedWordPdfResult.pageCount === 1 ? 'page' : 'pages'}{' '}
                    · {formatBytes(convertedWordPdfResult.bytes.byteLength)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      downloadBytesAsFile(
                        convertedWordPdfResult.bytes,
                        convertedWordPdfResult.name,
                        'application/pdf'
                      )
                    }
                    className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      shareOrDownloadBytesAsFile(
                        convertedWordPdfResult.bytes,
                        convertedWordPdfResult.name,
                        'application/pdf'
                      )
                    }
                    className="px-3.5 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[#2563EB]" />
                    <span>Share PDF</span>
                  </button>

                  {onOpenInEditor && (
                    <button
                      type="button"
                      onClick={() => onOpenInEditor(convertedWordPdfResult.doc)}
                      className="px-3.5 py-2 rounded-lg bg-[#4A1D5E] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Open in PDF Editor</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Editable Word Content Preview & Composer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Word Content Preview & Live Editor (Use # for Headings, * for Bullets)
                </label>
                {wordBlocks.some((b) => b.type === 'table' || b.type === 'image') &&
                  !wordTextEdited && (
                    <span className="text-[11px] font-semibold text-[#2563EB]">
                      ✓ Preserving extracted Word tables & embedded images
                    </span>
                  )}
              </div>
              <textarea
                rows={11}
                value={wordPlainText}
                onChange={(e) => {
                  setWordPlainText(e.target.value);
                  setWordTextEdited(true);
                }}
                placeholder="Upload a .DOCX / .DOC file above, click 'Load Sample Word Doc', or type/paste your document content here to convert into a PDF..."
                className="w-full p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-xs leading-relaxed text-[#14101B] dark:text-[#F4F1F8] focus:outline-none focus:border-[#4A1D5E]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleBuildPdfFromWord('download')}
                disabled={
                  isBusy ||
                  (!wordPlainText.trim() && wordBlocks.length === 0)
                }
                className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isBusy
                    ? 'Generating PDF...'
                    : 'Convert Word to PDF & Download'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleBuildPdfFromWord('open-editor')}
                disabled={
                  isBusy ||
                  (!wordPlainText.trim() && wordBlocks.length === 0)
                }
                className="px-4 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <FileText className="w-4 h-4" />
                <span>Convert & Open in PDF Editor</span>
              </button>

              <button
                type="button"
                onClick={() => handleBuildPdfFromWord('share')}
                disabled={
                  isBusy ||
                  (!wordPlainText.trim() && wordBlocks.length === 0)
                }
                className="px-4 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <Share2 className="w-4 h-4 text-[#2563EB]" />
                <span>Share PDF</span>
              </button>
            </div>
          </div>
        )}

        {/* 10. PDF TO WORD (.PDF -> .DOCX) */}
        {activeTool === 'pdf-to-word' && selectedDoc && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  PDF to Word Converter (.PDF → Editable .DOCX)
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Convert <strong>{selectedDoc.name}</strong> ({selectedDoc.pageCount}{' '}
                  {selectedDoc.pageCount === 1 ? 'page' : 'pages'}) into a standard Microsoft Word <code>.docx</code> document that opens in Word, Google Docs, and WPS Office.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExtractAndConvertPdfToWord(true)}
                  disabled={isBusy}
                  className="px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <FileOutput className="w-4 h-4" />
                  <span>
                    {isBusy
                      ? 'Converting to Word...'
                      : 'Convert PDF to Word (.DOCX) & Download'}
                  </span>
                </button>
              </div>
            </div>

            {/* 3 Conversion Mode Cards + Scanned PDF Auto-OCR Switch */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(
                [
                  {
                    id: 'editable',
                    title: '1. Editable Text & Headings (.DOCX)',
                    desc: 'Extracts paragraphs, headings, and lists for easy text editing in Word. Includes page snapshots only if a page has no text.',
                  },
                  {
                    id: 'hybrid',
                    title: '2. Editable Text + Page Snapshots',
                    desc: 'Includes both editable Word paragraphs AND the high-resolution page picture for each page (great for exams & tables).',
                  },
                  {
                    id: 'visual',
                    title: '3. Exact Visual Layout (.DOCX)',
                    desc: 'Embeds each full-page snapshot directly into Word so complex layouts, stamps, and handwriting look 100% identical.',
                  },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPdfToWordMode(m.id)}
                  className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    pdfToWordMode === m.id
                      ? 'border-[#2563EB] bg-[#2563EB]/8 dark:bg-[#2563EB]/20'
                      : 'border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                  }`}
                >
                  <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    {m.title}
                  </p>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] mt-1 leading-relaxed">
                    {m.desc}
                  </p>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]">
              <label className="flex items-center gap-2.5 text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoOcrScannedPages}
                  onChange={(e) => setAutoOcrScannedPages(e.target.checked)}
                  className="rounded accent-[#2563EB] w-4 h-4"
                />
                <span>
                  Auto-OCR Scanned Image Pages (recognizes text on scanned photos automatically)
                </span>
              </label>

              {pdfToWordProgress && (
                <span className="text-xs font-mono font-bold text-[#2563EB] animate-pulse">
                  {pdfToWordProgress}
                </span>
              )}
            </div>

            {/* Ready-to-Download .DOCX Card */}
            {pdfToWordDocxResult && (
              <div className="p-4 rounded-xl bg-[#15803D]/10 border-2 border-[#15803D]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#15803D] dark:text-[#4ADE80]">
                    ✓ Microsoft Word File Ready: {pdfToWordDocxResult.name}
                  </p>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] font-mono mt-0.5">
                    {pdfToWordDocxResult.pageCount}{' '}
                    {pdfToWordDocxResult.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                    {formatBytes(pdfToWordDocxResult.bytes.byteLength)} ·
                    Standard OpenXML (.DOCX)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      downloadBytesAsFile(
                        pdfToWordDocxResult.bytes,
                        pdfToWordDocxResult.name,
                        DOCX_MIME_TYPE
                      )
                    }
                    className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .DOCX</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      shareOrDownloadBytesAsFile(
                        pdfToWordDocxResult.bytes,
                        pdfToWordDocxResult.name,
                        DOCX_MIME_TYPE
                      )
                    }
                    className="px-3.5 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[#2563EB]" />
                    <span>Share .DOCX</span>
                  </button>
                </div>
              </div>
            )}

            {/* Editable Extracted Word Paragraphs per Page */}
            {pdfToWordPages.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Extracted Word Text Preview (You can edit any text below before re-downloading .DOCX)
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleExtractAndConvertPdfToWord(true)}
                    disabled={isBusy}
                    className="px-3.5 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-bold cursor-pointer"
                  >
                    Update & Download .DOCX
                  </button>
                </div>

                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {pdfToWordPages.map((pg, pIdx) => {
                    const joinedText = pg.paragraphs
                      .map((p) => p.text)
                      .join('\n\n');
                    return (
                      <div
                        key={pg.pageNumber}
                        className="p-3.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
                            Page {pg.pageNumber}
                          </span>
                          <span className="text-[11px] font-mono text-[#6E667D]">
                            {pg.paragraphs.length} paragraph block(s)
                          </span>
                        </div>
                        <textarea
                          rows={4}
                          value={joinedText}
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            setPdfToWordPages((prev) =>
                              prev.map((item, idx) =>
                                idx === pIdx
                                  ? {
                                      ...item,
                                      paragraphs: nextVal
                                        .split(/\n{2,}/)
                                        .map((t) => ({
                                          text: t.trim(),
                                          isHeading: false,
                                          fontSize: 11.5,
                                        }))
                                        .filter((p) => p.text.length > 0),
                                    }
                                  : item
                              )
                            );
                          }}
                          placeholder="No selectable text found on this page — page snapshot image will be embedded in the Word document."
                          className="w-full p-2.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs leading-relaxed text-[#14101B] dark:text-[#F4F1F8]"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
