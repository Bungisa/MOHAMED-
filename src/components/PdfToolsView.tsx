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
  getPdfPageCount,
  RenderedPageInfo,
  PictureTextBoxOverlay,
  compositeTextBoxesOntoImageDataUrl,
} from '../services/pdfService';
import { formatBytes } from '../services/storageService';

interface PdfToolsViewProps {
  initialTool?: ToolId;
  documents: StoredDocument[];
  onSaveNewDocument: (doc: StoredDocument) => Promise<void>;
  onUpdateDocument: (doc: StoredDocument) => Promise<void>;
}

const TOOL_TABS: {
  id: ToolId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'merge-pdf', label: 'Merge PDF', icon: Merge },
  { id: 'split-pdf', label: 'Split PDF', icon: Scissors },
  { id: 'compress-pdf', label: 'Compress PDF', icon: Minimize2 },
  { id: 'img-to-pdf', label: 'Images to PDF', icon: FileImage },
  { id: 'pdf-to-img', label: 'PDF to PNG/JPG & Text', icon: Images },
  { id: 'organize-pdf', label: 'Organize & Rotate', icon: LayoutGrid },
  { id: 'ocr-pdf', label: 'OCR (English & Swahili)', icon: ScanText },
  { id: 'security-pdf', label: 'PDF Security', icon: Shield },
];

