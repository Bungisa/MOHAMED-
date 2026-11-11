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
  Share2,
  Layers,
  Zap,
  Grid3X3,
  Settings,
  Timer,
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
type CameraCaptureMode = 'photo' | 'id-card' | 'document' | 'book' | 'signature';

const FILTER_OPTIONS: { id: ScanFilterType; label: string; desc: string }[] = [
  {
    id: 'clean-watermark',
    label: 'Watermark Clean',
    desc: 'Removes watermarks & keeps colors',
  },
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
  const [cameraFlashMode, setCameraFlashMode] = useState<'auto' | 'on' | 'off'>('auto');
  const [cameraGridEnabled, setCameraGridEnabled] = useState(false);
  const [cameraCaptureMode, setCameraCaptureMode] = useState<CameraCaptureMode>('document');
  const [cameraAutoMode, setCameraAutoMode] = useState(true);
  const [showCameraSettingsModal, setShowCameraSettingsModal] = useState(false);
  const [selectedCaptureFilter, setSelectedCaptureFilter] = useState<ScanFilterType>(defaultFilter);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didAutoStartRef = useRef(false);

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
    setShowCameraSettingsModal(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
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
    },
    [facingMode, stopCamera]
  );

  // Auto-open full-screen camera when user opens ScannerView directly
  useEffect(() => {
    if (
      !didAutoStartRef.current &&
      (!initialImportedFiles || initialImportedFiles.length === 0) &&
      pages.length === 0
    ) {
      didAutoStartRef.current = true;
      startCamera('environment');
    }
  }, [initialImportedFiles, pages.length, startCamera]);

  const cycleFlashMode = async () => {
    const nextMode: 'auto' | 'on' | 'off' =
      cameraFlashMode === 'auto'
        ? 'on'
        : cameraFlashMode === 'on'
          ? 'off'
          : 'auto';
    setCameraFlashMode(nextMode);
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack && 'applyConstraints' in videoTrack) {
        try {
          await videoTrack.applyConstraints({
            advanced: [{ torch: nextMode === 'on' } as MediaTrackConstraintSet],
          });
        } catch {
          // Hardware torch not supported on this device/browser
        }
      }
    }
  };

  const ingestDataUrlAsPage = useCallback(
    async (dataUrl: string, modeOverride?: CameraCaptureMode) => {
      setIsProcessing(true);
      try {
        const effectiveMode = modeOverride ?? cameraCaptureMode;
        const effectiveFilter: ScanFilterType =
          effectiveMode === 'photo'
            ? 'original'
            : effectiveMode === 'signature'
              ? 'ocv-black'
              : selectedCaptureFilter;

        const corners = await detectDocumentCorners(dataUrl);
        const cropped = await applyPerspectiveCrop(dataUrl, corners);
        const enhanced = await applyImageEnhancements(cropped.dataUrl, {
          filter: effectiveFilter,
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
          filter: effectiveFilter,
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
    [cameraCaptureMode, selectedCaptureFilter]
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
    await ingestDataUrlAsPage(dataUrl, cameraCaptureMode);
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

  const handleApplyFilterToAllPages = async () => {
    if (!activePage || pages.length <= 1) return;
    setIsProcessing(true);
    try {
      const targetFilter = activePage.filter;
      const targetBrightness = activePage.brightness;
      const targetContrast = activePage.contrast;
      const updatedPages = await Promise.all(
        pages.map(async (p) => {
          const processed = await applyImageEnhancements(p.croppedDataUrl, {
            filter: targetFilter,
            brightness: targetBrightness,
            contrast: targetContrast,
            rotation: p.rotation,
          });
          return {
            ...p,
            filter: targetFilter,
            brightness: targetBrightness,
            contrast: targetContrast,
            processedDataUrl: processed,
          };
        })
      );
      setPages(updatedPages);
      setStatusBanner(
        `Applied ${targetFilter.toUpperCase()} filter to all ${pages.length} pages.`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveOrDownloadPdf = async (
    mode: 'save-library' | 'open-editor' | 'download' | 'share'
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
        appliedFilter: pages[0].filter,
        appliedBrightness: pages[0].brightness,
        appliedContrast: pages[0].contrast,
      };

      // Always save to Local Document Vault so the document remains available even if the user presses Back
      await onSaveScannedDocument(newDoc, mode === 'open-editor');

      if (mode === 'download') {
        downloadBytesAsFile(pdfBytes, cleanName);
        setStatusBanner(
          `Saved to My Files & downloaded "${cleanName}" (${pages.length} pages).`
        );
      } else if (mode === 'share') {
        const fileObj = new File([new Uint8Array(pdfBytes)], cleanName, {
          type: 'application/pdf',
        });
        const nav = navigator as Navigator & {
          canShare?: (data?: ShareData) => boolean;
        };
        if (
          typeof nav.share === 'function' &&
          (!nav.canShare || nav.canShare({ files: [fileObj] }))
        ) {
          try {
            await nav.share({
              title: cleanName,
              text: `Scanned PDF from ElimikaPDF: ${cleanName}`,
              files: [fileObj],
            });
            setStatusBanner(
              `Shared "${cleanName}" and saved in Local Document Vault.`
            );
            return;
          } catch {
            // Fall back to direct download
          }
        }
        downloadBytesAsFile(pdfBytes, cleanName);
        setStatusBanner(
          `Saved "${cleanName}" to My Files & downloaded for sharing.`
        );
      } else {
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
            3-Step Guided Flow: Capture or Upload Photo → Precision Corner Crop → Filter & Save PDF
          </p>
        </div>

        {/* Streamlined 3-Step Pipeline Selector */}
        <div className="flex items-center gap-1 p-1 bg-[#F2EFF6] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-lg overflow-x-auto">
          {(
            [
              { id: 'capture', label: '1. Capture / Photo' },
              {
                id: 'crop',
                label: '2. Precision Crop',
                disabled: pages.length === 0,
              },
              {
                id: 'enhance',
                label: '3. Enhance & Save PDF',
                disabled: pages.length === 0,
              },
            ] as const
          ).map((s) => {
            const isActive =
              step === s.id || (s.id === 'enhance' && step === 'export');
            return (
              <button
                key={s.id}
                disabled={'disabled' in s ? s.disabled : false}
                onClick={() => setStep(s.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                  isActive
                    ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] font-semibold'
                    : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8]'
                }`}
              >
                {s.label}
              </button>
            );
          })}
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
                <div className="fixed inset-0 z-[70] bg-black text-white flex flex-col select-none">
                  {/* Top Black Camera Toolbar matching screenshot: [←] [⚡A] [⊞] [🔄] [⚙️] */}
                  <div className="h-16 px-4 sm:px-6 bg-black flex items-center justify-between shrink-0 z-20">
                    <button
                      type="button"
                      onClick={stopCamera}
                      title="Close full-screen camera"
                      aria-label="Back"
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={cycleFlashMode}
                      title={`Flash mode: ${cameraFlashMode.toUpperCase()}`}
                      aria-label="Toggle flash"
                      className="h-10 px-2.5 rounded-full flex items-center justify-center gap-0.5 text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Zap
                        className={`w-4 h-4 ${
                          cameraFlashMode === 'on'
                            ? 'fill-[#FBBF24] text-[#FBBF24]'
                            : cameraFlashMode === 'off'
                              ? 'text-white/45'
                              : 'fill-white text-white'
                        }`}
                      />
                      <span className="text-[11px] font-bold tracking-tight">
                        {cameraFlashMode === 'auto'
                          ? 'A'
                          : cameraFlashMode === 'on'
                            ? 'ON'
                            : 'OFF'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCameraGridEnabled((v) => !v)}
                      title="Toggle alignment grid"
                      aria-label="Toggle alignment grid"
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                        cameraGridEnabled
                          ? 'text-[#0088FF] bg-white/10'
                          : 'text-white hover:bg-white/10'
                      }`}
                    >
                      <Grid3X3 className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const next =
                          facingMode === 'environment' ? 'user' : 'environment';
                        setFacingMode(next);
                        startCamera(next);
                      }}
                      title="Flip Camera"
                      aria-label="Flip Camera"
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <SwitchCamera className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowCameraSettingsModal((v) => !v)}
                      title="Camera & Filter Settings"
                      aria-label="Camera Settings"
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                        showCameraSettingsModal
                          ? 'text-[#0088FF] bg-white/10'
                          : 'text-white hover:bg-white/10'
                      }`}
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Full-Bleed Camera Viewfinder */}
                  <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
                    <video
                      ref={videoRef}
                      playsInline
                      autoPlay
                      muted
                      className="w-full h-full object-cover"
                    />

                    {/* Optional 3x3 Alignment Grid Overlay */}
                    {cameraGridEnabled && (
                      <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                        {Array.from({ length: 9 }).map((_, idx) => (
                          <div
                            key={idx}
                            className="border border-white/25"
                          />
                        ))}
                      </div>
                    )}

                    {/* Mode-Specific Guide Frame */}
                    {cameraCaptureMode === 'id-card' && (
                      <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 aspect-[1.58/1] max-w-md mx-auto border-2 border-[#0088FF]/80 rounded-xl pointer-events-none flex items-end justify-center pb-2">
                        <span className="px-2.5 py-0.5 rounded bg-black/65 text-[11px] font-medium text-white">
                          Align ID Card within frame
                        </span>
                      </div>
                    )}
                    {cameraCaptureMode === 'book' && (
                      <div className="absolute inset-6 border-2 border-white/45 rounded-lg pointer-events-none flex items-center justify-center">
                        <div className="h-full border-l-2 border-dashed border-[#0088FF]/80" />
                      </div>
                    )}
                    {cameraCaptureMode === 'signature' && (
                      <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-36 max-w-md mx-auto border-2 border-[#0088FF]/80 rounded-xl pointer-events-none flex items-end justify-center pb-2">
                        <span className="px-2.5 py-0.5 rounded bg-black/65 text-[11px] font-medium text-white">
                          Center handwritten signature
                        </span>
                      </div>
                    )}

                    {/* Quick Filter Picker Popover when ⚙️ is tapped */}
                    {showCameraSettingsModal && (
                      <div className="absolute top-3 right-4 w-64 rounded-2xl bg-black/85 backdrop-blur-md border border-white/15 p-3 space-y-2 z-30 shadow-2xl">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            Default Scan Filter
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowCameraSettingsModal(false)}
                            className="text-[11px] text-[#0088FF] font-semibold cursor-pointer"
                          >
                            Done
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-1 max-h-56 overflow-y-auto">
                          {FILTER_OPTIONS.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => {
                                setSelectedCaptureFilter(f.id);
                                setShowCameraSettingsModal(false);
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between cursor-pointer ${
                                selectedCaptureFilter === f.id
                                  ? 'bg-[#0088FF] text-white font-semibold'
                                  : 'text-white/80 hover:bg-white/10'
                              }`}
                            >
                              <span>{f.label}</span>
                              {selectedCaptureFilter === f.id && (
                                <Check className="w-3.5 h-3.5" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Black Camera Dock matching screenshot */}
                  <div className="bg-black pt-1 pb-7 px-4 flex flex-col gap-5 shrink-0 z-20">
                    {/* 5 Capture Mode Tabs: Photo | ID Card | Document | Book | Signature */}
                    <div className="flex items-center justify-around max-w-md mx-auto w-full">
                      {(
                        [
                          { id: 'photo', label: 'Photo' },
                          { id: 'id-card', label: 'ID Card' },
                          { id: 'document', label: 'Document' },
                          { id: 'book', label: 'Book' },
                          { id: 'signature', label: 'Signature' },
                        ] as const
                      ).map((modeTab) => {
                        const isSelected = cameraCaptureMode === modeTab.id;
                        return (
                          <button
                            key={modeTab.id}
                            type="button"
                            onClick={() => setCameraCaptureMode(modeTab.id)}
                            className={`pt-2 pb-1 px-2 text-xs transition-colors cursor-pointer border-t-2 ${
                              isSelected
                                ? 'border-[#0088FF] text-[#0088FF] font-semibold'
                                : 'border-transparent text-white/85 hover:text-white font-medium'
                            }`}
                          >
                            {modeTab.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Shutter Row: [AUTO] [Circular Blue Camera Button] [Gallery / Page Count] */}
                    <div className="grid grid-cols-3 items-center max-w-md mx-auto w-full">
                      {/* Left: AUTO toggle */}
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => setCameraAutoMode((v) => !v)}
                          className="flex flex-col items-center justify-center gap-1 text-white hover:opacity-80 cursor-pointer"
                        >
                          <Timer
                            className={`w-5 h-5 ${
                              cameraAutoMode ? 'text-white' : 'text-white/45'
                            }`}
                          />
                          <span
                            className={`text-[10px] font-bold tracking-wider ${
                              cameraAutoMode ? 'text-white' : 'text-white/45'
                            }`}
                          >
                            {cameraAutoMode ? 'AUTO' : 'MANUAL'}
                          </span>
                        </button>
                      </div>

                      {/* Center: Circular Blue Camera Shutter Button */}
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={handleCaptureFromVideo}
                          aria-label="Capture Document"
                          className="w-16 h-16 rounded-full bg-[#0088FF] hover:bg-[#0077E6] active:scale-95 transition-transform ring-4 ring-[#0055AA]/70 flex items-center justify-center shadow-lg cursor-pointer"
                        >
                          <Camera className="w-7 h-7 text-white fill-white/15" />
                        </button>
                      </div>

                      {/* Right: Captured Pages Thumbnail or Import from Gallery */}
                      <div className="flex items-center justify-center">
                        {pages.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              stopCamera();
                              setStep('crop');
                            }}
                            title="Review captured pages"
                            className="relative w-11 h-11 rounded-lg border-2 border-white/80 overflow-hidden bg-white/10 cursor-pointer"
                          >
                            <img
                              src={pages[pages.length - 1].processedDataUrl}
                              alt="Last captured page"
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-[#0088FF] text-white text-[10px] font-bold">
                              {pages.length}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            title="Import from Gallery"
                            className="flex flex-col items-center justify-center gap-1 text-white/80 hover:text-white cursor-pointer"
                          >
                            <Upload className="w-5 h-5" />
                            <span className="text-[10px] font-semibold">
                              Gallery
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
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
                      Use your phone or laptop camera to photograph contracts, exam sheets, or notes. ElimikaPDF automatically locates all 4 outer page corners and flattens perspective distortion.
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
                    Drag any of the 4 corner handles or 4 edge bars to align with the paper edges, then click Apply Perspective Crop.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
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
                        prev.map((p, idx) => {
                          if (idx !== activePageIndex) return p;
                          const cx =
                            (p.corners[0].x +
                              p.corners[1].x +
                              p.corners[2].x +
                              p.corners[3].x) /
                            4;
                          const cy =
                            (p.corners[0].y +
                              p.corners[1].y +
                              p.corners[2].y +
                              p.corners[3].y) /
                            4;
                          const expandPt = (pt: Point2D): Point2D => ({
                            x: Math.max(
                              0.005,
                              Math.min(
                                0.995,
                                pt.x + (pt.x < cx ? -0.04 : 0.04)
                              )
                            ),
                            y: Math.max(
                              0.005,
                              Math.min(
                                0.995,
                                pt.y + (pt.y < cy ? -0.04 : 0.04)
                              )
                            ),
                          });
                          return {
                            ...p,
                            corners: [
                              expandPt(p.corners[0]),
                              expandPt(p.corners[1]),
                              expandPt(p.corners[2]),
                              expandPt(p.corners[3]),
                            ],
                          };
                        })
                      )
                    }
                    title="Expand all 4 edges outward by 4% so no outer margins or question numbers are clipped"
                    className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                  >
                    Expand +4%
                  </button>
                  <button
                    onClick={() =>
                      setPages((prev) =>
                        prev.map((p, idx) => {
                          if (idx !== activePageIndex) return p;
                          const minX = Math.max(
                            0.005,
                            Math.min(p.corners[0].x, p.corners[3].x)
                          );
                          const maxX = Math.min(
                            0.995,
                            Math.max(p.corners[1].x, p.corners[2].x)
                          );
                          const minY = Math.max(
                            0.005,
                            Math.min(p.corners[0].y, p.corners[1].y)
                          );
                          const maxY = Math.min(
                            0.995,
                            Math.max(p.corners[2].y, p.corners[3].y)
                          );
                          return {
                            ...p,
                            corners: [
                              { x: minX, y: minY },
                              { x: maxX, y: minY },
                              { x: maxX, y: maxY },
                              { x: minX, y: maxY },
                            ],
                          };
                        })
                      )
                    }
                    title="Square and level all 4 edges into a clean 90° rectangle"
                    className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                  >
                    Level 90°
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
                    className="px-2.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-medium text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-[#F4F1F8] cursor-pointer"
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

                {/* 3x Precision Magnifier Loupe while dragging any corner handle OR edge bar */}
                {(() => {
                  const focusPoint: Point2D | null =
                    draggingCornerIdx !== null &&
                    activePage.corners[draggingCornerIdx]
                      ? activePage.corners[draggingCornerIdx]
                      : draggingEdgeState !== null
                        ? {
                            x:
                              (activePage.corners[draggingEdgeState.edgeIdx].x +
                                activePage.corners[
                                  (draggingEdgeState.edgeIdx + 1) % 4
                                ].x) /
                              2,
                            y:
                              (activePage.corners[draggingEdgeState.edgeIdx].y +
                                activePage.corners[
                                  (draggingEdgeState.edgeIdx + 1) % 4
                                ].y) /
                              2,
                          }
                        : null;
                  if (!focusPoint) return null;
                  return (
                    <div
                      className={`absolute top-3 ${
                        focusPoint.x < 0.45 && focusPoint.y < 0.45
                          ? 'right-3'
                          : 'left-3'
                      } w-28 h-28 rounded-full border-3 border-white shadow-2xl overflow-hidden bg-black pointer-events-none z-30`}
                    >
                      <div
                        className="w-full h-full bg-no-repeat"
                        style={{
                          backgroundImage: `url(${activePage.originalDataUrl})`,
                          backgroundSize: '340% 340%',
                          backgroundPosition: `${focusPoint.x * 100}% ${focusPoint.y * 100}%`,
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
                          {Math.round(focusPoint.x * 100)}%,
                          {Math.round(focusPoint.y * 100)}%
                        </span>
                      </div>
                    </div>
                  );
                })()}
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

          {/* STEP 3: UNIFIED ENHANCE, FILTER & SAVE PDF STUDIO */}
          {(step === 'enhance' || step === 'export') && activePage && (
            <div className="p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Enhance & Save Document (Page {activePageIndex + 1} of{' '}
                    {pages.length})
                  </h2>
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    Choose a color filter (such as OCV BLACK to remove watermarks/shadows), adjust brightness, and save or download your PDF immediately.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStep('crop')}
                    className="px-3 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Adjust Crop</span>
                  </button>
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

              {/* Filter Presets + Apply to All Pages Button */}
              <div className="space-y-2.5">
                {pages.length > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                      Page {activePageIndex + 1} Filter:{' '}
                      <strong className="text-[#14101B] dark:text-[#F4F1F8]">
                        {activePage.filter.toUpperCase()}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyFilterToAllPages}
                      disabled={isProcessing}
                      className="px-3 py-1 rounded-lg bg-[#2563EB]/10 text-[#2563EB] dark:text-[#60A5FA] hover:bg-[#2563EB] hover:text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>
                        Apply {activePage.filter.toUpperCase()} to All{' '}
                        {pages.length} Pages
                      </span>
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {FILTER_OPTIONS.map((f) => {
                    const selected = activePage.filter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => updateEnhancementParams({ filter: f.id })}
                        className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#4A1D5E] dark:border-[#9D5CE5] bg-[#4A1D5E]/8 dark:bg-[#9D5CE5]/20'
                            : 'border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33]'
                        }`}
                      >
                        <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] truncate">
                          {f.label}
                        </p>
                        <p className="text-[10px] text-[#6E667D] dark:text-[#A39BB5] mt-0.5 line-clamp-1">
                          {f.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Brightness & Contrast Sliders */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#E4DFEC] dark:border-[#261F33]">
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

              {/* Integrated Save, Open in Editor & Download Dock */}
              <div className="rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] mb-1">
                      Document Filename
                    </label>
                    <input
                      type="text"
                      value={docName}
                      onChange={(e) => setDocName(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[#14101B] dark:text-[#F4F1F8] focus:outline-none focus:border-[#4A1D5E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8] mb-1">
                      PDF Page Size
                    </label>
                    <div className="flex items-center gap-1.5">
                      {(['A4', 'Letter', 'Fit'] as const).map((sz) => (
                        <button
                          key={sz}
                          onClick={() => setPageSize(sz)}
                          className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                            pageSize === sz
                              ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] border-[#4A1D5E] dark:border-[#9D5CE5]'
                              : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5]'
                          }`}
                        >
                          {sz === 'Fit' ? 'Fit Image' : sz}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => handleSaveOrDownloadPdf('open-editor')}
                    disabled={isProcessing || pages.length === 0}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-lg bg-[#4A1D5E] hover:bg-[#3B174B] dark:bg-[#9D5CE5] dark:hover:bg-[#8B47D6] text-white dark:text-[#0D0A12] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    <span>Save & Open in PDF Editor</span>
                  </button>

                  <button
                    onClick={() => handleSaveOrDownloadPdf('save-library')}
                    disabled={isProcessing || pages.length === 0}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-lg bg-[#F2EFF6] dark:bg-[#261F33] hover:bg-[#E4DFEC] dark:hover:bg-[#342B47] text-[#14101B] dark:text-[#F4F1F8] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Save className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF] shrink-0" />
                    <span>Save to My Files</span>
                  </button>

                  <button
                    onClick={() => handleSaveOrDownloadPdf('download')}
                    disabled={isProcessing || pages.length === 0}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Download PDF</span>
                  </button>

                  <button
                    onClick={() => handleSaveOrDownloadPdf('share')}
                    disabled={isProcessing || pages.length === 0}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Share2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                    <span>Share PDF</span>
                  </button>
                </div>
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
                startCamera();
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
