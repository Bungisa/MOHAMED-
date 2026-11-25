import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  Upload,
  FileText,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  RefreshCw,
  Wifi,
  Mail,
  Phone,
  Globe,
  Contact,
  MapPin,
  Trash2,
  ScanLine,
  Loader2,
  History,
  Image as ImageIcon,
  SwitchCamera,
} from 'lucide-react';
import { StoredDocument } from '../types/document';
import { renderPdfPage, getPdfPageCount } from '../services/pdfService';

interface QrCodeReaderWorkspaceProps {
  documents: StoredDocument[];
  selectedDoc?: StoredDocument | null;
  setFeedback: (msg: string | null) => void;
}

type QrScanSourceMode = 'camera' | 'image' | 'pdf';

interface ParsedQrPayload {
  kind: 'url' | 'wifi' | 'email' | 'phone' | 'sms' | 'vcard' | 'geo' | 'text';
  label: string;
  primaryValue: string;
  details?: { key: string; value: string }[];
  safeHref?: string;
}

interface QrScanHistoryItem {
  id: string;
  rawText: string;
  kind: ParsedQrPayload['kind'];
  sourceLabel: string;
  scannedAt: string;
}

const QR_HISTORY_STORAGE_KEY = 'elimikapdf_qr_scan_history_v1';

function parseQrPayload(raw: string): ParsedQrPayload {
  const trimmed = raw.trim();

  // 1. Safe HTTP(S) URL
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    return {
      kind: 'url',
      label: 'Website Link',
      primaryValue: trimmed,
      safeHref: trimmed,
    };
  }

  // 2. Wi-Fi configuration string: WIFI:T:WPA;S:MyNet;P:Secret;;
  if (/^WIFI:/i.test(trimmed)) {
    const getField = (tag: string) => {
      const m = trimmed.match(new RegExp(`${tag}:([^;]*)`, 'i'));
      return m ? m[1].replace(/\\([\\;,:])/g, '$1') : '';
    };
    const ssid = getField('S') || 'Unknown Network';
    const password = getField('P') || '(None)';
    const security = getField('T') || 'Open';
    const hidden = getField('H') === 'true' ? 'Yes' : 'No';
    return {
      kind: 'wifi',
      label: 'Wi-Fi Network',
      primaryValue: ssid,
      details: [
        { key: 'Network (SSID)', value: ssid },
        { key: 'Password', value: password },
        { key: 'Security', value: security },
        { key: 'Hidden', value: hidden },
      ],
    };
  }

  // 3. Email (mailto: or MATMSG:)
  if (/^mailto:/i.test(trimmed)) {
    const addr = trimmed.replace(/^mailto:/i, '').split('?')[0];
    return {
      kind: 'email',
      label: 'Email Address',
      primaryValue: addr || trimmed,
      safeHref: trimmed,
    };
  }
  if (/^MATMSG:/i.test(trimmed)) {
    const to = trimmed.match(/TO:([^;]*)/i)?.[1] || '';
    const sub = trimmed.match(/SUB:([^;]*)/i)?.[1] || '';
    const body = trimmed.match(/BODY:([^;]*)/i)?.[1] || '';
    return {
      kind: 'email',
      label: 'Email Message',
      primaryValue: to || trimmed,
      details: [
        ...(to ? [{ key: 'To', value: to }] : []),
        ...(sub ? [{ key: 'Subject', value: sub }] : []),
        ...(body ? [{ key: 'Message', value: body }] : []),
      ],
      safeHref: to ? `mailto:${encodeURIComponent(to)}` : undefined,
    };
  }

  // 4. Phone number
  if (/^tel:/i.test(trimmed)) {
    const phone = trimmed.replace(/^tel:/i, '').trim();
    return {
      kind: 'phone',
      label: 'Phone Number',
      primaryValue: phone,
      safeHref: `tel:${phone}`,
    };
  }

  // 5. SMS
  if (/^smsto:/i.test(trimmed) || /^sms:/i.test(trimmed)) {
    const rest = trimmed.replace(/^sms(?:to)?:/i, '');
    const [num, ...msgParts] = rest.split(':');
    return {
      kind: 'sms',
      label: 'SMS Message',
      primaryValue: num || trimmed,
      details: msgParts.length
        ? [
            { key: 'Recipient', value: num },
            { key: 'Message', value: msgParts.join(':') },
          ]
        : undefined,
      safeHref: num ? `sms:${num}` : undefined,
    };
  }

  // 6. vCard Contact
  if (/^BEGIN:VCARD/i.test(trimmed)) {
    const fn = trimmed.match(/^FN[^:]*:(.*)$/im)?.[1]?.trim() || '';
    const tel = trimmed.match(/^TEL[^:]*:(.*)$/im)?.[1]?.trim() || '';
    const email = trimmed.match(/^EMAIL[^:]*:(.*)$/im)?.[1]?.trim() || '';
    const org = trimmed.match(/^ORG[^:]*:(.*)$/im)?.[1]?.trim() || '';
    const details: { key: string; value: string }[] = [];
    if (fn) details.push({ key: 'Name', value: fn });
    if (org) details.push({ key: 'Organization', value: org });
    if (tel) details.push({ key: 'Phone', value: tel });
    if (email) details.push({ key: 'Email', value: email });
    return {
      kind: 'vcard',
      label: 'Contact Card (vCard)',
      primaryValue: fn || tel || email || 'Contact Details',
      details: details.length ? details : undefined,
    };
  }

  // 7. Geo Coordinates
  if (/^geo:/i.test(trimmed)) {
    const coords = trimmed.replace(/^geo:/i, '').split('?')[0];
    return {
      kind: 'geo',
      label: 'Map Location',
      primaryValue: coords,
      safeHref: `https://maps.google.com/?q=${encodeURIComponent(coords)}`,
    };
  }

  // 8. Bare domain like www.example.com
  if (/^www\.[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed)) {
    return {
      kind: 'url',
      label: 'Website Link',
      primaryValue: trimmed,
      safeHref: `https://${trimmed}`,
    };
  }

  return {
    kind: 'text',
    label: 'Text Content',
    primaryValue: trimmed,
  };
}