export const PdfToolsView: React.FC<PdfToolsViewProps> = ({
  initialTool = 'merge-pdf',
  documents,
  onSaveNewDocument,
  onUpdateDocument,
}) => {
  const normalizedInitial =
    initialTool === 'rotate-pdf'
      ? 'organize-pdf'
      : initialTool === 'scan-to-pdf' || initialTool === 'edit-pdf'
        ? 'merge-pdf'
        : initialTool;

  const [activeTool, setActiveTool] = useState<ToolId>(normalizedInitial);
  const [selectedDocId, setSelectedDocId] = useState<string>(
    documents[0]?.id || ''
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
  }, [documents, mergeList.length]);

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

  // 2. SPLIT PDF STATE
  const [splitRangeInput, setSplitRangeInput] = useState('1');
  const parsePageRanges = (input: string, maxPages: number): number[] => {
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
            if (p >= 1 && p <= maxPages) set.add(p);
          }
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (!Number.isNaN(p) && p >= 1 && p <= maxPages) set.add(p);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  };

  const handleRunSplitExtract = async () => {
    if (!selectedDoc) return;
    const pagesToExtract = parsePageRanges(
      splitRangeInput,
      selectedDoc.pageCount
    );
    if (pagesToExtract.length === 0) {
      setFeedback(
        `Please enter valid page numbers between 1 and ${selectedDoc.pageCount}.`
      );
      return;
    }
    setIsBusy(true);
    try {
      const splitBytes = await extractPdfPages(
        selectedDoc.pdfData,
        pagesToExtract
      );
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Pages_${pagesToExtract.join('-')}.pdf`;
      const newDoc: StoredDocument = {
        id: `doc-split-${Date.now()}`,
        name: outName,
        category: selectedDoc.category,
        starred: false,
        sizeBytes: splitBytes.byteLength,
        pageCount: pagesToExtract.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: splitBytes,
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(splitBytes, outName);
      setFeedback(
        `Extracted ${pagesToExtract.length} page(s) into "${outName}" and downloaded.`
      );
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
      setFeedback(
        `Compression complete: ${formatBytes(selectedDoc.sizeBytes)} → ${formatBytes(compressed.byteLength)}.`
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
    'image/png'
  );
  const [renderedImages, setRenderedImages] = useState<RenderedPageInfo[]>([]);
  const [extractedPagesText, setExtractedPagesText] = useState<
    { pageNumber: number; text: string }[]
  >([]);

  // Text boxes placed over converted PDF pictures (indexed by pageNumber)
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
  const [defaultPicTextColor, setDefaultPicTextColor] = useState('#14101B');
  const [defaultPicBoxBgColor, setDefaultPicBoxBgColor] = useState('#FFFFFF');
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

  const pushPictureTextBoxesWithUndo = (
    next: Record<number, PictureTextBoxOverlay[]>
  ) => {
    setPictureTextBoxUndoStack((prev) => [...prev, pictureTextBoxesByPage]);
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
      text: 'Type text here',
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
    const list = pictureTextBoxesByPage[pageNumber] || [];
    pushPictureTextBoxesWithUndo({
      ...pictureTextBoxesByPage,
      [pageNumber]: list.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    });
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
      const imgs: RenderedPageInfo[] = [];
      for (let i = 1; i <= selectedDoc.pageCount; i++) {
        const pageInfo = await renderPdfPage(
          selectedDoc.pdfData,
          i,
          1.6,
          exportFormat,
          0.92
        );
        imgs.push(pageInfo);
      }
      setRenderedImages(imgs);
      const texts = await extractAllPdfText(selectedDoc.pdfData);
      setExtractedPagesText(texts);
      setFeedback(
        `Converted ${imgs.length} PDF page(s) into pictures. Click anywhere on a picture (or click "+ Add Text Box") to write text with custom colors!`
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

  useEffect(() => {
    if (activeTool === 'organize-pdf' && selectedDoc) {
      let cancelled = false;
      const loadThumbs = async () => {
        setIsBusy(true);
        try {
          const list: {
            id: string;
            sourcePageNumber?: number;
            isBlank?: boolean;
            addRotationDeg: number;
            thumbUrl?: string;
          }[] = [];
          for (let i = 1; i <= selectedDoc.pageCount; i++) {
            const p = await renderPdfPage(selectedDoc.pdfData, i, 0.7);
            list.push({
              id: `org-${i}-${Date.now()}`,
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
  }, [activeTool, selectedDoc]);

  const handleSaveOrganizedPdf = async () => {
    if (!selectedDoc || orgSpecs.length === 0) return;
    setIsBusy(true);
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
      downloadBytesAsFile(updatedBytes, updatedDoc.name);
      setFeedback(
        `Saved reorganized PDF (${orgSpecs.length} pages) and downloaded.`
      );
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Tool Selector */}
      <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
              PDF Processing & OCR Workbench
            </h1>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              All operations execute locally in your browser using pdf-lib, PDF.js, and Tesseract.js
            </p>
          </div>

          {/* Target Document Selector (for single-doc tools) */}
          {activeTool !== 'merge-pdf' && activeTool !== 'img-to-pdf' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5] whitespace-nowrap">
                Target PDF:
              </span>
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="text-xs font-bold bg-[#FAF9FB] dark:bg-[#261F33] border border-[#E4DFEC] dark:border-[#342B47] rounded-lg px-3 py-2 text-[#14101B] dark:text-[#F4F1F8] max-w-xs truncate"
              >
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name} ({doc.pageCount} pg · {formatBytes(doc.sizeBytes)})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Tool Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-[#F2EFF6] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg overflow-x-auto">
          {TOOL_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTool(t.id);
                  setFeedback(null);
                }}
                className={`px-3 py-2 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-semibold'
                    : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{t.label}</span>
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

        {/* 2. SPLIT PDF */}
        {activeTool === 'split-pdf' && selectedDoc && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Split PDF or Extract Selected Pages
              </h2>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                Active document: <strong>{selectedDoc.name}</strong> (
                {selectedDoc.pageCount} pages total)
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold">
                Page Numbers or Ranges (e.g. 1-2, 3)
              </label>
              <input
                type="text"
                value={splitRangeInput}
                onChange={(e) => setSplitRangeInput(e.target.value)}
                placeholder={`1-${selectedDoc.pageCount}`}
                className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
              />
            </div>

            <button
              onClick={handleRunSplitExtract}
              disabled={isBusy}
              className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Scissors className="w-4 h-4" />
              <span>Extract Pages & Download PDF</span>
            </button>
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
                              }}
                              className={`absolute p-1 rounded-xs cursor-move ${
                                isBoxSelected
                                  ? 'ring-2 ring-[#4A1D5E] dark:ring-[#9D5CE5] z-20'
                                  : 'hover:ring-1 hover:ring-[#4A1D5E]/60 z-10'
                              }`}
                            >
                              <textarea
                                value={box.text}
                                onPointerDown={(e) => e.stopPropagation()}
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
                                      b.id === box.id ? { ...b, text: val } : b
                                    ),
                                  }));
                                }}
                                style={{
                                  color: box.textColor,
                                  backgroundColor: 'transparent',
                                  fontWeight: box.fontWeight || 'normal',
                                  fontStyle: box.fontStyle || 'normal',
                                }}
                                className="w-full h-full resize-none focus:outline-none leading-snug"
                              />

                              {isBoxSelected && (
                                <>
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
                                    className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#4A1D5E] border-2 border-white cursor-nwse-resize"
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

        {/* 6. ORGANIZE & ROTATE PAGES */}
        {activeTool === 'organize-pdf' && selectedDoc && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div>
                <h2 className="text-base font-bold">
                  Organize, Rotate, Insert, or Delete PDF Pages
                </h2>
                <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                  Rotate individual pages or all pages, reorder sequence, or insert blank separator pages.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setOrgSpecs((prev) =>
                      prev.map((s) => ({
                        ...s,
                        addRotationDeg: (s.addRotationDeg + 90) % 360,
                      }))
                    )
                  }
                  className="px-3 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Rotate All 90°</span>
                </button>
                <button
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
                  className="px-3 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <PlusSquare className="w-3.5 h-3.5" />
                  <span>Append Blank Page</span>
                </button>
                <button
                  onClick={handleSaveOrganizedPdf}
                  disabled={isBusy || orgSpecs.length === 0}
                  className="px-4 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Apply & Download PDF</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {orgSpecs.map((spec, idx) => (
                <div
                  key={spec.id}
                  className="p-3 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] space-y-2.5"
                >
                  <div className="h-40 bg-white rounded border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center overflow-hidden">
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
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold">
                      #{idx + 1}{' '}
                      {spec.sourcePageNumber
                        ? `(Src p.${spec.sourcePageNumber})`
                        : '(Blank)'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
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
                        className="p-1 rounded border border-[#E4DFEC] dark:border-[#261F33] cursor-pointer"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        disabled={orgSpecs.length <= 1}
                        onClick={() =>
                          setOrgSpecs((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        title="Delete page"
                        className="p-1 rounded text-[#DC2626] disabled:opacity-30 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
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

        {/* 8. PDF SECURITY & PROTECTION */}
        {activeTool === 'security-pdf' && selectedDoc && (
          <div className="space-y-6 max-w-2xl">
            <div className="p-4 rounded-xl bg-[#F2EFF6] dark:bg-[#261F33]/50 border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
                <Info className="w-4 h-4 shrink-0" />
                <span>Honest Browser-Side PDF Security Notice</span>
              </div>
              <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                Pure client-side JavaScript PDF libraries (<code>pdf-lib</code>) do not natively write AES-256 stream encryption dictionaries without server-side or WebAssembly C++ binaries. ScanPro provides two genuine client-side protections: (1) <strong>Local Vault Passphrase Lock</strong> before opening/exporting from IndexedDB, and (2) <strong>Permanent Vector Security Watermarking</strong> baked across all pages.
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
      </div>
    </div>
  );
};
