import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  RotateCw,
  Check,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Plus,
  Download,
  Save,
  RefreshCw,
  Sliders,
  Maximize2,
  Sparkles,
  SwitchCamera,
  FileText,
  AlertCircle,
} from 'lucide-react';
import {
  Point2D,
  ScanFilterType,
  ScanPage,
  StoredDocument,
} from '../types/document';
import {
  detectDocumentCorners,
  applyPerspectiveCrop,
  applyImageEnhancements,
} from '../services/imageProcessingService';
import {
  createPdfFromImages,
  downloadBytesAsFile,
} from '../services/pdfService';

interface ScannerViewProps {
  initialImportedFiles?: FileList | File[] | null;
  onClearInitialFiles?: () => void;
  defaultFilter?: ScanFilterType;
  defaultPageSize?: 'A4' | 'Letter' | 'Fit';
  onSaveScannedDocument: (
    doc: StoredDocument,
    openInEditorAfter: boolean
  ) => Promise<void>;
}

type WorkflowStep = 'capture' | 'crop' | 'enhance' | 'export';

const FILTER_OPTIONS: { id: ScanFilterType; label: string; desc: string }[] = [
  { id: 'ocv-black', label: 'OCV BLACK', desc: 'Deep jet-black ink & pure white' },
  { id: 'vivid-light', label: 'Vivid Light', desc: 'Vivid color & luminous contrast' },
  { id: 'magic', label: 'Magic Color', desc: 'Crisp text & whitened paper' },
  { id: 'bw', label: 'B&W Document', desc: 'Adaptive high-contrast ink' },
  { id: 'shadow-clean', label: 'Shadow Clean', desc: 'Evens out lighting' },
  { id: 'grayscale', label: 'Grayscale', desc: 'Balanced monochrome' },
  { id: 'original', label: 'Original', desc: 'Unfiltered capture' },
];

