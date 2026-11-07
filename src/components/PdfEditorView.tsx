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
} from 'lucide-react';
import {
  StoredDocument,
  AnnotationElement,
  AnnotationType,
  NativeTextBlock,
} from '../types/document';
import {
  renderAllPdfPages,
  RenderedPageInfo,
  bakeAnnotationsIntoPdf,
  organizePdfPages,
  extractPdfPages,
  downloadBytesAsFile,
  getEmbeddedPdfImagesOnPage,
  cropRegionFromDataUrl,
  EmbeddedPdfImageInfo,
} from '../services/pdfService';

interface PdfEditorViewProps {
  activeDocument: StoredDocument | null;
  allDocuments: StoredDocument[];
  initialReaderMode?: boolean;
  onSelectDocument: (doc: StoredDocument) => void;
  onUploadNewPdf: (files: FileList | File[]) => Promise<void>;
  onSaveUpdatedDocument: (doc: StoredDocument) => Promise<void>;
}

type WorkspaceMode = 'content-edit' | 'annotate' | 'reader';
type EditorTool = 'select' | 'select-picture' | AnnotationType;

const TOOL_BUTTONS: {
  id: EditorTool;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'select', label: 'Select / Move', icon: MousePointer },
  { id: 'select-picture', label: 'Select Picture / Box', icon: ImageOff },
  { id: 'text', label: 'Add Text', icon: Type },
  { id: 'image', label: 'Add Image', icon: ImageIcon },
  { id: 'draw', label: 'Freehand Draw', icon: Pencil },
  { id: 'whiteout', label: 'Whiteout', icon: Eraser },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikethrough', label: 'Strike', icon: Strikethrough },
  { id: 'comment', label: 'Comment', icon: MessageSquare },
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'arrow', label: 'Arrow', icon: MoveUpRight },
  { id: 'line', label: 'Line', icon: Minus },
];