/**
 * Decodes a QR code from an HTMLCanvasElement using jsQR with multi-pass scaling
 * so small, high-resolution, or inverted QR codes decode reliably.
 */
function decodeQrFromCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;

  const tryPass = (w: number, h: number): string | null => {
    let targetCtx = ctx;
    let targetW = canvas.width;
    let targetH = canvas.height;
    if (w !== canvas.width || h !== canvas.height) {
      const scaled = document.createElement('canvas');
      scaled.width = w;
      scaled.height = h;
      const sCtx = scaled.getContext('2d', { willReadFrequently: true });
      if (!sCtx) return null;
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, w, h);
      sCtx.drawImage(canvas, 0, 0, w, h);
      targetCtx = sCtx;
      targetW = w;
      targetH = h;
    }
    const imgData = targetCtx.getImageData(0, 0, targetW, targetH);
    const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
      inversionAttempts: 'attemptBoth',
    });
    return decoded?.data ? decoded.data : null;
  };

  // Pass 1: native resolution (capped to 1400px max dim for speed)
  const maxDim = Math.max(canvas.width, canvas.height);
  if (maxDim <= 1400) {
    const direct = tryPass(canvas.width, canvas.height);
    if (direct) return direct;
  }

  // Pass 2: normalized ~900px
  const scale900 = Math.min(1, 900 / maxDim);
  const res900 = tryPass(
    Math.max(120, Math.round(canvas.width * scale900)),
    Math.max(120, Math.round(canvas.height * scale900))
  );
  if (res900) return res900;

  // Pass 3: downsampled ~500px (helps with dense noisy photos)
  if (maxDim > 520) {
    const scale500 = 500 / maxDim;
    const res500 = tryPass(
      Math.max(120, Math.round(canvas.width * scale500)),
      Math.max(120, Math.round(canvas.height * scale500))
    );
    if (res500) return res500;
  }

  // Pass 4: upscaled 1.6x for tiny QR codes on full-page documents
  if (maxDim < 1100) {
    const up = tryPass(
      Math.round(canvas.width * 1.5),
      Math.round(canvas.height * 1.5)
    );
    if (up) return up;
  }

  return null;
}