export const ScannerView: React.FC<ScannerViewProps> = ({
  initialImportedFiles,
  onClearInitialFiles,
  defaultFilter = 'magic',
  defaultPageSize = 'A4',
  onSaveScannedDocument,
}) => {
  const [step, setStep] = useState<WorkflowStep>('capture');
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [draggingCornerIdx, setDraggingCornerIdx] = useState<number | null>(
    null
  );
  const [draggingEdgeState, setDraggingEdgeState] = useState<{
    edgeIdx: number; // 0: Top (0-1), 1: Right (1-2), 2: Bottom (2-3), 3: Left (3-0)
    startX: number;
    startY: number;
    origCorners: [Point2D, Point2D, Point2D, Point2D];
  } | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Export settings
  const [docName, setDocName] = useState(
    `Scan_${new Date().toISOString().slice(0, 10)}.pdf`
  );
  const [pageSize, setPageSize] = useState<'A4' | 'Letter' | 'Fit'>(
    defaultPageSize
  );
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const activePage = pages[activePageIndex] || null;

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    setCameraError(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera access unavailable (${err.message}). You can upload photos from your device or generate a test document page below.`
          : 'Camera permission denied or no camera detected on this device.'
      );
      setCameraActive(false);
    }
  };

  const ingestDataUrlAsPage = useCallback(
    async (dataUrl: string) => {
      setIsProcessing(true);
      try {
        const corners = await detectDocumentCorners(dataUrl);
        const cropped = await applyPerspectiveCrop(dataUrl, corners);
        const enhanced = await applyImageEnhancements(cropped.dataUrl, {
          filter: defaultFilter,
          brightness: 0,
          contrast: 0,
          rotation: 0,
        });

        const newPage: ScanPage = {
          id: `scan-page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          originalDataUrl: dataUrl,
          croppedDataUrl: cropped.dataUrl,
          processedDataUrl: enhanced,
          corners,
          filter: defaultFilter,
          brightness: 0,
          contrast: 0,
          rotation: 0,
          width: cropped.width,
          height: cropped.height,
        };

        setPages((prev) => {
          const updated = [...prev, newPage];
          setActivePageIndex(updated.length - 1);
          return updated;
        });
        setStep('crop');
      } finally {
        setIsProcessing(false);
      }
    },
    [defaultFilter]
  );

  // Ingest files passed from Dashboard "Import Image" button
  useEffect(() => {
    if (initialImportedFiles && initialImportedFiles.length > 0) {
      const filesSnapshot = Array.from(initialImportedFiles);
      onClearInitialFiles?.();
      const processFiles = async () => {
        for (let i = 0; i < filesSnapshot.length; i++) {
          const file = filesSnapshot[i];
          const dataUrl = await readFileAsDataUrl(file);
          await ingestDataUrlAsPage(dataUrl);
        }
      };
      processFiles();
    }
  }, [initialImportedFiles, ingestDataUrlAsPage, onClearInitialFiles]);

  const handleCaptureFromVideo = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    stopCamera();
    await ingestDataUrlAsPage(dataUrl);
  };

  /**
   * Creates a realistic angled desktop capture of a printed document on a dark desk
   * so users without a physical camera can test automatic edge detection and perspective warp.
   */
  const handleGenerateSampleCapture = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1250;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Desk surface background
    ctx.fillStyle = '#241E2C';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw a slightly skewed quadrilateral white document page
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(120, 110);
    ctx.lineTo(890, 145);
    ctx.lineTo(860, 1120);
    ctx.lineTo(95, 1085);
    ctx.closePath();
    ctx.fillStyle = '#F7F5FA';
    ctx.fill();

    // Document content inside page
    ctx.translate(145, 165);
    ctx.rotate(0.032);
    ctx.fillStyle = '#4A1D5E';
    ctx.fillRect(0, 0, 660, 6);

    ctx.fillStyle = '#14101B';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('COMMERCIAL DELIVERY NOTE #DN-4092', 0, 52);

    ctx.fillStyle = '#524B60';
    ctx.font = '18px monospace';
    ctx.fillText('Date: November 6, 2026  ·  Origin: Mombasa Port Terminal', 0, 88);

    const lines = [
      '------------------------------------------------------------------',
      'ITEM   DESCRIPTION                           QTY      WEIGHT (KG)',
      '------------------------------------------------------------------',
      '001    Industrial Solar Inverter 10kW        04       192.00',
      '002    Lithium Iron Phosphate Rack 48V       08       360.00',
      '003    Armored Copper Interconnect Cable     12        84.50',
      '------------------------------------------------------------------',
      ' Inspector Note: Received in good order. Seals intact.',
      ' Kumbukumbu: Mizigo imepokelewa salama bila uharibifu.',
      '',
      ' Verified By: J. Mwangi (Senior Field Inspector)',
    ];

    ctx.fillStyle = '#1C1726';
    ctx.font = '19px monospace';
    lines.forEach((line, idx) => {
      ctx.fillText(line, 0, 150 + idx * 44);
    });

    ctx.restore();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    await ingestDataUrlAsPage(dataUrl);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesSnapshot = Array.from(e.target.files);
    e.target.value = '';
    stopCamera();
    for (let i = 0; i < filesSnapshot.length; i++) {
      const dataUrl = await readFileAsDataUrl(filesSnapshot[i]);
      await ingestDataUrlAsPage(dataUrl);
    }
  };

  // Window-level pointer listeners for silky-smooth corner & edge dragging on mobile and desktop
  useEffect(() => {
    if (draggingCornerIdx === null && !draggingEdgeState) return;

    const onWinPointerMove = (e: PointerEvent) => {
      if (!cropContainerRef.current) return;
      const rect = cropContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      if (draggingCornerIdx !== null) {
        const nx = Math.max(
          0.002,
          Math.min(0.998, (e.clientX - rect.left) / rect.width)
        );
        const ny = Math.max(
          0.002,
          Math.min(0.998, (e.clientY - rect.top) / rect.height)
        );

        setPages((prev) =>
          prev.map((p, idx) => {
            if (idx !== activePageIndex) return p;
            const nextCorners = [...p.corners] as [
              Point2D,
              Point2D,
              Point2D,
              Point2D,
            ];
            nextCorners[draggingCornerIdx] = { x: nx, y: ny };
            return { ...p, corners: nextCorners };
          })
        );
      } else if (draggingEdgeState) {
        const dx = (e.clientX - draggingEdgeState.startX) / rect.width;
        const dy = (e.clientY - draggingEdgeState.startY) / rect.height;
        const i1 = draggingEdgeState.edgeIdx;
        const i2 = (draggingEdgeState.edgeIdx + 1) % 4;

        setPages((prev) =>
          prev.map((p, idx) => {
            if (idx !== activePageIndex) return p;
            const nextCorners = [...draggingEdgeState.origCorners] as [
              Point2D,
              Point2D,
              Point2D,
              Point2D,
            ];
            nextCorners[i1] = {
              x: Math.max(
                0.002,
                Math.min(0.998, draggingEdgeState.origCorners[i1].x + dx)
              ),
              y: Math.max(
                0.002,
                Math.min(0.998, draggingEdgeState.origCorners[i1].y + dy)
              ),
            };
            nextCorners[i2] = {
              x: Math.max(
                0.002,
                Math.min(0.998, draggingEdgeState.origCorners[i2].x + dx)
              ),
              y: Math.max(
                0.002,
                Math.min(0.998, draggingEdgeState.origCorners[i2].y + dy)
              ),
            };
            return { ...p, corners: nextCorners };
          })
        );
      }
    };

    const onWinPointerUp = () => {
      setDraggingCornerIdx(null);
      setDraggingEdgeState(null);
    };

    window.addEventListener('pointermove', onWinPointerMove, { passive: true });
    window.addEventListener('pointerup', onWinPointerUp);
    window.addEventListener('pointercancel', onWinPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerUp);
    };
  }, [draggingCornerIdx, draggingEdgeState, activePageIndex]);

  const handleAutoDetectCurrentPage = async () => {
    if (!activePage) return;
    setIsProcessing(true);
    try {
      const detected = await detectDocumentCorners(activePage.originalDataUrl);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activePageIndex ? { ...p, corners: detected } : p
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyCropAndProceed = async () => {
    if (!activePage) return;
    setIsProcessing(true);
    try {
      const cropped = await applyPerspectiveCrop(
        activePage.originalDataUrl,
        activePage.corners
      );
      const enhanced = await applyImageEnhancements(cropped.dataUrl, {
        filter: activePage.filter,
        brightness: activePage.brightness,
        contrast: activePage.contrast,
        rotation: activePage.rotation,
      });

      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activePageIndex
            ? {
                ...p,
                croppedDataUrl: cropped.dataUrl,
                processedDataUrl: enhanced,
                width: cropped.width,
                height: cropped.height,
              }
            : p
        )
      );
      setStep('enhance');
    } finally {
      setIsProcessing(false);
    }
  };

  const updateEnhancementParams = async (updates: {
    filter?: ScanFilterType;
    brightness?: number;
    contrast?: number;
    rotation?: number;
  }) => {
    if (!activePage) return;
    const nextFilter = updates.filter ?? activePage.filter;
    const nextBrightness = updates.brightness ?? activePage.brightness;
    const nextContrast = updates.contrast ?? activePage.contrast;
    const nextRotation = updates.rotation ?? activePage.rotation;

    setIsProcessing(true);
    try {
      const processed = await applyImageEnhancements(
        activePage.croppedDataUrl,
        {
          filter: nextFilter,
          brightness: nextBrightness,
          contrast: nextContrast,
          rotation: nextRotation,
        }
      );

      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activePageIndex
            ? {
                ...p,
                filter: nextFilter,
                brightness: nextBrightness,
                contrast: nextContrast,
                rotation: nextRotation,
                processedDataUrl: processed,
              }
            : p
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const movePageOrder = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
    setActivePageIndex(target);
  };

  const deletePageAt = (index: number) => {
    setPages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setStep('capture');
        setActivePageIndex(0);
      } else if (activePageIndex >= next.length) {
        setActivePageIndex(next.length - 1);
      }
      return next;
    });
  };

  const handleRetakeCurrentPage = () => {
    deletePageAt(activePageIndex);
    setStep('capture');
  };

  const handleSaveOrDownloadPdf = async (
    mode: 'save-library' | 'open-editor' | 'download'
  ) => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const imageUrls = pages.map((p) => p.processedDataUrl);
      const pdfBytes = await createPdfFromImages(imageUrls, {
        pageSize,
        marginPt: 20,
      });

      const cleanName = docName.trim().endsWith('.pdf')
        ? docName.trim()
        : `${docName.trim() || 'Scanned_Document'}.pdf`;

      if (mode === 'download') {
        downloadBytesAsFile(pdfBytes, cleanName);
        setStatusBanner(`Downloaded "${cleanName}" (${pages.length} pages).`);
      } else {
        const newDoc: StoredDocument = {
          id: `doc-scan-${Date.now()}`,
          name: cleanName,
          category: 'Scans',
          starred: false,
          sizeBytes: pdfBytes.byteLength,
          pageCount: pages.length,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
          pdfData: pdfBytes,
          thumbnailDataUrl: pages[0].processedDataUrl,
        };
        await onSaveScannedDocument(newDoc, mode === 'open-editor');
        setStatusBanner(`Saved "${cleanName}" to Local Document Vault.`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Top Scanner Studio Workflow Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-xl p-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#14101B] dark:text-[#F4F1F8]">
            Document Scanner Studio
          </h1>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
            Camera Capture → Edge & Corner Detection → Perspective Rectification → Adaptive Filter → Multi-Page PDF
          </p>
        </div>

        {/* Interactive 4-Step Pipeline Selector */}
        <div className="flex items-center gap-1 p-1 bg-[#F2EFF6] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg overflow-x-auto">
          {(
            [
              { id: 'capture', label: '1. Capture' },
              { id: 'crop', label: '2. Detect & Crop', disabled: pages.length === 0 },
              { id: 'enhance', label: '3. Enhance', disabled: pages.length === 0 },
              { id: 'export', label: '4. Preview & Export', disabled: pages.length === 0 },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              disabled={'disabled' in s ? s.disabled : false}
              onClick={() => setStep(s.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                step === s.id
                  ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-semibold'
                  : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {statusBanner && (
        <div className="p-3 rounded-lg bg-[#15803D]/10 border border-[#15803D]/30 text-[#15803D] dark:text-[#4ADE80] text-xs font-medium flex items-center justify-between">
          <span>{statusBanner}</span>
          <button
            onClick={() => setStatusBanner(null)}
            className="underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Scanner Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Center Viewport (8 cols on lg) */}
        <div className="lg:col-span-8 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden">
          {/* STEP 1: CAPTURE OR UPLOAD */}
          {step === 'capture' && (
            <div className="p-6 space-y-6">
              {cameraActive ? (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-4/3 max-h-[520px] mx-auto flex items-center justify-center">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full h-full object-contain"
                    />
                    {/* Viewfinder alignment frame */}
                    <div className="absolute inset-8 border-2 border-dashed border-[#9D5CE5]/80 rounded-lg pointer-events-none flex items-end justify-center pb-3">
                      <span className="px-2.5 py-1 rounded bg-black/60 text-white text-[11px]">
                        Position document inside frame
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => {
                        const next =
                          facingMode === 'environment' ? 'user' : 'environment';
                        setFacingMode(next);
                        startCamera(next);
                      }}
                      className="px-4 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-2 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                    >
                      <SwitchCamera className="w-4 h-4" />
                      <span>Flip Camera</span>
                    </button>

                    <button
                      onClick={handleCaptureFromVideo}
                      className="px-6 py-3 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-sm font-bold flex items-center gap-2 shadow-sm cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Capture Page Now</span>
                    </button>

                    <button
                      onClick={stopCamera}
                      className="px-4 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-medium text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] cursor-pointer"
                    >
                      Close Camera
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-10 px-4 text-center space-y-6">
                  <div className="w-16 h-16 rounded-2xl bg-[#F2EFF6] dark:bg-[#261F33] flex items-center justify-center mx-auto">
                    <Camera className="w-8 h-8 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  </div>
                  <div className="space-y-2 max-w-md mx-auto">
                    <h2 className="text-xl font-bold text-[#14101B] dark:text-[#F4F1F8]">
                      Capture or Import a Document Page
                    </h2>
                    <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] leading-relaxed">
                      Use your phone or laptop camera to photograph contracts, receipts, or notes. ScanPro automatically locates the 4 page corners and flattens perspective distortion.
                    </p>
                  </div>

                  {cameraError && (
                    <div className="max-w-md mx-auto p-3 rounded-lg bg-[#D97706]/10 border border-[#D97706]/30 text-left flex items-start gap-2.5 text-xs text-[#D97706] dark:text-[#FBBF24]">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{cameraError}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => startCamera()}
                      className="px-5 py-3 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] font-semibold text-sm flex items-center gap-2 cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Start Camera</span>
                    </button>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-3 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] dark:hover:bg-[#342B47] text-[#14101B] dark:text-[#F4F1F8] font-semibold text-sm flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                      <span>Upload Image from Device</span>
                    </button>

                    <button
                      onClick={handleGenerateSampleCapture}
                      className="px-4 py-3 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] flex items-center gap-2 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                      <span>Load Skewed Test Document</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: DETECT EDGES & PERSPECTIVE CROP */}
          {step === 'crop' && activePage && (
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Adjust Document Boundaries (Page {activePageIndex + 1} of{' '}
                    {pages.length})
                  </h2>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    Drag any of the 4 corner handles to align with the paper edges, then click Apply Perspective Crop.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleAutoDetectCurrentPage}
                    disabled={isProcessing}
                    className="px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Auto-Detect Precise Corners</span>
                  </button>
                  <button
                    onClick={() =>
                      setPages((prev) =>
                        prev.map((p, idx) =>
                          idx === activePageIndex
                            ? {
                                ...p,
                                corners: [
                                  { x: 0.005, y: 0.005 },
                                  { x: 0.995, y: 0.005 },
                                  { x: 0.995, y: 0.995 },
                                  { x: 0.005, y: 0.995 },
                                ],
                              }
                            : p
                        )
                      )
                    }
                    className="px-3 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-medium text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] cursor-pointer"
                  >
                    Full Frame
                  </button>
                </div>
              </div>

              {/* Interactive Corner & Edge Handle Stage with 3x Precision Magnifier Loupe */}
              <div className="relative bg-[#181322] rounded-xl p-4 flex items-center justify-center overflow-hidden select-none">
                <div
                  ref={cropContainerRef}
                  className="relative inline-block max-w-full max-h-[520px] touch-none"
                >
                  <img
                    src={activePage.originalDataUrl}
                    alt="Original captured document"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="max-h-[520px] w-auto block rounded"
                  />

                  {/* SVG Polygon & Grid Overlay */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <polygon
                      points={activePage.corners
                        .map((c) => `${c.x * 100},${c.y * 100}`)
                        .join(' ')}
                      fill="rgba(37, 99, 235, 0.16)"
                      stroke="#3B82F6"
                      strokeWidth="0.75"
                    />
                  </svg>

                  {/* 4 Edge Midpoint Handles (Top, Right, Bottom, Left) */}
                  {[0, 1, 2, 3].map((edgeIdx) => {
                    const c1 = activePage.corners[edgeIdx];
                    const c2 = activePage.corners[(edgeIdx + 1) % 4];
                    const midX = (c1.x + c2.x) * 50;
                    const midY = (c1.y + c2.y) * 50;
                    const isHorizontal = edgeIdx === 0 || edgeIdx === 2;
                    return (
                      <button
                        key={`edge-${edgeIdx}`}
                        type="button"
                        aria-label={`Edge handle ${edgeIdx + 1}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setDraggingEdgeState({
                            edgeIdx,
                            startX: e.clientX,
                            startY: e.clientY,
                            origCorners: [...activePage.corners] as [
                              Point2D,
                              Point2D,
                              Point2D,
                              Point2D,
                            ],
                          });
                        }}
                        style={{
                          left: `${midX}%`,
                          top: `${midY}%`,
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                          isHorizontal ? 'w-7 h-3' : 'w-3 h-7'
                        } rounded-full bg-[#2563EB] border-2 border-white shadow-md cursor-move touch-none z-10`}
                      />
                    );
                  })}

                  {/* 4 Draggable Precision Corner Handles */}
                  {activePage.corners.map((corner, cIdx) => {
                    const isDraggingThis = draggingCornerIdx === cIdx;
                    return (
                      <button
                        key={cIdx}
                        type="button"
                        aria-label={`Corner handle ${cIdx + 1}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setDraggingCornerIdx(cIdx);
                        }}
                        style={{
                          left: `${corner.x * 100}%`,
                          top: `${corner.y * 100}%`,
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center focus:outline-none touch-none z-20 transition-transform ${
                          isDraggingThis
                            ? 'bg-[#2563EB]/40 scale-125 ring-2 ring-[#60A5FA]'
                            : 'bg-[#2563EB]'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-white shadow-xs" />
                      </button>
                    );
                  })}
                </div>

                {/* 3x Precision Magnifier Loupe while dragging any corner handle */}
                {draggingCornerIdx !== null &&
                  activePage.corners[draggingCornerIdx] && (
                    <div
                      className={`absolute top-3 ${
                        activePage.corners[draggingCornerIdx].x < 0.45 &&
                        activePage.corners[draggingCornerIdx].y < 0.45
                          ? 'right-3'
                          : 'left-3'
                      } w-28 h-28 rounded-full border-3 border-white shadow-2xl overflow-hidden bg-black pointer-events-none z-30`}
                    >
                      <div
                        className="w-full h-full bg-no-repeat"
                        style={{
                          backgroundImage: `url(${activePage.originalDataUrl})`,
                          backgroundSize: '340% 340%',
                          backgroundPosition: `${activePage.corners[draggingCornerIdx].x * 100}% ${activePage.corners[draggingCornerIdx].y * 100}%`,
                        }}
                      />
                      {/* Precision Crosshair inside Loupe */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-full h-[1.5px] bg-[#3B82F6]/85" />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-full w-[1.5px] bg-[#3B82F6]/85" />
                      </div>
                      <div className="absolute bottom-1 inset-x-0 text-center">
                        <span className="px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-mono font-bold text-white">
                          {Math.round(
                            activePage.corners[draggingCornerIdx].x * 100
                          )}
                          %,
                          {Math.round(
                            activePage.corners[draggingCornerIdx].y * 100
                          )}
                          %
                        </span>
                      </div>
                    </div>
                  )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleRetakeCurrentPage}
                  className="px-4 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold text-[#6E667D] dark:text-[#A39BB5] hover:text-[#DC2626] flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retake / Discard Page</span>
                </button>

                <button
                  onClick={handleApplyCropAndProceed}
                  disabled={isProcessing}
                  className="px-5 py-2.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {isProcessing
                      ? 'Rectifying Perspective...'
                      : 'Apply Perspective Crop'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: ENHANCE & FILTER */}
          {step === 'enhance' && activePage && (
            <div className="p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Enhance & Filter Document (Page {activePageIndex + 1})
                  </h2>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    Choose a document filter, adjust contrast or brightness, and rotate orientation.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      updateEnhancementParams({
                        rotation: (activePage.rotation + 90) % 360,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Rotate 90°</span>
                  </button>
                  <button
                    onClick={() => setStep('export')}
                    className="px-4 py-2 rounded-lg bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Continue to Export</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Processed Page Preview */}
              <div className="bg-[#181322] rounded-xl p-4 flex items-center justify-center min-h-[380px]">
                <img
                  src={activePage.processedDataUrl}
                  alt="Enhanced document page"
                  referrerPolicy="no-referrer"
                  className="max-h-[480px] w-auto rounded shadow-lg"
                />
              </div>

              {/* Filter Presets */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {FILTER_OPTIONS.map((f) => {
                  const selected = activePage.filter === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => updateEnhancementParams({ filter: f.id })}
                      className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/5 dark:bg-[#9D5CE5]/15'
                          : 'border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                      }`}
                    >
                      <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                        {f.label}
                      </p>
                      <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] mt-0.5">
                        {f.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Brightness & Contrast Sliders */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E4DFEC] dark:border-[#261F33]">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                      Brightness
                    </span>
                    <span className="font-mono tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                      {activePage.brightness > 0
                        ? `+${activePage.brightness}`
                        : activePage.brightness}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-60}
                    max={60}
                    step={5}
                    value={activePage.brightness}
                    onChange={(e) =>
                      updateEnhancementParams({
                        brightness: Number(e.target.value),
                      })
                    }
                    className="w-full accent-[#4A1D5E] dark:accent-[#9D5CE5] cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                      Contrast
                    </span>
                    <span className="font-mono tabular-nums text-[#6E667D] dark:text-[#A39BB5]">
                      {activePage.contrast > 0
                        ? `+${activePage.contrast}`
                        : activePage.contrast}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-60}
                    max={60}
                    step={5}
                    value={activePage.contrast}
                    onChange={(e) =>
                      updateEnhancementParams({
                        contrast: Number(e.target.value),
                      })
                    }
                    className="w-full accent-[#4A1D5E] dark:accent-[#9D5CE5] cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: PREVIEW & EXPORT PDF */}
          {step === 'export' && (
            <div className="p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
                <div>
                  <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Review Multi-Page Packet & Export PDF
                  </h2>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    Rearrange page order, add more pages, or export as a unified PDF document.
                  </p>
                </div>
                <button
                  onClick={() => setStep('capture')}
                  className="px-3.5 py-2 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer self-start"
                >
                  <Plus className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Add Another Page</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] mb-1.5">
                    Output Document Filename
                  </label>
                  <input
                    type="text"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] focus:outline-none focus:border-[#4A1D5E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] mb-1.5">
                    PDF Page Geometry
                  </label>
                  <div className="flex items-center gap-2">
                    {(['A4', 'Letter', 'Fit'] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setPageSize(sz)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          pageSize === sz
                            ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] border-[#4A1D5E] dark:border-[#9D5CE5]'
                            : 'border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5]'
                        }`}
                      >
                        {sz === 'Fit' ? 'Fit Image' : sz}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Export Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={() => handleSaveOrDownloadPdf('save-library')}
                  disabled={isProcessing || pages.length === 0}
                  className="px-5 py-3 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Save PDF to Local Library</span>
                </button>

                <button
                  onClick={() => handleSaveOrDownloadPdf('open-editor')}
                  disabled={isProcessing || pages.length === 0}
                  className="px-5 py-3 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] dark:hover:bg-[#342B47] text-[#14101B] dark:text-[#F4F1F8] text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />
                  <span>Save & Open in PDF Editor</span>
                </button>

                <button
                  onClick={() => handleSaveOrDownloadPdf('download')}
                  disabled={isProcessing || pages.length === 0}
                  className="px-5 py-3 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PDF File</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Multi-Page Batch Tray (4 cols on lg) */}
        <div className="lg:col-span-4 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Captured Pages ({pages.length})
              </h3>
              <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
                Click a page to crop or enhance; reorder as needed
              </p>
            </div>
            <button
              onClick={() => {
                setStep('capture');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] text-xs font-semibold text-[#4A1D5E] dark:text-[#D5B3FF] flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Page</span>
            </button>
          </div>

          {pages.length === 0 ? (
            <div className="py-12 px-4 text-center border border-dashed border-[#E4DFEC] dark:border-[#261F33] rounded-lg space-y-2">
              <p className="text-xs font-medium text-[#6E667D] dark:text-[#A39BB5]">
                No pages captured yet
              </p>
              <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5]">
                Captured or uploaded pages will appear here so you can assemble a multi-page PDF.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {pages.map((p, idx) => {
                const isSelected = idx === activePageIndex;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setActivePageIndex(idx);
                      if (step === 'capture') setStep('enhance');
                    }}
                    className={`p-2.5 rounded-lg border flex items-center gap-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/5 dark:bg-[#9D5CE5]/10'
                        : 'border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6]/50 dark:hover:bg-[#261F33]/50'
                    }`}
                  >
                    <img
                      src={p.processedDataUrl}
                      alt={`Scanned page ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-12 h-16 object-cover rounded border border-[#E4DFEC] dark:border-[#261F33] shrink-0 bg-white"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                        Page {idx + 1}
                      </p>
                      <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] truncate">
                        Filter: {p.filter} · {p.width}×{p.height}px
                      </p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            movePageOrder(idx, -1);
                          }}
                          title="Move page earlier"
                          className="p-1 rounded border border-[#E4DFEC] dark:border-[#261F33] disabled:opacity-30 hover:bg-white dark:hover:bg-[#261F33]"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === pages.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            movePageOrder(idx, 1);
                          }}
                          title="Move page later"
                          className="p-1 rounded border border-[#E4DFEC] dark:border-[#261F33] disabled:opacity-30 hover:bg-white dark:hover:bg-[#261F33]"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePageIndex(idx);
                            setStep('crop');
                          }}
                          className="px-2 py-0.5 text-[10px] font-semibold rounded border border-[#E4DFEC] dark:border-[#261F33] hover:bg-white dark:hover:bg-[#261F33]"
                        >
                          Crop
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePageAt(idx);
                          }}
                          title="Delete page"
                          className="p-1 rounded text-[#DC2626] hover:bg-[#DC2626]/10 ml-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pages.length > 0 && (
            <div className="pt-3 border-t border-[#E4DFEC] dark:border-[#261F33] flex flex-col gap-2">
              <button
                onClick={() => handleSaveOrDownloadPdf('save-library')}
                disabled={isProcessing}
                className="w-full py-2.5 px-4 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Save All ({pages.length}) as One PDF</span>
              </button>
              <button
                onClick={() => handleSaveOrDownloadPdf('download')}
                disabled={isProcessing}
                className="w-full py-2 px-4 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download PDF Directly</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}
