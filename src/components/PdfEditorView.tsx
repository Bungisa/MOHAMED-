import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Trash2,
  PlusSquare,
  ArrowUp,
  ArrowDown,
  Download,
  Save,
  Undo2,
  Redo2,
  Type,
  Image as ImageIcon,
  Square,
  Circle,
  Minus,
  MoveUpRight,
  Highlighter,
  Underline,
  Strikethrough,
  MessageSquare,
  Eraser,
  MousePointer,
  Search,
  Printer,
  Share2,
  Maximize,
  Eye,
  FileEdit,
  FileUp,
  Hash,
  Stamp,
  Copy,
  Check,
  FileOutput,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Pencil,
  Bold,
  Italic,
  Layers,
  Replace,
  Move,
  CopyPlus,
  Sun,
  Sparkles,
  X,
  HelpCircle,
  MoreVertical,
  Contrast,
  ChevronUp,
  ChevronDown,
  Smartphone,
  Folder,
  CloudUpload,
  HardDrive,
  Mail,
  Minimize2,
} from 'lucide-react';
import {
  ActiveView,
  StoredDocument,
  AnnotationElement,
  AnnotationType,
  NativeTextBlock,
  ScanFilterType,
} from '../types/document';
import {
  renderAllPdfPages,
  RenderedPageInfo,
  bakeAnnotationsIntoPdf,
  organizePdfPages,
  extractPdfPages,
  downloadBytesAsFile,
  getEmbeddedPdfImagesOnPage,
  removeEmbeddedPdfImageFromPage,
  cropRegionFromDataUrl,
  reconstructBackgroundPatchFromDataUrl,
  EmbeddedPdfImageInfo,
  compressPdfWithOptions,
  exportPdfAsJpegBytes,
  SaveCompressionQuality,
} from '../services/pdfService';
import { applyImageEnhancements } from '../services/imageProcessingService';

interface PdfEditorViewProps {
  activeDocument: StoredDocument | null;
  allDocuments: StoredDocument[];
  initialReaderMode?: boolean;
  onSelectDocument: (doc: StoredDocument) => void;
  onUploadNewPdf: (files: FileList | File[]) => Promise<void>;
  onSaveUpdatedDocument: (doc: StoredDocument, silent?: boolean) => Promise<void>;
  onCloseEditor?: () => void;
  onNavigate?: (view: ActiveView) => void;
}

type WorkspaceMode = 'content-edit' | 'annotate' | 'reader';
type EditorTool = 'select' | 'select-picture' | AnnotationType;
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type PageFitMode = 'fit-page' | 'fit-width';
type BottomPanelTab =
  | 'none'
  | 'watermark'
  | 'text'
  | 'highlight'
  | 'doodle'
  | 'filter'
  | 'pictures'
  | 'copy'
  | 'more';

interface HistorySnapshot {
  annotations: AnnotationElement[];
  pdfBytes: Uint8Array | null;
}

const PDF_COLOR_FILTERS: {
  id: ScanFilterType;
  label: string;
  shortDesc: string;
}[] = [
  { id: 'original', label: 'Original', shortDesc: 'Unmodified PDF' },
  {
    id: 'clean-watermark',
    label: 'Watermark Clean (Color)',
    shortDesc: 'Removes watermarks without affecting words, quality, or color',
  },
  {
    id: 'ocv-black',
    label: 'OCV BLACK',
    shortDesc: 'Removes watermarks & makes text crisp black',
  },
  { id: 'vivid-light', label: 'Vivid Light', shortDesc: 'Luminous vivid color' },
  { id: 'magic', label: 'Magic Color', shortDesc: 'Whitened paper' },
  { id: 'bw', label: 'B&W Scan', shortDesc: 'High contrast B&W' },
  { id: 'grayscale', label: 'Grayscale', shortDesc: 'Monochrome tone' },
];

const RESIZE_HANDLES: {
  dir: ResizeHandle;
  posClass: string;
  cursorClass: string;
}[] = [
  { dir: 'nw', posClass: '-top-1.5 -left-1.5', cursorClass: 'cursor-nwse-resize' },
  { dir: 'n', posClass: '-top-1.5 left-1/2 -translate-x-1/2', cursorClass: 'cursor-ns-resize' },
  { dir: 'ne', posClass: '-top-1.5 -right-1.5', cursorClass: 'cursor-nesw-resize' },
  { dir: 'e', posClass: 'top-1/2 -translate-y-1/2 -right-1.5', cursorClass: 'cursor-ew-resize' },
  { dir: 'se', posClass: '-bottom-1.5 -right-1.5', cursorClass: 'cursor-nwse-resize' },
  { dir: 's', posClass: '-bottom-1.5 left-1/2 -translate-x-1/2', cursorClass: 'cursor-ns-resize' },
  { dir: 'sw', posClass: '-bottom-1.5 -left-1.5', cursorClass: 'cursor-nesw-resize' },
  { dir: 'w', posClass: 'top-1/2 -translate-y-1/2 -left-1.5', cursorClass: 'cursor-ew-resize' },
];