export const QrCodeReaderWorkspace: React.FC<QrCodeReaderWorkspaceProps> = ({
  documents,
  selectedDoc,
  setFeedback,
}) => {
  const [mode, setMode] = useState<QrScanSourceMode>('camera');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment'
  );
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [decodedText, setDecodedText] = useState<string | null>(null);
  const [decodedSource, setDecodedSource] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(
    null
  );
  const [isScanningFile, setIsScanningFile] = useState(false);

  const [selectedPdfId, setSelectedPdfId] = useState<string>(
    selectedDoc?.id || documents[0]?.id || ''
  );
  const [isScanningPdf, setIsScanningPdf] = useState(false);
  const [pdfScanProgress, setPdfScanProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 0, total: 0 });
  const [pdfQrResults, setPdfQrResults] = useState<
    { pageNumber: number; text: string }[]
  >([]);

  const [history, setHistory] = useState<QrScanHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(QR_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectedDoc?.id && !selectedPdfId) {
      setSelectedPdfId(selectedDoc.id);
    }
  }, [selectedDoc?.id, selectedPdfId]);

  const recordDecodedResult = useCallback(
    (rawText: string, sourceLabel: string) => {
      const clean = rawText.trim();
      if (!clean) return;
      const parsed = parseQrPayload(clean);
      setDecodedText(clean);
      setDecodedSource(sourceLabel);
      setHistory((prev) => {
        const deduped = prev.filter((item) => item.rawText !== clean);
        const next: QrScanHistoryItem[] = [
          {
            id: `qr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            rawText: clean,
            kind: parsed.kind,
            sourceLabel,
            scannedAt: new Date().toISOString(),
          },
          ...deduped,
        ].slice(0, 25);
        try {
          localStorage.setItem(QR_HISTORY_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore quota errors
        }
        return next;
      });
      setFeedback(`QR code decoded (${parsed.label}).`);
    },
    [setFeedback]
  );

  const stopCamera = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  const startCamera = useCallback(
    async (preferredFacing: 'environment' | 'user' = facingMode) => {
      stopCamera();
      setCameraError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Camera access is unavailable in this browser. You can switch to "Scan Image" to read any QR photo or screenshot.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsCameraActive(true);

        const canvas =
          scanCanvasRef.current || document.createElement('canvas');
        scanCanvasRef.current = canvas;
        let lastScanTs = 0;

        const tick = (ts: number) => {
          const video = videoRef.current;
          if (!video || !streamRef.current) return;

          if (
            video.readyState >= video.HAVE_ENOUGH_DATA &&
            video.videoWidth > 0 &&
            ts - lastScanTs >= 180
          ) {
            lastScanTs = ts;
            const maxW = 640;
            const scale = Math.min(1, maxW / video.videoWidth);
            const w = Math.round(video.videoWidth * scale);
            const h = Math.round(video.videoHeight * scale);
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              const code = jsQR(imgData.data, w, h, {
                inversionAttempts: 'attemptBoth',
              });
              if (code?.data) {
                stopCamera();
                recordDecodedResult(code.data, 'Live Camera');
                return;
              }
            }
          }
          rafIdRef.current = requestAnimationFrame(tick);
        };

        rafIdRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Camera permission denied.';
        setCameraError(
          `Could not open camera (${msg}). Allow camera permission or use "Scan Image" to upload a QR screenshot.`
        );
      }
    },
    [facingMode, recordDecodedResult, stopCamera]
  );

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (mode !== 'camera') {
      stopCamera();
    }
  }, [mode, stopCamera]);

  const handleImageFileSelected = async (file: File) => {
    setIsScanningFile(true);
    setFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      setUploadedPreviewUrl(dataUrl);

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not decode image.'));
        el.src = dataUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas unavailable.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const result = decodeQrFromCanvas(canvas);
      if (result) {
        recordDecodedResult(result, `Image: ${file.name}`);
      } else {
        setFeedback(
          'No QR code was detected in that image. Try a sharper, closer, or higher-contrast photo of the QR code.'
        );
      }
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : 'Could not scan image.'
      );
    } finally {
      setIsScanningFile(false);
    }
  };

  const handleScanPdfDocument = async () => {
    const targetDoc = documents.find((d) => d.id === selectedPdfId);
    if (!targetDoc || !targetDoc.pdfData) {
      setFeedback('Please select a PDF document from your vault first.');
      return;
    }

    setIsScanningPdf(true);
    setPdfQrResults([]);
    setFeedback(null);

    try {
      const totalPages = Math.max(
        1,
        await getPdfPageCount(targetDoc.pdfData).catch(
          () => targetDoc.pageCount || 1
        )
      );
      const maxPagesToScan = Math.min(totalPages, 30);
      setPdfScanProgress({ current: 0, total: maxPagesToScan });

      const found: { pageNumber: number; text: string }[] = [];

      for (let pageNum = 1; pageNum <= maxPagesToScan; pageNum++) {
        setPdfScanProgress({ current: pageNum, total: maxPagesToScan });
        const rendered = await renderPdfPage(targetDoc.pdfData, pageNum, 1.8);
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Page decode failed'));
          el.src = rendered.dataUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          const qrText = decodeQrFromCanvas(canvas);
          if (qrText) {
            found.push({ pageNumber: pageNum, text: qrText });
          }
        }
      }

      setPdfQrResults(found);
      if (found.length > 0) {
        recordDecodedResult(
          found[0].text,
          `${targetDoc.name} (Page ${found[0].pageNumber})`
        );
        setFeedback(
          `Found ${found.length} QR code${found.length === 1 ? '' : 's'} across ${maxPagesToScan} scanned page${maxPagesToScan === 1 ? '' : 's'}.`
        );
      } else {
        setFeedback(
          `Scanned ${maxPagesToScan} page${maxPagesToScan === 1 ? '' : 's'} of "${targetDoc.name}" — no QR code found.`
        );
      }
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : 'Failed to scan PDF pages.'
      );
    } finally {
      setIsScanningPdf(false);
    }
  };

  const handleCopy = async (value: string, key = 'main') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setFeedback('Unable to access clipboard.');
    }
  };

  const parsedResult = decodedText ? parseQrPayload(decodedText) : null;

  const renderKindIcon = (kind: ParsedQrPayload['kind']) => {
    switch (kind) {
      case 'url':
        return <Globe className="w-4 h-4 text-[#0284C7]" />;
      case 'wifi':
        return <Wifi className="w-4 h-4 text-[#0D9488]" />;
      case 'email':
        return <Mail className="w-4 h-4 text-[#7C3AED]" />;
      case 'phone':
      case 'sms':
        return <Phone className="w-4 h-4 text-[#16A34A]" />;
      case 'vcard':
        return <Contact className="w-4 h-4 text-[#EA580C]" />;
      case 'geo':
        return <MapPin className="w-4 h-4 text-[#E11D48]" />;
      default:
        return <QrCode className="w-4 h-4 text-[#4A1D5E] dark:text-[#D5B3FF]" />;
    }
  };

  return (
    <div className="bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4 sm:p-6 space-y-5 shadow-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0D9488]/12 dark:bg-[#0D9488]/25 text-[#0D9488] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
            <ScanLine className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-[#14101B] dark:text-[#F4F1F8]">
              QR Code Reader & Scanner
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Scan QR codes live with your camera, from any image/screenshot, or inside any PDF document — 100% offline.
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="inline-flex items-center p-1 rounded-xl bg-[#F4F1F8] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] self-start">
          <button
            type="button"
            onClick={() => setMode('camera')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'camera'
                ? 'bg-[#0D9488] text-white shadow-xs'
                : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Camera
          </button>
          <button
            type="button"
            onClick={() => setMode('image')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'image'
                ? 'bg-[#0D9488] text-white shadow-xs'
                : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-white'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Image
          </button>
          <button
            type="button"
            onClick={() => setMode('pdf')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'pdf'
                ? 'bg-[#0D9488] text-white shadow-xs'
                : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            From PDF
          </button>
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Scanner Source Panel */}
        <div className="lg:col-span-7 space-y-4">
          {mode === 'camera' && (
            <div className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#0D0A12] overflow-hidden">
              <div className="relative aspect-[4/3] w-full flex items-center justify-center bg-[#0B0911]">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    isCameraActive ? 'block' : 'hidden'
                  }`}
                />

                {/* Viewfinder Frame Overlay */}
                {isCameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-52 h-52 sm:w-60 sm:h-60 relative rounded-2xl border-2 border-white/30 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                      <span className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-[#2DD4BF] rounded-tl-xl" />
                      <span className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-[#2DD4BF] rounded-tr-xl" />
                      <span className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-[#2DD4BF] rounded-bl-xl" />
                      <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-[#2DD4BF] rounded-br-xl" />
                      <div className="absolute inset-x-3 top-1/2 h-0.5 bg-[#2DD4BF] shadow-[0_0_12px_#2DD4BF] animate-pulse" />
                    </div>
                  </div>
                )}

                {!isCameraActive && (
                  <div className="text-center p-6 space-y-3 max-w-sm">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0D9488]/20 text-[#2DD4BF] flex items-center justify-center">
                      <Camera className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-bold text-white">
                      Point camera at any QR code
                    </p>
                    <p className="text-xs text-neutral-400">
                      Instantly reads URLs, Wi-Fi passwords, contacts, emails, phone numbers, and text offline.
                    </p>
                    {cameraError && (
                      <p className="text-xs text-amber-300 bg-amber-950/60 border border-amber-700/50 rounded-xl p-2.5">
                        {cameraError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => startCamera(facingMode)}
                      className="px-5 py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold inline-flex items-center gap-2 shadow-md cursor-pointer transition-colors"
                    >
                      <Camera className="w-4 h-4" />
                      Start Live QR Camera
                    </button>
                  </div>
                )}
              </div>

              {/* Camera Action Bar */}
              <div className="px-4 py-3 bg-[#14101B] border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isCameraActive ? (
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <CameraOff className="w-3.5 h-3.5" />
                      Stop Camera
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startCamera(facingMode)}
                      className="px-3.5 py-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Scan Again
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const next =
                        facingMode === 'environment' ? 'user' : 'environment';
                      setFacingMode(next);
                      if (isCameraActive) {
                        startCamera(next);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <SwitchCamera className="w-3.5 h-3.5" />
                    {facingMode === 'environment' ? 'Back Camera' : 'Front Camera'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setMode('image')}
                  className="text-xs font-semibold text-[#5EEAD4] hover:underline cursor-pointer"
                >
                  Upload QR photo instead
                </button>
              </div>
            </div>
          )}

          {mode === 'image' && (
            <div className="rounded-2xl border-2 border-dashed border-[#D3CBE0] dark:border-[#342B47] bg-[#FAF9FB] dark:bg-[#0D0A12] p-6 text-center space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFileSelected(file);
                  e.target.value = '';
                }}
              />

              {uploadedPreviewUrl ? (
                <div className="space-y-3">
                  <img
                    src={uploadedPreviewUrl}
                    alt="Uploaded QR code preview"
                    className="max-h-64 mx-auto rounded-xl border border-[#E4DFEC] dark:border-[#261F33] shadow-xs object-contain bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isScanningFile}
                    className="px-4 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isScanningFile ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {isScanningFile ? 'Scanning image...' : 'Choose Another Image'}
                  </button>
                </div>
              ) : (
                <div className="py-6 space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0D9488]/12 text-[#0D9488] dark:text-[#5EEAD4] flex items-center justify-center">
                    <Upload className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
                      Upload a QR Code Photo or Screenshot
                    </p>
                    <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-1">
                      Supports PNG, JPG, WEBP, BMP — including dark-mode and inverted QR codes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isScanningFile}
                    className="px-5 py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    {isScanningFile ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ImageIcon className="w-4 h-4" />
                    )}
                    {isScanningFile ? 'Scanning...' : 'Select QR Image'}
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'pdf' && (
            <div className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] p-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                  Select PDF Document from Vault to Scan for QR Codes
                </label>
                {documents.length === 0 ? (
                  <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
                    No documents in your vault yet. Import a PDF first or switch to Camera / Image scan.
                  </p>
                ) : (
                  <select
                    value={selectedPdfId}
                    onChange={(e) => setSelectedPdfId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-semibold text-[#14101B] dark:text-[#F4F1F8]"
                  >
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name} ({doc.pageCount} page{doc.pageCount === 1 ? '' : 's'})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={handleScanPdfDocument}
                disabled={isScanningPdf || documents.length === 0}
                className="w-full py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isScanningPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning Page {pdfScanProgress.current} of {pdfScanProgress.total}...
                  </>
                ) : (
                  <>
                    <ScanLine className="w-4 h-4" />
                    Scan PDF Pages for QR Codes
                  </>
                )}
              </button>

              {pdfQrResults.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#E4DFEC] dark:border-[#261F33]">
                  <p className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                    Detected QR Codes in Document ({pdfQrResults.length})
                  </p>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {pdfQrResults.map((item, idx) => (
                      <button
                        key={`${item.pageNumber}-${idx}`}
                        type="button"
                        onClick={() => {
                          setDecodedText(item.text);
                          setDecodedSource(`PDF Page ${item.pageNumber}`);
                        }}
                        className="w-full p-2.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#0D9488] text-left flex items-start justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <span className="inline-block px-2 py-0.5 rounded bg-[#0D9488]/12 text-[#0D9488] dark:text-[#5EEAD4] text-[10px] font-bold mb-1">
                            Page {item.pageNumber}
                          </span>
                          <p className="text-xs font-mono text-[#14101B] dark:text-[#F4F1F8] break-all line-clamp-2">
                            {item.text}
                          </p>
                        </div>
                        <QrCode className="w-4 h-4 text-[#0D9488] shrink-0 mt-1" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Decoded Result & History */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#6E667D] dark:text-[#A39BB5]">
                Decoded Result
              </span>
              {decodedSource && (
                <span className="text-[11px] font-semibold text-[#0D9488] dark:text-[#5EEAD4]">
                  {decodedSource}
                </span>
              )}
            </div>

            {parsedResult && decodedText ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {renderKindIcon(parsedResult.kind)}
                  <span className="text-sm font-extrabold text-[#14101B] dark:text-[#F4F1F8]">
                    {parsedResult.label}
                  </span>
                </div>

                {parsedResult.details ? (
                  <div className="space-y-1.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] p-3">
                    {parsedResult.details.map((row) => (
                      <div
                        key={row.key}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                          {row.key}:
                        </span>
                        <span className="font-mono font-bold text-[#14101B] dark:text-[#F4F1F8] break-all text-right">
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-mono text-[#14101B] dark:text-[#F4F1F8] break-all whitespace-pre-wrap max-h-44 overflow-y-auto select-text">
                    {decodedText}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(decodedText, 'main')}
                    className="flex-1 px-3 py-2 rounded-xl bg-[#4A1D5E] hover:bg-[#3A164B] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedKey === 'main' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Content
                      </>
                    )}
                  </button>

                  {parsedResult.safeHref && (
                    <a
                      href={parsedResult.safeHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Link
                    </a>
                  )}

                  {mode === 'camera' && !isCameraActive && (
                    <button
                      type="button"
                      onClick={() => startCamera(facingMode)}
                      className="px-3 py-2 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold text-[#14101B] dark:text-[#F4F1F8] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Scan Next
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center space-y-2">
                <QrCode className="w-9 h-9 mx-auto text-[#C4BDD2] dark:text-[#3A314F]" />
                <p className="text-xs font-semibold text-[#6E667D] dark:text-[#A39BB5]">
                  No QR code scanned yet.
                </p>
                <p className="text-[11px] text-[#8A829B]">
                  Scan using your camera, upload an image, or scan any PDF in your vault.
                </p>
              </div>
            )}
          </div>

          {/* Recent Scan History */}
          {history.length > 0 && (
            <div className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] bg-[#FAF9FB] dark:bg-[#0D0A12] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#6E667D]" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#6E667D] dark:text-[#A39BB5]">
                    Recent Scans ({history.length})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHistory([]);
                    try {
                      localStorage.removeItem(QR_HISTORY_STORAGE_KEY);
                    } catch {
                      // Ignore
                    }
                  }}
                  className="text-[11px] font-semibold text-rose-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setDecodedText(item.rawText);
                      setDecodedSource(item.sourceLabel);
                    }}
                    className="w-full p-2.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#0D9488] text-left flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <div className="shrink-0">{renderKindIcon(item.kind)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono font-semibold text-[#14101B] dark:text-[#F4F1F8] truncate">
                        {item.rawText}
                      </p>
                      <p className="text-[10px] text-[#8A829B] truncate">
                        {item.sourceLabel}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