export const PdfEditorView: React.FC<PdfEditorViewProps> = ({
  activeDocument,
  allDocuments,
  initialReaderMode = false,
  onSelectDocument,
  onUploadNewPdf,
  onSaveUpdatedDocument,
}) => {
  // iLovePDF-inspired 3 modes: 'content-edit' (Edit existing PDF text & pictures), 'annotate' (Add elements/markup), 'reader' (Clean viewer)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    initialReaderMode ? 'reader' : 'content-edit'
  );
  const isReaderMode = workspaceMode === 'reader';

  // Continuous vertical multi-page scroll (default, like iLovePDF) vs Single Page view
  const [viewAllPagesVertically, setViewAllPagesVertically] = useState(true);

  const [pages, setPages] = useState<RenderedPageInfo[]>([]);
  const [totalExpectedPages, setTotalExpectedPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [workingPdfBytes, setWorkingPdfBytes] = useState<Uint8Array | null>(
    null
  );

  // Annotations & Undo/Redo History
  const [annotations, setAnnotations] = useState<AnnotationElement[]>([]);
  const [undoStack, setUndoStack] = useState<AnnotationElement[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationElement[][]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');

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

  // Dragging / Resizing annotation on page overlay
  const [dragState, setDragState] = useState<{
    id: string;
    pageNumber: number;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const pageOverlayRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pageWrapperRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const pdfUploadInputRef = useRef<HTMLInputElement>(null);
  const imageAnnotationInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWorkspaceMode(initialReaderMode ? 'reader' : 'content-edit');
  }, [initialReaderMode]);

  const inspectAllEmbeddedImages = useCallback(
    async (pdfBytes: Uint8Array, pageCount: number) => {
      const map: Record<number, EmbeddedPdfImageInfo[]> = {};
      for (let p = 1; p <= pageCount; p++) {
        const imgs = await getEmbeddedPdfImagesOnPage(pdfBytes, p);
        map[p] = imgs;
      }
      setEmbeddedImagesByPage(map);
    },
    []
  );

  const renderAllPages = useCallback(
    async (pdfBytes: Uint8Array) => {
      setIsLoadingPages(true);
      try {
        const allRendered = await renderAllPdfPages(
          pdfBytes,
          1.5,
          (renderedSoFar, total) => {
            setTotalExpectedPages(total);
            setPages(renderedSoFar);
            if (renderedSoFar.length >= 1) {
              setIsLoadingPages(false);
            }
          }
        );
        setPages(allRendered);
        setTotalExpectedPages(allRendered.length);
        setCurrentPage((prev) =>
          Math.max(1, Math.min(prev, allRendered.length || 1))
        );
        await inspectAllEmbeddedImages(pdfBytes, allRendered.length);
      } catch (err) {
        console.error('Failed to render PDF:', err);
        setStatusMessage(
          'Could not render this PDF file. It may be corrupted or unsupported.'
        );
      } finally {
        setIsLoadingPages(false);
      }
    },
    [inspectAllEmbeddedImages]
  );

  useEffect(() => {
    if (activeDocument) {
      const sourceBytes = activeDocument.basePdfData || activeDocument.pdfData;
      const cloned = new Uint8Array(sourceBytes);
      setWorkingPdfBytes(cloned);
      setAnnotations(activeDocument.annotations || []);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedAnnId(null);
      setSelectedEmbedded(null);
      setSelectedPictureRegion(null);
      setCurrentPage(1);
      setTotalExpectedPages(activeDocument.pageCount || 1);
      renderAllPages(cloned);
    }
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

  const pushAnnotationsWithUndo = useCallback(
    (next: AnnotationElement[]) => {
      setUndoStack((prev) => [...prev, annotations]);
      setRedoStack([]);
      setAnnotations(next);
    },
    [annotations]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setUndoStack((u) => u.slice(0, -1));
    setAnnotations(prev);
    setSelectedAnnId(null);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setStatusMessage('Undid last change and restored previous state.');
  }, [undoStack, annotations]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, annotations]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next);
    setSelectedAnnId(null);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setStatusMessage('Redid change.');
  }, [redoStack, annotations]);

  // Convert an existing Native PDF Text Block into an editable/movable/deletable Text Annotation (iLovePDF Content Edit style)
  const handleSelectNativeTextBlock = (block: NativeTextBlock) => {
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
      backgroundColor: '#FFFFFF',
      color: '#14101B',
      opacity: 1,
      replacesNativeTextId: block.id,
      origRect: {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
      },
      createdAt: new Date().toISOString(),
    };

    pushAnnotationsWithUndo([...annotations, newAnn]);
    setSelectedAnnId(newId);
    setSelectedEmbedded(null);
    setSelectedPictureRegion(null);
    setStatusMessage(
      `Selected PDF text on Page ${block.pageNumber}. Edit inline, drag to move, or click Delete to remove from PDF.`
    );
  };

  // Delete an existing Native PDF Text Block completely (masks its original footprint with whiteout)
  const handleDeleteNativeTextBlock = (ann: AnnotationElement) => {
    if (ann.origRect) {
      const maskAnn: AnnotationElement = {
        id: `mask-txt-${Date.now()}`,
        pageNumber: ann.pageNumber,
        type: 'whiteout',
        x: ann.origRect.x,
        y: ann.origRect.y,
        width: ann.origRect.width,
        height: ann.origRect.height,
        color: '#FFFFFF',
        opacity: 1,
        replacesNativeTextId: ann.replacesNativeTextId,
        origRect: ann.origRect,
      };
      pushAnnotationsWithUndo(
        annotations.map((a) => (a.id === ann.id ? maskAnn : a))
      );
      setSelectedAnnId(null);
      setStatusMessage(
        'Removed original text block from page. Click Save PDF to update file.'
      );
    } else {
      pushAnnotationsWithUndo(annotations.filter((a) => a.id !== ann.id));
      setSelectedAnnId(null);
    }
  };

  // Unlock an embedded PDF image/box into a movable/resizable image layer (non-destructively with Undo support)
  const handleUnlockEmbeddedImageToMoveOrResize = async (
    pageNumber: number,
    emb: EmbeddedPdfImageInfo
  ) => {
    const targetPage = pages[pageNumber - 1];
    if (!targetPage) return;

    setIsLoadingPages(true);
    try {
      const croppedDataUrl = await cropRegionFromDataUrl(targetPage.dataUrl, {
        x: emb.x,
        y: emb.y,
        width: emb.normWidth,
        height: emb.normHeight,
      });

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
        origRect: {
          x: emb.x,
          y: emb.y,
          width: emb.normWidth,
          height: emb.normHeight,
        },
        createdAt: new Date().toISOString(),
      };

      pushAnnotationsWithUndo([...annotations, newAnn]);
      setSelectedEmbedded(null);
      setSelectedAnnId(newId);
      setCurrentPage(pageNumber);
      setStatusMessage(
        `Unlocked "${emb.label || 'Picture'}" on Page ${pageNumber}. Drag to move, resize corners, or click Undo to revert.`
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
      defaultText = 'Type text here';
      defaultW = 0.3;
      defaultH = 0.05;
      defaultColor = '#14101B';
    } else if (activeTool === 'comment') {
      defaultText = 'Review comment note';
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
      fontSize: 14,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: defaultColor,
      strokeWidth: 2,
      opacity: 1,
      createdAt: new Date().toISOString(),
    };

    pushAnnotationsWithUndo([...annotations, newAnn]);
    setSelectedAnnId(newId);
    setActiveTool('select');
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

    if (activeTool === 'select-picture' && e.target === overlayEl) {
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
      const width = Math.max(0.02, Math.abs(cx - regionDragStart.x));
      const height = Math.max(0.02, Math.abs(cy - regionDragStart.y));
      setSelectedPictureRegion({ pageNumber, x, y, width, height });
      return;
    }

    if (!dragState || dragState.pageNumber !== pageNumber) return;
    const dx = (e.clientX - dragState.startX) / rect.width;
    const dy = (e.clientY - dragState.startY) / rect.height;

    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== dragState.id) return a;
        if (dragState.mode === 'move') {
          const nx = Math.max(0, Math.min(1 - a.width, dragState.origX + dx));
          const ny = Math.max(0, Math.min(1 - a.height, dragState.origY + dy));
          return {
            ...a,
            x: nx,
            y: ny,
            endX: nx + a.width,
            endY: ny + a.height,
          };
        } else {
          const nw = Math.max(0.03, Math.min(1 - a.x, dragState.origW + dx));
          const nh = Math.max(0.02, Math.min(1 - a.y, dragState.origH + dy));
          return {
            ...a,
            width: nw,
            height: nh,
            endX: a.x + nw,
            endY: a.y + nh,
          };
        }
      })
    );
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
    setActiveDrawStroke(null);
    setDragState(null);
    setRegionDragStart(null);
  };

  const updateSelectedAnnotation = (updates: Partial<AnnotationElement>) => {
    if (!selectedAnnId) return;
    pushAnnotationsWithUndo(
      annotations.map((a) => (a.id === selectedAnnId ? { ...a, ...updates } : a))
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
      `Removed selected ${itemTypeLabel} from Page ${target.pageNumber}. Click Undo if you removed the wrong item.`
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

  const handleRemoveSelectedPictureRegion = useCallback(() => {
    if (!selectedPictureRegion) return;
    const eraseAnn: AnnotationElement = {
      id: `erase-pic-${Date.now()}`,
      pageNumber: selectedPictureRegion.pageNumber,
      type: 'whiteout',
      x: selectedPictureRegion.x,
      y: selectedPictureRegion.y,
      width: selectedPictureRegion.width,
      height: selectedPictureRegion.height,
      color: '#FFFFFF',
      opacity: 1,
      replacesNativeTextId: `region-${Date.now()}`,
      origRect: {
        x: selectedPictureRegion.x,
        y: selectedPictureRegion.y,
        width: selectedPictureRegion.width,
        height: selectedPictureRegion.height,
      },
      createdAt: new Date().toISOString(),
    };
    pushAnnotationsWithUndo([...annotations, eraseAnn]);
    const pageNum = selectedPictureRegion.pageNumber;
    setSelectedPictureRegion(null);
    setActiveTool('select');
    setStatusMessage(
      `Removed selected area on Page ${pageNum}. Click Undo if you removed the wrong area.`
    );
  }, [selectedPictureRegion, annotations, pushAnnotationsWithUndo]);

  // Page Structural Operations (Rotate, Delete, Insert Blank, Reorder, Extract)
  const handleRotatePage = async (pageNum: number) => {
    if (!workingPdfBytes) return;
    const specs = pages.map((p) => ({
      sourcePageNumber: p.pageNumber,
      addRotationDeg: p.pageNumber === pageNum ? 90 : 0,
    }));
    const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
    setWorkingPdfBytes(updatedBytes);
    await renderAllPages(updatedBytes);
    setStatusMessage(`Rotated Page ${pageNum} by 90°.`);
  };

  const handleDeletePage = async (pageNum: number) => {
    if (!workingPdfBytes || pages.length <= 1) {
      setStatusMessage('A PDF document must contain at least one page.');
      return;
    }
    const specs = pages
      .filter((p) => p.pageNumber !== pageNum)
      .map((p) => ({ sourcePageNumber: p.pageNumber }));
    const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
    setWorkingPdfBytes(updatedBytes);
    setAnnotations((prev) =>
      prev
        .filter((a) => a.pageNumber !== pageNum)
        .map((a) =>
          a.pageNumber > pageNum ? { ...a, pageNumber: a.pageNumber - 1 } : a
        )
    );
    await renderAllPages(updatedBytes);
    setStatusMessage(`Deleted Page ${pageNum}.`);
  };

  const handleInsertBlankPageAfter = async (pageNum: number) => {
    if (!workingPdfBytes) return;
    const specs: { sourcePageNumber?: number; isBlank?: boolean }[] = [];
    for (const p of pages) {
      specs.push({ sourcePageNumber: p.pageNumber });
      if (p.pageNumber === pageNum) {
        specs.push({ isBlank: true });
      }
    }
    const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
    setWorkingPdfBytes(updatedBytes);
    setAnnotations((prev) =>
      prev.map((a) =>
        a.pageNumber > pageNum ? { ...a, pageNumber: a.pageNumber + 1 } : a
      )
    );
    await renderAllPages(updatedBytes);
    jumpToPage(pageNum + 1);
    setStatusMessage(`Inserted blank A4 page after Page ${pageNum}.`);
  };

  const handleMovePage = async (pageNum: number, dir: -1 | 1) => {
    if (!workingPdfBytes) return;
    const target = pageNum + dir;
    if (target < 1 || target > pages.length) return;
    const order = pages.map((p) => p.pageNumber);
    const idxA = pageNum - 1;
    const idxB = target - 1;
    [order[idxA], order[idxB]] = [order[idxB], order[idxA]];
    const specs = order.map((num) => ({ sourcePageNumber: num }));
    const updatedBytes = await organizePdfPages(workingPdfBytes, specs);
    setWorkingPdfBytes(updatedBytes);
    await renderAllPages(updatedBytes);
    jumpToPage(target);
  };

  const handleExtractSinglePage = async (pageNum: number) => {
    if (!workingPdfBytes || !activeDocument) return;
    const extracted = await extractPdfPages(workingPdfBytes, [pageNum]);
    const baseName = activeDocument.name.replace(/\.pdf$/i, '');
    downloadBytesAsFile(extracted, `${baseName}_Page_${pageNum}.pdf`);
    setStatusMessage(`Extracted and downloaded Page ${pageNum}.`);
  };

  // Removes ONLY the specific selected embedded picture or box at its exact bounding box, with full Undo support
  const handleRemoveEmbeddedPdfImage = useCallback(
    (pageNumber: number, targetKey: string) => {
      const pageItems = embeddedImagesByPage[pageNumber] || [];
      const targetItem = pageItems.find((item) => item.key === targetKey);
      if (!targetItem) {
        setStatusMessage('Please select a picture or box on the page first.');
        return;
      }

      const maskAnn: AnnotationElement = {
        id: `remove-emb-${Date.now()}`,
        pageNumber,
        type: 'whiteout',
        x: targetItem.x,
        y: targetItem.y,
        width: targetItem.normWidth,
        height: targetItem.normHeight,
        color: '#FFFFFF',
        opacity: 1,
        text: targetItem.label || 'Removed Picture',
        replacesNativeTextId: targetItem.key,
        origRect: {
          x: targetItem.x,
          y: targetItem.y,
          width: targetItem.normWidth,
          height: targetItem.normHeight,
        },
        createdAt: new Date().toISOString(),
      };

      pushAnnotationsWithUndo([...annotations, maskAnn]);
      setSelectedEmbedded(null);
      setSelectedAnnId(null);
      setStatusMessage(
        `Removed "${targetItem.label || 'Selected Picture'}" from Page ${pageNumber}. Click Undo if you removed the wrong picture.`
      );
    },
    [embeddedImagesByPage, annotations, pushAnnotationsWithUndo]
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

  const handleSaveOrDownloadModifiedPdf = async (downloadToo: boolean) => {
    if (!workingPdfBytes || !activeDocument) return;
    setIsLoadingPages(true);
    try {
      const finalBytes = await bakeAnnotationsIntoPdf(
        workingPdfBytes,
        annotations,
        {
          addPageNumbers,
          pageNumberPosition,
          watermarkText,
          watermarkOpacity,
        }
      );

      const updatedDoc: StoredDocument = {
        ...activeDocument,
        sizeBytes: finalBytes.byteLength,
        pageCount: pages.length,
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: finalBytes,
        basePdfData: new Uint8Array(workingPdfBytes),
        annotations,
      };

      await onSaveUpdatedDocument(updatedDoc);

      if (downloadToo) {
        downloadBytesAsFile(finalBytes, updatedDoc.name);
        setStatusMessage(
          `Saved and downloaded "${updatedDoc.name}" (${pages.length} pages).`
        );
      } else {
        setStatusMessage(
          `Saved "${updatedDoc.name}" (${pages.length} pages) to Local Vault.`
        );
      }
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
    const file = new File(
      [new Uint8Array(workingPdfBytes)],
      activeDocument.name,
      {
        type: 'application/pdf',
      }
    );
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: activeDocument.name,
          text: 'Shared from ScanPro Studio',
          files: [file],
        });
        return;
      } catch {
        // Fallback if user cancels
      }
    }
    downloadBytesAsFile(workingPdfBytes, activeDocument.name);
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
      className="h-[calc(100vh-4rem)] flex flex-col bg-[#F2EFF6] dark:bg-[#0D0A12]"
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

      {/* Row 1: Top Studio Bar with iLovePDF-style 3-Mode Switcher */}
      <div className="bg-white dark:bg-[#16111F] border-b border-[#E4DFEC] dark:border-[#261F33] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Document Switcher + 3-Mode Switcher (Edit PDF Content | Annotate & Add | Reader) */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <select
            value={activeDocument.id}
            onChange={(e) => {
              const found = allDocuments.find((d) => d.id === e.target.value);
              if (found) onSelectDocument(found);
            }}
            aria-label="Select active PDF document"
            className="text-xs font-bold bg-[#FAF9FB] dark:bg-[#261F33] border border-[#E4DFEC] dark:border-[#342B47] rounded-lg px-2.5 py-1.5 text-[#14101B] dark:text-[#F4F1F8] max-w-[180px] truncate cursor-pointer"
          >
            {allDocuments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.pageCount}p)
              </option>
            ))}
          </select>

          <button
            onClick={() => pdfUploadInputRef.current?.click()}
            className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-medium hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>Open PDF</span>
          </button>

          {/* iLovePDF-inspired Mode Switcher */}
          <div className="flex items-center p-0.5 bg-[#F2EFF6] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg">
            <button
              onClick={() => {
                setWorkspaceMode('content-edit');
                setActiveTool('select');
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                workspaceMode === 'content-edit'
                  ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                  : 'text-[#6E667D] dark:text-[#A39BB5]'
              }`}
              title="Click existing PDF text or pictures directly on the page to edit, move, or remove them"
            >
              <FileEdit className="w-3.5 h-3.5" />
              <span>Edit PDF Content</span>
            </button>
            <button
              onClick={() => setWorkspaceMode('annotate')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                workspaceMode === 'annotate'
                  ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                  : 'text-[#6E667D] dark:text-[#A39BB5]'
              }`}
              title="Add new text, images, freehand drawings, highlights, and shapes"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Annotate & Add</span>
            </button>
            <button
              onClick={() => {
                setWorkspaceMode('reader');
                setSelectedAnnId(null);
                setSelectedEmbedded(null);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                workspaceMode === 'reader'
                  ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12]'
                  : 'text-[#6E667D] dark:text-[#A39BB5]'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Reader</span>
            </button>
          </div>
        </div>

        {/* Center: Page Nav, All-Pages Scroll Toggle, Zoom & Search */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-1.5 py-1">
            <button
              onClick={() => jumpToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] disabled:opacity-30 cursor-pointer"
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono tabular-nums px-1.5 font-semibold">
              Page {currentPage} / {pages.length || totalExpectedPages || 1}
            </span>
            <button
              onClick={() => jumpToPage(currentPage + 1)}
              disabled={currentPage >= pages.length}
              className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] disabled:opacity-30 cursor-pointer"
              title="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setViewAllPagesVertically((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap hidden md:inline-flex items-center gap-1 ${
              viewAllPagesVertically
                ? 'bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 border-[#4A1D5E] dark:border-[#9D5CE5] text-[#4A1D5E] dark:text-[#D5B3FF]'
                : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5]'
            }`}
            title="Toggle between scrolling all pages vertically or viewing a single page at a time"
          >
            <span>
              {viewAllPagesVertically ? 'All Pages Scroll' : 'Single Page'}
            </span>
          </button>

          <div className="flex items-center gap-1 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-1.5 py-1">
            <button
              onClick={() =>
                setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))
              }
              title="Zoom out"
              className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom(1.0)}
              title="Reset zoom to 100%"
              className="text-xs font-mono tabular-nums px-1.5 hover:underline cursor-pointer"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() =>
                setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))
              }
              title="Zoom in"
              className="p-1 rounded hover:bg-[#E4DFEC] dark:hover:bg-[#261F33] cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative hidden xl:block">
            <Search className="w-3.5 h-3.5 text-[#6E667D] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search text..."
              className="pl-8 pr-2.5 py-1 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] w-36 focus:outline-none focus:border-[#4A1D5E]"
            />
          </div>
        </div>

        {/* Right: Undo/Redo, Print, Share, Save & Download */}
        <div className="flex items-center gap-1.5">
          {!isReaderMode && (
            <>
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                title="Undo last action (Ctrl+Z)"
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  undoStack.length > 0
                    ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF] hover:bg-[#4A1D5E]/20'
                    : 'border-[#E4DFEC] dark:border-[#261F33] opacity-40 cursor-not-allowed'
                }`}
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>
                  Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
                </span>
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                title="Redo action (Ctrl+Y)"
                className="px-2 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1 disabled:opacity-35 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer whitespace-nowrap"
              >
                <Redo2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Redo</span>
              </button>
            </>
          )}

          <button
            onClick={toggleFullscreen}
            title="Fullscreen Viewer"
            className="p-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
          >
            <Maximize className="w-4 h-4" />
          </button>

          <button
            onClick={handlePrintPdf}
            title="Print PDF"
            className="p-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
          >
            <Printer className="w-4 h-4" />
          </button>

          <button
            onClick={handleSharePdf}
            title="Share PDF"
            className="p-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleSaveOrDownloadModifiedPdf(false)}
            className="px-3 py-1.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save PDF</span>
          </button>

          <button
            onClick={() => handleSaveOrDownloadModifiedPdf(true)}
            className="px-3 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Row 2: Tool Palette & Contextual Formatting Bar (iLovePDF style) */}
      {!isReaderMode && (
        <div className="bg-[#FAF9FB] dark:bg-[#110D18] border-b border-[#E4DFEC] dark:border-[#261F33] px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {TOOL_BUTTONS.map((tb) => {
              const Icon = tb.icon;
              const active = activeTool === tb.id;
              return (
                <button
                  key={tb.id}
                  onClick={() => setActiveTool(tb.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-semibold'
                      : 'text-[#6E667D] dark:text-[#A39BB5] hover:bg-[#E4DFEC]/60 dark:hover:bg-[#261F33]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tb.label}</span>
                </button>
              );
            })}
          </div>

          {/* Contextual Formatting Controls when an Element or Picture is Selected */}
          <div className="flex items-center gap-2 ml-auto">
            {selectedAnnotation?.type === 'text' && (
              <div className="flex items-center gap-1.5 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg px-2 py-1">
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
                      : 'hover:bg-[#F2EFF6]'
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
                      : 'hover:bg-[#F2EFF6]'
                  }`}
                  title="Italic"
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  min={8}
                  max={48}
                  value={selectedAnnotation.fontSize || 14}
                  onChange={(e) =>
                    updateSelectedAnnotation({
                      fontSize: Number(e.target.value),
                    })
                  }
                  className="w-12 px-1 py-0.5 text-xs font-mono border border-[#E4DFEC] dark:border-[#261F33] rounded text-center"
                  title="Font Size"
                />
              </div>
            )}

            {(selectedAnnotation?.type === 'image' || selectedEmbeddedObj) && (
              <div className="flex items-center gap-1.5">
                {selectedEmbeddedObj && selectedEmbedded && (
                  <button
                    type="button"
                    onClick={() =>
                      handleUnlockEmbeddedImageToMoveOrResize(
                        selectedEmbedded.pageNumber,
                        selectedEmbeddedObj
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-[#4A1D5E] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Move className="w-3.5 h-3.5" />
                    <span>Move / Resize Picture</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => replaceImageInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Replace className="w-3.5 h-3.5" />
                  <span>Replace Picture</span>
                </button>
              </div>
            )}

            {selectedAnnotation !== null ||
            selectedEmbedded !== null ||
            selectedPictureRegion !== null ? (
              <div className="flex items-center gap-1.5">
                <button
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
                  className="px-3 py-1.5 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {selectedEmbeddedObj
                      ? `Remove Selected ${selectedEmbeddedObj.kind === 'box' ? 'Box' : 'Picture'}`
                      : selectedAnnotation?.type === 'image'
                        ? 'Remove Selected Picture'
                        : selectedAnnotation
                          ? `Remove Selected ${selectedAnnotation.type === 'rectangle' || selectedAnnotation.type === 'circle' || selectedAnnotation.type === 'whiteout' ? 'Box' : 'Element'}`
                          : 'Remove Selected Area'}
                  </span>
                </button>
                {undoStack.length > 0 && (
                  <button
                    onClick={handleUndo}
                    className="px-2.5 py-1.5 rounded-lg border border-[#4A1D5E] dark:border-[#9D5CE5] text-[#4A1D5E] dark:text-[#D5B3FF] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Undo</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {undoStack.length > 0 && (
                  <button
                    onClick={handleUndo}
                    className="px-2.5 py-1.5 rounded-lg bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 border border-[#4A1D5E] dark:border-[#9D5CE5] text-[#4A1D5E] dark:text-[#D5B3FF] text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    title="Undo last removal or edit"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Undo Remove / Edit</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setActiveTool('select-picture');
                    setStatusMessage(
                      'Click any picture or box on the page (or drag a box around any area) to select it first, then click Remove Selected.'
                    );
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTool === 'select-picture'
                      ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                      : 'border-[#E4DFEC] dark:border-[#261F33] text-[#4A1D5E] dark:text-[#D5B3FF] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                  }`}
                >
                  <ImageOff className="w-3.5 h-3.5 shrink-0" />
                  <span>Select Picture / Box to Remove</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Horizontal Page Strip (visible on < sm screens so mobile users see all pages) */}
      <div className="sm:hidden bg-white dark:bg-[#16111F] border-b border-[#E4DFEC] dark:border-[#261F33] px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[11px] font-bold text-[#6E667D] shrink-0">
          Pages ({pages.length}):
        </span>
        {pages.map((p) => (
          <button
            key={p.pageNumber}
            onClick={() => jumpToPage(p.pageNumber)}
            className={`px-2.5 py-1 rounded text-xs font-mono font-bold shrink-0 cursor-pointer ${
              p.pageNumber === currentPage
                ? 'bg-[#4A1D5E] text-white'
                : 'bg-[#F2EFF6] dark:bg-[#261F33] text-[#14101B] dark:text-[#F4F1F8]'
            }`}
          >
            {p.pageNumber}
          </button>
        ))}
        <button
          onClick={() => handleInsertBlankPageAfter(currentPage)}
          className="px-2 py-1 rounded text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] border border-[#E4DFEC] dark:border-[#261F33] shrink-0 cursor-pointer"
        >
          + Blank
        </button>
      </div>

      {statusMessage && (
        <div className="bg-[#4A1D5E] text-white px-4 py-1.5 text-xs flex items-center justify-between gap-3">
          <span>{statusMessage}</span>
          <div className="flex items-center gap-3 shrink-0">
            {undoStack.length > 0 && (
              <button
                onClick={handleUndo}
                className="px-2.5 py-0.5 rounded bg-white text-[#4A1D5E] font-bold flex items-center gap-1 hover:bg-neutral-100 cursor-pointer"
              >
                <Undo2 className="w-3 h-3" />
                <span>Undo</span>
              </button>
            )}
            <button
              onClick={() => setStatusMessage(null)}
              className="underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main 3-Pane Studio Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Thumbnail & Page Management Rail */}
        <aside className="w-48 sm:w-56 shrink-0 bg-white dark:bg-[#16111F] border-r border-[#E4DFEC] dark:border-[#261F33] overflow-y-auto p-3 space-y-3 hidden sm:block">
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
                    src={p.dataUrl}
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

        {/* Center Interactive Multi-Page PDF Canvas Stage */}
        <div className="flex-1 overflow-auto p-4 sm:p-8 flex flex-col items-center gap-8 bg-[#E4DFEC]/50 dark:bg-[#09070D]">
          {isLoadingPages && pages.length === 0 ? (
            <div className="my-auto text-center space-y-2">
              <div className="w-8 h-8 border-2 border-[#4A1D5E] dark:border-[#9D5CE5] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
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

              return (
                <div
                  key={pageNum}
                  ref={(el) => {
                    pageWrapperRefs.current[pageNum] = el;
                  }}
                  onClick={() => setCurrentPage(pageNum)}
                  className="flex flex-col items-center gap-2 shrink-0"
                >
                  {/* Per-Page Header Strip */}
                  <div
                    className={`w-full px-3 py-1.5 rounded-lg border flex items-center justify-between text-xs transition-colors ${
                      isCurrentPage
                        ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] border-[#4A1D5E] dark:border-[#9D5CE5] font-bold shadow-xs'
                        : 'bg-white dark:bg-[#16111F] text-[#6E667D] dark:text-[#A39BB5] border-[#E4DFEC] dark:border-[#261F33]'
                    }`}
                  >
                    <span className="font-mono tabular-nums">
                      Page {pageNum} of {pages.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRotatePage(pageNum);
                        }}
                        title="Rotate this page 90°"
                        className="p-1 rounded hover:bg-black/10 cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInsertBlankPageAfter(pageNum);
                        }}
                        title="Insert blank page after this page"
                        className="p-1 rounded hover:bg-black/10 cursor-pointer"
                      >
                        <PlusSquare className="w-3.5 h-3.5" />
                      </button>
                      {pages.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePage(pageNum);
                          }}
                          title="Delete this page"
                          className="p-1 rounded hover:bg-black/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Interactive Page Canvas */}
                  <div
                    ref={(el) => {
                      pageOverlayRefs.current[pageNum] = el;
                    }}
                    onClick={(e) => handleCanvasClick(e, pageNum)}
                    onPointerDown={(e) => handlePointerDownCanvas(e, pageNum)}
                    onPointerMove={(e) => handlePointerMoveOverlay(e, pageNum)}
                    onPointerUp={handlePointerUpOverlay}
                    style={{
                      width: `${Math.round(pageInfo.width * 0.72 * zoom)}px`,
                      height: `${Math.round(pageInfo.height * 0.72 * zoom)}px`,
                    }}
                    className={`relative bg-white shadow-xl border transition-shadow select-none shrink-0 ${
                      isCurrentPage
                        ? 'border-[#4A1D5E] dark:border-[#9D5CE5] ring-2 ring-[#4A1D5E]/20 dark:ring-[#9D5CE5]/25'
                        : 'border-[#E4DFEC] dark:border-[#261F33]'
                    } ${
                      !isReaderMode && activeTool !== 'select'
                        ? 'cursor-crosshair'
                        : 'cursor-default'
                    }`}
                  >
                    <img
                      src={pageInfo.dataUrl}
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
                            title="Click to edit, move, or delete this PDF text"
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
                          return (
                            <div
                              key={emb.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentPage(pageNum);
                                setSelectedEmbedded({
                                  pageNumber: pageNum,
                                  key: emb.key,
                                });
                                setSelectedAnnId(null);
                                setSelectedPictureRegion(null);
                                setStatusMessage(
                                  `Selected "${itemLabel}" on Page ${pageNum}. Click Remove to delete only this item, or Undo anytime.`
                                );
                              }}
                              style={{
                                left: `${emb.x * 100}%`,
                                top: `${emb.y * 100}%`,
                                width: `${emb.normWidth * 100}%`,
                                height: `${emb.normHeight * 100}%`,
                              }}
                              className={`absolute transition-all cursor-pointer ${
                                isEmbSelected
                                  ? 'ring-2 ring-[#DC2626] bg-[#DC2626]/10 z-30'
                                  : activeTool === 'select-picture' ||
                                      workspaceMode === 'content-edit'
                                    ? 'border-2 border-dashed border-[#4A1D5E]/60 hover:border-[#4A1D5E] hover:bg-[#4A1D5E]/10 z-10'
                                    : 'border border-dashed border-transparent hover:border-[#4A1D5E]/70 hover:bg-[#4A1D5E]/5 z-10'
                              }`}
                            >
                              {(isEmbSelected ||
                                activeTool === 'select-picture' ||
                                workspaceMode === 'content-edit') && (
                                <span
                                  className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold pointer-events-none ${
                                    isEmbSelected
                                      ? 'bg-[#DC2626] text-white'
                                      : 'bg-[#4A1D5E]/90 text-white'
                                  }`}
                                >
                                  {isEmbSelected
                                    ? `Selected: ${itemLabel}`
                                    : `${itemLabel} (Click to Select)`}
                                </span>
                              )}

                              {/* Floating Action Bar when this Embedded Picture or Box is Selected */}
                              {isEmbSelected && (
                                <div className="absolute -top-9 right-0 flex items-center gap-1 z-30">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUnlockEmbeddedImageToMoveOrResize(
                                        pageNum,
                                        emb
                                      );
                                    }}
                                    className="px-2 py-1 rounded bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
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
                                      className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer whitespace-nowrap"
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
                          className="absolute ring-2 ring-[#DC2626] bg-[#DC2626]/10 z-20"
                        >
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold pointer-events-none">
                            Selected Area
                          </span>
                          {!regionDragStart && (
                            <div className="absolute -top-8 right-0 flex items-center gap-1 z-30">
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

                    {/* Live Watermark Preview */}
                    {watermarkText.trim() && (
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
                        ann.type === 'whiteout' &&
                        Boolean(ann.replacesNativeTextId);
                      return (
                        <React.Fragment key={ann.id}>
                          {/* If this annotation modified or moved a native text block or embedded picture, render a white mask over the original position */}
                          {ann.origRect && ann.type !== 'whiteout' && (
                            <div
                              style={{
                                left: `${ann.origRect.x * 100}%`,
                                top: `${ann.origRect.y * 100}%`,
                                width: `${ann.origRect.width * 100}%`,
                                height: `${ann.origRect.height * 100}%`,
                              }}
                              className="absolute bg-white pointer-events-none z-10"
                            />
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
                            onPointerDown={(e) => {
                              if (isReaderMode || isSilentRemovalMask) return;
                              e.stopPropagation();
                              setCurrentPage(pageNum);
                              setSelectedAnnId(ann.id);
                              setSelectedEmbedded(null);
                              setUndoStack((prev) => [...prev, annotations]);
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
                            }}
                            className={`absolute group ${
                              isSilentRemovalMask
                                ? 'pointer-events-none z-10'
                                : isSelected
                                  ? 'ring-2 ring-[#DC2626] z-30 cursor-move'
                                  : !isReaderMode
                                    ? 'cursor-move z-20 hover:ring-1 hover:ring-[#4A1D5E]'
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
                                className="w-full h-full opacity-40"
                              />
                            )}

                            {ann.type === 'underline' && (
                              <div
                                style={{
                                  borderBottomColor: ann.color,
                                  borderBottomWidth: `${ann.strokeWidth || 2}px`,
                                }}
                                className="w-full h-full border-b"
                              />
                            )}

                            {ann.type === 'strikethrough' && (
                              <div className="w-full h-full flex items-center">
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
                                className="w-full h-full"
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
                                className="w-full h-full rounded-full"
                              />
                            )}

                            {(ann.type === 'line' || ann.type === 'arrow') && (
                              <svg
                                className="w-full h-full overflow-visible"
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
                                  color: ann.color,
                                  backgroundColor:
                                    ann.backgroundColor || 'transparent',
                                  fontSize: `${Math.round((ann.fontSize || 13) * 0.72 * zoom)}px`,
                                  fontWeight: ann.fontWeight || 'normal',
                                  fontStyle: ann.fontStyle || 'normal',
                                }}
                                className="w-full h-full leading-snug whitespace-pre-wrap break-words font-sans px-0.5"
                              >
                                {isSelected ? (
                                  <input
                                    type="text"
                                    value={ann.text || ''}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      updateSelectedAnnotation({
                                        text: e.target.value,
                                      })
                                    }
                                    className="w-full h-full bg-white/95 focus:outline-none px-1"
                                  />
                                ) : (
                                  ann.text
                                )}
                              </div>
                            )}

                            {ann.type === 'comment' && (
                              <div className="w-full h-full bg-[#FEF9C3] border border-[#CA8A04] rounded p-1.5 shadow-xs overflow-hidden text-[11px] text-[#422006] leading-tight">
                                <strong className="block text-[10px] uppercase">
                                  Note:
                                </strong>
                                {ann.text}
                              </div>
                            )}

                            {ann.type === 'image' && ann.imageDataUrl && (
                              <img
                                src={ann.imageDataUrl}
                                alt="Inserted annotation"
                                referrerPolicy="no-referrer"
                                draggable={false}
                                className="w-full h-full object-contain"
                              />
                            )}

                            {/* Floating Action Toolbar & Resize Handle when Selected */}
                            {isSelected && (
                              <>
                                <div
                                  onPointerDown={(e) => e.stopPropagation()}
                                  className="absolute -top-8 right-0 flex items-center gap-1 z-30"
                                >
                                  {ann.type === 'image' && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        replaceImageInputRef.current?.click();
                                      }}
                                      className="px-2 py-0.5 rounded bg-neutral-800 text-white text-[10px] font-bold shadow-md flex items-center gap-1 hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
                                    >
                                      <Replace className="w-3 h-3" />
                                      <span>Replace</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      duplicateSelectedAnnotation();
                                    }}
                                    title="Duplicate"
                                    className="p-1 rounded bg-[#4A1D5E] text-white shadow-md hover:bg-[#3B174B] cursor-pointer"
                                  >
                                    <CopyPlus className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteSelectedAnnotation();
                                    }}
                                    className="px-2 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold shadow-md flex items-center gap-1 hover:bg-[#B91C1C] cursor-pointer whitespace-nowrap"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>
                                      {ann.type === 'image'
                                        ? 'Remove Picture'
                                        : 'Delete'}
                                    </span>
                                  </button>
                                </div>

                                <div
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    setDragState({
                                      id: ann.id,
                                      pageNumber: pageNum,
                                      mode: 'resize',
                                      startX: e.clientX,
                                      startY: e.clientY,
                                      origX: ann.x,
                                      origY: ann.y,
                                      origW: ann.width,
                                      origH: ann.height,
                                    });
                                  }}
                                  className="absolute -bottom-2 -right-2 w-4 h-4 rounded-full bg-[#4A1D5E] dark:bg-[#9D5CE5] border-2 border-white cursor-nwse-resize"
                                />
                              </>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Contextual Inspector & iLovePDF-style Layer / Object Manager */}
        <aside className="w-76 shrink-0 bg-white dark:bg-[#16111F] border-l border-[#E4DFEC] dark:border-[#261F33] overflow-y-auto p-4 space-y-5 hidden lg:block">
          {/* Selected Element Formatting Panel */}
          {selectedAnnotation && !isReaderMode && (
            <div className="space-y-3 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#14101B] dark:text-[#F4F1F8]">
                  Selected: {selectedAnnotation.type} (P.{selectedAnnotation.pageNumber})
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      reorderAnnotationLayer(selectedAnnotation.id, 'backward')
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
              )}

              {selectedAnnotation.type !== 'whiteout' &&
                selectedAnnotation.type !== 'image' && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
                      Color
                    </label>
                    <div className="flex items-center gap-2">
                      {[
                        '#14101B',
                        '#4A1D5E',
                        '#DC2626',
                        '#15803D',
                        '#2563EB',
                        '#FACC15',
                      ].map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() =>
                            updateSelectedAnnotation({ color: hex })
                          }
                          style={{ backgroundColor: hex }}
                          className={`w-5 h-5 rounded-full border cursor-pointer ${
                            selectedAnnotation.color === hex
                              ? 'ring-2 ring-offset-2 ring-[#4A1D5E]'
                              : 'border-neutral-300'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* Pictures & Boxes on Current Page (Select first, then Move/Resize, Replace, or Remove) */}
          {!isReaderMode && (
            <div className="space-y-3 border-b border-[#E4DFEC] dark:border-[#261F33] pb-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Pictures & Boxes (Page {currentPage})</span>
                </h3>
                <button
                  onClick={() => imageAnnotationInputRef.current?.click()}
                  className="text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] hover:underline cursor-pointer"
                >
                  + Add Picture
                </button>
              </div>

              {/* 1. Attached / Unlocked Overlay Pictures & Boxes */}
              {currentPageAnnotations
                .filter(
                  (a) =>
                    !(a.type === 'whiteout' && a.replacesNativeTextId) &&
                    (a.type === 'image' ||
                      a.type === 'rectangle' ||
                      a.type === 'circle' ||
                      a.type === 'whiteout')
                )
                .map((imgAnn, i) => {
                  const isImgSelected = selectedAnnId === imgAnn.id;
                  return (
                    <div
                      key={imgAnn.id}
                      onClick={() => {
                        setSelectedAnnId(imgAnn.id);
                        setSelectedEmbedded(null);
                        setSelectedPictureRegion(null);
                      }}
                      className={`p-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        isImgSelected
                          ? 'border-[#DC2626] bg-[#DC2626]/5 ring-1 ring-[#DC2626]'
                          : 'border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {imgAnn.imageDataUrl && (
                          <img
                            src={imgAnn.imageDataUrl}
                            alt={`Picture ${i + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 object-cover rounded border border-[#E4DFEC]"
                          />
                        )}
                        <div className="min-w-0">
                          <span className="text-xs font-semibold truncate block">
                            {imgAnn.type === 'image'
                              ? `Picture Layer #${i + 1}`
                              : `Box Layer (${imgAnn.type}) #${i + 1}`}
                          </span>
                          <span className="text-[10px] text-[#6E667D]">
                            {isImgSelected ? 'Selected' : 'Click to select'}
                          </span>
                        </div>
                      </div>
                      {isImgSelected ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSelectedAnnotation();
                          }}
                          className="px-2.5 py-1 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[11px] font-bold cursor-pointer shrink-0"
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0">
                          Select
                        </span>
                      )}
                    </div>
                  );
                })}

              {/* 2. Native Embedded PDF Pictures & Boxes */}
              {currentPageEmbeddedImages
                .filter(
                  (emb) =>
                    !annotations.some((a) => a.replacesNativeTextId === emb.key)
                )
                .map((emb, idx) => {
                  const isEmbSelected =
                    selectedEmbedded?.pageNumber === currentPage &&
                    selectedEmbedded?.key === emb.key;
                  const itemLabel =
                    emb.label ||
                    `${emb.kind === 'box' ? 'Box' : 'Picture'} #${idx + 1}`;
                  return (
                    <div
                      key={emb.key}
                      onClick={() => {
                        setSelectedEmbedded({
                          pageNumber: currentPage,
                          key: emb.key,
                        });
                        setSelectedAnnId(null);
                        setSelectedPictureRegion(null);
                      }}
                      className={`p-2 rounded-lg border space-y-2 cursor-pointer transition-colors ${
                        isEmbSelected
                          ? 'border-[#DC2626] bg-[#DC2626]/5 ring-1 ring-[#DC2626]'
                          : 'bg-[#FAF9FB] dark:bg-[#0D0A12] border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">
                            {itemLabel}
                          </p>
                          <p className="text-[10px] font-mono tabular-nums text-[#6E667D]">
                            {emb.width}×{emb.height}px ·{' '}
                            {isEmbSelected ? 'Selected' : 'Click to select'}
                          </p>
                        </div>
                        {!isEmbSelected && (
                          <span className="text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0">
                            Select
                          </span>
                        )}
                      </div>
                      {isEmbSelected && (
                        <div className="flex items-center gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlockEmbeddedImageToMoveOrResize(
                                currentPage,
                                emb
                              );
                            }}
                            className="flex-1 py-1 px-2 rounded bg-[#4A1D5E] text-white text-[10px] font-bold cursor-pointer"
                          >
                            Move / Resize
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveEmbeddedPdfImage(
                                currentPage,
                                emb.key
                              );
                            }}
                            className="flex-1 py-1 px-2 rounded bg-[#DC2626] text-white text-[10px] font-bold cursor-pointer"
                          >
                            Remove {emb.kind === 'box' ? 'Box' : 'Picture'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

              {undoStack.length > 0 && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="w-full py-1.5 px-3 rounded-lg border border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/10 dark:bg-[#9D5CE5]/20 text-[#4A1D5E] dark:text-[#D5B3FF] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Undo Last Removal / Edit</span>
                </button>
              )}

              {currentPageAnnotations.filter(
                (a) =>
                  !(a.type === 'whiteout' && a.replacesNativeTextId) &&
                  (a.type === 'image' ||
                    a.type === 'rectangle' ||
                    a.type === 'circle')
              ).length === 0 &&
                currentPageEmbeddedImages.filter(
                  (emb) =>
                    !annotations.some((a) => a.replacesNativeTextId === emb.key)
                ).length === 0 && (
                  <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
                    No selectable pictures or boxes remaining on Page{' '}
                    {currentPage}. Click <strong>Select Picture / Box</strong>{' '}
                    in the ribbon and drag around any graphic to select and
                    remove it.
                  </p>
                )}
            </div>
          )}

          {/* iLovePDF-style Editable PDF Text Blocks & Layers List */}
          {!isReaderMode && (
            <div className="space-y-2 border-b border-[#E4DFEC] dark:border-[#261F33] pb-5">
              <h3 className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                <span>Editable PDF Text Blocks (Page {currentPage})</span>
              </h3>
              <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
                Click any text line on the page (or below) to edit typos, move it, or remove it from the PDF:
              </p>
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

          {/* Document-Wide Page Numbers & Watermark Controls */}
          {!isReaderMode && (
            <div className="space-y-3 border-b border-[#E4DFEC] dark:border-[#261F33] pb-5">
              <h3 className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1.5">
                <Stamp className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                <span>Page Numbers & Watermark</span>
              </h3>

              <label className="flex items-center justify-between text-xs cursor-pointer">
                <span className="text-[#6E667D] dark:text-[#A39BB5] flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" />
                  Add Page Numbers
                </span>
                <input
                  type="checkbox"
                  checked={addPageNumbers}
                  onChange={(e) => setAddPageNumbers(e.target.checked)}
                  className="accent-[#4A1D5E] dark:accent-[#9D5CE5]"
                />
              </label>

              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-[#6E667D] dark:text-[#A39BB5]">
                  Watermark Stamp Text
                </label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="e.g. CONFIDENTIAL or DRAFT"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
            </div>
          )}

          {/* Extracted Native PDF Text on Current Page */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Full Page Text Stream
              </h3>
              {activePageInfo?.extractedText && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(activePageInfo.extractedText);
                    setCopiedNativeText(true);
                    setTimeout(() => setCopiedNativeText(false), 2000);
                  }}
                  className="text-[11px] font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] flex items-center gap-1 cursor-pointer"
                >
                  {copiedNativeText ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="p-2.5 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] max-h-36 overflow-y-auto text-[11px] font-mono text-[#6E667D] dark:text-[#A39BB5] whitespace-pre-wrap leading-relaxed">
              {activePageInfo?.extractedText ||
                'No selectable native text layer on this page.'}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