export const PdfEditorView: React.FC<PdfEditorViewProps> = ({
  activeDocument,
  allDocuments,
  initialReaderMode = false,
  onSelectDocument,
  onUploadNewPdf,
  onSaveUpdatedDocument,
  onCloseEditor,
  onNavigate,
}) => {
  // iLovePDF-inspired 3 modes: 'content-edit' (Edit existing PDF text & pictures), 'annotate' (Add elements/markup), 'reader' (Clean viewer)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    initialReaderMode ? 'reader' : 'content-edit'
  );
  const isReaderMode = workspaceMode === 'reader';

  // Active grouped bottom drawer tab ('none' keeps the PDF in almost-full-screen view by default)
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('none');
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [showDesktopSidebars, setShowDesktopSidebars] = useState(false);

  // Continuous vertical multi-page scroll vs Single Page view
  const [viewAllPagesVertically, setViewAllPagesVertically] = useState(true);

  const [pages, setPages] = useState<RenderedPageInfo[]>([]);
  const [totalExpectedPages, setTotalExpectedPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  // Fit Whole Page by default so 100% of the PDF page is visible during editing
  const [fitMode, setFitMode] = useState<PageFitMode>('fit-page');
  const [zoom, setZoom] = useState(1.0);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 680,
    height: 620,
  });
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [workingPdfBytes, setWorkingPdfBytes] = useState<Uint8Array | null>(
    null
  );

  // Color Filter (Original, OCV BLACK, Vivid Light, etc.) & Brightness Switch
  const [pageColorFilter, setPageColorFilter] =
    useState<ScanFilterType>('original');
  const [brightnessSwitchOn, setBrightnessSwitchOn] = useState(false);
  const [pageBrightness, setPageBrightness] = useState<number>(0);
  const [pageContrast, setPageContrast] = useState<number>(0);
  const [filteredPageUrls, setFilteredPageUrls] = useState<
    Record<number, string>
  >({});
  const [originalPageUrls, setOriginalPageUrls] = useState<
    Record<number, string>
  >({});
  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [compareViewMode, setCompareViewMode] = useState<
    'split' | 'original' | 'edited'
  >('split');
  const [compareSplitPercent, setCompareSplitPercent] = useState(50);
  const [isApplyingFilter, setIsApplyingFilter] = useState(false);

  // Annotations & Undo/Redo History (tracks both overlay annotations and underlying PDF bytes)
  const [annotations, setAnnotations] = useState<AnnotationElement[]>([]);
  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  // Separate inline text typing mode from smooth Move/Drag mode so added text can be dragged effortlessly anywhere on the page
  const [editingTextAnnId, setEditingTextAnnId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');

  // Save Document & Compress Bottom Sheets State (modeled after reference screenshots)
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showCompressModal, setShowCompressModal] = useState(false);
  const [saveDocName, setSaveDocName] = useState('');
  const [isRenamingInSaveModal, setIsRenamingInSaveModal] = useState(false);
  const [saveFormat, setSaveFormat] = useState<'pdf' | 'jpg'>('pdf');
  const [enablePasswordProtection, setEnablePasswordProtection] =
    useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [searchableOcrPdf, setSearchableOcrPdf] = useState(false);
  const [createLongImage, setCreateLongImage] = useState(false);
  const [createZipFile, setCreateZipFile] = useState(false);
  const [pdfPageSize, setPdfPageSize] = useState<
    'A4' | 'Letter' | 'Legal' | 'Fit'
  >('A4');
  const [compressionQuality, setCompressionQuality] =
    useState<SaveCompressionQuality>('high');
  const [highCompression, setHighCompression] = useState(false);
  const [preparedBaseBytes, setPreparedBaseBytes] = useState<Uint8Array | null>(
    null
  );
  const [compressedPreviewBytes, setCompressedPreviewBytes] =
    useState<Uint8Array | null>(null);
  const [isCompressingPreview, setIsCompressingPreview] = useState(false);

  // Embedded PDF Images (XObjects) indexed by pageNumber (1..N)
  const [embeddedImagesByPage, setEmbeddedImagesByPage] = useState<
    Record<number, EmbeddedPdfImageInfo[]>
  >({});
  const [selectedEmbedded, setSelectedEmbedded] = useState<{
    pageNumber: number;
    key: string;
  } | null>(null);

  // Marquee-selected picture region on a page (for selecting any flattened/scanned picture area)
  const [selectedPictureRegion, setSelectedPictureRegion] = useState<{
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [regionDragStart, setRegionDragStart] = useState<{
    pageNumber: number;
    x: number;
    y: number;
  } | null>(null);

  // Freehand drawing active stroke state
  const [activeDrawStroke, setActiveDrawStroke] = useState<{
    pageNumber: number;
    points: { x: number; y: number }[];
  } | null>(null);
  const [drawColor] = useState('#4A1D5E');
  const [drawStrokeWidth] = useState(2.5);

  // Default Font Size & Colors when adding/editing text boxes (Blue background + White text by default)
  const [defaultFontSize, setDefaultFontSize] = useState<number>(18);
  const [defaultTextColor, setDefaultTextColor] = useState('#FFFFFF');
  const [defaultTextBoxBgColor, setDefaultTextBoxBgColor] =
    useState<string>('#2563EB');
  const [defaultTextBoxBorderColor, setDefaultTextBoxBorderColor] =
    useState<string>('transparent');

  // Document-wide stamps (Page Numbers & Watermark)
  const [addPageNumbers, setAddPageNumbers] = useState(false);
  const [pageNumberPosition] = useState<'bottom-center' | 'bottom-right'>(
    'bottom-center'
  );
  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkOpacity] = useState(0.16);

  // Search within PDF
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedNativeText, setCopiedNativeText] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Dragging / Resizing annotation on page overlay (supports 'move' and all 8 resize handles)
  const [dragState, setDragState] = useState<{
    id: string;
    pageNumber: number;
    mode: 'move' | ResizeHandle;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const pageOverlayRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pageWrapperRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const pdfUploadInputRef = useRef<HTMLInputElement>(null);
  const imageAnnotationInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWorkspaceMode(initialReaderMode ? 'reader' : 'content-edit');
  }, [initialReaderMode]);

  const zoomRef = useRef(zoom);
  const isPinchingRef = useRef(false);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Smooth focal-point anchored zoom that scales ONLY the PDF content inside stageContainerRef
  const applyPdfZoom = useCallback(
    (targetZoom: number, focalClientX?: number, focalClientY?: number) => {
      const clampedZoom = Math.max(
        0.5,
        Math.min(4.0, +targetZoom.toFixed(2))
      );
      const prevZoom = zoomRef.current;
      if (Math.abs(clampedZoom - prevZoom) < 0.005) return;

      const el = stageContainerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const focusX =
          focalClientX !== undefined
            ? focalClientX - rect.left
            : rect.width / 2;
        const focusY =
          focalClientY !== undefined
            ? focalClientY - rect.top
            : rect.height / 2;

        const contentX = el.scrollLeft + focusX;
        const contentY = el.scrollTop + focusY;
        const ratio = clampedZoom / prevZoom;

        zoomRef.current = clampedZoom;
        setZoom(clampedZoom);

        requestAnimationFrame(() => {
          const container = stageContainerRef.current;
          if (!container) return;
          container.scrollLeft = Math.max(0, contentX * ratio - focusX);
          container.scrollTop = Math.max(0, contentY * ratio - focusY);
        });
      } else {
        zoomRef.current = clampedZoom;
        setZoom(clampedZoom);
      }
    },
    []
  );

  // Measure the available stage viewport so the whole PDF page always fits inside the screen
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth || Math.floor(el.getBoundingClientRect().width);
      const h =
        el.clientHeight || Math.floor(el.getBoundingClientRect().height);
      if (w > 80 && h > 80) {
        setStageSize((prev) =>
          Math.abs(prev.width - w) > 1 || Math.abs(prev.height - h) > 1
            ? { width: w, height: h }
            : prev
        );
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [activeDocument]);

  // Attach two-finger Pinch-to-Zoom and Ctrl/Cmd + Wheel Zoom strictly to the PDF Stage Container
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    let pinchStartDist = 0;
    let pinchStartZoom = 1;

    const getTouchDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isPinchingRef.current = true;
        setActiveDrawStroke(null);
        setRegionDragStart(null);
        pinchStartDist = getTouchDist(e.touches[0], e.touches[1]);
        pinchStartZoom = zoomRef.current;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist > 10) {
        e.preventDefault();
        e.stopPropagation();
        const currDist = getTouchDist(e.touches[0], e.touches[1]);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const nextZoom = pinchStartZoom * (currDist / pinchStartDist);
        applyPdfZoom(nextZoom, midX, midY);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartDist = 0;
        setTimeout(() => {
          isPinchingRef.current = false;
        }, 80);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.008;
        applyPdfZoom(zoomRef.current + delta, e.clientX, e.clientY);
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [applyPdfZoom, activeDocument]);

  // Apply Color Filter (OCV BLACK, Vivid Light, etc.) and Brightness Switch to rendered pages (prioritizing currentPage first for instant response)
  useEffect(() => {
    let cancelled = false;
    if (
      pages.length === 0 ||
      (pageColorFilter === 'original' &&
        pageBrightness === 0 &&
        pageContrast === 0)
    ) {
      setFilteredPageUrls({});
      setIsApplyingFilter(false);
      return;
    }

    setIsApplyingFilter(true);
    (async () => {
      const orderedPages = [
        ...pages.filter((p) => p.pageNumber === currentPage),
        ...pages.filter((p) => p.pageNumber !== currentPage),
      ];
      const nextMap: Record<number, string> = {};
      for (const p of orderedPages) {
        if (cancelled) return;
        const processed = await applyImageEnhancements(p.dataUrl, {
          filter: pageColorFilter,
          brightness: pageBrightness,
          contrast: pageContrast,
          rotation: 0,
        });
        if (cancelled) return;
        nextMap[p.pageNumber] = processed;
        setFilteredPageUrls((prev) => ({
          ...prev,
          [p.pageNumber]: processed,
        }));
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelled) {
        setIsApplyingFilter(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pages, pageColorFilter, pageBrightness, pageContrast, currentPage]);

  // Lazily inspect embedded PDF pictures/boxes on the active page so opening multi-page PDFs is lightweight and fast
  useEffect(() => {
    let cancelled = false;
    if (!workingPdfBytes || pages.length === 0) return;
    if (embeddedImagesByPage[currentPage] !== undefined) return;

    (async () => {
      const imgs = await getEmbeddedPdfImagesOnPage(
        workingPdfBytes,
        currentPage
      );
      if (!cancelled) {
        setEmbeddedImagesByPage((prev) => ({
          ...prev,
          [currentPage]: imgs,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workingPdfBytes, currentPage, pages.length, embeddedImagesByPage]);

  const renderAllPages = useCallback(
    async (pdfBytes: Uint8Array, captureAsOriginal = false) => {
      setIsLoadingPages(true);
      setEmbeddedImagesByPage({});
      try {
        const allRendered = await renderAllPdfPages(
          pdfBytes,
          1.65,
          (renderedSoFar, total) => {
            setTotalExpectedPages(total);
            setPages(renderedSoFar);
            if (captureAsOriginal) {
              const origMap: Record<number, string> = {};
              renderedSoFar.forEach((p) => {
                origMap[p.pageNumber] = p.dataUrl;
              });
              setOriginalPageUrls(origMap);
            }
            if (renderedSoFar.length >= 1) {
              setIsLoadingPages(false);
            }
          }
        );
        setPages(allRendered);
        if (captureAsOriginal) {
          const origMap: Record<number, string> = {};
          allRendered.forEach((p) => {
            origMap[p.pageNumber] = p.dataUrl;
          });
          setOriginalPageUrls(origMap);
        }
        setTotalExpectedPages(allRendered.length);
        setCurrentPage((prev) =>
          Math.max(1, Math.min(prev, allRendered.length || 1))
        );
      } catch (err) {
        console.error('Failed to render PDF:', err);
        setStatusMessage(
          'Could not render this PDF file. It may be corrupted or unsupported.'
        );
      } finally {
        setIsLoadingPages(false);
      }
    },
    []
  );

  const loadedDocIdRef = useRef<string | null>(null);
  const hasInitializedDocRef = useRef(false);

  useEffect(() => {
    if (!activeDocument) {
      loadedDocIdRef.current = null;
      hasInitializedDocRef.current = false;
      return;
    }
    // Only reset/re-render when switching to a different document ID so saving the active document in-place never wipes out your edits or view
    if (loadedDocIdRef.current === activeDocument.id) {
      return;
    }
    loadedDocIdRef.current = activeDocument.id;
    hasInitializedDocRef.current = false;

    const sourceBytes = activeDocument.basePdfData || activeDocument.pdfData;
    const cloned = new Uint8Array(sourceBytes);
    setWorkingPdfBytes(cloned);
    setAnnotations(activeDocument.annotations || []);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedAnnId(null);
    setEditingTextAnnId(null);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setIsComparingOriginal(false);
    setCompareViewMode('split');
    setCompareSplitPercent(50);
    setCurrentPage(1);
    setFitMode('fit-page');
    setZoom(1.0);
    const savedFilter = activeDocument.appliedFilter || 'original';
    const savedBrightness = activeDocument.appliedBrightness || 0;
    const savedContrast = activeDocument.appliedContrast || 0;
    setPageColorFilter(savedFilter);
    setBrightnessSwitchOn(savedBrightness > 0);
    setPageBrightness(savedBrightness);
    setPageContrast(savedContrast);
    setWatermarkText(activeDocument.watermarkText || '');
    setAddPageNumbers(Boolean(activeDocument.addPageNumbers));
    setSaveDocName(activeDocument.name.replace(/\.pdf$/i, ''));
    setCompressionQuality('high');
    setHighCompression(false);
    setPreparedBaseBytes(null);
    setCompressedPreviewBytes(null);
    setTotalExpectedPages(activeDocument.pageCount || 1);
    renderAllPages(cloned, true).then(() => {
      hasInitializedDocRef.current = true;
    });
  }, [activeDocument, renderAllPages]);

  const jumpToPage = (pageNum: number) => {
    const clamped = Math.max(1, Math.min(pages.length || 1, pageNum));
    setCurrentPage(clamped);
    if (viewAllPagesVertically) {
      const el = pageWrapperRefs.current[clamped];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Lightweight Undo snapshot: only clones PDF bytes when underlying PDF bytes actually change
  const pushAnnotationsWithUndo = useCallback(
    (next: AnnotationElement[], nextPdfBytes?: Uint8Array) => {
      setUndoStack((prev) => [
        ...prev.slice(-29),
        {
          annotations,
          pdfBytes:
            nextPdfBytes && workingPdfBytes
              ? new Uint8Array(workingPdfBytes)
              : null,
        },
      ]);
      setRedoStack([]);
      setAnnotations(next);
      if (nextPdfBytes) {
        setWorkingPdfBytes(nextPdfBytes);
      }
    },
    [annotations, workingPdfBytes]
  );

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [
      ...r,
      {
        annotations,
        pdfBytes: workingPdfBytes ? new Uint8Array(workingPdfBytes) : null,
      },
    ]);
    setUndoStack((u) => u.slice(0, -1));
    setAnnotations(prev.annotations);
    setSelectedAnnId(null);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);

    if (
      prev.pdfBytes &&
      (!workingPdfBytes ||
        prev.pdfBytes.byteLength !== workingPdfBytes.byteLength ||
        prev.pdfBytes.some((b, idx) => b !== workingPdfBytes[idx]))
    ) {
      const restoredBytes = new Uint8Array(prev.pdfBytes);
      setWorkingPdfBytes(restoredBytes);
      await renderAllPages(restoredBytes);
    }
    setStatusMessage('Undid last change and restored previous state.');
  }, [undoStack, annotations, workingPdfBytes, renderAllPages]);

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [
      ...u,
      {
        annotations,
        pdfBytes: workingPdfBytes ? new Uint8Array(workingPdfBytes) : null,
      },
    ]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next.annotations);
    setSelectedAnnId(null);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);

    if (
      next.pdfBytes &&
      (!workingPdfBytes ||
        next.pdfBytes.byteLength !== workingPdfBytes.byteLength ||
        next.pdfBytes.some((b, idx) => b !== workingPdfBytes[idx]))
    ) {
      const restoredBytes = new Uint8Array(next.pdfBytes);
      setWorkingPdfBytes(restoredBytes);
      await renderAllPages(restoredBytes);
    }
    setStatusMessage('Redid change.');
  }, [redoStack, annotations, workingPdfBytes, renderAllPages]);

  // Convert an existing Native PDF Text Block into an editable/movable/deletable Text Annotation
  // while reconstructing the original background underneath so moving/deleting leaves the background intact
  const handleSelectNativeTextBlock = async (block: NativeTextBlock) => {
    setCurrentPage(block.pageNumber);
    const existing = annotations.find(
      (a) => a.replacesNativeTextId === block.id
    );
    if (existing) {
      setSelectedAnnId(existing.id);
      setSelectedEmbedded(null);
      setSelectedPictureRegion(null);
      return;
    }

    const targetPage = pages[block.pageNumber - 1];
    const origRect = {
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
    };
    const origBgDataUrl = targetPage
      ? await reconstructBackgroundPatchFromDataUrl(
          targetPage.dataUrl,
          origRect
        )
      : undefined;

    const newId = `edit-native-txt-${Date.now()}`;
    const newAnn: AnnotationElement = {
      id: newId,
      pageNumber: block.pageNumber,
      type: 'text',
      x: block.x,
      y: block.y,
      width: Math.max(0.18, block.width + 0.04),
      height: Math.max(0.032, block.height + 0.01),
      text: block.text,
      fontSize: block.fontSize,
      fontWeight: 'normal',
      fontStyle: 'normal',
      backgroundColor: 'transparent',
      color: '#14101B',
      opacity: 1,
      replacesNativeTextId: block.id,
      origRect,
      origBgDataUrl,
      createdAt: new Date().toISOString(),
    };

    pushAnnotationsWithUndo([...annotations, newAnn]);
    setSelectedAnnId(newId);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setStatusMessage(
      `Selected PDF text on Page ${block.pageNumber}. Edit inline, drag handles to move/resize, or click Delete to remove while preserving the background.`
    );
  };

  // Delete an existing Native PDF Text Block or Unlocked Object while leaving the background as it was before
  const handleDeleteNativeTextBlock = async (ann: AnnotationElement) => {
    if (ann.origRect) {
      const targetPage = pages[ann.pageNumber - 1];
      const bgDataUrl =
        ann.origBgDataUrl ||
        (targetPage
          ? await reconstructBackgroundPatchFromDataUrl(
              targetPage.dataUrl,
              ann.origRect
            )
          : '');

      if (bgDataUrl) {
        const restorePatchAnn: AnnotationElement = {
          id: `restore-bg-${Date.now()}`,
          pageNumber: ann.pageNumber,
          type: 'image',
          x: ann.origRect.x,
          y: ann.origRect.y,
          width: ann.origRect.width,
          height: ann.origRect.height,
          color: 'transparent',
          imageDataUrl: bgDataUrl,
          opacity: 1,
          replacesNativeTextId: ann.replacesNativeTextId,
          origRect: ann.origRect,
          origBgDataUrl: bgDataUrl,
          isBackgroundRestorePatch: true,
        };
        pushAnnotationsWithUndo(
          annotations.map((a) => (a.id === ann.id ? restorePatchAnn : a))
        );
      } else {
        pushAnnotationsWithUndo(annotations.filter((a) => a.id !== ann.id));
      }
      setSelectedAnnId(null);
      setStatusMessage(
        'Removed element and restored original background. Click Undo to revert.'
      );
    } else {
      pushAnnotationsWithUndo(annotations.filter((a) => a.id !== ann.id));
      setSelectedAnnId(null);
    }
  };

  // Unlock an embedded PDF image/box into a movable/resizable image layer with 8 handles,
  // removing the original XObject from the PDF page (or reconstructing the background) so the background underneath is preserved!
  const handleUnlockEmbeddedImageToMoveOrResize = async (
    pageNumber: number,
    emb: EmbeddedPdfImageInfo
  ) => {
    const targetPage = pages[pageNumber - 1];
    if (!targetPage) return;

    setIsLoadingPages(true);
    try {
      const origRect = {
        x: emb.x,
        y: emb.y,
        width: emb.normWidth,
        height: emb.normHeight,
      };

      const croppedDataUrl = await cropRegionFromDataUrl(
        targetPage.dataUrl,
        origRect
      );

      // Try removing the underlying XObject from workingPdfBytes so the true PDF background underneath is revealed
      let removedNativeXObject = false;
      let updatedPdfBytes = workingPdfBytes;
      if (
        workingPdfBytes &&
        emb.pdfXObjectKey &&
        !emb.isFullPageBackground &&
        emb.kind === 'picture'
      ) {
        const res = await removeEmbeddedPdfImageFromPage(
          workingPdfBytes,
          pageNumber,
          emb.pdfXObjectKey
        );
        if (res.removedCount > 0) {
          removedNativeXObject = true;
          updatedPdfBytes = res.pdfBytes;
        }
      }

      const origBgDataUrl = !removedNativeXObject
        ? await reconstructBackgroundPatchFromDataUrl(
            targetPage.dataUrl,
            origRect
          )
        : undefined;

      const newId = `ann-unlocked-img-${Date.now()}`;
      const newAnn: AnnotationElement = {
        id: newId,
        pageNumber,
        type: 'image',
        x: emb.x,
        y: emb.y,
        width: emb.normWidth,
        height: emb.normHeight,
        color: '#4A1D5E',
        imageDataUrl: croppedDataUrl,
        opacity: 1,
        replacesNativeTextId: emb.key,
        origRect: removedNativeXObject ? undefined : origRect,
        origBgDataUrl,
        createdAt: new Date().toISOString(),
      };

      pushAnnotationsWithUndo(
        [...annotations, newAnn],
        removedNativeXObject && updatedPdfBytes ? updatedPdfBytes : undefined
      );
      if (removedNativeXObject && updatedPdfBytes) {
        await renderAllPages(updatedPdfBytes);
      }

      setSelectedEmbedded(null);
      setSelectedAnnId(newId);
      setCurrentPage(pageNumber);
      setStatusMessage(
        `Unlocked "${emb.label || 'Picture'}" on Page ${pageNumber}. Drag to move or use the 8 handles to resize—the original background underneath is preserved!`
      );
    } finally {
      setIsLoadingPages(false);
    }
  };

  const handleCanvasClick = (
    e: React.MouseEvent<HTMLDivElement>,
    pageNumber: number
  ) => {
    setCurrentPage(pageNumber);
    const overlayEl = pageOverlayRefs.current[pageNumber];
    if (isReaderMode || !overlayEl) return;

    if (
      activeTool === 'select' ||
      activeTool === 'select-picture' ||
      activeTool === 'draw'
    ) {
      if (e.target === overlayEl && !regionDragStart) {
        setSelectedAnnId(null);
        setSelectedEmbedded(null);
      }
      return;
    }
    if (activeTool === 'image') {
      imageAnnotationInputRef.current?.click();
      return;
    }

    const rect = overlayEl.getBoundingClientRect();
    const clickX = Math.max(
      0.02,
      Math.min(0.85, (e.clientX - rect.left) / rect.width)
    );
    const clickY = Math.max(
      0.02,
      Math.min(0.88, (e.clientY - rect.top) / rect.height)
    );

    const newId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let defaultW = 0.24;
    let defaultH = 0.06;
    let defaultColor = '#4A1D5E';
    let defaultText: string | undefined;

    if (activeTool === 'text') {
      defaultText = '';
      defaultW = 0.34;
      defaultH = 0.068;
      defaultColor = defaultTextColor;
    } else if (activeTool === 'comment') {
      defaultText = '';
      defaultW = 0.28;
      defaultH = 0.09;
      defaultColor = '#D97706';
    } else if (activeTool === 'highlight') {
      defaultW = 0.32;
      defaultH = 0.035;
      defaultColor = '#FACC15';
    } else if (activeTool === 'underline' || activeTool === 'strikethrough') {
      defaultW = 0.28;
      defaultH = 0.02;
      defaultColor = '#DC2626';
    } else if (activeTool === 'whiteout') {
      defaultW = 0.26;
      defaultH = 0.05;
      defaultColor = '#FFFFFF';
    } else if (activeTool === 'rectangle' || activeTool === 'circle') {
      defaultW = 0.22;
      defaultH = 0.14;
      defaultColor = '#4A1D5E';
    } else if (activeTool === 'arrow' || activeTool === 'line') {
      defaultW = 0.2;
      defaultH = 0.08;
      defaultColor = '#DC2626';
    }

    const newAnn: AnnotationElement = {
      id: newId,
      pageNumber,
      type: activeTool,
      x: clickX,
      y: clickY,
      width: defaultW,
      height: defaultH,
      endX: clickX + defaultW,
      endY: clickY + defaultH,
      text: defaultText,
      fontSize: defaultFontSize,
      fontWeight: activeTool === 'text' ? 'bold' : 'normal',
      fontStyle: 'normal',
      color: defaultColor,
      backgroundColor:
        activeTool === 'text'
          ? defaultTextBoxBgColor
          : activeTool === 'comment'
            ? '#FEF9C3'
            : undefined,
      fillColor:
        activeTool === 'text' && defaultTextBoxBorderColor !== 'transparent'
          ? defaultTextBoxBorderColor
          : undefined,
      strokeWidth: 2,
      opacity: 1,
      createdAt: new Date().toISOString(),
    };

    pushAnnotationsWithUndo([...annotations, newAnn]);
    setSelectedAnnId(newId);
    setEditingTextAnnId(activeTool === 'text' ? newId : null);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setActiveTool('select');
    if (activeTool === 'text') {
      setStatusMessage(
        `Added text box on Page ${pageNumber}. Start typing right away, or drag the box anywhere on the page!`
      );
    }
  };

  // Immediately places a default Blue-background (#2563EB) + White-text (#FFFFFF) text box with "Type here" placeholder on the current page
  const handleQuickAddDefaultTextBox = (pageNumber = currentPage) => {
    const newId = `ann-txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newAnn: AnnotationElement = {
      id: newId,
      pageNumber,
      type: 'text',
      x: 0.28,
      y: 0.32,
      width: 0.38,
      height: 0.07,
      endX: 0.66,
      endY: 0.39,
      text: '',
      fontSize: defaultFontSize,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: defaultTextColor,
      backgroundColor: defaultTextBoxBgColor,
      fillColor:
        defaultTextBoxBorderColor !== 'transparent'
          ? defaultTextBoxBorderColor
          : undefined,
      strokeWidth: 2,
      opacity: 1,
      createdAt: new Date().toISOString(),
    };

    pushAnnotationsWithUndo([...annotations, newAnn]);
    setSelectedAnnId(newId);
    setEditingTextAnnId(newId);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setActiveTool('select');
    setBottomPanelTab('text');
  };

  // Places an editable, color-customizable Text Box directly over a picture or region
  const handleWriteTextOverPictureOrBox = (
    pageNumber: number,
    targetRect: { x: number; y: number; width: number; height: number },
    label?: string
  ) => {
    const newId = `ann-txt-pic-${Date.now()}`;
    const boxW = Math.max(0.24, Math.min(0.75, targetRect.width));
    const boxH = Math.max(0.065, Math.min(0.25, targetRect.height * 0.45));
    const boxX = Math.max(
      0.02,
      Math.min(0.95 - boxW, targetRect.x + (targetRect.width - boxW) / 2)
    );
    const boxY = Math.max(
      0.02,
      Math.min(0.92 - boxH, targetRect.y + (targetRect.height - boxH) / 2)
    );

    const newAnn: AnnotationElement = {
      id: newId,
      pageNumber,
      type: 'text',
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      text: '',
      fontSize: defaultFontSize,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: defaultTextColor,
      backgroundColor: defaultTextBoxBgColor,
      fillColor:
        defaultTextBoxBorderColor !== 'transparent'
          ? defaultTextBoxBorderColor
          : undefined,
      strokeWidth: 2,
      opacity: 1,
      createdAt: new Date().toISOString(),
    };

    pushAnnotationsWithUndo([...annotations, newAnn]);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setSelectedAnnId(newId);
    setEditingTextAnnId(newId);
    setActiveTool('select');
    setBottomPanelTab('text');
    setCurrentPage(pageNumber);
    setStatusMessage(
      `Placed text box over ${label || 'picture'} on Page ${pageNumber}. Type your text or drag the box smoothly anywhere!`
    );
  };

  const handleImageAnnotationUpload = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const newId = `ann-img-${Date.now()}`;
      const newAnn: AnnotationElement = {
        id: newId,
        pageNumber: currentPage,
        type: 'image',
        x: 0.25,
        y: 0.25,
        width: 0.28,
        height: 0.18,
        color: '#4A1D5E',
        imageDataUrl: dataUrl,
        opacity: 1,
      };
      pushAnnotationsWithUndo([...annotations, newAnn]);
      setSelectedAnnId(newId);
      setActiveTool('select');
    };
    reader.readAsDataURL(file);
  };

  const handleReplaceSelectedImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (selectedAnnotation?.type === 'image') {
        updateSelectedAnnotation({ imageDataUrl: dataUrl });
        setStatusMessage(
          'Replaced selected picture. Click Undo to revert or Save PDF to persist.'
        );
      } else if (selectedEmbedded) {
        const pageImgs =
          embeddedImagesByPage[selectedEmbedded.pageNumber] || [];
        const emb = pageImgs.find((x) => x.key === selectedEmbedded.key);
        if (emb) {
          const targetPageNum = selectedEmbedded.pageNumber;
          const newId = `ann-rep-img-${Date.now()}`;
          pushAnnotationsWithUndo([
            ...annotations,
            {
              id: newId,
              pageNumber: targetPageNum,
              type: 'image',
              x: emb.x,
              y: emb.y,
              width: emb.normWidth,
              height: emb.normHeight,
              color: '#4A1D5E',
              imageDataUrl: dataUrl,
              opacity: 1,
              replacesNativeTextId: emb.key,
              origRect: {
                x: emb.x,
                y: emb.y,
                width: emb.normWidth,
                height: emb.normHeight,
              },
            },
          ]);
          setSelectedEmbedded(null);
          setSelectedAnnId(newId);
          setStatusMessage(
            `Replaced "${emb.label || 'Picture'}" on Page ${targetPageNum}. Click Undo to revert.`
          );
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePointerDownCanvas = (
    e: React.PointerEvent<HTMLDivElement>,
    pageNumber: number
  ) => {
    if (isPinchingRef.current) return;
    setCurrentPage(pageNumber);
    const overlayEl = pageOverlayRefs.current[pageNumber];
    if (isReaderMode || !overlayEl) return;

    const rect = overlayEl.getBoundingClientRect();
    const sx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    if (activeTool === 'draw') {
      e.stopPropagation();
      setSelectedAnnId(null);
      setSelectedEmbedded(null);
      setActiveDrawStroke({ pageNumber, points: [{ x: sx, y: sy }] });
      return;
    }

    if (
      (activeTool === 'select-picture' || activeTool === 'whiteout') &&
      e.target === overlayEl
    ) {
      setSelectedAnnId(null);
      setSelectedEmbedded(null);
      setRegionDragStart({ pageNumber, x: sx, y: sy });
      setSelectedPictureRegion({
        pageNumber,
        x: sx,
        y: sy,
        width: 0.01,
        height: 0.01,
      });
    }
  };

  const applyDragMovement = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState) return;
      const overlayEl = pageOverlayRefs.current[dragState.pageNumber];
      if (!overlayEl) return;
      const rect = overlayEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const pixelDist = Math.hypot(
        clientX - dragState.startX,
        clientY - dragState.startY
      );
      // Wait for >3px pointer movement before moving so a simple tap to focus/edit text doesn't jitter
      if (pixelDist < 3) return;

      // If the user starts dragging a text box while inline textarea is open, exit inline typing so the drag is 100% smooth
      if (editingTextAnnId === dragState.id) {
        setEditingTextAnnId(null);
      }

      const dx = (clientX - dragState.startX) / rect.width;
      const dy = (clientY - dragState.startY) / rect.height;

      setAnnotations((prev) =>
        prev.map((a) => {
          if (a.id !== dragState.id) return a;
          if (dragState.mode === 'move') {
            const nx = Math.max(0, Math.min(1 - a.width, dragState.origX + dx));
            const ny = Math.max(
              0,
              Math.min(1 - a.height, dragState.origY + dy)
            );
            return {
              ...a,
              x: nx,
              y: ny,
              endX: nx + a.width,
              endY: ny + a.height,
            };
          } else {
            const dir = dragState.mode;
            let nx = dragState.origX;
            let ny = dragState.origY;
            let nw = dragState.origW;
            let nh = dragState.origH;

            if (dir.includes('e')) {
              nw = Math.max(0.025, Math.min(1 - nx, dragState.origW + dx));
            }
            if (dir.includes('s')) {
              nh = Math.max(0.02, Math.min(1 - ny, dragState.origH + dy));
            }
            if (dir.includes('w')) {
              const maxLeftShift = dragState.origW - 0.025;
              const clampedDx = Math.max(
                -dragState.origX,
                Math.min(maxLeftShift, dx)
              );
              nx = dragState.origX + clampedDx;
              nw = dragState.origW - clampedDx;
            }
            if (dir.includes('n')) {
              const maxTopShift = dragState.origH - 0.02;
              const clampedDy = Math.max(
                -dragState.origY,
                Math.min(maxTopShift, dy)
              );
              ny = dragState.origY + clampedDy;
              nh = dragState.origH - clampedDy;
            }

            return {
              ...a,
              x: nx,
              y: ny,
              width: nw,
              height: nh,
              endX: nx + nw,
              endY: ny + nh,
            };
          }
        })
      );
    },
    [dragState, editingTextAnnId]
  );

  // Global window pointer listeners so dragging written text boxes works smoothly across the entire screen
  useEffect(() => {
    if (!dragState) return;
    const onWinPointerMove = (e: PointerEvent) => {
      applyDragMovement(e.clientX, e.clientY);
    };
    const onWinPointerUp = () => {
      setDragState(null);
    };
    window.addEventListener('pointermove', onWinPointerMove, { passive: true });
    window.addEventListener('pointerup', onWinPointerUp);
    window.addEventListener('pointercancel', onWinPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerUp);
    };
  }, [dragState, applyDragMovement]);

  const handlePointerMoveOverlay = (
    e: React.PointerEvent<HTMLDivElement>,
    pageNumber: number
  ) => {
    const overlayEl = pageOverlayRefs.current[pageNumber];
    if (!overlayEl) return;
    const rect = overlayEl.getBoundingClientRect();
    const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    if (activeDrawStroke && activeDrawStroke.pageNumber === pageNumber) {
      setActiveDrawStroke((prev) =>
        prev ? { ...prev, points: [...prev.points, { x: cx, y: cy }] } : null
      );
      return;
    }

    if (regionDragStart && regionDragStart.pageNumber === pageNumber) {
      const x = Math.min(regionDragStart.x, cx);
      const y = Math.min(regionDragStart.y, cy);
      const width = Math.max(0.015, Math.abs(cx - regionDragStart.x));
      const height = Math.max(0.015, Math.abs(cy - regionDragStart.y));
      setSelectedPictureRegion({ pageNumber, x, y, width, height });
      return;
    }

    if (dragState && dragState.pageNumber === pageNumber) {
      applyDragMovement(e.clientX, e.clientY);
    }
  };

  const handlePointerUpOverlay = () => {
    if (activeDrawStroke && activeDrawStroke.points.length > 1) {
      const pts = activeDrawStroke.points;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const newId = `ann-draw-${Date.now()}`;
      const newDrawAnn: AnnotationElement = {
        id: newId,
        pageNumber: activeDrawStroke.pageNumber,
        type: 'draw',
        x: minX,
        y: minY,
        width: Math.max(0.02, maxX - minX),
        height: Math.max(0.02, maxY - minY),
        points: pts,
        color: drawColor,
        strokeWidth: drawStrokeWidth,
        opacity: 1,
        createdAt: new Date().toISOString(),
      };
      pushAnnotationsWithUndo([...annotations, newDrawAnn]);
      setSelectedAnnId(newId);
    }

    // One-Swipe Watermark / Banner Eraser: when activeTool === 'whiteout' and user dragged a region, immediately place a clean cover box over it
    if (activeTool === 'whiteout' && regionDragStart && selectedPictureRegion) {
      if (
        selectedPictureRegion.width > 0.025 ||
        selectedPictureRegion.height > 0.02
      ) {
        const newId = `ann-erase-${Date.now()}`;
        const eraseAnn: AnnotationElement = {
          id: newId,
          pageNumber: selectedPictureRegion.pageNumber,
          type: 'whiteout',
          x: selectedPictureRegion.x,
          y: selectedPictureRegion.y,
          width: selectedPictureRegion.width,
          height: selectedPictureRegion.height,
          endX: selectedPictureRegion.x + selectedPictureRegion.width,
          endY: selectedPictureRegion.y + selectedPictureRegion.height,
          color: '#FFFFFF',
          opacity: 1,
          createdAt: new Date().toISOString(),
        };
        pushAnnotationsWithUndo([...annotations, eraseAnn]);
        setSelectedAnnId(newId);
        setSelectedPictureRegion(null);
        setRegionDragStart(null);
        setActiveTool('select');
        setStatusMessage(
          'Covered watermark/banner area! Tap "Write Text" to add text over it, or drag handles to adjust.'
        );
        return;
      } else {
        setSelectedPictureRegion(null);
      }
    }

    setActiveDrawStroke(null);
    setDragState(null);
    setRegionDragStart(null);
  };

  // Fast in-place annotation state update without cloning megabytes of PDF bytes on every keystroke
  const updateSelectedAnnotation = (updates: Partial<AnnotationElement>) => {
    if (!selectedAnnId) return;
    setAnnotations((prev) =>
      prev.map((a) => (a.id === selectedAnnId ? { ...a, ...updates } : a))
    );
  };

  // Enlarge or shrink text font size (updates defaultFontSize AND any selected text box, auto-expanding height if needed)
  const handleChangeFontSize = (nextSizeRaw: number) => {
    const nextSize = Math.max(8, Math.min(96, Math.round(nextSizeRaw)));
    setDefaultFontSize(nextSize);
    if (selectedAnnId) {
      const target = annotations.find((a) => a.id === selectedAnnId);
      if (target && (target.type === 'text' || target.type === 'comment')) {
        const lineCount = Math.max(1, (target.text || '').split('\n').length);
        const minNeededHeight = Math.min(
          0.95 - target.y,
          Math.max(target.height, (nextSize / 720) * (lineCount + 0.65))
        );
        updateSelectedAnnotation({
          fontSize: nextSize,
          height: minNeededHeight,
        });
      }
    }
  };

  const handleToggleBrightnessSwitch = () => {
    const nextOn = !brightnessSwitchOn;
    setBrightnessSwitchOn(nextOn);
    setPageBrightness(nextOn ? 28 : 0);
    setStatusMessage(
      nextOn
        ? 'Brightness Switch ON (+28 boost applied to document pages).'
        : 'Brightness Switch OFF (restored normal document brightness).'
    );
  };

  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnId) return;
    const target = annotations.find((a) => a.id === selectedAnnId);
    if (!target) return;
    if (target.origRect) {
      handleDeleteNativeTextBlock(target);
      return;
    }
    const itemTypeLabel =
      target.type === 'image'
        ? 'picture'
        : target.type === 'rectangle' ||
            target.type === 'circle' ||
            target.type === 'whiteout'
          ? 'box'
          : target.type;
    pushAnnotationsWithUndo(annotations.filter((a) => a.id !== selectedAnnId));
    setSelectedAnnId(null);
    setStatusMessage(
      `Removed selected ${itemTypeLabel} from Page ${target.pageNumber} while preserving the original background. Click Undo if you removed the wrong item.`
    );
  }, [selectedAnnId, annotations, pushAnnotationsWithUndo]);

  const duplicateSelectedAnnotation = () => {
    const target = annotations.find((a) => a.id === selectedAnnId);
    if (!target) return;
    const copyId = `ann-dup-${Date.now()}`;
    const copy: AnnotationElement = {
      ...target,
      id: copyId,
      x: Math.min(0.9, target.x + 0.03),
      y: Math.min(0.9, target.y + 0.03),
      replacesNativeTextId: undefined,
      origRect: undefined,
      origBgDataUrl: undefined,
    };
    pushAnnotationsWithUndo([...annotations, copy]);
    setSelectedAnnId(copyId);
  };

  const reorderAnnotationLayer = (id: string, dir: 'forward' | 'backward') => {
    const idx = annotations.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const targetIdx = dir === 'forward' ? idx + 1 : idx - 1;
    if (targetIdx < 0 || targetIdx >= annotations.length) return;
    const copy = [...annotations];
    [copy[idx], copy[targetIdx]] = [copy[targetIdx], copy[idx]];
    pushAnnotationsWithUndo(copy);
  };

  const handleRemoveSelectedPictureRegion = useCallback(async () => {
    if (!selectedPictureRegion) return;
    const pageNum = selectedPictureRegion.pageNumber;
    const targetPage = pages[pageNum - 1];
    const rect = {
      x: selectedPictureRegion.x,
      y: selectedPictureRegion.y,
      width: selectedPictureRegion.width,
      height: selectedPictureRegion.height,
    };

    const bgPatchUrl = targetPage
      ? await reconstructBackgroundPatchFromDataUrl(targetPage.dataUrl, rect)
      : '';

    const restoreAnn: AnnotationElement = {
      id: `restore-region-${Date.now()}`,
      pageNumber: pageNum,
      type: bgPatchUrl ? 'image' : 'whiteout',
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      color: '#FFFFFF',
      imageDataUrl: bgPatchUrl || undefined,
      opacity: 1,
      replacesNativeTextId: `region-${Date.now()}`,
      origRect: rect,
      origBgDataUrl: bgPatchUrl || undefined,
      isBackgroundRestorePatch: true,
      createdAt: new Date().toISOString(),
    };
    pushAnnotationsWithUndo([...annotations, restoreAnn]);
    setSelectedPictureRegion(null);
    setActiveTool('select');
    setStatusMessage(
      `Removed selected object on Page ${pageNum} and restored the surrounding background. Click Undo to revert.`
    );
  }, [selectedPictureRegion, pages, annotations, pushAnnotationsWithUndo]);

  // Page Structural Operations (Rotate, Delete, Insert Blank, Reorder, Extract)
  const persistStructuralChange = async (
    updatedBytes: Uint8Array,
    newPageCount: number,
    nextAnnotations: AnnotationElement[]
  ) => {
    if (!activeDocument) return;
    await onSaveUpdatedDocument(
      {
        ...activeDocument,
        pdfData: updatedBytes,
        sizeBytes: updatedBytes.byteLength,
        pageCount: newPageCount,
        annotations: nextAnnotations,
        updatedAt: new Date().toISOString(),
      },
      true
    );
  };

  const handleRotatePage = async (pageNum: number) => {
    if (!workingPdfBytes) return;
    setIsLoadingPages(true);
    try {
      const specs = pages.map((p) => ({
        sourcePageNumber: p.pageNumber,
        addRotationDeg: p.pageNumber === pageNum ? 90 : 0,
      }));
      const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
      setWorkingPdfBytes(updatedBytes);
      await renderAllPages(updatedBytes);
      await persistStructuralChange(updatedBytes, pages.length, annotations);
      setStatusMessage(`Rotated Page ${pageNum} by 90°.`);
    } finally {
      setIsLoadingPages(false);
    }
  };

  const handleDeletePage = async (pageNum: number) => {
    if (!workingPdfBytes || pages.length <= 1) {
      setStatusMessage('A PDF document must contain at least one page.');
      return;
    }
    setIsLoadingPages(true);
    try {
      const specs = pages
        .filter((p) => p.pageNumber !== pageNum)
        .map((p) => ({ sourcePageNumber: p.pageNumber }));
      const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
      const nextAnns = annotations
        .filter((a) => a.pageNumber !== pageNum)
        .map((a) =>
          a.pageNumber > pageNum ? { ...a, pageNumber: a.pageNumber - 1 } : a
        );
      setWorkingPdfBytes(updatedBytes);
      setAnnotations(nextAnns);
      await renderAllPages(updatedBytes);
      await persistStructuralChange(updatedBytes, specs.length, nextAnns);
      setStatusMessage(`Deleted Page ${pageNum}.`);
    } finally {
      setIsLoadingPages(false);
    }
  };

  const handleInsertBlankPageAfter = async (pageNum: number) => {
    if (!workingPdfBytes) return;
    setIsLoadingPages(true);
    try {
      const specs: { sourcePageNumber?: number; isBlank?: boolean }[] = [];
      for (const p of pages) {
        specs.push({ sourcePageNumber: p.pageNumber });
        if (p.pageNumber === pageNum) {
          specs.push({ isBlank: true });
        }
      }
      const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
      const nextAnns = annotations.map((a) =>
        a.pageNumber > pageNum ? { ...a, pageNumber: a.pageNumber + 1 } : a
      );
      setWorkingPdfBytes(updatedBytes);
      setAnnotations(nextAnns);
      await renderAllPages(updatedBytes);
      await persistStructuralChange(updatedBytes, specs.length, nextAnns);
      jumpToPage(pageNum + 1);
      setStatusMessage(`Inserted blank A4 page after Page ${pageNum}.`);
    } finally {
      setIsLoadingPages(false);
    }
  };

  const handleMovePageToPosition = async (
    fromPageNum: number,
    toPageNum: number
  ) => {
    if (!workingPdfBytes) return;
    if (
      fromPageNum < 1 ||
      fromPageNum > pages.length ||
      toPageNum < 1 ||
      toPageNum > pages.length ||
      fromPageNum === toPageNum
    ) {
      return;
    }
    setIsLoadingPages(true);
    try {
      const order = pages.map((p) => p.pageNumber);
      const [moved] = order.splice(fromPageNum - 1, 1);
      order.splice(toPageNum - 1, 0, moved);

      // Map old page number -> new 1-indexed page number
      const oldToNewPageMap = new Map<number, number>();
      order.forEach((oldNum, newIdx) => {
        oldToNewPageMap.set(oldNum, newIdx + 1);
      });

      const nextAnns = annotations.map((a) => ({
        ...a,
        pageNumber: oldToNewPageMap.get(a.pageNumber) || a.pageNumber,
      }));

      const specs = order.map((num) => ({ sourcePageNumber: num }));
      const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
      setWorkingPdfBytes(updatedBytes);
      setAnnotations(nextAnns);
      await renderAllPages(updatedBytes);
      await persistStructuralChange(updatedBytes, order.length, nextAnns);
      jumpToPage(toPageNum);
      setStatusMessage(`Moved Page ${fromPageNum} to Page ${toPageNum}.`);
    } finally {
      setIsLoadingPages(false);
    }
  };

  const handleMovePage = async (pageNum: number, dir: -1 | 1) => {
    await handleMovePageToPosition(pageNum, pageNum + dir);
  };

  const handleExtractSinglePage = async (pageNum: number) => {
    if (!workingPdfBytes || !activeDocument) return;
    const extracted = await extractPdfPages(workingPdfBytes, [pageNum]);
    const baseName = activeDocument.name.replace(/\.pdf$/i, '');
    downloadBytesAsFile(extracted, `${baseName}_Page_${pageNum}.pdf`);
    setStatusMessage(`Extracted and downloaded Page ${pageNum}.`);
  };

  // Removes ONLY the specific selected embedded picture or box and leaves the background as it was before the object was placed!
  const handleRemoveEmbeddedPdfImage = useCallback(
    async (pageNumber: number, targetKey: string) => {
      const pageItems = embeddedImagesByPage[pageNumber] || [];
      const targetItem = pageItems.find((item) => item.key === targetKey);
      if (!targetItem) {
        setStatusMessage('Please select a picture or box on the page first.');
        return;
      }

      setIsLoadingPages(true);
      try {
        // 1. If this is an embedded PDF Image XObject, strip that specific XObject from the PDF page resources
        // so PDF.js re-renders the page with the original underlying PDF background (text, lines, scan, colors) 100% intact!
        if (
          workingPdfBytes &&
          targetItem.pdfXObjectKey &&
          !targetItem.isFullPageBackground &&
          targetItem.kind === 'picture'
        ) {
          const { pdfBytes: cleanedBytes, removedCount } =
            await removeEmbeddedPdfImageFromPage(
              workingPdfBytes,
              pageNumber,
              targetItem.pdfXObjectKey
            );

          if (removedCount > 0) {
            pushAnnotationsWithUndo([...annotations], cleanedBytes);
            setSelectedEmbedded(null);
            setSelectedAnnId(null);
            await renderAllPages(cleanedBytes);
            setStatusMessage(
              `Removed "${targetItem.label || 'Selected Picture'}" from Page ${pageNumber} and revealed the original PDF background underneath. Click Undo to revert.`
            );
            return;
          }
        }

        // 2. For vector boxes or flattened scan graphics, reconstruct the natural surrounding background
        const targetPage = pages[pageNumber - 1];
        const origRect = {
          x: targetItem.x,
          y: targetItem.y,
          width: targetItem.normWidth,
          height: targetItem.normHeight,
        };
        const bgPatchUrl = targetPage
          ? await reconstructBackgroundPatchFromDataUrl(
              targetPage.dataUrl,
              origRect
            )
          : '';

        const restoreAnn: AnnotationElement = {
          id: `remove-emb-${Date.now()}`,
          pageNumber,
          type: bgPatchUrl ? 'image' : 'whiteout',
          x: targetItem.x,
          y: targetItem.y,
          width: targetItem.normWidth,
          height: targetItem.normHeight,
          color: '#FFFFFF',
          imageDataUrl: bgPatchUrl || undefined,
          opacity: 1,
          text: targetItem.label || 'Removed Object',
          replacesNativeTextId: targetItem.key,
          origRect,
          origBgDataUrl: bgPatchUrl || undefined,
          isBackgroundRestorePatch: true,
          createdAt: new Date().toISOString(),
        };

        pushAnnotationsWithUndo([...annotations, restoreAnn]);
        setSelectedEmbedded(null);
        setSelectedAnnId(null);
        setStatusMessage(
          `Removed "${targetItem.label || 'Selected Object'}" from Page ${pageNumber} and restored the background as it was before. Click Undo if you removed the wrong item.`
        );
      } finally {
        setIsLoadingPages(false);
      }
    },
    [
      embeddedImagesByPage,
      workingPdfBytes,
      pages,
      annotations,
      pushAnnotationsWithUndo,
      renderAllPages,
    ]
  );

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z to Undo, Ctrl+Y / Cmd+Shift+Z to Redo, Delete / Backspace to remove selected picture or box
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnId) {
          e.preventDefault();
          deleteSelectedAnnotation();
        } else if (selectedEmbedded) {
          e.preventDefault();
          handleRemoveEmbeddedPdfImage(
            selectedEmbedded.pageNumber,
            selectedEmbedded.key
          );
        } else if (selectedPictureRegion) {
          e.preventDefault();
          handleRemoveSelectedPictureRegion();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    selectedAnnId,
    selectedEmbedded,
    selectedPictureRegion,
    deleteSelectedAnnotation,
    handleRemoveEmbeddedPdfImage,
    handleRemoveSelectedPictureRegion,
  ]);

  const formatFileSize = (bytesCount: number): string => {
    if (bytesCount < 1024) return `${bytesCount} B`;
    const kb = bytesCount / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  };

  // Helper to bake and persist all current edits (annotations, OCV BLACK / filters, brightness, watermark, compression) into IndexedDB
  const persistCurrentEditsToVault = useCallback(
    async (options?: {
      customDocName?: string;
      silent?: boolean;
      preBakedBytes?: Uint8Array | null;
      preCompressedBytes?: Uint8Array | null;
    }): Promise<{ bakedBytes: Uint8Array; finalPdfBytes: Uint8Array; finalPdfName: string } | null> => {
      if (!workingPdfBytes || !activeDocument) return null;
      const cleanTitle =
        (options?.customDocName ?? saveDocName).trim() ||
        activeDocument.name.replace(/\.pdf$/i, '');
      const finalPdfName = cleanTitle.toLowerCase().endsWith('.pdf')
        ? cleanTitle
        : `${cleanTitle}.pdf`;

      const hasFilteredPages = Object.keys(filteredPageUrls).length > 0;
      const bakedBytes =
        options?.preBakedBytes ||
        (await bakeAnnotationsIntoPdf(workingPdfBytes, annotations, {
          addPageNumbers,
          pageNumberPosition,
          watermarkText,
          watermarkOpacity,
          filteredPageDataUrls: hasFilteredPages ? filteredPageUrls : undefined,
        }));

      let finalPdfBytes = options?.preCompressedBytes || bakedBytes;
      if (
        !options?.preCompressedBytes &&
        (compressionQuality !== 'high' ||
          highCompression ||
          pdfPageSize !== 'A4')
      ) {
        finalPdfBytes = await compressPdfWithOptions(bakedBytes, {
          quality: compressionQuality,
          highCompression,
          pageSize: pdfPageSize,
        });
      }

      const updatedDoc: StoredDocument = {
        ...activeDocument,
        name: finalPdfName,
        sizeBytes: finalPdfBytes.byteLength,
        pageCount: pages.length || activeDocument.pageCount,
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: finalPdfBytes,
        basePdfData: new Uint8Array(workingPdfBytes),
        annotations,
        appliedFilter: pageColorFilter,
        appliedBrightness: pageBrightness,
        appliedContrast: pageContrast,
        watermarkText,
        addPageNumbers,
        thumbnailDataUrl:
          filteredPageUrls[1] ||
          pages[0]?.dataUrl ||
          activeDocument.thumbnailDataUrl,
      };

      await onSaveUpdatedDocument(updatedDoc, options?.silent ?? false);
      return { bakedBytes, finalPdfBytes, finalPdfName };
    },
    [
      workingPdfBytes,
      activeDocument,
      saveDocName,
      filteredPageUrls,
      annotations,
      addPageNumbers,
      pageNumberPosition,
      watermarkText,
      watermarkOpacity,
      compressionQuality,
      highCompression,
      pdfPageSize,
      pages,
      pageColorFilter,
      pageBrightness,
      pageContrast,
      onSaveUpdatedDocument,
    ]
  );

  // Automatic background save (debounced 900ms) so any edits made are immediately saved in the Local Vault even if you press Back or switch tabs
  useEffect(() => {
    if (!hasInitializedDocRef.current || !workingPdfBytes || !activeDocument) {
      return;
    }
    if (isApplyingFilter || isLoadingPages) return;
    const timer = setTimeout(() => {
      persistCurrentEditsToVault({ silent: true }).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [
    annotations,
    workingPdfBytes,
    pageColorFilter,
    pageBrightness,
    pageContrast,
    watermarkText,
    addPageNumbers,
    filteredPageUrls,
    isApplyingFilter,
    isLoadingPages,
    activeDocument,
    persistCurrentEditsToVault,
  ]);

  // Opens the Save Document Bottom Sheet (with Compress Now option) AND immediately persists the edited document to My Documents / Local Vault
  const handleOpenSaveSheet = async () => {
    if (!workingPdfBytes || !activeDocument) return;
    const currentCleanName =
      saveDocName.trim() || activeDocument.name.replace(/\.pdf$/i, '');
    setSaveDocName(currentCleanName);
    setIsRenamingInSaveModal(false);
    setShowSaveModal(true);
    try {
      const saved = await persistCurrentEditsToVault({
        customDocName: currentCleanName,
        silent: false,
      });
      if (saved) {
        setPreparedBaseBytes(saved.bakedBytes);
        setCompressedPreviewBytes(saved.finalPdfBytes);
      }
    } catch (err) {
      console.error('Failed to prepare baked PDF preview:', err);
      setPreparedBaseBytes(workingPdfBytes);
    }
  };

  // Whenever compression settings or preparedBaseBytes change while Save/Compress modal is open, compute the compressed PDF bytes
  useEffect(() => {
    if (!showSaveModal && !showCompressModal) return;
    const base = preparedBaseBytes || workingPdfBytes;
    if (!base) return;

    if (
      compressionQuality === 'high' &&
      !highCompression &&
      pdfPageSize === 'A4'
    ) {
      setCompressedPreviewBytes(base);
      setIsCompressingPreview(false);
      return;
    }

    let cancelled = false;
    setIsCompressingPreview(true);
    (async () => {
      try {
        const compressed = await compressPdfWithOptions(base, {
          quality: compressionQuality,
          highCompression,
          pageSize: pdfPageSize,
        });
        if (!cancelled) {
          setCompressedPreviewBytes(compressed);
          setIsCompressingPreview(false);
        }
      } catch (err) {
        console.error('Compression preview error:', err);
        if (!cancelled) {
          setCompressedPreviewBytes(base);
          setIsCompressingPreview(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    showSaveModal,
    showCompressModal,
    preparedBaseBytes,
    workingPdfBytes,
    compressionQuality,
    highCompression,
    pdfPageSize,
  ]);

  // Executes saving to the chosen destination from the Save Document bottom sheet
  const handleExecuteSaveDestination = async (
    destination: 'phone' | 'documents' | 'cloud' | 'gdrive' | 'email'
  ) => {
    if (!workingPdfBytes || !activeDocument) return;
    setIsLoadingPages(true);
    try {
      const saved = await persistCurrentEditsToVault({
        customDocName: saveDocName,
        silent: false,
        preBakedBytes: preparedBaseBytes,
        preCompressedBytes: compressedPreviewBytes,
      });
      if (!saved) return;
      const { finalPdfBytes, finalPdfName } = saved;
      const cleanTitle = finalPdfName.replace(/\.pdf$/i, '');

      // Handle JPG or Long Image export if chosen
      if (saveFormat === 'jpg' || createLongImage) {
        const imgExport = await exportPdfAsJpegBytes(finalPdfBytes, {
          longImage: createLongImage,
          quality: compressionQuality,
          highCompression,
        });
        const imgFileName = `${cleanTitle}${createLongImage ? '_LongImage' : ''}.jpg`;
        if (destination !== 'documents') {
          downloadBytesAsFile(imgExport.bytes, imgFileName, 'image/jpeg');
        }
        setShowSaveModal(false);
        setShowCompressModal(false);
        setStatusMessage(
          `Saved "${imgFileName}" (${formatFileSize(imgExport.bytes.byteLength)}) successfully.`
        );
        return;
      }

      if (destination === 'phone') {
        downloadBytesAsFile(finalPdfBytes, finalPdfName, 'application/pdf');
        setStatusMessage(
          `Saved "${finalPdfName}" (${formatFileSize(finalPdfBytes.byteLength)}) to Phone Storage & My Documents.`
        );
      } else if (destination === 'documents') {
        setStatusMessage(
          `Saved "${finalPdfName}" (${formatFileSize(finalPdfBytes.byteLength)}) to My Documents.`
        );
      } else if (destination === 'cloud' || destination === 'gdrive') {
        const shareFile = new File(
          [new Uint8Array(finalPdfBytes)],
          finalPdfName,
          {
            type: 'application/pdf',
          }
        );
        if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
          try {
            await navigator.share({
              title: finalPdfName,
              text:
                destination === 'gdrive'
                  ? 'Save to Google Drive'
                  : 'Save to Cloud Storage',
              files: [shareFile],
            });
          } catch {
            downloadBytesAsFile(finalPdfBytes, finalPdfName, 'application/pdf');
          }
        } else {
          downloadBytesAsFile(finalPdfBytes, finalPdfName, 'application/pdf');
          setStatusMessage(
            `Downloaded "${finalPdfName}" (${formatFileSize(finalPdfBytes.byteLength)}) ready for ${destination === 'gdrive' ? 'Google Drive' : 'Cloud'} upload.`
          );
        }
      } else if (destination === 'email') {
        downloadBytesAsFile(finalPdfBytes, finalPdfName, 'application/pdf');
        const subject = encodeURIComponent(`Document: ${finalPdfName}`);
        const body = encodeURIComponent(
          `Please find attached the document "${finalPdfName}" (${pages.length} pages, ${formatFileSize(finalPdfBytes.byteLength)}).`
        );
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
        setStatusMessage(
          `Downloaded "${finalPdfName}" and opened Email composer.`
        );
      }

      setShowSaveModal(false);
      setShowCompressModal(false);
    } finally {
      setIsLoadingPages(false);
    }
  };

  const handlePrintPdf = () => {
    if (!workingPdfBytes) return;
    const blob = new Blob([new Uint8Array(workingPdfBytes)], {
      type: 'application/pdf',
    });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
      }, 5000);
    };
  };

  const handleSharePdf = async () => {
    if (!workingPdfBytes || !activeDocument) return;
    const saved = await persistCurrentEditsToVault({ silent: true });
    const bytesToShare = saved ? saved.finalPdfBytes : workingPdfBytes;
    const nameToShare = saved ? saved.finalPdfName : activeDocument.name;
    const file = new File([new Uint8Array(bytesToShare)], nameToShare, {
      type: 'application/pdf',
    });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: nameToShare,
          text: 'Shared from ElimikaPDF',
          files: [file],
        });
        return;
      } catch {
        // Fallback if user cancels
      }
    }
    downloadBytesAsFile(bytesToShare, nameToShare);
    setStatusMessage(
      'Native device share sheet unavailable on this browser; downloaded PDF instead.'
    );
  };

  const toggleFullscreen = () => {
    if (!viewerContainerRef.current) return;
    if (!document.fullscreenElement) {
      viewerContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const activePageInfo = pages[currentPage - 1] || null;
  const currentPageAnnotations = annotations.filter(
    (a) => a.pageNumber === currentPage
  );
  const currentPageEmbeddedImages = embeddedImagesByPage[currentPage] || [];
  const selectedAnnotation =
    annotations.find((a) => a.id === selectedAnnId) || null;
  const selectedEmbeddedObj = selectedEmbedded
    ? (embeddedImagesByPage[selectedEmbedded.pageNumber] || []).find(
        (e) => e.key === selectedEmbedded.key
      ) || null
    : null;

  const matchingPageNumbers = searchQuery.trim()
    ? pages
        .filter((p) =>
          p.extractedText
            .toLowerCase()
            .includes(searchQuery.trim().toLowerCase())
        )
        .map((p) => p.pageNumber)
    : [];

  const pagesToDisplay = viewAllPagesVertically
    ? pages
    : activePageInfo
      ? [activePageInfo]
      : [];

  if (!activeDocument) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <input
          ref={pdfUploadInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              const filesSnapshot = Array.from(e.target.files);
              e.target.value = '';
              onUploadNewPdf(filesSnapshot);
            }
          }}
        />
        <div className="rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-8 text-center space-y-4">
          <FileEdit className="w-10 h-10 text-[#4A1D5E] dark:text-[#D5B3FF] mx-auto" />
          <div className="space-y-1 max-w-md mx-auto">
            <h1 className="text-xl font-bold text-[#14101B] dark:text-[#F4F1F8]">
              Open a PDF in the Editor & Content Studio
            </h1>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Upload a PDF from your device or select any stored document from your local vault below.
            </p>
          </div>
          <button
            onClick={() => pdfUploadInputRef.current?.click()}
            className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
          >
            <FileUp className="w-4 h-4" />
            <span>Upload PDF File</span>
          </button>
        </div>

        {allDocuments.length > 0 && (
          <div className="rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-6 space-y-3">
            <h2 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
              Or Select from Local Vault
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {allDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => onSelectDocument(doc)}
                  className="p-3.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E] dark:hover:border-[#9D5CE5] text-left transition-colors cursor-pointer"
                >
                  <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                    {doc.name}
                  </p>
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] mt-1 font-mono tabular-nums">
                    {doc.pageCount} pages · {doc.category}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={viewerContainerRef}
      className="h-dvh w-full flex flex-col bg-[#D8D8DC] dark:bg-[#09070D] overflow-hidden relative select-none"
    >
      <input
        ref={pdfUploadInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const filesSnapshot = Array.from(e.target.files);
            e.target.value = '';
            onUploadNewPdf(filesSnapshot);
          }
        }}
      />
      <input
        ref={imageAnnotationInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageAnnotationUpload}
      />
      <input
        ref={replaceImageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleReplaceSelectedImageUpload}
      />

      {/* Non-intrusive Floating Status Banner positioned BELOW the Top Header Bar (without any Undo button so Save is never covered) */}
      {statusMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] sm:max-w-md bg-[#14101B]/90 dark:bg-[#16111F]/95 text-white px-3.5 py-1.5 rounded-full shadow-lg border border-white/15 text-[11px] flex items-center justify-between gap-2.5 backdrop-blur-xs">
          <span className="truncate">{statusMessage}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-white/75 hover:text-white cursor-pointer shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quick Help Modal (Opened by tapping '?' next to Document Editor in the bottom bar) */}
      {showHelpGuide && (
        <div
          onClick={() => setShowHelpGuide(false)}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Document Editor Quick Guide
              </h3>
              <button
                onClick={() => setShowHelpGuide(false)}
                className="p-1 rounded-lg hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="text-xs text-[#6E667D] dark:text-[#A39BB5] space-y-2 leading-relaxed">
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                  Edit or Enlarge Text:
                </strong>{' '}
                Tap any existing text line on the page (or tap{' '}
                <strong>Text</strong> in the bottom bar to add new text). Use{' '}
                <strong>A+ / A-</strong> to increase/decrease font size and pick
                any text or box color.
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                  Select, Move, Resize, or Remove Pictures/Boxes:
                </strong>{' '}
                Tap any picture or stamp on the page to show its bounding box
                and 8 handles. Tap <strong>Remove Picture / Box</strong> to
                delete it while restoring the original background underneath, or{' '}
                <strong>Undo</strong> to revert.
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                  Color Filters & Brightness Switch:
                </strong>{' '}
                Tap the circular floating button on the bottom-right of the
                canvas (or <strong>Filter</strong> in the bottom bar) to apply{' '}
                <strong>OCV BLACK</strong>, <strong>Vivid Light</strong>, or the{' '}
                <strong>Brightness Switch</strong>.
              </li>
              <li>
                <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                  Save & Export:
                </strong>{' '}
                Tap the checkmark (<strong>✓</strong>) on the bottom-right to
                save your edited PDF, or tap Download.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Compact, Always-Visible Mobile & Desktop Top Bar */}
      <header className="h-12 px-2.5 sm:px-4 bg-white dark:bg-[#16111F] border-b border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-2 shrink-0 z-30">
        {/* Left: Back button + Document Title + Page Counter */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={async () => {
              await persistCurrentEditsToVault({ silent: true });
              if (onCloseEditor) {
                onCloseEditor();
              }
            }}
            title="Back to Home"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#14101B] dark:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] transition-colors cursor-pointer shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xs sm:text-sm font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
            {activeDocument.name}
          </span>
          {pages.length > 0 && (
            <span className="text-[11px] font-mono font-semibold text-[#6E667D] dark:text-[#A39BB5] shrink-0">
              ({currentPage}/{pages.length})
            </span>
          )}
        </div>

        {/* Right: Read/Edit Switch + Undo + Share + Prominent Save Button */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Clean Read / Edit Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] border border-[#E4DFEC] dark:border-[#342B47]">
            <button
              type="button"
              onClick={() => {
                setWorkspaceMode('reader');
                setBottomPanelTab('none');
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                isReaderMode
                  ? 'bg-[#003FE8] text-white shadow-xs'
                  : 'text-[#6E667D] dark:text-[#A39BB5]'
              }`}
            >
              Read
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode('content-edit')}
              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                !isReaderMode
                  ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] shadow-xs'
                  : 'text-[#6E667D] dark:text-[#A39BB5]'
              }`}
            >
              Edit
            </button>
          </div>

          <button
            type="button"
            onClick={handleSharePdf}
            title="Share PDF"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#14101B] dark:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer shrink-0"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleOpenSaveSheet}
            title="Save or Download PDF"
            className="h-8 px-2.5 sm:px-3 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Save</span>
          </button>
        </div>
      </header>

      {/* Main Almost-Full-Screen Studio Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Optional Left Thumbnail Rail (toggled via More -> Side Panels on Desktop) */}
        {showDesktopSidebars && (
          <aside className="w-48 sm:w-52 shrink-0 bg-white dark:bg-[#16111F] border-r border-[#E4DFEC] dark:border-[#261F33] overflow-y-auto p-3 space-y-3 hidden lg:block">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Pages ({pages.length})
              </span>
              <button
                onClick={() => handleInsertBlankPageAfter(currentPage)}
                title="Insert blank page after current"
                className="text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <PlusSquare className="w-3.5 h-3.5" />
                <span>Blank Page</span>
              </button>
            </div>

            {pages.map((p) => {
              const isCurrent = p.pageNumber === currentPage;
              const hasSearchMatch = matchingPageNumbers.includes(p.pageNumber);
              const displayThumbSrc =
                filteredPageUrls[p.pageNumber] || p.dataUrl;
              return (
                <div
                  key={p.pageNumber}
                  onClick={() => jumpToPage(p.pageNumber)}
                  className={`p-2 rounded-lg border transition-colors cursor-pointer space-y-2 ${
                    isCurrent
                      ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/5 dark:bg-[#9D5CE5]/10'
                      : 'border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/40'
                  }`}
                >
                  <div className="relative">
                    <img
                      src={displayThumbSrc}
                      alt={`Page ${p.pageNumber} thumbnail`}
                      referrerPolicy="no-referrer"
                      className="w-full h-auto rounded border border-[#E4DFEC] dark:border-[#261F33] bg-white"
                    />
                    {hasSearchMatch && (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-[#D97706] text-white rounded">
                        Match
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold tabular-nums">
                      Page {p.pageNumber}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMovePage(p.pageNumber, -1);
                        }}
                        disabled={p.pageNumber === 1}
                        title="Move page up"
                        className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] disabled:opacity-30"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMovePage(p.pageNumber, 1);
                        }}
                        disabled={p.pageNumber === pages.length}
                        title="Move page down"
                        className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] disabled:opacity-30"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRotatePage(p.pageNumber);
                        }}
                        title="Rotate page 90°"
                        className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33]"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExtractSinglePage(p.pageNumber);
                        }}
                        title="Extract page as PDF"
                        className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33]"
                      >
                        <FileOutput className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePage(p.pageNumber);
                        }}
                        title="Delete page"
                        className="p-1 rounded text-[#DC2626] hover:bg-[#DC2626]/10"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>
        )}

        {/* Center Almost-Full-Screen PDF Canvas Stage (Zooms ONLY PDF contents inside this container) */}
        <div
          ref={stageContainerRef}
          data-pdf-zoom-stage="true"
          className="flex-1 min-w-0 min-h-0 w-full h-full overflow-auto bg-[#D8D8DC] dark:bg-[#09070D] touch-pan-x touch-pan-y"
        >
          <div className="min-w-full min-h-full w-max flex flex-col items-center justify-center px-1.5 py-2 sm:px-4 sm:py-3 gap-3 mx-auto">
            {isLoadingPages && pages.length === 0 ? (
              <div className="my-auto text-center space-y-2">
                <div className="w-8 h-8 border-2 border-[#4A1D5E] dark:border-[#9D5CE5] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-medium text-[#14101B] dark:text-[#A39BB5]">
                  Rendering PDF pages...
                </p>
              </div>
            ) : (
              pagesToDisplay.map((pageInfo) => {
              const pageNum = pageInfo.pageNumber;
              const isCurrentPage = pageNum === currentPage;
              const pageAnns = annotations.filter(
                (a) => a.pageNumber === pageNum
              );
              const pageEmbeddedImgs = embeddedImagesByPage[pageNum] || [];

              // Compute responsive dimensions so the PDF page fills almost the entire screen
              const availW = Math.max(240, stageSize.width - 12);
              const availH = Math.max(260, stageSize.height - 16);
              const fitPageScale = Math.min(
                availW / pageInfo.width,
                availH / pageInfo.height
              );
              const fitWidthScale = availW / pageInfo.width;
              const baseScale =
                fitMode === 'fit-page' ? fitPageScale : fitWidthScale;
              const finalScale = baseScale * zoom;
              const displayW = Math.max(
                200,
                Math.round(pageInfo.width * finalScale)
              );
              const displayH = Math.max(
                240,
                Math.round(pageInfo.height * finalScale)
              );
              // PDF.js rendered at 1.2x PDF points, so 1 PDF point = (finalScale * 1.2) CSS pixels
              const pdfPointToPx = finalScale * 1.2;
              const displayPageSrc =
                filteredPageUrls[pageNum] || pageInfo.dataUrl;

              return (
                <div
                  key={pageNum}
                  ref={(el) => {
                    pageWrapperRefs.current[pageNum] = el;
                  }}
                  onClick={() => setCurrentPage(pageNum)}
                  className="flex flex-col items-center shrink-0 my-auto"
                >
                  {/* Interactive Page Canvas (Almost Full Screen) */}
                  <div
                    ref={(el) => {
                      pageOverlayRefs.current[pageNum] = el;
                    }}
                    onClick={(e) => handleCanvasClick(e, pageNum)}
                    onPointerDown={(e) => handlePointerDownCanvas(e, pageNum)}
                    onPointerMove={(e) => handlePointerMoveOverlay(e, pageNum)}
                    onPointerUp={handlePointerUpOverlay}
                    onPointerCancel={handlePointerUpOverlay}
                    style={{
                      width: `${displayW}px`,
                      height: `${displayH}px`,
                    }}
                    className={`relative bg-white shadow-md transition-shadow select-none shrink-0 ${
                      isCurrentPage
                        ? 'ring-1 ring-black/10 dark:ring-[#9D5CE5]/30'
                        : ''
                    } ${
                      !isReaderMode && activeTool !== 'select'
                        ? 'cursor-crosshair'
                        : 'cursor-default'
                    }`}
                  >
                    <img
                      src={displayPageSrc}
                      alt={`PDF Page ${pageNum}`}
                      referrerPolicy="no-referrer"
                      draggable={false}
                      className="w-full h-full block pointer-events-none"
                    />

                    {/* iLovePDF Content Edit Mode: Clickable Existing Native PDF Text Blocks */}
                    {workspaceMode === 'content-edit' &&
                      activeTool === 'select' &&
                      pageInfo.nativeTextBlocks.map((block) => {
                        const alreadyEdited = annotations.some(
                          (a) => a.replacesNativeTextId === block.id
                        );
                        if (alreadyEdited) return null;
                        return (
                          <div
                            key={block.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectNativeTextBlock(block);
                            }}
                            title="Click to edit, enlarge font size, move, or delete this PDF text"
                            style={{
                              left: `${block.x * 100}%`,
                              top: `${block.y * 100}%`,
                              width: `${block.width * 100}%`,
                              height: `${block.height * 100}%`,
                            }}
                            className="absolute border border-transparent hover:border-[#4A1D5E]/60 hover:bg-[#4A1D5E]/5 rounded-xs cursor-text transition-colors z-10"
                          />
                        );
                      })}

                    {/* Selectable Embedded PDF Pictures & Boxes directly on the Page Canvas */}
                    {!isReaderMode &&
                      pageEmbeddedImgs
                        .filter(
                          (emb) =>
                            !annotations.some(
                              (a) => a.replacesNativeTextId === emb.key
                            )
                        )
                        .map((emb, idx) => {
                          const isEmbSelected =
                            selectedEmbedded?.pageNumber === pageNum &&
                            selectedEmbedded?.key === emb.key;
                          const itemLabel =
                            emb.label ||
                            `${emb.kind === 'box' ? 'Box' : 'Picture'} #${idx + 1}`;
                          // When the user has chosen Add Text or another annotation tool, allow clicking directly through pictures so text boxes can be placed over pictures!
                          const allowClickThroughForTool =
                            activeTool !== 'select' &&
                            activeTool !== 'select-picture';
                          return (
                            <div
                              key={emb.key}
                              onClick={(e) => {
                                if (allowClickThroughForTool) return;
                                e.stopPropagation();
                                setCurrentPage(pageNum);
                                setSelectedEmbedded({
                                  pageNumber: pageNum,
                                  key: emb.key,
                                });
                                setSelectedAnnId(null);
                                setSelectedPictureRegion(null);
                                setStatusMessage(
                                  `Selected "${itemLabel}" on Page ${pageNum}. Click "Write Text" to add text over it, or "Remove" to delete it.`
                                );
                              }}
                              style={{
                                left: `${emb.x * 100}%`,
                                top: `${emb.y * 100}%`,
                                width: `${emb.normWidth * 100}%`,
                                height: `${emb.normHeight * 100}%`,
                              }}
                              className={`absolute transition-all ${
                                allowClickThroughForTool
                                  ? 'pointer-events-none z-10'
                                  : isEmbSelected
                                    ? 'ring-2 ring-[#2563EB] bg-[#2563EB]/10 z-30 cursor-move'
                                    : activeTool === 'select-picture' ||
                                        bottomPanelTab === 'pictures'
                                      ? 'border-2 border-dashed border-[#4A1D5E]/60 hover:border-[#2563EB] hover:bg-[#2563EB]/5 z-10 cursor-pointer'
                                      : 'border border-dashed border-transparent hover:border-[#2563EB]/80 hover:bg-[#2563EB]/5 z-10 cursor-pointer'
                              }`}
                            >
                              {!allowClickThroughForTool &&
                                (isEmbSelected ||
                                  activeTool === 'select-picture' ||
                                  bottomPanelTab === 'pictures') && (
                                  <span
                                    className={`absolute top-0.5 left-0.5 px-1 py-0.5 rounded text-[9px] font-bold pointer-events-none ${
                                      isEmbSelected
                                        ? 'bg-[#2563EB] text-white'
                                        : 'bg-[#4A1D5E]/85 text-white'
                                    }`}
                                  >
                                    {isEmbSelected
                                      ? `Selected: ${itemLabel}`
                                      : itemLabel}
                                  </span>
                                )}

                              {/* 8 Manipulation Handles & Floating Action Bar when this Embedded Picture or Box is Selected */}
                              {isEmbSelected && !allowClickThroughForTool && (
                                <>
                                  {RESIZE_HANDLES.map((h) => (
                                    <div
                                      key={h.dir}
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        handleUnlockEmbeddedImageToMoveOrResize(
                                          pageNum,
                                          emb
                                        );
                                      }}
                                      title="Click or drag handle to unlock and resize"
                                      className={`absolute ${h.posClass} ${h.cursorClass} w-3 h-3 rounded-xs bg-white border-2 border-[#2563EB] shadow-xs z-40`}
                                    />
                                  ))}
                                  <div className="absolute -top-9 right-0 flex items-center gap-1 z-40">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleWriteTextOverPictureOrBox(
                                          pageNum,
                                          {
                                            x: emb.x,
                                            y: emb.y,
                                            width: emb.normWidth,
                                            height: emb.normHeight,
                                          },
                                          itemLabel
                                        );
                                      }}
                                      className="px-2 py-1 rounded bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Type className="w-3 h-3" />
                                      <span>Write Text</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUnlockEmbeddedImageToMoveOrResize(
                                          pageNum,
                                          emb
                                        );
                                      }}
                                      className="px-2 py-1 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Move className="w-3 h-3" />
                                      <span>Move / Resize</span>
                                    </button>
                                    {emb.kind !== 'box' && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          replaceImageInputRef.current?.click();
                                        }}
                                        className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                      >
                                        <Replace className="w-3 h-3" />
                                        <span>Replace</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveEmbeddedPdfImage(
                                          pageNum,
                                          emb.key
                                        );
                                      }}
                                      className="px-2.5 py-1 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      <span>
                                        Remove{' '}
                                        {emb.kind === 'box' ? 'Box' : 'Picture'}
                                      </span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}

                    {/* User-Dragged Selected Picture Region on the Page Canvas */}
                    {!isReaderMode &&
                      selectedPictureRegion &&
                      selectedPictureRegion.pageNumber === pageNum && (
                        <div
                          style={{
                            left: `${selectedPictureRegion.x * 100}%`,
                            top: `${selectedPictureRegion.y * 100}%`,
                            width: `${selectedPictureRegion.width * 100}%`,
                            height: `${selectedPictureRegion.height * 100}%`,
                          }}
                          className="absolute ring-2 ring-[#2563EB] bg-[#2563EB]/10 z-20"
                        >
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#2563EB] text-white text-[10px] font-bold pointer-events-none">
                            Selected Area
                          </span>
                          {RESIZE_HANDLES.map((h) => (
                            <div
                              key={h.dir}
                              className={`absolute ${h.posClass} w-2.5 h-2.5 rounded-xs bg-white border-2 border-[#2563EB] pointer-events-none`}
                            />
                          ))}
                          {!regionDragStart && (
                            <div className="absolute -top-8 right-0 flex items-center gap-1 z-30">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleWriteTextOverPictureOrBox(
                                    pageNum,
                                    selectedPictureRegion,
                                    'Selected Area'
                                  );
                                }}
                                className="px-2.5 py-1 rounded bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-[11px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Type className="w-3 h-3" />
                                <span>Write Text Here</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveSelectedPictureRegion();
                                }}
                                className="px-2.5 py-1 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[11px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Remove Selected</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPictureRegion(null);
                                }}
                                className="px-2 py-1 rounded bg-neutral-800 text-white text-[10px] font-semibold cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                    {/* Live Freehand Drawing Stroke in Progress */}
                    {activeDrawStroke &&
                      activeDrawStroke.pageNumber === pageNum &&
                      activeDrawStroke.points.length > 1 && (
                        <svg
                          className="absolute inset-0 w-full h-full pointer-events-none z-30"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          <polyline
                            fill="none"
                            stroke={drawColor}
                            strokeWidth={drawStrokeWidth * 0.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={activeDrawStroke.points
                              .map((p) => `${p.x * 100},${p.y * 100}`)
                              .join(' ')}
                          />
                        </svg>
                      )}

                    {/* Live Watermark Preview (automatically hidden when Watermark Remover filter is active) */}
                    {watermarkText.trim() &&
                      pageColorFilter !== 'clean-watermark' &&
                      pageColorFilter !== 'ocv-black' && (
                        <div
                          style={{ opacity: watermarkOpacity }}
                          className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
                        >
                          <span className="text-4xl sm:text-5xl font-bold text-[#4A1D5E] -rotate-35 whitespace-nowrap select-none">
                            {watermarkText}
                          </span>
                        </div>
                      )}

                    {/* Live Page Number Preview */}
                    {addPageNumbers && (
                      <div
                        className={`absolute bottom-3 text-[11px] font-mono text-[#6E667D] pointer-events-none ${
                          pageNumberPosition === 'bottom-right'
                            ? 'right-6'
                            : 'left-1/2 -translate-x-1/2'
                        }`}
                      >
                        Page {pageNum} of {pages.length}
                      </div>
                    )}

                    {/* Interactive Overlay & Edited Native Elements */}
                    {pageAnns.map((ann) => {
                      const isSelected =
                        ann.id === selectedAnnId && !isReaderMode;
                      const isSilentRemovalMask =
                        Boolean(ann.isBackgroundRestorePatch) ||
                        (ann.type === 'whiteout' &&
                          Boolean(ann.replacesNativeTextId));
                      return (
                        <React.Fragment key={ann.id}>
                          {/* If this annotation modified or moved a native text block or embedded picture, restore the original background at its original position */}
                          {ann.origRect && !isSilentRemovalMask && (
                            ann.origBgDataUrl ? (
                              <img
                                src={ann.origBgDataUrl}
                                alt=""
                                referrerPolicy="no-referrer"
                                draggable={false}
                                style={{
                                  left: `${ann.origRect.x * 100}%`,
                                  top: `${ann.origRect.y * 100}%`,
                                  width: `${ann.origRect.width * 100}%`,
                                  height: `${ann.origRect.height * 100}%`,
                                }}
                                className="absolute object-fill pointer-events-none z-10"
                              />
                            ) : (
                              <div
                                style={{
                                  left: `${ann.origRect.x * 100}%`,
                                  top: `${ann.origRect.y * 100}%`,
                                  width: `${ann.origRect.width * 100}%`,
                                  height: `${ann.origRect.height * 100}%`,
                                }}
                                className="absolute bg-white pointer-events-none z-10"
                              />
                            )
                          )}

                          <div
                            onClick={(e) => {
                              if (isSilentRemovalMask) return;
                              e.stopPropagation();
                              setCurrentPage(pageNum);
                              if (!isReaderMode) {
                                setSelectedAnnId(ann.id);
                                setSelectedEmbedded(null);
                                setSelectedPictureRegion(null);
                              }
                            }}
                            onDoubleClick={(e) => {
                              if (isReaderMode || isSilentRemovalMask) return;
                              e.stopPropagation();
                              if (
                                ann.type === 'text' ||
                                ann.type === 'comment'
                              ) {
                                setSelectedAnnId(ann.id);
                                setEditingTextAnnId(ann.id);
                              }
                            }}
                            onPointerDown={(e) => {
                              if (isReaderMode || isSilentRemovalMask) return;
                              e.stopPropagation();
                              setCurrentPage(pageNum);
                              setSelectedAnnId(ann.id);
                              setSelectedEmbedded(null);
                              setSelectedPictureRegion(null);
                              setUndoStack((prev) => [
                                ...prev.slice(-29),
                                {
                                  annotations,
                                  pdfBytes: null,
                                },
                              ]);
                              setRedoStack([]);
                              setDragState({
                                id: ann.id,
                                pageNumber: pageNum,
                                mode: 'move',
                                startX: e.clientX,
                                startY: e.clientY,
                                origX: ann.x,
                                origY: ann.y,
                                origW: ann.width,
                                origH: ann.height,
                              });
                            }}
                            style={{
                              left: `${ann.x * 100}%`,
                              top: `${ann.y * 100}%`,
                              width: `${ann.width * 100}%`,
                              height: `${ann.height * 100}%`,
                              opacity: ann.opacity ?? 1,
                              touchAction: 'none',
                            }}
                            className={`absolute group touch-none select-none ${
                              isSilentRemovalMask
                                ? 'pointer-events-none z-10'
                                : isSelected
                                  ? 'ring-2 ring-[#2563EB] z-30 cursor-grab active:cursor-grabbing'
                                  : !isReaderMode
                                    ? 'cursor-grab active:cursor-grabbing z-20 hover:ring-1 hover:ring-[#2563EB]'
                                    : 'z-20'
                            }`}
                          >
                            {ann.type === 'whiteout' && (
                              <div
                                className={`w-full h-full bg-white ${
                                  isSilentRemovalMask
                                    ? ''
                                    : 'border border-dashed border-neutral-200'
                                }`}
                              />
                            )}

                            {ann.type === 'draw' &&
                              ann.points &&
                              ann.points.length > 1 && (
                                <svg
                                  className="w-full h-full overflow-visible pointer-events-none"
                                  viewBox={`${ann.x * 100} ${ann.y * 100} ${ann.width * 100} ${ann.height * 100}`}
                                  preserveAspectRatio="none"
                                >
                                  <polyline
                                    fill="none"
                                    stroke={ann.color}
                                    strokeWidth={(ann.strokeWidth || 2.5) * 0.4}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={ann.points
                                      .map((p) => `${p.x * 100},${p.y * 100}`)
                                      .join(' ')}
                                  />
                                </svg>
                              )}

                            {ann.type === 'highlight' && (
                              <div
                                style={{ backgroundColor: ann.color }}
                                className="w-full h-full opacity-40 pointer-events-none"
                              />
                            )}

                            {ann.type === 'underline' && (
                              <div
                                style={{
                                  borderBottomColor: ann.color,
                                  borderBottomWidth: `${ann.strokeWidth || 2}px`,
                                }}
                                className="w-full h-full border-b pointer-events-none"
                              />
                            )}

                            {ann.type === 'strikethrough' && (
                              <div className="w-full h-full flex items-center pointer-events-none">
                                <div
                                  style={{
                                    backgroundColor: ann.color,
                                    height: `${ann.strokeWidth || 2}px`,
                                  }}
                                  className="w-full"
                                />
                              </div>
                            )}

                            {ann.type === 'rectangle' && (
                              <div
                                style={{
                                  borderColor: ann.color,
                                  borderWidth: `${ann.strokeWidth || 2}px`,
                                  backgroundColor:
                                    ann.fillColor || 'transparent',
                                }}
                                className="w-full h-full pointer-events-none"
                              />
                            )}

                            {ann.type === 'circle' && (
                              <div
                                style={{
                                  borderColor: ann.color,
                                  borderWidth: `${ann.strokeWidth || 2}px`,
                                  backgroundColor:
                                    ann.fillColor || 'transparent',
                                }}
                                className="w-full h-full rounded-full pointer-events-none"
                              />
                            )}

                            {(ann.type === 'line' || ann.type === 'arrow') && (
                              <svg
                                className="w-full h-full overflow-visible pointer-events-none"
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                              >
                                <line
                                  x1="0"
                                  y1="0"
                                  x2="100"
                                  y2="100"
                                  stroke={ann.color}
                                  strokeWidth={
                                    ann.strokeWidth ? ann.strokeWidth * 2 : 4
                                  }
                                />
                                {ann.type === 'arrow' && (
                                  <polygon
                                    points="100,100 82,95 95,82"
                                    fill={ann.color}
                                  />
                                )}
                              </svg>
                            )}

                            {ann.type === 'text' && (
                              <div
                                style={{
                                  color: ann.color || '#FFFFFF',
                                  backgroundColor:
                                    ann.backgroundColor &&
                                    ann.backgroundColor !== 'transparent'
                                      ? ann.backgroundColor
                                      : 'transparent',
                                  borderColor:
                                    ann.fillColor &&
                                    ann.fillColor !== 'transparent'
                                      ? ann.fillColor
                                      : 'transparent',
                                  borderWidth:
                                    ann.fillColor &&
                                    ann.fillColor !== 'transparent'
                                      ? '1.5px'
                                      : '0px',
                                  borderStyle: 'solid',
                                  fontSize: `${Math.max(9, Math.round((ann.fontSize || 16) * pdfPointToPx))}px`,
                                  fontWeight: ann.fontWeight || 'normal',
                                  fontStyle: ann.fontStyle || 'normal',
                                }}
                                className="w-full h-full leading-snug whitespace-pre-wrap break-words font-sans px-1.5 py-0.5 rounded-xs"
                              >
                                {isSelected && editingTextAnnId === ann.id ? (
                                  <textarea
                                    autoFocus
                                    value={ann.text || ''}
                                    placeholder="Type here"
                                    onChange={(e) =>
                                      updateSelectedAnnotation({
                                        text: e.target.value,
                                      })
                                    }
                                    style={{
                                      color: ann.color || '#FFFFFF',
                                      backgroundColor: 'transparent',
                                      fontSize: 'inherit',
                                      fontWeight: ann.fontWeight || 'normal',
                                      fontStyle: ann.fontStyle || 'normal',
                                    }}
                                    className="w-full h-full resize-none focus:outline-none leading-snug placeholder:opacity-75 placeholder:text-current cursor-grab active:cursor-grabbing"
                                  />
                                ) : (
                                  <span
                                    className={`pointer-events-none select-none block w-full h-full ${
                                      !ann.text ? 'opacity-75' : ''
                                    }`}
                                  >
                                    {ann.text || 'Type here'}
                                  </span>
                                )}
                              </div>
                            )}

                            {ann.type === 'comment' && (
                              <div
                                style={{
                                  backgroundColor:
                                    ann.backgroundColor &&
                                    ann.backgroundColor !== 'transparent'
                                      ? ann.backgroundColor
                                      : '#FEF9C3',
                                  borderColor: ann.color || '#CA8A04',
                                  color: ann.color || '#422006',
                                }}
                                className="w-full h-full border rounded p-1.5 shadow-xs overflow-hidden text-[11px] leading-tight pointer-events-none"
                              >
                                <strong className="block text-[10px] uppercase">
                                  Note:
                                </strong>
                                {ann.text || 'Type here'}
                              </div>
                            )}

                            {ann.type === 'image' && ann.imageDataUrl && (
                              <img
                                src={ann.imageDataUrl}
                                alt="Inserted annotation"
                                referrerPolicy="no-referrer"
                                draggable={false}
                                className="w-full h-full object-contain pointer-events-none"
                              />
                            )}

                            {/* Dedicated Smooth Drag Pill on Bottom-Left of Selected Element */}
                            {isSelected && (
                              <div
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setEditingTextAnnId(null);
                                  setCurrentPage(pageNum);
                                  setSelectedAnnId(ann.id);
                                  setUndoStack((prev) => [
                                    ...prev.slice(-29),
                                    { annotations, pdfBytes: null },
                                  ]);
                                  setRedoStack([]);
                                  setDragState({
                                    id: ann.id,
                                    pageNumber: pageNum,
                                    mode: 'move',
                                    startX: e.clientX,
                                    startY: e.clientY,
                                    origX: ann.x,
                                    origY: ann.y,
                                    origW: ann.width,
                                    origH: ann.height,
                                  });
                                }}
                                title="Drag this handle or anywhere on the box to move smoothly"
                                className="absolute -bottom-6 left-0 px-2.5 py-0.5 rounded-full bg-[#2563EB] text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-grab active:cursor-grabbing z-40 whitespace-nowrap pointer-events-auto touch-none"
                              >
                                <Move className="w-3 h-3" />
                                <span>Drag to Move</span>
                              </div>
                            )}

                            {/* Floating Action Toolbar & 8 Resize Handles when Selected */}
                            {isSelected && (
                              <>
                                <div
                                  onPointerDown={(e) => e.stopPropagation()}
                                  className="absolute -top-10 right-0 flex items-center gap-1 z-40 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-1.5 py-1 shadow-lg max-w-[92vw] overflow-x-auto"
                                >
                                  {ann.type === 'text' && (
                                    <div className="flex items-center gap-1 pr-1 border-r border-[#E4DFEC] dark:border-[#261F33]">
                                      {/* Toggle between Smooth Move Mode and Inline Typing Mode */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingTextAnnId((prev) =>
                                            prev === ann.id ? null : ann.id
                                          );
                                        }}
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                                          editingTextAnnId === ann.id
                                            ? 'bg-[#15803D] text-white'
                                            : 'bg-[#2563EB] text-white'
                                        }`}
                                        title={
                                          editingTextAnnId === ann.id
                                            ? 'Finish typing and return to smooth drag mode'
                                            : 'Edit text inline inside box'
                                        }
                                      >
                                        {editingTextAnnId === ann.id ? (
                                          <>
                                            <Check className="w-3 h-3" />
                                            <span>Done Typing</span>
                                          </>
                                        ) : (
                                          <>
                                            <Pencil className="w-3 h-3" />
                                            <span>Edit Text</span>
                                          </>
                                        )}
                                      </button>

                                      {/* Direct A- / A+ Font Size Increase Buttons on Selected Text Box */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleChangeFontSize(
                                            (ann.fontSize || 16) - 2
                                          );
                                        }}
                                        title="Decrease font size (A-)"
                                        className="px-1.5 py-0.5 rounded bg-[#F2EFF6] dark:bg-[#261F33] text-[10px] font-extrabold cursor-pointer"
                                      >
                                        A-
                                      </button>
                                      <span className="text-[10px] font-mono font-bold px-0.5">
                                        {ann.fontSize || 16}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleChangeFontSize(
                                            (ann.fontSize || 16) + 2
                                          );
                                        }}
                                        title="Increase font size to enlarge text (A+)"
                                        className="px-1.5 py-0.5 rounded bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-[10px] font-extrabold cursor-pointer"
                                      >
                                        A+
                                      </button>

                                      <span className="text-[9px] font-bold text-[#6E667D] ml-0.5">
                                        Text:
                                      </span>
                                      {[
                                        '#14101B',
                                        '#FFFFFF',
                                        '#DC2626',
                                        '#2563EB',
                                        '#15803D',
                                      ].map((c) => (
                                        <button
                                          key={c}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDefaultTextColor(c);
                                            updateSelectedAnnotation({
                                              color: c,
                                            });
                                          }}
                                          style={{ backgroundColor: c }}
                                          className={`w-3.5 h-3.5 rounded-full border cursor-pointer shrink-0 ${
                                            ann.color === c
                                              ? 'ring-1 ring-[#4A1D5E]'
                                              : 'border-neutral-300'
                                          }`}
                                          title={`Text color ${c}`}
                                        />
                                      ))}
                                      <input
                                        type="color"
                                        value={
                                          ann.color?.startsWith('#')
                                            ? ann.color
                                            : '#14101B'
                                        }
                                        onChange={(e) => {
                                          setDefaultTextColor(e.target.value);
                                          updateSelectedAnnotation({
                                            color: e.target.value,
                                          });
                                        }}
                                        title="Custom text color"
                                        className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer shrink-0"
                                      />
                                      <span className="text-[9px] font-bold text-[#6E667D] ml-0.5">
                                        Box:
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDefaultTextBoxBgColor(
                                            'transparent'
                                          );
                                          updateSelectedAnnotation({
                                            backgroundColor: 'transparent',
                                          });
                                        }}
                                        className={`px-1 py-0.2 rounded text-[9px] font-semibold border cursor-pointer ${
                                          !ann.backgroundColor ||
                                          ann.backgroundColor === 'transparent'
                                            ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                                            : 'border-neutral-300 text-[#6E667D]'
                                        }`}
                                        title="Transparent text box"
                                      >
                                        None
                                      </button>
                                      {[
                                        '#FFFFFF',
                                        '#FEF08A',
                                        '#DBEAFE',
                                        '#DCFCE7',
                                        '#14101B',
                                      ].map((bg) => (
                                        <button
                                          key={bg}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDefaultTextBoxBgColor(bg);
                                            updateSelectedAnnotation({
                                              backgroundColor: bg,
                                            });
                                          }}
                                          style={{ backgroundColor: bg }}
                                          className={`w-3.5 h-3.5 rounded border cursor-pointer shrink-0 ${
                                            ann.backgroundColor === bg
                                              ? 'ring-1 ring-[#4A1D5E]'
                                              : 'border-neutral-300'
                                          }`}
                                          title={`Box fill ${bg}`}
                                        />
                                      ))}
                                      <input
                                        type="color"
                                        value={
                                          ann.backgroundColor?.startsWith('#')
                                            ? ann.backgroundColor
                                            : '#FFFFFF'
                                        }
                                        onChange={(e) => {
                                          setDefaultTextBoxBgColor(
                                            e.target.value
                                          );
                                          updateSelectedAnnotation({
                                            backgroundColor: e.target.value,
                                          });
                                        }}
                                        title="Custom text box fill color"
                                        className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer shrink-0"
                                      />
                                    </div>
                                  )}
                                  {ann.type === 'whiteout' && (
                                    <div className="flex items-center gap-1 pr-1 border-r border-[#E4DFEC] dark:border-[#261F33]">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleWriteTextOverPictureOrBox(
                                            pageNum,
                                            {
                                              x: ann.x,
                                              y: ann.y,
                                              width: ann.width,
                                              height: ann.height,
                                            },
                                            'Covered Area'
                                          );
                                        }}
                                        className="px-2 py-0.5 rounded bg-[#2563EB] text-white text-[10px] font-bold shadow-xs flex items-center gap-1 hover:bg-[#1D4ED8] cursor-pointer whitespace-nowrap"
                                      >
                                        <Type className="w-3 h-3" />
                                        <span>Write Text</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const targetPage = pages[pageNum - 1];
                                          if (!targetPage) return;
                                          const rect = {
                                            x: ann.x,
                                            y: ann.y,
                                            width: ann.width,
                                            height: ann.height,
                                          };
                                          const bgPatch =
                                            await reconstructBackgroundPatchFromDataUrl(
                                              targetPage.dataUrl,
                                              rect
                                            );
                                          if (bgPatch) {
                                            updateSelectedAnnotation({
                                              type: 'image',
                                              imageDataUrl: bgPatch,
                                            });
                                            setStatusMessage(
                                              'Blended cover with surrounding paper background!'
                                            );
                                          }
                                        }}
                                        className="px-2 py-0.5 rounded bg-[#15803D] text-white text-[10px] font-bold shadow-xs flex items-center gap-1 hover:bg-[#166534] cursor-pointer whitespace-nowrap"
                                        title="Match surrounding paper tone"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        <span>Match Paper</span>
                                      </button>
                                    </div>
                                  )}
                                  {ann.type === 'image' && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleWriteTextOverPictureOrBox(
                                            pageNum,
                                            {
                                              x: ann.x,
                                              y: ann.y,
                                              width: ann.width,
                                              height: ann.height,
                                            },
                                            'Picture'
                                          );
                                        }}
                                        className="px-2 py-0.5 rounded bg-[#4A1D5E] text-white text-[10px] font-bold shadow-xs flex items-center gap-1 hover:bg-[#3B174B] cursor-pointer whitespace-nowrap"
                                      >
                                        <Type className="w-3 h-3" />
                                        <span>Write Text</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          replaceImageInputRef.current?.click();
                                        }}
                                        className="px-2 py-0.5 rounded bg-neutral-800 text-white text-[10px] font-bold shadow-xs flex items-center gap-1 hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
                                      >
                                        <Replace className="w-3 h-3" />
                                        <span>Replace</span>
                                      </button>
                                    </>
                                  )}

                                  {/* 4-Way Touch Micro-Nudge Pad (← ↑ ↓ →) for Pixel-Precise Positioning on Mobile */}
                                  <div className="flex items-center gap-0.5 px-1 border-r border-[#E4DFEC] dark:border-[#261F33] shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateSelectedAnnotation({
                                          x: Math.max(0, ann.x - 0.005),
                                        });
                                      }}
                                      title="Nudge Left"
                                      className="p-1 rounded bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#2563EB] hover:text-white cursor-pointer"
                                    >
                                      <ChevronLeft className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateSelectedAnnotation({
                                          y: Math.max(0, ann.y - 0.005),
                                        });
                                      }}
                                      title="Nudge Up"
                                      className="p-1 rounded bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#2563EB] hover:text-white cursor-pointer"
                                    >
                                      <ChevronUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateSelectedAnnotation({
                                          y: Math.min(
                                            1 - ann.height,
                                            ann.y + 0.005
                                          ),
                                        });
                                      }}
                                      title="Nudge Down"
                                      className="p-1 rounded bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#2563EB] hover:text-white cursor-pointer"
                                    >
                                      <ChevronDown className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateSelectedAnnotation({
                                          x: Math.min(
                                            1 - ann.width,
                                            ann.x + 0.005
                                          ),
                                        });
                                      }}
                                      title="Nudge Right"
                                      className="p-1 rounded bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#2563EB] hover:text-white cursor-pointer"
                                    >
                                      <ChevronRight className="w-3 h-3" />
                                    </button>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      duplicateSelectedAnnotation();
                                    }}
                                    title="Duplicate"
                                    className="p-1 rounded bg-[#4A1D5E] text-white shadow-xs hover:bg-[#3B174B] cursor-pointer"
                                  >
                                    <CopyPlus className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteSelectedAnnotation();
                                    }}
                                    className="px-2 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold shadow-xs flex items-center gap-1 hover:bg-[#B91C1C] cursor-pointer whitespace-nowrap"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>
                                      {ann.type === 'image'
                                        ? 'Remove Picture'
                                        : 'Delete'}
                                    </span>
                                  </button>
                                </div>

                                {/* 8 Manipulation Handles around the Selected Element Bounding Box */}
                                {RESIZE_HANDLES.map((h) => (
                                  <div
                                    key={h.dir}
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      setUndoStack((prev) => [
                                        ...prev.slice(-29),
                                        {
                                          annotations,
                                          pdfBytes: null,
                                        },
                                      ]);
                                      setRedoStack([]);
                                      setDragState({
                                        id: ann.id,
                                        pageNumber: pageNum,
                                        mode: h.dir,
                                        startX: e.clientX,
                                        startY: e.clientY,
                                        origX: ann.x,
                                        origY: ann.y,
                                        origW: ann.width,
                                        origH: ann.height,
                                      });
                                    }}
                                    style={{ touchAction: 'none' }}
                                    className={`absolute ${h.posClass} ${h.cursorClass} w-3.5 h-3.5 rounded-xs bg-white border-2 border-[#2563EB] shadow-xs z-40 touch-none`}
                                  />
                                ))}
                              </>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}

                    {/* Original vs. Edited Document Comparison Overlay (Triggered by Bottom-Right Button after Undo) */}
                    {isComparingOriginal && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (compareViewMode !== 'split') return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (rect.width > 0) {
                            const pct = Math.max(
                              2,
                              Math.min(
                                98,
                                ((e.clientX - rect.left) / rect.width) * 100
                              )
                            );
                            setCompareSplitPercent(pct);
                          }
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (
                            compareViewMode !== 'split' ||
                            (e.buttons === 0 && e.pointerType === 'mouse')
                          ) {
                            return;
                          }
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (rect.width > 0) {
                            const pct = Math.max(
                              2,
                              Math.min(
                                98,
                                ((e.clientX - rect.left) / rect.width) * 100
                              )
                            );
                            setCompareSplitPercent(pct);
                          }
                        }}
                        style={{ touchAction: 'none' }}
                        className="absolute inset-0 z-50 select-none cursor-ew-resize overflow-hidden"
                      >
                        {/* Unmodified Original Document Layer */}
                        {compareViewMode !== 'edited' && (
                          <img
                            src={
                              originalPageUrls[pageNum] || pageInfo.dataUrl
                            }
                            alt={`Original Page ${pageNum}`}
                            referrerPolicy="no-referrer"
                            draggable={false}
                            style={
                              compareViewMode === 'split'
                                ? {
                                    clipPath: `inset(0 ${100 - compareSplitPercent}% 0 0)`,
                                  }
                                : undefined
                            }
                            className="absolute inset-0 w-full h-full block pointer-events-none bg-white"
                          />
                        )}

                        {/* Labels for Original vs. Edited */}
                        {compareViewMode === 'split' && (
                          <>
                            <span className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-md bg-[#14101B]/85 text-white text-[10px] font-bold uppercase tracking-wider shadow-md pointer-events-none">
                              Original
                            </span>
                            <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-md bg-[#003FE8]/90 text-white text-[10px] font-bold uppercase tracking-wider shadow-md pointer-events-none">
                              Edited
                            </span>

                            {/* Vertical Split Wipe Line & Grab Handle */}
                            <div
                              style={{ left: `${compareSplitPercent}%` }}
                              className="absolute top-0 bottom-0 w-0.5 bg-[#003FE8] shadow-[0_0_8px_rgba(0,63,232,0.8)] -translate-x-1/2 pointer-events-none flex items-center justify-center"
                            >
                              <div className="w-8 h-8 rounded-full bg-[#003FE8] text-white border-2 border-white shadow-lg flex items-center justify-center text-xs font-bold">
                                ↔
                              </div>
                            </div>
                          </>
                        )}

                        {compareViewMode === 'original' && (
                          <span className="absolute top-2.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#14101B]/90 text-white text-[11px] font-bold uppercase tracking-wider shadow-md pointer-events-none">
                            Original Document (Before Edits)
                          </span>
                        )}

                        {compareViewMode === 'edited' && (
                          <span className="absolute top-2.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#003FE8]/95 text-white text-[11px] font-bold uppercase tracking-wider shadow-md pointer-events-none">
                            Edited Document (Current)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Subtle Page Indicator Below Page (when multiple pages exist) */}
                  {pages.length > 1 && (
                    <span className="mt-1 text-[10px] font-mono font-semibold text-[#5A5565] dark:text-[#A39BB5]">
                      Page {pageNum} of {pages.length}
                    </span>
                  )}
                </div>
              );
            })
          )}
          </div>
        </div>

        {/* Stable Floating PDF-Only Zoom Controls on Bottom-Left of Stage */}
        <div className="absolute bottom-3 left-3 z-30 flex items-center gap-0.5 rounded-full bg-white/92 dark:bg-[#16111F]/92 border border-neutral-300/80 dark:border-[#261F33] px-1.5 py-1 shadow-md backdrop-blur-xs">
          <button
            type="button"
            onClick={() => applyPdfZoom(zoom - 0.2)}
            disabled={zoom <= 0.5}
            title="Zoom out PDF content"
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-neutral-200/70 dark:hover:bg-[#261F33] disabled:opacity-35 cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5 text-[#14101B] dark:text-[#F4F1F8]" />
          </button>
          <button
            type="button"
            onClick={() => applyPdfZoom(1.0)}
            title="Reset PDF zoom to 100%"
            className="px-2 py-0.5 text-[11px] font-mono font-bold text-[#14101B] dark:text-[#F4F1F8] hover:bg-neutral-200/70 dark:hover:bg-[#261F33] rounded-full cursor-pointer"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => applyPdfZoom(zoom + 0.2)}
            disabled={zoom >= 4.0}
            title="Zoom in PDF content"
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-neutral-200/70 dark:hover:bg-[#261F33] disabled:opacity-35 cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5 text-[#14101B] dark:text-[#F4F1F8]" />
          </button>
        </div>

        {/* Top-Left "A4" Page Size Badge & Top-Right "1/9" + Up/Down Stepper on Stage (Matches Reference Screenshots) */}
        <button
          type="button"
          onClick={() => {
            const sizes: ('A4' | 'Letter' | 'Legal' | 'Fit')[] = [
              'A4',
              'Letter',
              'Legal',
              'Fit',
            ];
            const next =
              sizes[(sizes.indexOf(pdfPageSize) + 1) % sizes.length];
            setPdfPageSize(next);
            setStatusMessage(`PDF Page Size set to ${next}.`);
          }}
          title="Tap to change PDF Page Size (A4 / Letter / Legal / Fit)"
          className="absolute top-3 left-3 z-30 px-2.5 py-0.5 rounded-md bg-white/85 dark:bg-[#16111F]/85 border border-neutral-300/80 dark:border-[#261F33] text-[#2563EB] dark:text-[#60A5FA] text-xs font-semibold shadow-xs backdrop-blur-xs cursor-pointer"
        >
          {pdfPageSize}
        </button>

        <div className="absolute top-2.5 right-3 z-30 flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-md bg-white/85 dark:bg-[#16111F]/85 border border-neutral-300/80 dark:border-[#261F33] text-[#5A5565] dark:text-[#A39BB5] text-xs font-mono font-semibold shadow-xs backdrop-blur-xs">
            {currentPage}/{pages.length || 1}
          </span>
          {pages.length > 1 && (
            <div className="flex flex-col items-center bg-white/90 dark:bg-[#16111F]/90 border border-neutral-300/80 dark:border-[#261F33] rounded-full p-0.5 shadow-sm backdrop-blur-xs">
              <button
                type="button"
                onClick={() => jumpToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                title="Previous page"
                className="p-1 rounded-full hover:bg-neutral-200/70 dark:hover:bg-[#261F33] disabled:opacity-30 cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5 text-[#3A3545] dark:text-[#F4F1F8]" />
              </button>
              <button
                type="button"
                onClick={() => jumpToPage(currentPage + 1)}
                disabled={currentPage >= pages.length}
                title="Next page"
                className="p-1 rounded-full hover:bg-neutral-200/70 dark:hover:bg-[#261F33] disabled:opacity-30 cursor-pointer"
              >
                <ChevronDown className="w-3.5 h-3.5 text-[#3A3545] dark:text-[#F4F1F8]" />
              </button>
            </div>
          )}
        </div>

        {/* Floating Original vs. Edited Mode Switcher Bar when Compare Mode is Active */}
        {isComparingOriginal && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1 rounded-full bg-[#14101B]/92 dark:bg-[#16111F]/95 border border-white/15 text-white shadow-xl backdrop-blur-xs">
            <button
              type="button"
              onClick={() => setCompareViewMode('split')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                compareViewMode === 'split'
                  ? 'bg-[#003FE8] text-white'
                  : 'text-white/75 hover:text-white'
              }`}
            >
              Split Compare
            </button>
            <button
              type="button"
              onClick={() => setCompareViewMode('original')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                compareViewMode === 'original'
                  ? 'bg-[#003FE8] text-white'
                  : 'text-white/75 hover:text-white'
              }`}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => setCompareViewMode('edited')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                compareViewMode === 'edited'
                  ? 'bg-[#003FE8] text-white'
                  : 'text-white/75 hover:text-white'
              }`}
            >
              Edited
            </button>
            <button
              type="button"
              onClick={() => setIsComparingOriginal(false)}
              title="Close Comparison"
              className="w-6 h-6 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating Corner Controls on Bottom-Right of Grey Document Stage (Matches Reference Screenshot) */}
        <div className="absolute bottom-3 right-3 z-30 flex items-center gap-2">
          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              title="Undo last change (Ctrl+Z)"
              className="h-10 px-3.5 rounded-full bg-[#4A1D5E]/95 hover:bg-[#3B174B] text-white text-xs font-bold shadow-lg flex items-center gap-1.5 cursor-pointer backdrop-blur-xs"
            >
              <Undo2 className="w-4 h-4" />
              <span>Undo ({undoStack.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsComparingOriginal((prev) => {
                const next = !prev;
                if (next) {
                  setSelectedAnnId(null);
                  setEditingTextAnnId(null);
                  setSelectedEmbedded(null);
                  setCompareViewMode('split');
                  setCompareSplitPercent(50);
                }
                return next;
              });
            }}
            title="Compare Original vs. Edited Document"
            className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-colors cursor-pointer backdrop-blur-xs ${
              isComparingOriginal
                ? 'bg-[#003FE8] text-white ring-2 ring-white'
                : 'bg-[#4A1D5E]/95 hover:bg-[#3B174B] text-white'
            }`}
          >
            <Contrast className="w-5 h-5" />
          </button>
        </div>

        {/* Optional Right Contextual Inspector (toggled via More -> Side Panels on Desktop) */}
        {showDesktopSidebars && (
          <aside className="w-76 shrink-0 bg-white dark:bg-[#16111F] border-l border-[#E4DFEC] dark:border-[#261F33] overflow-y-auto p-4 space-y-5 hidden lg:block">
            {/* Selected Element Formatting Panel */}
            {selectedAnnotation && !isReaderMode && (
              <div className="space-y-3 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#14101B] dark:text-[#F4F1F8]">
                    Selected: {selectedAnnotation.type} (P.
                    {selectedAnnotation.pageNumber})
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        reorderAnnotationLayer(
                          selectedAnnotation.id,
                          'backward'
                        )
                      }
                      title="Send Backward"
                      className="p-1 rounded border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() =>
                        reorderAnnotationLayer(selectedAnnotation.id, 'forward')
                      }
                      title="Bring Forward"
                      className="p-1 rounded border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={deleteSelectedAnnotation}
                      className="ml-1 text-xs font-semibold text-[#DC2626] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {(selectedAnnotation.type === 'text' ||
                  selectedAnnotation.type === 'comment') && (
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
                        Text Content
                      </label>
                      <textarea
                        rows={2}
                        value={selectedAnnotation.text || ''}
                        onChange={(e) =>
                          updateSelectedAnnotation({ text: e.target.value })
                        }
                        className="w-full p-2 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
                          Font Size (Enlarge Text)
                        </label>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              handleChangeFontSize(
                                (selectedAnnotation.fontSize || 16) - 2
                              )
                            }
                            className="px-2 py-0.5 rounded bg-[#F2EFF6] dark:bg-[#261F33] text-xs font-extrabold cursor-pointer"
                          >
                            A-
                          </button>
                          <span className="text-xs font-mono font-bold px-1">
                            {selectedAnnotation.fontSize || 16}pt
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleChangeFontSize(
                                (selectedAnnotation.fontSize || 16) + 2
                              )
                            }
                            className="px-2 py-0.5 rounded bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-extrabold cursor-pointer"
                          >
                            A+
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={8}
                        max={72}
                        step={1}
                        value={selectedAnnotation.fontSize || 16}
                        onChange={(e) =>
                          handleChangeFontSize(Number(e.target.value))
                        }
                        className="w-full accent-[#4A1D5E] dark:accent-[#9D5CE5] cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Editable PDF Text Blocks List */}
            {!isReaderMode && (
              <div className="space-y-2 border-b border-[#E4DFEC] dark:border-[#261F33] pb-5">
                <h3 className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Editable PDF Text Blocks (Page {currentPage})</span>
                </h3>
                <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                  {activePageInfo?.nativeTextBlocks.map((b) => {
                    const editedAnn = annotations.find(
                      (a) => a.replacesNativeTextId === b.id
                    );
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => handleSelectNativeTextBlock(b)}
                        className={`w-full text-left px-2.5 py-1.5 rounded border text-[11px] truncate transition-colors cursor-pointer ${
                          editedAnn && selectedAnnId === editedAnn.id
                            ? 'border-[#4A1D5E] bg-[#4A1D5E]/10 font-semibold'
                            : 'border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E]'
                        }`}
                      >
                        {editedAnn
                          ? editedAnn.type === 'whiteout'
                            ? `[Removed] ${b.text}`
                            : editedAnn.text
                          : b.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* =====================================================================
          BOTTOM GROUPED DOCUMENT EDITOR DOCK (Modeled after Reference Picture)
         ===================================================================== */}
      <div className="shrink-0 bg-white dark:bg-[#16111F] border-t border-[#E4DFEC] dark:border-[#261F33] z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        {/* Contextual Sub-Drawer: Appears right above the bottom icon strip when a tool tab is open OR an object on the page is selected */}
        {(bottomPanelTab !== 'none' ||
          selectedAnnotation !== null ||
          selectedEmbedded !== null ||
          selectedPictureRegion !== null) && (
          <div className="bg-[#FAF9FB] dark:bg-[#110D18] border-b border-[#E4DFEC] dark:border-[#261F33] px-3 py-2">
            {/* 1. TEXT PANEL (or when a Text Box / Comment is selected on the canvas) */}
            {(bottomPanelTab === 'text' ||
              (bottomPanelTab === 'none' &&
                (selectedAnnotation?.type === 'text' ||
                  selectedAnnotation?.type === 'comment'))) && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleQuickAddDefaultTextBox(currentPage)}
                    className="px-2.5 py-1 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shadow-xs"
                  >
                    <Type className="w-3.5 h-3.5" />
                    <span>+ Add Text Box</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMode('annotate');
                      setActiveTool('text');
                      setStatusMessage(
                        'Tap anywhere on the PDF page to place a new text box.'
                      );
                    }}
                    className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      activeTool === 'text'
                        ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                        : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8]'
                    }`}
                  >
                    <span>Tap Page to Place</span>
                  </button>

                  {/* Live Text Input right in the bottom bar with "Type here" placeholder (never requires deleting placeholder text) */}
                  {(selectedAnnotation?.type === 'text' ||
                    selectedAnnotation?.type === 'comment') && (
                    <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border-2 border-[#2563EB] rounded-lg px-2 py-0.5">
                      <Pencil className="w-3 h-3 text-[#2563EB] shrink-0" />
                      <input
                        type="text"
                        value={selectedAnnotation.text || ''}
                        onChange={(e) =>
                          updateSelectedAnnotation({ text: e.target.value })
                        }
                        placeholder="Type here"
                        className="w-36 sm:w-48 text-xs font-medium bg-transparent focus:outline-none text-[#14101B] dark:text-[#F4F1F8]"
                      />
                    </div>
                  )}

                  {/* Quick 4-Way Nudge Buttons for Moving Written Text Precisely */}
                  {selectedAnnotation && (
                    <div className="flex items-center gap-0.5 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-1 py-0.5">
                      <span className="text-[9px] font-bold text-[#6E667D] px-0.5">
                        Move:
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedAnnotation({
                            x: Math.max(0, selectedAnnotation.x - 0.02),
                          })
                        }
                        title="Move Left"
                        className="p-1 rounded hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedAnnotation({
                            y: Math.max(0, selectedAnnotation.y - 0.02),
                          })
                        }
                        title="Move Up"
                        className="p-1 rounded hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedAnnotation({
                            y: Math.min(
                              1 - selectedAnnotation.height,
                              selectedAnnotation.y + 0.02
                            ),
                          })
                        }
                        title="Move Down"
                        className="p-1 rounded hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedAnnotation({
                            x: Math.min(
                              1 - selectedAnnotation.width,
                              selectedAnnotation.x + 0.02
                            ),
                          })
                        }
                        title="Move Right"
                        className="p-1 rounded hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Font Size Decrease (A-) & Increase (A+) to Enlarge Text */}
                  <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-0.5">
                    <span className="text-[10px] font-bold text-[#6E667D] dark:text-[#A39BB5] uppercase">
                      Size:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const currentSize =
                          selectedAnnotation?.fontSize || defaultFontSize;
                        handleChangeFontSize(currentSize - 2);
                      }}
                      title="Decrease font size (A-)"
                      className="px-2 py-0.5 rounded bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#4A1D5E] hover:text-white text-xs font-extrabold cursor-pointer"
                    >
                      A-
                    </button>
                    <input
                      type="number"
                      min={8}
                      max={96}
                      value={selectedAnnotation?.fontSize || defaultFontSize}
                      onChange={(e) =>
                        handleChangeFontSize(Number(e.target.value))
                      }
                      className="w-11 px-1 py-0.5 text-xs font-mono font-bold border border-[#E4DFEC] dark:border-[#261F33] rounded text-center bg-transparent"
                      title="Font Size (pt)"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const currentSize =
                          selectedAnnotation?.fontSize || defaultFontSize;
                        handleChangeFontSize(currentSize + 2);
                      }}
                      title="Increase font size to enlarge text (A+)"
                      className="px-2 py-0.5 rounded bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] hover:opacity-90 text-xs font-extrabold cursor-pointer"
                    >
                      A+
                    </button>
                  </div>

                  {/* Bold & Italic */}
                  {selectedAnnotation?.type === 'text' && (
                    <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-1.5 py-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedAnnotation({
                            fontWeight:
                              selectedAnnotation.fontWeight === 'bold'
                                ? 'normal'
                                : 'bold',
                          })
                        }
                        className={`p-1 rounded cursor-pointer ${
                          selectedAnnotation.fontWeight === 'bold'
                            ? 'bg-[#4A1D5E] text-white'
                            : 'hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                        }`}
                        title="Bold"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedAnnotation({
                            fontStyle:
                              selectedAnnotation.fontStyle === 'italic'
                                ? 'normal'
                                : 'italic',
                          })
                        }
                        className={`p-1 rounded cursor-pointer ${
                          selectedAnnotation.fontStyle === 'italic'
                            ? 'bg-[#4A1D5E] text-white'
                            : 'hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                        }`}
                        title="Italic"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Text Color Picker */}
                  <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-1">
                    <span className="text-[10px] font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                      Text:
                    </span>
                    {[
                      '#FFFFFF',
                      '#14101B',
                      '#4A1D5E',
                      '#DC2626',
                      '#2563EB',
                      '#15803D',
                    ].map((hex) => {
                      const activeColor = selectedAnnotation
                        ? selectedAnnotation.color
                        : defaultTextColor;
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => {
                            setDefaultTextColor(hex);
                            if (selectedAnnotation) {
                              updateSelectedAnnotation({ color: hex });
                            }
                          }}
                          style={{ backgroundColor: hex }}
                          className={`w-4 h-4 rounded-full border cursor-pointer ${
                            activeColor === hex
                              ? 'ring-2 ring-offset-1 ring-[#4A1D5E] dark:ring-[#9D5CE5]'
                              : 'border-neutral-300 dark:border-neutral-600'
                          }`}
                        />
                      );
                    })}
                    <input
                      type="color"
                      value={
                        selectedAnnotation?.color?.startsWith('#')
                          ? selectedAnnotation.color
                          : defaultTextColor
                      }
                      onChange={(e) => {
                        setDefaultTextColor(e.target.value);
                        if (selectedAnnotation) {
                          updateSelectedAnnotation({ color: e.target.value });
                        }
                      }}
                      className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                  </div>

                  {/* Box Background Fill Color Picker */}
                  <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-1">
                    <span className="text-[10px] font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                      Box:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDefaultTextBoxBgColor('transparent');
                        if (selectedAnnotation) {
                          updateSelectedAnnotation({
                            backgroundColor: 'transparent',
                          });
                        }
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                        (selectedAnnotation
                          ? !selectedAnnotation.backgroundColor ||
                            selectedAnnotation.backgroundColor === 'transparent'
                          : defaultTextBoxBgColor === 'transparent')
                          ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                          : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D]'
                      }`}
                    >
                      Clear
                    </button>
                    {[
                      '#2563EB',
                      '#FFFFFF',
                      '#FEF08A',
                      '#DBEAFE',
                      '#DCFCE7',
                      '#14101B',
                      '#DC2626',
                    ].map((hex) => {
                      const activeBg = selectedAnnotation
                        ? selectedAnnotation.backgroundColor || 'transparent'
                        : defaultTextBoxBgColor;
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => {
                            setDefaultTextBoxBgColor(hex);
                            if (selectedAnnotation) {
                              updateSelectedAnnotation({
                                backgroundColor: hex,
                              });
                            }
                          }}
                          style={{ backgroundColor: hex }}
                          className={`w-4 h-4 rounded border cursor-pointer ${
                            activeBg === hex
                              ? 'ring-2 ring-offset-1 ring-[#4A1D5E] dark:ring-[#9D5CE5]'
                              : 'border-neutral-300 dark:border-neutral-600'
                          }`}
                        />
                      );
                    })}
                    <input
                      type="color"
                      value={
                        selectedAnnotation?.backgroundColor?.startsWith('#')
                          ? selectedAnnotation.backgroundColor
                          : defaultTextBoxBgColor.startsWith('#')
                            ? defaultTextBoxBgColor
                            : '#2563EB'
                      }
                      onChange={(e) => {
                        setDefaultTextBoxBgColor(e.target.value);
                        if (selectedAnnotation) {
                          updateSelectedAnnotation({
                            backgroundColor: e.target.value,
                          });
                        }
                      }}
                      className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {selectedAnnotation && (
                    <button
                      type="button"
                      onClick={deleteSelectedAnnotation}
                      className="px-2.5 py-1 rounded-lg bg-[#DC2626] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBottomPanelTab('none')}
                    className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer"
                    title="Hide panel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* 2. PICTURES & BOXES PANEL (or when an Embedded Picture / Box / Region is selected) */}
            {(bottomPanelTab === 'pictures' ||
              (bottomPanelTab === 'none' &&
                (selectedEmbedded !== null ||
                  selectedPictureRegion !== null ||
                  selectedAnnotation?.type === 'image' ||
                  selectedAnnotation?.type === 'rectangle' ||
                  selectedAnnotation?.type === 'circle' ||
                  selectedAnnotation?.type === 'whiteout'))) && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMode('content-edit');
                      setActiveTool('select');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      activeTool === 'select'
                        ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                        : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]'
                    }`}
                  >
                    <MousePointer className="w-3.5 h-3.5" />
                    <span>Tap to Select Object</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTool('select-picture');
                      setStatusMessage(
                        'Drag a box around any picture, logo, or stamp on the page to select or remove it.'
                      );
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      activeTool === 'select-picture'
                        ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                        : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]'
                    }`}
                  >
                    <ImageOff className="w-3.5 h-3.5" />
                    <span>Drag-Select Area</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => imageAnnotationInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>+ Add Picture</span>
                  </button>

                  {/* Actions when a Picture / Box / Region is selected */}
                  {(selectedAnnotation?.type === 'image' ||
                    selectedEmbeddedObj ||
                    selectedPictureRegion) && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedEmbeddedObj && selectedEmbedded) {
                            handleWriteTextOverPictureOrBox(
                              selectedEmbedded.pageNumber,
                              {
                                x: selectedEmbeddedObj.x,
                                y: selectedEmbeddedObj.y,
                                width: selectedEmbeddedObj.normWidth,
                                height: selectedEmbeddedObj.normHeight,
                              },
                              selectedEmbeddedObj.label || 'Picture'
                            );
                          } else if (selectedAnnotation) {
                            handleWriteTextOverPictureOrBox(
                              selectedAnnotation.pageNumber,
                              {
                                x: selectedAnnotation.x,
                                y: selectedAnnotation.y,
                                width: selectedAnnotation.width,
                                height: selectedAnnotation.height,
                              },
                              'Picture'
                            );
                          } else if (selectedPictureRegion) {
                            handleWriteTextOverPictureOrBox(
                              selectedPictureRegion.pageNumber,
                              selectedPictureRegion,
                              'Selected Area'
                            );
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Type className="w-3.5 h-3.5" />
                        <span>Write Text Over Picture</span>
                      </button>

                      {selectedEmbeddedObj && selectedEmbedded && (
                        <button
                          type="button"
                          onClick={() =>
                            handleUnlockEmbeddedImageToMoveOrResize(
                              selectedEmbedded.pageNumber,
                              selectedEmbeddedObj
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-[#2563EB] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Move className="w-3.5 h-3.5" />
                          <span>Move / Resize</span>
                        </button>
                      )}

                      {(selectedAnnotation?.type === 'image' ||
                        selectedEmbeddedObj) && (
                        <button
                          type="button"
                          onClick={() => replaceImageInputRef.current?.click()}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Replace className="w-3.5 h-3.5" />
                          <span>Replace</span>
                        </button>
                      )}
                    </>
                  )}

                  {(selectedAnnotation !== null ||
                    selectedEmbedded !== null ||
                    selectedPictureRegion !== null) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedAnnotation) {
                          deleteSelectedAnnotation();
                        } else if (selectedEmbedded) {
                          handleRemoveEmbeddedPdfImage(
                            selectedEmbedded.pageNumber,
                            selectedEmbedded.key
                          );
                        } else if (selectedPictureRegion) {
                          handleRemoveSelectedPictureRegion();
                        }
                      }}
                      className="px-3 py-1 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {selectedEmbeddedObj
                          ? `Remove ${selectedEmbeddedObj.kind === 'box' ? 'Box' : 'Picture'}`
                          : selectedAnnotation?.type === 'image'
                            ? 'Remove Picture'
                            : 'Remove Selected'}
                      </span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                  title="Hide panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 3. COLOR FILTER (OCV BLACK, Vivid Light, etc.) & BRIGHTNESS SWITCH PANEL */}
            {bottomPanelTab === 'filter' && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold text-[#6E667D] dark:text-[#A39BB5] uppercase flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                    <span>Filter:</span>
                  </span>
                  {PDF_COLOR_FILTERS.map((f) => {
                    const isSelected = pageColorFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setPageColorFilter(f.id);
                          if (f.id === 'clean-watermark') {
                            if (watermarkText) setWatermarkText('');
                            setStatusMessage(
                              'Smart Watermark Remover active: Watermarks removed while preserving 100% of document words, font sharpness & original colors.'
                            );
                          } else if (f.id === 'ocv-black') {
                            if (watermarkText) setWatermarkText('');
                            setStatusMessage(
                              'OCV BLACK active: Watermarks bleached & removed, leaving crisp jet-black text on pure white paper.'
                            );
                          } else {
                            setStatusMessage(
                              f.id === 'original'
                                ? 'Restored Original PDF page colors.'
                                : `Applied "${f.label}" filter (${f.shortDesc}). Tap ✓ to save.`
                            );
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap border ${
                          isSelected
                            ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] border-[#4A1D5E] dark:border-[#9D5CE5]'
                            : 'bg-white dark:bg-[#16111F] text-[#14101B] dark:text-[#F4F1F8] border-[#E4DFEC] dark:border-[#261F33]'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}

                  {/* When Watermark Clean (Color) or OCV BLACK is selected, provide one-tap Watermark Removal Strength presets */}
                  {(pageColorFilter === 'clean-watermark' ||
                    pageColorFilter === 'ocv-black') && (
                    <div className="flex items-center gap-1 bg-[#15803D]/10 border border-[#15803D]/30 rounded-lg px-2 py-0.5">
                      <span className="text-[10px] font-bold text-[#15803D] dark:text-[#4ADE80] whitespace-nowrap">
                        Watermark Clean:
                      </span>
                      {(
                        [
                          { label: 'Gentle', b: -15 },
                          { label: 'Standard', b: 0 },
                          { label: 'Strong', b: 18 },
                          { label: 'Max', b: 32 },
                        ] as const
                      ).map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setPageBrightness(preset.b);
                            setBrightnessSwitchOn(preset.b > 0);
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            pageBrightness === preset.b
                              ? 'bg-[#15803D] text-white'
                              : 'text-[#15803D] dark:text-[#4ADE80] hover:bg-[#15803D]/15'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <span className="h-4 w-px bg-[#E4DFEC] dark:bg-[#261F33] mx-0.5" />

                  {/* Brightness Switch & Fine Steppers */}
                  <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-0.5">
                    <button
                      type="button"
                      onClick={handleToggleBrightnessSwitch}
                      className={`px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        brightnessSwitchOn || pageBrightness > 0
                          ? 'bg-[#D97706] text-white'
                          : 'bg-[#F2EFF6] dark:bg-[#261F33] text-[#6E667D] dark:text-[#A39BB5]'
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>
                        Brightness:{' '}
                        {brightnessSwitchOn || pageBrightness > 0
                          ? 'ON'
                          : 'OFF'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(-60, pageBrightness - 10);
                        setPageBrightness(next);
                        setBrightnessSwitchOn(next > 0);
                      }}
                      className="px-1.5 py-0.5 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] text-xs font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="text-[11px] font-mono tabular-nums font-bold px-0.5">
                      {pageBrightness > 0
                        ? `+${pageBrightness}`
                        : pageBrightness}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.min(60, pageBrightness + 10);
                        setPageBrightness(next);
                        setBrightnessSwitchOn(next > 0);
                      }}
                      className="px-1.5 py-0.5 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] text-xs font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  {isApplyingFilter ? (
                    <span className="text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] animate-pulse whitespace-nowrap">
                      Applying to all {pages.length} pages (
                      {Object.keys(filteredPageUrls).length}/{pages.length})...
                    </span>
                  ) : (
                    pageColorFilter !== 'original' && (
                      <span className="px-2 py-0.5 rounded-full bg-[#15803D]/15 text-[#15803D] dark:text-[#4ADE80] text-[10px] font-bold whitespace-nowrap">
                        ✓ Applied to All {pages.length} Pages
                      </span>
                    )
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 4. WATERMARK & PAGES PANEL */}
            {bottomPanelTab === 'watermark' && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-2 shrink-0">
                  {/* 1-Tap Smart Color-Preserving Watermark Remover */}
                  <button
                    type="button"
                    onClick={() => {
                      const next =
                        pageColorFilter === 'clean-watermark'
                          ? 'original'
                          : 'clean-watermark';
                      setPageColorFilter(next);
                      if (next === 'clean-watermark') {
                        if (watermarkText) setWatermarkText('');
                        setStatusMessage(
                          `Smart Watermark Remover enabled across all ${pages.length} pages: Watermarks removed while preserving document words, font quality & original colors.`
                        );
                      } else {
                        setStatusMessage('Restored original PDF page state.');
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap border ${
                      pageColorFilter === 'clean-watermark'
                        ? 'bg-[#15803D] text-white border-[#15803D]'
                        : 'bg-white dark:bg-[#16111F] text-[#14101B] dark:text-[#F4F1F8] border-[#E4DFEC] dark:border-[#261F33]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {pageColorFilter === 'clean-watermark'
                        ? 'Watermark Removed (Keep Color: ON)'
                        : 'Remove Watermark (Keep Color & Words)'}
                    </span>
                  </button>

                  {/* Optional OCV BLACK Mode Toggle for Monochrome Scans */}
                  <button
                    type="button"
                    onClick={() => {
                      const next =
                        pageColorFilter === 'ocv-black'
                          ? 'original'
                          : 'ocv-black';
                      setPageColorFilter(next);
                      if (next === 'ocv-black') {
                        if (watermarkText) setWatermarkText('');
                        setStatusMessage(
                          `OCV BLACK enabled across all ${pages.length} pages: Background watermarks & solid banners removed.`
                        );
                      } else {
                        setStatusMessage('Restored original PDF page colors.');
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap border ${
                      pageColorFilter === 'ocv-black'
                        ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                        : 'bg-white dark:bg-[#16111F] text-[#6E667D] dark:text-[#A39BB5] border-[#E4DFEC] dark:border-[#261F33]'
                    }`}
                  >
                    <span>
                      {pageColorFilter === 'ocv-black'
                        ? 'OCV B&W: ON'
                        : 'OCV B&W Clean'}
                    </span>
                  </button>

                  {/* 1-Swipe Banner / Stamp Eraser Box Tool */}
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMode('annotate');
                      setActiveTool('whiteout');
                      setStatusMessage(
                        'Swipe/drag a rectangle over any watermark banner (e.g. wazaelimu.com) or stamp on the page to erase it!'
                      );
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap border ${
                      activeTool === 'whiteout'
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white dark:bg-[#16111F] text-[#2563EB] dark:text-[#60A5FA] border-[#2563EB]/40'
                    }`}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Swipe to Erase Banner / Stamp</span>
                  </button>

                  <div className="flex items-center gap-1.5 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-1">
                    <Stamp className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                    <input
                      type="text"
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      placeholder="Watermark text (e.g. CONFIDENTIAL)"
                      className="w-44 text-xs bg-transparent focus:outline-none"
                    />
                    {watermarkText && (
                      <button
                        type="button"
                        onClick={() => setWatermarkText('')}
                        className="text-[10px] text-[#DC2626] font-bold cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={addPageNumbers}
                      onChange={(e) => setAddPageNumbers(e.target.checked)}
                      className="accent-[#4A1D5E]"
                    />
                    <span>Page Numbers</span>
                  </label>

                  {pages.length > 1 && (
                    <div className="flex items-center gap-1 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-1">
                      <button
                        type="button"
                        disabled={currentPage <= 1 || isLoadingPages}
                        onClick={() => handleMovePage(currentPage, -1)}
                        title="Move current page earlier"
                        className="p-1 rounded hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] disabled:opacity-30 cursor-pointer flex items-center gap-0.5 text-xs font-bold text-[#003FE8] dark:text-[#60A5FA]"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                        <span>Move Up</span>
                      </button>
                      <button
                        type="button"
                        disabled={currentPage >= pages.length || isLoadingPages}
                        onClick={() => handleMovePage(currentPage, 1)}
                        title="Move current page later"
                        className="p-1 rounded hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] disabled:opacity-30 cursor-pointer flex items-center gap-0.5 text-xs font-bold text-[#003FE8] dark:text-[#60A5FA]"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                        <span>Move Down</span>
                      </button>
                      <select
                        value={currentPage}
                        disabled={isLoadingPages}
                        onChange={(e) =>
                          handleMovePageToPosition(
                            currentPage,
                            Number(e.target.value)
                          )
                        }
                        aria-label="Move current page to position"
                        className="ml-1 px-1.5 py-0.5 rounded bg-[#F2EFF6] dark:bg-[#261F33] text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] cursor-pointer"
                      >
                        {pages.map((p) => (
                          <option key={p.pageNumber} value={p.pageNumber}>
                            Move to #{p.pageNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRotatePage(currentPage)}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Rotate 90°</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleInsertBlankPageAfter(currentPage)}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <PlusSquare className="w-3.5 h-3.5" />
                    <span>+ Blank Page</span>
                  </button>

                  {pages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeletePage(currentPage)}
                      className="px-2.5 py-1 rounded-lg bg-[#DC2626]/10 text-[#DC2626] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Page {currentPage}</span>
                    </button>
                  )}

                  {/* Quick Page Jumper Pills */}
                  <div className="flex items-center gap-1 pl-1 border-l border-[#E4DFEC] dark:border-[#261F33]">
                    <span className="text-[10px] font-bold text-[#6E667D]">
                      Pages:
                    </span>
                    {pages.map((p) => (
                      <button
                        key={p.pageNumber}
                        type="button"
                        onClick={() => jumpToPage(p.pageNumber)}
                        className={`px-2 py-0.5 rounded text-xs font-mono font-bold cursor-pointer ${
                          p.pageNumber === currentPage
                            ? 'bg-[#4A1D5E] text-white'
                            : 'bg-white dark:bg-[#261F33] border border-[#E4DFEC] dark:border-[#342B47]'
                        }`}
                      >
                        {p.pageNumber}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 5. HIGHLIGHT & MARKUP PANEL */}
            {bottomPanelTab === 'highlight' && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1.5 shrink-0">
                  {(
                    [
                      { id: 'highlight', label: 'Highlight', icon: Highlighter },
                      { id: 'whiteout', label: 'Whiteout', icon: Eraser },
                      { id: 'underline', label: 'Underline', icon: Underline },
                      {
                        id: 'strikethrough',
                        label: 'Strike',
                        icon: Strikethrough,
                      },
                      { id: 'comment', label: 'Comment', icon: MessageSquare },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const active = activeTool === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setWorkspaceMode('annotate');
                          setActiveTool(item.id);
                          setStatusMessage(
                            `Tap on the PDF page to add ${item.label}.`
                          );
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                            : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 6. DOODLE & SHAPES PANEL */}
            {bottomPanelTab === 'doodle' && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1.5 shrink-0">
                  {(
                    [
                      { id: 'draw', label: 'Freehand Doodle', icon: Pencil },
                      { id: 'rectangle', label: 'Rectangle', icon: Square },
                      { id: 'circle', label: 'Circle', icon: Circle },
                      { id: 'arrow', label: 'Arrow', icon: MoveUpRight },
                      { id: 'line', label: 'Line', icon: Minus },
                      { id: 'image', label: 'Insert Image', icon: ImageIcon },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const active = activeTool === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setWorkspaceMode('annotate');
                          if (item.id === 'image') {
                            imageAnnotationInputRef.current?.click();
                          } else {
                            setActiveTool(item.id);
                            setStatusMessage(
                              item.id === 'draw'
                                ? 'Drag directly on the page to draw freehand.'
                                : `Tap on the page to place ${item.label}.`
                            );
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                            : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 7. COPY & SEARCH PANEL */}
            {bottomPanelTab === 'copy' && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-2 shrink-0">
                  {selectedAnnotation && (
                    <button
                      type="button"
                      onClick={duplicateSelectedAnnotation}
                      className="px-2.5 py-1 rounded-lg bg-[#4A1D5E] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                      <span>Duplicate Selected Element</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (activePageInfo?.extractedText) {
                        navigator.clipboard.writeText(
                          activePageInfo.extractedText
                        );
                        setCopiedNativeText(true);
                        setStatusMessage(
                          `Copied Page ${currentPage} text to clipboard.`
                        );
                        setTimeout(() => setCopiedNativeText(false), 2000);
                      } else {
                        setStatusMessage(
                          'No selectable text layer on this page.'
                        );
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {copiedNativeText ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#15803D]" />
                        <span>Copied Page {currentPage} Text!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Page {currentPage} Text</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-1">
                    <Search className="w-3.5 h-3.5 text-[#6E667D]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search text in PDF..."
                      className="w-40 text-xs bg-transparent focus:outline-none"
                    />
                    {searchQuery && (
                      <span className="text-[10px] font-mono font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
                        {matchingPageNumbers.length} match
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 8. MORE PANEL (Watermark, Copy Text, Document Switcher, Open PDF, Full Page/Fit Width, Zoom, Print, Share) */}
            {bottomPanelTab === 'more' && (
              <div className="flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setBottomPanelTab('watermark')}
                    className="px-2.5 py-1 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] text-[#4A1D5E] dark:text-[#D5B3FF] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Stamp className="w-3.5 h-3.5" />
                    <span>Watermark</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBottomPanelTab('copy')}
                    className="px-2.5 py-1 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] text-[#4A1D5E] dark:text-[#D5B3FF] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Text</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => pdfUploadInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Open PDF</span>
                  </button>

                  {/* Full Page vs Fit Width */}
                  <div className="flex items-center p-0.5 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('fit-page');
                        setZoom(1.0);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                        fitMode === 'fit-page' && zoom === 1
                          ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                          : 'text-[#6E667D] dark:text-[#A39BB5]'
                      }`}
                    >
                      Full Page
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('fit-width');
                        setZoom(1.0);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                        fitMode === 'fit-width' && zoom === 1
                          ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                          : 'text-[#6E667D] dark:text-[#A39BB5]'
                      }`}
                    >
                      Fit Width
                    </button>
                  </div>

                  {/* Zoom Controls */}
                  <div className="flex items-center gap-0.5 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-1.5 py-0.5">
                    <button
                      type="button"
                      onClick={() => applyPdfZoom(zoom - 0.2)}
                      className="p-0.5 rounded hover:bg-[#E4DFEC] cursor-pointer"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('fit-page');
                        applyPdfZoom(1.0);
                      }}
                      className="text-[11px] font-mono font-bold px-1 cursor-pointer"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPdfZoom(zoom + 0.2)}
                      className="p-0.5 rounded hover:bg-[#E4DFEC] cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handlePrintPdf}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowHelpGuide(true)}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Help</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setBottomPanelTab('none')}
                  className="p-1 rounded-lg text-[#6E667D] hover:bg-[#E4DFEC]/50 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Bottom Bar: Clean Reader Controls in Reader Mode OR 6-Button Tool Grid in Edit Mode */}
        {isReaderMode ? (
          <div className="h-14 px-3 sm:px-6 flex items-center justify-between gap-2 bg-white dark:bg-[#16111F]">
            {/* Page Navigation */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => jumpToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center disabled:opacity-30 cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-xs font-mono font-bold text-[#14101B] dark:text-[#F4F1F8] whitespace-nowrap">
                Page {currentPage} / {pages.length || 1}
              </span>
              <button
                type="button"
                onClick={() => jumpToPage(currentPage + 1)}
                disabled={currentPage >= pages.length}
                className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center disabled:opacity-30 cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom & Fit Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => applyPdfZoom(zoom - 0.2)}
                className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setFitMode((m) =>
                    m === 'fit-page' ? 'fit-width' : 'fit-page'
                  );
                  applyPdfZoom(1.0);
                }}
                className="h-9 px-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {fitMode === 'fit-page' ? 'Fit Width' : 'Fit Page'}
              </button>
              <button
                type="button"
                onClick={() => applyPdfZoom(zoom + 0.2)}
                className="w-9 h-9 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-center cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Edit Mode: 6-Button Grid that fits 100% of any Phone Screen without horizontal clipping */
          <div className="px-1.5 py-1.5 grid grid-cols-6 items-center gap-1 bg-white dark:bg-[#16111F]">
            {(
              [
                { id: 'text', label: 'Text', icon: Type },
                { id: 'pictures', label: 'Pictures', icon: ImageOff },
                { id: 'filter', label: 'Filter', icon: Sparkles },
                { id: 'doodle', label: 'Draw', icon: Pencil },
                { id: 'highlight', label: 'Highlight', icon: Highlighter },
                { id: 'more', label: 'More', icon: MoreVertical },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isActive =
                bottomPanelTab === item.id ||
                (item.id === 'more' &&
                  (bottomPanelTab === 'watermark' ||
                    bottomPanelTab === 'copy'));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    const nextTab = bottomPanelTab === item.id ? 'none' : item.id;
                    setBottomPanelTab(nextTab);
                    if (item.id === 'text' && bottomPanelTab !== 'text') {
                      setWorkspaceMode('annotate');
                      const hasTextOnPage = annotations.some(
                        (a) => a.pageNumber === currentPage && a.type === 'text'
                      );
                      if (!hasTextOnPage) {
                        handleQuickAddDefaultTextBox(currentPage);
                      } else {
                        setActiveTool('select');
                      }
                    } else if (
                      item.id === 'pictures' &&
                      bottomPanelTab !== 'pictures'
                    ) {
                      setWorkspaceMode('content-edit');
                      setActiveTool('select');
                    } else if (
                      item.id === 'doodle' &&
                      bottomPanelTab !== 'doodle'
                    ) {
                      setWorkspaceMode('annotate');
                      setActiveTool('draw');
                    } else if (
                      item.id === 'highlight' &&
                      bottomPanelTab !== 'highlight'
                    ) {
                      setWorkspaceMode('annotate');
                      setActiveTool('highlight');
                    }
                  }}
                  className={`min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer ${
                    isActive
                      ? 'text-[#4A1D5E] dark:text-[#D5B3FF] font-bold bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20'
                      : 'text-[#5A5565] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-5 h-5 mb-0.5 stroke-[1.8] shrink-0" />
                  <span className="text-[11px] leading-tight truncate max-w-full">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* =====================================================================
          SAVE DOCUMENT BOTTOM SHEET (Matches Reference Screenshot 1)
         ===================================================================== */}
      {showSaveModal && !showCompressModal && (
        <div
          onClick={() => setShowSaveModal(false)}
          className="fixed inset-0 z-50 bg-black/50 flex flex-col justify-end"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl mx-auto bg-white dark:bg-[#16111F] rounded-t-3xl shadow-2xl border-t border-[#E4DFEC] dark:border-[#261F33] overflow-y-auto max-h-[90dvh] text-[#14101B] dark:text-[#F4F1F8] animate-in slide-in-from-bottom duration-200"
          >
            {/* Header: Save Icon + Document Name + Files & Size + Rename Button */}
            <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3 border-b border-neutral-200/80 dark:border-[#261F33]">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center shrink-0">
                  <Save className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  {isRenamingInSaveModal ? (
                    <input
                      type="text"
                      autoFocus
                      value={saveDocName}
                      onChange={(e) => setSaveDocName(e.target.value)}
                      onBlur={() => setIsRenamingInSaveModal(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setIsRenamingInSaveModal(false);
                      }}
                      className="w-full text-sm sm:text-base font-semibold bg-[#F2EFF6] dark:bg-[#261F33] px-2.5 py-1 rounded-lg focus:outline-none border border-[#2563EB]"
                    />
                  ) : (
                    <h3 className="text-sm sm:text-base font-semibold text-[#3A3545] dark:text-[#F4F1F8] truncate">
                      {saveDocName || activeDocument.name}
                    </h3>
                  )}
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-0.5 font-medium flex flex-wrap items-center gap-1.5">
                    <span>
                      {pages.length} {pages.length === 1 ? 'File' : 'Files'}
                    </span>
                    <span className="text-neutral-300 dark:text-neutral-600">
                      |
                    </span>
                    <span>
                      {isCompressingPreview
                        ? 'Calculating size...'
                        : formatFileSize(
                            (
                              compressedPreviewBytes ||
                              preparedBaseBytes ||
                              workingPdfBytes
                            )?.byteLength || activeDocument.sizeBytes
                          )}
                    </span>
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-[#15803D]/15 text-[#15803D] dark:text-[#4ADE80] text-[10px] font-bold">
                      ✓ Saved in My Documents
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRenamingInSaveModal((v) => !v)}
                title="Rename document before saving"
                className="p-2 rounded-lg text-[#2563EB] hover:bg-[#2563EB]/10 transition-colors cursor-pointer shrink-0"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>

            {/* Row 1: Save as PDF / IMAGE (JPG) */}
            <div className="px-5 py-3.5 flex items-center justify-between border-b border-neutral-200/70 dark:border-[#261F33]">
              <span className="text-sm font-medium text-[#221E29] dark:text-[#F4F1F8]">
                {saveFormat === 'pdf' ? 'Save as PDF' : 'Save as Image'}
              </span>
              <div className="inline-flex rounded-md border border-neutral-300 dark:border-[#342B47] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSaveFormat('pdf')}
                  className={`px-5 py-1.5 text-xs font-bold tracking-wide transition-colors cursor-pointer ${
                    saveFormat === 'pdf'
                      ? 'bg-[#DCE6EE] dark:bg-[#2563EB]/30 text-[#1E3A5F] dark:text-white border-r border-[#1E3A5F]/40'
                      : 'bg-white dark:bg-[#16111F] text-[#6E667D] dark:text-[#A39BB5]'
                  }`}
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setSaveFormat('jpg')}
                  className={`px-4 py-1.5 text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
                    saveFormat === 'jpg'
                      ? 'bg-[#DCE6EE] dark:bg-[#2563EB]/30 text-[#1E3A5F] dark:text-white'
                      : 'bg-white dark:bg-[#16111F] text-[#6E667D] dark:text-[#A39BB5]'
                  }`}
                >
                  IMAGE<span className="text-[10px] ml-0.5">(JPG)</span>
                </button>
              </div>
            </div>

            {/* Row 2: Enable Password Protection */}
            <div className="px-5 py-3 border-b border-neutral-200/70 dark:border-[#261F33] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#221E29] dark:text-[#F4F1F8]">
                  Enable Password Protection
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enablePasswordProtection}
                  onClick={() => setEnablePasswordProtection((v) => !v)}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                    enablePasswordProtection
                      ? 'bg-[#2563EB]'
                      : 'bg-neutral-300 dark:bg-neutral-700'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      enablePasswordProtection
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {enablePasswordProtection && (
                <input
                  type="password"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="Enter password to protect document..."
                  className="w-full px-3 py-1.5 rounded-lg text-xs bg-[#F2EFF6] dark:bg-[#261F33] border border-[#E4DFEC] dark:border-[#342B47] focus:outline-none focus:border-[#2563EB]"
                />
              )}
            </div>

            {/* Row 3: Searchable PDF with OCR Text */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-neutral-200/70 dark:border-[#261F33]">
              <span className="text-sm font-medium text-[#221E29] dark:text-[#F4F1F8]">
                Searchable PDF with OCR Text
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={searchableOcrPdf}
                onClick={() => setSearchableOcrPdf((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                  searchableOcrPdf
                    ? 'bg-[#2563EB]'
                    : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    searchableOcrPdf ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Row 4: Create Long Image */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-neutral-200/70 dark:border-[#261F33]">
              <span
                className={`text-sm font-medium ${
                  createLongImage
                    ? 'text-[#221E29] dark:text-[#F4F1F8]'
                    : 'text-[#8C859B] dark:text-[#A39BB5]'
                }`}
              >
                Create Long Image
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={createLongImage}
                onClick={() => {
                  const next = !createLongImage;
                  setCreateLongImage(next);
                  if (next) setSaveFormat('jpg');
                }}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                  createLongImage
                    ? 'bg-[#2563EB]'
                    : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    createLongImage ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Row 5: Create ZIP File */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-neutral-200/70 dark:border-[#261F33]">
              <span className="text-sm font-medium text-[#221E29] dark:text-[#F4F1F8]">
                Create ZIP File
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={createZipFile}
                onClick={() => setCreateZipFile((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                  createZipFile
                    ? 'bg-[#2563EB]'
                    : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    createZipFile ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Row 6: PDF Page Size: A4 */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-neutral-200/70 dark:border-[#261F33]">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[#221E29] dark:text-[#F4F1F8]">
                  PDF Page Size:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const sizes: ('A4' | 'Letter' | 'Legal' | 'Fit')[] = [
                      'A4',
                      'Letter',
                      'Legal',
                      'Fit',
                    ];
                    const next =
                      sizes[(sizes.indexOf(pdfPageSize) + 1) % sizes.length];
                    setPdfPageSize(next);
                  }}
                  className="text-sm font-bold text-[#0284C7] dark:text-[#38BDF8] hover:underline cursor-pointer"
                >
                  {pdfPageSize}
                </button>
              </div>
              <div className="flex items-center gap-1">
                {(['A4', 'Letter', 'Legal', 'Fit'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setPdfPageSize(sz)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
                      pdfPageSize === sz
                        ? 'bg-[#0284C7] text-white'
                        : 'text-[#6E667D] hover:bg-neutral-100 dark:hover:bg-[#261F33]'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 7: Size X.XX MB - Compress Now (Opens Compress Sheet) */}
            <div className="px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap text-sm">
                <span className="text-[#6E667D] dark:text-[#A39BB5] font-medium">
                  Size{' '}
                  {isCompressingPreview
                    ? 'Compressing...'
                    : formatFileSize(
                        (
                          compressedPreviewBytes ||
                          preparedBaseBytes ||
                          workingPdfBytes
                        )?.byteLength || activeDocument.sizeBytes
                      )}{' '}
                  -
                </span>
                <button
                  type="button"
                  onClick={() => setShowCompressModal(true)}
                  className="text-[#0284C7] dark:text-[#38BDF8] font-semibold underline cursor-pointer hover:opacity-85"
                >
                  Compress Now
                </button>
                {(compressionQuality !== 'high' || highCompression) && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-[#15803D]/15 text-[#15803D] dark:text-[#4ADE80] text-[11px] font-bold">
                    {preparedBaseBytes && compressedPreviewBytes
                      ? `${formatFileSize(preparedBaseBytes.byteLength)} → ${formatFileSize(compressedPreviewBytes.byteLength)} (${compressionQuality.toUpperCase()})`
                      : `Quality: ${compressionQuality.toUpperCase()}${highCompression ? ' + High Compression' : ''}`}
                  </span>
                )}
              </div>
            </div>

            {/* Divider with "Save File to" */}
            <div className="px-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-neutral-200 dark:bg-[#261F33]" />
              <span className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
                Save File to
              </span>
              <div className="h-px flex-1 bg-neutral-200 dark:bg-[#261F33]" />
            </div>

            {/* 5 Circular Action Destinations matching Reference Screenshot 1 */}
            <div className="px-5 pt-4 pb-6 grid grid-cols-3 gap-y-5 gap-x-2 text-center">
              <button
                type="button"
                onClick={() => handleExecuteSaveDestination('phone')}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full border border-neutral-200 dark:border-[#261F33] flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform bg-white dark:bg-[#1E172B]">
                  <Smartphone className="w-5 h-5 text-[#DC2626]" />
                </div>
                <span className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-tight">
                  Save to Phone Storage
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteSaveDestination('documents')}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full border border-neutral-200 dark:border-[#261F33] flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform bg-white dark:bg-[#1E172B]">
                  <Folder className="w-5 h-5 text-[#16A34A] fill-[#16A34A]" />
                </div>
                <span className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-tight">
                  Save to My Documents
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteSaveDestination('cloud')}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full border border-neutral-200 dark:border-[#261F33] flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform bg-white dark:bg-[#1E172B]">
                  <CloudUpload className="w-5 h-5 text-[#0284C7]" />
                </div>
                <span className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-tight">
                  Save to Cloud
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteSaveDestination('gdrive')}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full border border-neutral-200 dark:border-[#261F33] flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform bg-white dark:bg-[#1E172B]">
                  <HardDrive className="w-5 h-5 text-[#F59E0B]" />
                </div>
                <span className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-tight">
                  Save to Google Drive
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteSaveDestination('email')}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full border border-neutral-200 dark:border-[#261F33] flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform bg-white dark:bg-[#1E172B]">
                  <Mail className="w-5 h-5 text-[#EA4335]" />
                </div>
                <span className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-tight">
                  Send to Email
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          COMPRESS BOTTOM SHEET (Matches Reference Screenshot 2)
         ===================================================================== */}
      {showCompressModal && (
        <div
          onClick={() => setShowCompressModal(false)}
          className="fixed inset-0 z-50 bg-black/35 flex flex-col justify-end"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl mx-auto bg-white dark:bg-[#16111F] rounded-t-3xl shadow-2xl border-t border-[#E4DFEC] dark:border-[#261F33] pb-7 text-[#14101B] dark:text-[#F4F1F8] animate-in slide-in-from-bottom duration-200"
          >
            {/* Header: Compress icon + "Compress" + Close X */}
            <div className="px-5 py-3.5 flex items-center justify-between border-b border-neutral-200/80 dark:border-[#261F33]">
              <div className="flex items-center gap-2.5">
                <Minimize2 className="w-4 h-4 text-[#3A3545] dark:text-[#F4F1F8]" />
                <span className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8]">
                  Compress
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCompressModal(false)}
                className="p-1 rounded-full text-[#6E667D] hover:bg-neutral-100 dark:hover:bg-[#261F33] cursor-pointer"
                title="Apply and return to Save sheet"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Row 1: Size : X.XX MB on left, High Compression toggle on right */}
            <div className="px-5 py-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm sm:text-base font-medium text-[#6E667D] dark:text-[#A39BB5]">
                  Size :{' '}
                  <strong className="font-semibold text-[#3A3545] dark:text-[#F4F1F8]">
                    {isCompressingPreview
                      ? 'Compressing...'
                      : preparedBaseBytes &&
                          compressedPreviewBytes &&
                          (compressionQuality !== 'high' || highCompression)
                        ? `${formatFileSize(preparedBaseBytes.byteLength)} → ${formatFileSize(compressedPreviewBytes.byteLength)}`
                        : formatFileSize(
                            (
                              compressedPreviewBytes ||
                              preparedBaseBytes ||
                              workingPdfBytes
                            )?.byteLength || activeDocument.sizeBytes
                          )}
                  </strong>
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-sm font-medium text-[#6E667D] dark:text-[#A39BB5]">
                  High Compression
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={highCompression}
                  onClick={() => setHighCompression((v) => !v)}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                    highCompression
                      ? 'bg-[#0284C7]'
                      : 'bg-neutral-300 dark:bg-neutral-700'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      highCompression ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Row 2: Document Quality (Low / Medium / Good / High) + Multi-Stop Slider */}
            <div className="px-5 pt-2 pb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-[#14101B] dark:text-[#F4F1F8]">
                  Document Quality
                </span>
                <span className="text-sm font-semibold text-[#0284C7] dark:text-[#38BDF8] capitalize min-w-[54px]">
                  {compressionQuality}
                </span>
              </div>

              {/* Interactive 4-Stop Quality Slider matching Screenshot 2 */}
              <div className="flex-1 max-w-xs relative flex items-center py-2">
                <div className="w-full h-1 bg-[#1E3A4C] dark:bg-[#38BDF8]/50 rounded-full relative flex items-center justify-between">
                  {(
                    ['low', 'medium', 'good', 'high'] as SaveCompressionQuality[]
                  ).map((q) => {
                    const isSelected = compressionQuality === q;
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setCompressionQuality(q)}
                        title={`Set Document Quality to ${q.toUpperCase()}`}
                        className={`rounded-full transition-all cursor-pointer flex items-center justify-center ${
                          isSelected
                            ? 'w-6 h-6 bg-[#1E3A4C] dark:bg-[#38BDF8] shadow-md scale-110'
                            : 'w-3.5 h-3.5 bg-white dark:bg-[#16111F] border-2 border-neutral-300 dark:border-neutral-500 hover:border-[#0284C7]'
                        }`}
                      >
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-white dark:bg-[#0D0A12]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick Quality Labels & Apply Button */}
            <div className="px-5 pt-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'low', label: 'Low (Smallest)' },
                    { id: 'medium', label: 'Medium' },
                    { id: 'good', label: 'Good' },
                    { id: 'high', label: 'High' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCompressionQuality(item.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      compressionQuality === item.id
                        ? 'bg-[#0284C7] text-white'
                        : 'bg-[#F2EFF6] dark:bg-[#261F33] text-[#6E667D] dark:text-[#A39BB5]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowCompressModal(false);
                  setShowSaveModal(true);
                }}
                className="px-4 py-1.5 rounded-lg bg-[#1E3A4C] hover:bg-[#162B38] text-white text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
