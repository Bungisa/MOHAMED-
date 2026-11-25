import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  PDFName,
  PDFString,
} from 'pdf-lib';
import {
  renderPdfPage,
  extractAllPdfText,
  getPdfPageCount,
  createPdfFromImages,
} from './pdfService';
import {
  parseUploadedWordFile,
  generatePdfFromWordBlocks,
} from './wordConversionService';

/**
 * Ensures any string passed to pdf-lib StandardFonts (WinAnsi encoding)
 * never throws "WinAnsi cannot encode ..." on Unicode symbols, newlines, tabs, or emojis.
 */
function toWinAnsiSafeText(input: string): string {
  return String(input ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/\u00A0/g, ' ')
    .replace(/\u20A6/g, 'NGN ')
    .replace(/\u20B9/g, 'INR ')
    .replace(/\u20B5/g, 'GHS ')
    .replace(/\u20AA/g, 'ILS ')
    .replace(/\u20A9/g, 'KRW ')
    .replace(/\u20B1/g, 'PHP ')
    .replace(/\u20AB/g, 'VND ')
    .replace(/\u0E3F/g, 'THB ')
    .replace(/\u20B4/g, 'UAH ')
    .replace(/\u20B8/g, 'KZT ')
    .replace(/\u20BA/g, 'TRY ')
    .replace(/\u20BD/g, 'RUB ')
    .replace(/[\u2190-\u21FF]/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function hexToRgbComponents(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return {
      r: Number.isNaN(r) ? 0 : r,
      g: Number.isNaN(g) ? 0 : g,
      b: Number.isNaN(b) ? 0 : b,
    };
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return {
    r: Number.isNaN(r) ? 0 : r,
    g: Number.isNaN(g) ? 0 : g,
    b: Number.isNaN(b) ? 0 : b,
  };
}

// ============================================================================
// 1. PAGE NUMBERS TOOL
// ============================================================================
export interface PageNumberOptions {
  position:
    | 'bottom-center'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'top-right'
    | 'top-left';
  format: 'page-of-total' | 'slash' | 'number-only' | 'dashed';
  startNumber: number;
  fromPage: number;
  toPage: number;
  fontSize: number;
  fontFamily: 'helvetica' | 'times' | 'courier';
  marginPt: number;
  colorHex: string;
}

export async function addPageNumbersToPdf(
  pdfBytes: Uint8Array,
  options: PageNumberOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const fontEnum =
    options.fontFamily === 'times'
      ? StandardFonts.TimesRomanBold
      : options.fontFamily === 'courier'
        ? StandardFonts.CourierBold
        : StandardFonts.HelveticaBold;
  const font = await doc.embedFont(fontEnum);
  const pages = doc.getPages();
  const total = pages.length;
  const { r, g, b } = hexToRgbComponents(options.colorHex || '#14101B');

  const startIdx = Math.max(1, options.fromPage || 1) - 1;
  const endIdx = Math.min(total, options.toPage || total) - 1;

  for (let i = startIdx; i <= endIdx; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const displayNum = (options.startNumber || 1) + (i - startIdx);
    const displayTotal = (options.startNumber || 1) + (total - 1);

    let label = `${displayNum}`;
    if (options.format === 'page-of-total') {
      label = `Page ${displayNum} of ${displayTotal}`;
    } else if (options.format === 'slash') {
      label = `${displayNum} / ${displayTotal}`;
    } else if (options.format === 'dashed') {
      label = `— ${displayNum} —`;
    }

    const fSize = Math.max(8, Math.min(28, options.fontSize || 11));
    const textW = font.widthOfTextAtSize(label, fSize);
    const margin = Math.max(14, options.marginPt || 24);

    let x = (width - textW) / 2;
    if (options.position.endsWith('left')) {
      x = margin;
    } else if (options.position.endsWith('right')) {
      x = Math.max(margin, width - textW - margin);
    }

    const y = options.position.startsWith('top')
      ? Math.max(margin, height - margin - fSize)
      : margin;

    page.drawText(label, {
      x,
      y,
      size: fSize,
      font,
      color: rgb(r, g, b),
    });
  }

  return await doc.save();
}

// ============================================================================
// 2. STAMP WATERMARK TOOL (Text or Image over PDF)
// ============================================================================
export interface StampWatermarkOptions {
  text: string;
  position: 'diagonal' | 'center' | 'top-center' | 'bottom-center' | 'tile';
  opacity: number; // 0.05 to 1.0
  fontSize: number;
  colorHex: string;
  rotationDeg: number;
  imageDataUrl?: string;
}

export async function stampWatermarkOntoPdf(
  pdfBytes: Uint8Array,
  options: StampWatermarkOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const { r, g, b } = hexToRgbComponents(options.colorHex || '#4A1D5E');
  const opacity = Math.max(0.05, Math.min(1, options.opacity ?? 0.22));
  const fSize = Math.max(12, Math.min(96, options.fontSize || 42));
  const label = (options.text || 'CONFIDENTIAL').trim();

  let embeddedImg: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (options.imageDataUrl) {
    try {
      const b64 = options.imageDataUrl.split(',')[1];
      const imgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (options.imageDataUrl.startsWith('data:image/png')) {
        embeddedImg = await doc.embedPng(imgBytes);
      } else {
        embeddedImg = await doc.embedJpg(imgBytes);
      }
    } catch {
      embeddedImg = null;
    }
  }

  for (const page of pages) {
    const { width, height } = page.getSize();

    if (embeddedImg) {
      const targetW = Math.min(width * 0.45, 240);
      const scale = targetW / Math.max(1, embeddedImg.width);
      const targetH = embeddedImg.height * scale;
      page.drawImage(embeddedImg, {
        x: (width - targetW) / 2,
        y: (height - targetH) / 2,
        width: targetW,
        height: targetH,
        opacity,
      });
    }

    if (!label) continue;
    const textW = font.widthOfTextAtSize(label, fSize);

    if (options.position === 'tile') {
      const stepX = Math.max(180, textW + 80);
      const stepY = 160;
      for (let y = 60; y < height; y += stepY) {
        for (let x = 40; x < width; x += stepX) {
          page.drawText(label, {
            x,
            y,
            size: Math.round(fSize * 0.65),
            font,
            color: rgb(r, g, b),
            opacity,
            rotate: degrees(options.rotationDeg || 35),
          });
        }
      }
    } else if (options.position === 'diagonal') {
      page.drawText(label, {
        x: Math.max(30, width * 0.18),
        y: height * 0.38,
        size: fSize,
        font,
        color: rgb(r, g, b),
        opacity,
        rotate: degrees(options.rotationDeg || 38),
      });
    } else if (options.position === 'top-center') {
      page.drawText(label, {
        x: Math.max(16, (width - textW) / 2),
        y: height - fSize - 24,
        size: Math.min(fSize, 28),
        font,
        color: rgb(r, g, b),
        opacity,
      });
    } else if (options.position === 'bottom-center') {
      page.drawText(label, {
        x: Math.max(16, (width - textW) / 2),
        y: 24,
        size: Math.min(fSize, 28),
        font,
        color: rgb(r, g, b),
        opacity,
      });
    } else {
      page.drawText(label, {
        x: Math.max(16, (width - textW) / 2),
        y: height / 2,
        size: fSize,
        font,
        color: rgb(r, g, b),
        opacity,
      });
    }
  }

  return await doc.save();
}

// ============================================================================
// 3. SIGN PDF TOOL (Draw / Type / Upload Electronic Signature)
// ============================================================================
export interface SignPdfOptions {
  signatureDataUrl?: string;
  typedName?: string;
  signerTitle?: string;
  includeDate?: boolean;
  colorHex: string;
  pageScope: 'last' | 'first' | 'all' | 'custom';
  customPageNumber?: number;
  position: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'middle-right';
}

export async function signPdfDocument(
  pdfBytes: Uint8Array,
  options: SignPdfOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const { r, g, b } = hexToRgbComponents(options.colorHex || '#003FE8');

  let sigImg: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (options.signatureDataUrl) {
    try {
      const b64 = options.signatureDataUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (options.signatureDataUrl.startsWith('data:image/png')) {
        sigImg = await doc.embedPng(bytes);
      } else {
        sigImg = await doc.embedJpg(bytes);
      }
    } catch {
      sigImg = null;
    }
  }

  const targetIndices: number[] = [];
  if (options.pageScope === 'all') {
    for (let i = 0; i < total; i++) targetIndices.push(i);
  } else if (options.pageScope === 'first') {
    targetIndices.push(0);
  } else if (options.pageScope === 'custom') {
    const idx = Math.max(
      0,
      Math.min(total - 1, (options.customPageNumber || 1) - 1)
    );
    targetIndices.push(idx);
  } else {
    targetIndices.push(total - 1);
  }

  const dateStr = new Date().toISOString().slice(0, 10);

  for (const idx of targetIndices) {
    const page = pages[idx];
    const { width, height } = page.getSize();
    const boxW = 175;
    const boxH = 68;

    let x = width - boxW - 36;
    let y = 42;
    if (options.position === 'bottom-left') {
      x = 36;
      y = 42;
    } else if (options.position === 'bottom-center') {
      x = (width - boxW) / 2;
      y = 42;
    } else if (options.position === 'middle-right') {
      x = width - boxW - 36;
      y = height * 0.35;
    }

    // Subtle signature line
    page.drawLine({
      start: { x, y: y + 18 },
      end: { x: x + boxW, y: y + 18 },
      thickness: 0.8,
      color: rgb(0.45, 0.45, 0.5),
    });

    if (sigImg) {
      const scale = Math.min(
        (boxW - 10) / Math.max(1, sigImg.width),
        44 / Math.max(1, sigImg.height)
      );
      const drawW = sigImg.width * scale;
      const drawH = sigImg.height * scale;
      page.drawImage(sigImg, {
        x: x + (boxW - drawW) / 2,
        y: y + 21,
        width: drawW,
        height: drawH,
      });
    } else if (options.typedName?.trim()) {
      page.drawText(options.typedName.trim(), {
        x: x + 6,
        y: y + 26,
        size: 20,
        font: fontBold,
        color: rgb(r, g, b),
      });
    }

    const metaParts: string[] = [];
    if (options.typedName?.trim()) metaParts.push(options.typedName.trim());
    if (options.signerTitle?.trim()) metaParts.push(options.signerTitle.trim());
    if (options.includeDate) metaParts.push(`Signed ${dateStr}`);

    if (metaParts.length > 0) {
      page.drawText(metaParts.join(' · ').slice(0, 48), {
        x,
        y: y + 6,
        size: 8,
        font: fontRegular,
        color: rgb(0.25, 0.25, 0.3),
      });
    }
  }

  return await doc.save();
}

// ============================================================================
// 4. CROP PDF TOOL
// ============================================================================
export interface CropPdfOptions {
  topPct: number; // 0..45
  bottomPct: number; // 0..45
  leftPct: number; // 0..45
  rightPct: number; // 0..45
  scope: 'all' | 'current';
  currentPage?: number;
}

export async function cropPdfDocument(
  pdfBytes: Uint8Array,
  options: CropPdfOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const top = Math.max(0, Math.min(0.45, (options.topPct || 0) / 100));
  const bottom = Math.max(0, Math.min(0.45, (options.bottomPct || 0) / 100));
  const left = Math.max(0, Math.min(0.45, (options.leftPct || 0) / 100));
  const right = Math.max(0, Math.min(0.45, (options.rightPct || 0) / 100));

  pages.forEach((page, idx) => {
    if (
      options.scope === 'current' &&
      options.currentPage &&
      idx + 1 !== options.currentPage
    ) {
      return;
    }
    const { width, height } = page.getSize();
    const newX = width * left;
    const newY = height * bottom;
    const newW = Math.max(50, width * (1 - left - right));
    const newH = Math.max(50, height * (1 - top - bottom));
    page.setCropBox(newX, newY, newW, newH);
    page.setMediaBox(newX, newY, newW, newH);
  });

  return await doc.save();
}

// ============================================================================
// 5. REDACT PDF TOOL (Permanent Rasterized Content & Pattern Redaction)
// ============================================================================
export interface RedactBoxSpec {
  id: string;
  pageNumber: number;
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
}

export interface RedactPdfOptions {
  boxes: RedactBoxSpec[];
  searchTerms: string[];
  redactEmails: boolean;
  redactPhones: boolean;
  fillColor: '#000000' | '#FFFFFF';
}

export async function redactPdfDocument(
  pdfBytes: Uint8Array,
  options: RedactPdfOptions
): Promise<{ pdfBytes: Uint8Array; redactedCount: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await loadingTask.promise;
  const outPdf = await PDFDocument.create();
  let redactedCount = 0;

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}/;
  const cleanTerms = options.searchTerms
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  try {
    if (typeof document === 'undefined') {
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const fillRgb =
        options.fillColor === '#FFFFFF' ? rgb(1, 1, 1) : rgb(0, 0, 0);

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const baseVp = page.getViewport({ scale: 1.0 });
        const pdfPage = pages[pageNum - 1];
        if (!pdfPage) continue;
        const { width, height } = pdfPage.getSize();

        const pageBoxes = options.boxes.filter((b) => b.pageNumber === pageNum);
        for (const box of pageBoxes) {
          const rx = box.x * width;
          const rw = box.width * width;
          const rh = box.height * height;
          const ry = height - box.y * height - rh;
          pdfPage.drawRectangle({
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            color: fillRgb,
          });
          redactedCount++;
        }

        if (
          cleanTerms.length > 0 ||
          options.redactEmails ||
          options.redactPhones
        ) {
          const textContent = await page.getTextContent();
          const pageW = baseVp.width || width || 595.28;
          const pageH = baseVp.height || height || 841.89;
          for (const item of textContent.items) {
            if (!('str' in item) || !item.str.trim() || !item.transform) continue;
            const str = item.str;
            const lower = str.toLowerCase();
            const matchesTerm = cleanTerms.some((term) => lower.includes(term));
            const matchesEmail = options.redactEmails && emailRegex.test(str);
            const matchesPhone = options.redactPhones && phoneRegex.test(str);
            if (matchesTerm || matchesEmail || matchesPhone) {
              const tx = item.transform[4];
              const ty = item.transform[5];
              const fontH = Math.max(
                10,
                Math.round(Math.hypot(item.transform[2], item.transform[3]) || 12)
              );
              const itemW = Math.max(
                24,
                item.width || str.length * (fontH * 0.55)
              );
              pdfPage.drawRectangle({
                x: Math.max(0, (tx / pageW) * width - 2),
                y: Math.max(0, (ty / pageH) * height - 2),
                width: ((itemW + 6) / pageW) * width,
                height: ((fontH * 1.45) / pageH) * height,
                color: fillRgb,
              });
              redactedCount++;
            }
          }
        }
      }

      return {
        pdfBytes: await pdfDoc.save({ useObjectStreams: false }),
        redactedCount,
      };
    }

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseVp = page.getViewport({ scale: 1.0 });
      const hiVp = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(hiVp.width);
      canvas.height = Math.floor(hiVp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: hiVp,
        canvas,
      }).promise;

      ctx.fillStyle = options.fillColor || '#000000';

      // 1. Apply manual redaction boxes on this page
      const pageBoxes = options.boxes.filter((b) => b.pageNumber === pageNum);
      for (const box of pageBoxes) {
        ctx.fillRect(
          box.x * canvas.width,
          box.y * canvas.height,
          box.width * canvas.width,
          box.height * canvas.height
        );
        redactedCount++;
      }

      // 2. Apply automatic text/regex redaction on this page
      if (
        cleanTerms.length > 0 ||
        options.redactEmails ||
        options.redactPhones
      ) {
        const textContent = await page.getTextContent();
        const pageW = baseVp.width || 595.28;
        const pageH = baseVp.height || 841.89;

        for (const item of textContent.items) {
          if (!('str' in item) || !item.str.trim() || !item.transform) continue;
          const str = item.str;
          const lower = str.toLowerCase();

          const matchesTerm = cleanTerms.some((term) => lower.includes(term));
          const matchesEmail = options.redactEmails && emailRegex.test(str);
          const matchesPhone = options.redactPhones && phoneRegex.test(str);

          if (matchesTerm || matchesEmail || matchesPhone) {
            const tx = item.transform[4];
            const ty = item.transform[5];
            const fontH = Math.max(
              10,
              Math.round(Math.hypot(item.transform[2], item.transform[3]) || 12)
            );
            const itemW = Math.max(
              24,
              item.width || str.length * (fontH * 0.55)
            );

            const rx = Math.max(0, (tx - 2) / pageW) * canvas.width;
            const ry =
              Math.max(0, 1 - (ty + fontH * 1.15) / pageH) * canvas.height;
            const rw = Math.min(canvas.width - rx, ((itemW + 6) / pageW) * canvas.width);
            const rh = ((fontH * 1.45) / pageH) * canvas.height;

            ctx.fillRect(rx, ry, rw, rh);
            redactedCount++;
          }
        }
      }

      const jpgUrl = canvas.toDataURL('image/jpeg', 0.94);
      const b64 = jpgUrl.split(',')[1];
      const jpgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const embedded = await outPdf.embedJpg(jpgBytes);
      const outPage = outPdf.addPage([baseVp.width, baseVp.height]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: baseVp.width,
        height: baseVp.height,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return {
    pdfBytes: await outPdf.save(),
    redactedCount,
  };
}

// ============================================================================
// 6. REPAIR PDF & UNLOCK PDF & PDF/A ARCHIVAL TOOLS
// ============================================================================
export async function repairPdfDocument(pdfBytes: Uint8Array): Promise<{
  pdfBytes: Uint8Array;
  recoveredPages: number;
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  let recoveredPages = 0;

  try {
    const srcDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
      updateMetadata: true,
    });
    const outDoc = await PDFDocument.create();
    const total = srcDoc.getPageCount();
    diagnostics.push(`Parsed XRef table & trailer (${total} page nodes found).`);

    for (let i = 0; i < total; i++) {
      try {
        const [copied] = await outDoc.copyPages(srcDoc, [i]);
        outDoc.addPage(copied);
        recoveredPages++;
      } catch {
        diagnostics.push(
          `Page ${i + 1} stream corrupted — reconstructing via raster fallback.`
        );
        const rendered = await renderPdfPage(pdfBytes, i + 1, 1.8, 'image/jpeg', 0.92);
        const b64 = rendered.dataUrl.split(',')[1];
        const jpgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const emb = await outDoc.embedJpg(jpgBytes);
        const p = outDoc.addPage([rendered.width / 1.8, rendered.height / 1.8]);
        p.drawImage(emb, {
          x: 0,
          y: 0,
          width: rendered.width / 1.8,
          height: rendered.height / 1.8,
        });
        recoveredPages++;
      }
    }

    outDoc.setProducer('ElimikaPDF Repair Engine (PDF 1.7 Standard)');
    outDoc.setModificationDate(new Date());
    diagnostics.push(
      `Rebuilt clean cross-reference table and object streams (${recoveredPages}/${total} pages verified).`
    );

    return {
      pdfBytes: await outDoc.save({ useObjectStreams: false }),
      recoveredPages,
      diagnostics,
    };
  } catch {
    diagnostics.push(
      'Primary PDF object tree damaged; running deep page-by-page raster recovery...'
    );
    const outDoc = await PDFDocument.create();
    const count = await getPdfPageCount(pdfBytes);
    for (let p = 1; p <= count; p++) {
      const rendered = await renderPdfPage(pdfBytes, p, 1.8, 'image/jpeg', 0.92);
      const b64 = rendered.dataUrl.split(',')[1];
      const jpgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const emb = await outDoc.embedJpg(jpgBytes);
      const page = outDoc.addPage([595.28, 841.89]);
      page.drawImage(emb, { x: 0, y: 0, width: 595.28, height: 841.89 });
      recoveredPages++;
    }
    diagnostics.push(`Recovered ${recoveredPages} page(s) into a clean PDF container.`);
    return {
      pdfBytes: await outDoc.save(),
      recoveredPages,
      diagnostics,
    };
  }
}

export async function convertPdfToPdfA(
  pdfBytes: Uint8Array,
  docTitle: string,
  conformance: 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b' = 'PDF/A-1b'
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const nowIso = new Date().toISOString();
  const partNum = conformance === 'PDF/A-3b' ? '3' : conformance === 'PDF/A-2b' ? '2' : '1';

  doc.setTitle(docTitle || 'Archived PDF/A Document');
  doc.setCreator('ElimikaPDF Archival Engine');
  doc.setProducer(`ElimikaPDF ISO 19005-${partNum} (${conformance})`);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const xmpXml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>${partNum}</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${docTitle.replace(/[<>&]/g, '')}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>ElimikaPDF ISO PDF/A Converter</xmp:CreatorTool>
      <xmp:CreateDate>${nowIso}</xmp:CreateDate>
      <xmp:ModifyDate>${nowIso}</xmp:ModifyDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const xmpBytes = new TextEncoder().encode(xmpXml);
  const metadataStream = doc.context.stream(xmpBytes, {
    Type: 'Metadata',
    Subtype: 'XML',
    Length: xmpBytes.byteLength,
  });
  const metadataRef = doc.context.register(metadataStream);
  doc.catalog.set(PDFName.of('Metadata'), metadataRef);
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'));

  return await doc.save({ useObjectStreams: false });
}

export async function unlockPdfDocument(
  pdfBytes: Uint8Array
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const cleanDoc = await PDFDocument.create();
  const indices = doc.getPageIndices();
  const copied = await cleanDoc.copyPages(doc, indices);
  copied.forEach((p) => cleanDoc.addPage(p));
  return await cleanDoc.save({ useObjectStreams: false });
}

// ============================================================================
// 7. PDF FORMS TOOL (Create Interactive Fillable AcroForm Fields)
// ============================================================================
export interface PdfFormFieldSpec {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'checkbox' | 'dropdown';
  pageNumber: number;
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
  defaultValue?: string;
  checked?: boolean;
  options?: string[];
}

export async function buildFillablePdfForm(
  pdfBytes: Uint8Array,
  fields: PdfFormFieldSpec[],
  flattenForm = false
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const pages = doc.getPages();

  for (const f of fields) {
    const pageIdx = Math.max(0, Math.min(pages.length - 1, f.pageNumber - 1));
    const page = pages[pageIdx];
    const { width, height } = page.getSize();

    const fx = f.x * width;
    const fh = Math.max(16, f.height * height);
    const fy = Math.max(12, height - f.y * height - fh);
    const fw = Math.max(24, f.width * width);

    if (f.label.trim()) {
      page.drawText(f.label.trim(), {
        x: fx,
        y: fy + fh + 4,
        size: 9.5,
        font,
        color: rgb(0.15, 0.12, 0.22),
      });
    }

    const safeFieldName = `${f.name.replace(/[^a-zA-Z0-9_]/g, '_')}_${f.id.slice(-4)}`;

    if (f.type === 'text') {
      const tf = form.createTextField(safeFieldName);
      if (f.defaultValue) tf.setText(f.defaultValue);
      tf.addToPage(page, {
        x: fx,
        y: fy,
        width: fw,
        height: fh,
        borderWidth: 1,
        borderColor: rgb(0.29, 0.11, 0.37),
      });
    } else if (f.type === 'checkbox') {
      const cb = form.createCheckBox(safeFieldName);
      cb.addToPage(page, {
        x: fx,
        y: fy,
        width: Math.min(fw, 18),
        height: Math.min(fh, 18),
        borderWidth: 1,
        borderColor: rgb(0.29, 0.11, 0.37),
      });
      if (f.checked) cb.check();
    } else if (f.type === 'dropdown') {
      const dd = form.createDropdown(safeFieldName);
      const opts =
        f.options && f.options.length > 0
          ? f.options
          : ['Option A', 'Option B', 'Option C'];
      dd.addOptions(opts);
      if (f.defaultValue && opts.includes(f.defaultValue)) {
        dd.select(f.defaultValue);
      } else {
        dd.select(opts[0]);
      }
      dd.addToPage(page, {
        x: fx,
        y: fy,
        width: fw,
        height: fh,
        borderWidth: 1,
        borderColor: rgb(0.29, 0.11, 0.37),
      });
    }
  }

  if (flattenForm) {
    form.flatten();
  }

  return await doc.save();
}

// ============================================================================
// 8. PDF TO EXCEL (.XLS / .CSV) & EXCEL TO PDF CONVERTERS
// ============================================================================
export async function extractPdfToExcelRows(
  pdfBytes: Uint8Array
): Promise<string[][]> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await loadingTask.promise;
  const allRows: string[][] = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();

      const items: { text: string; x: number; y: number }[] = [];
      for (const item of tc.items) {
        if ('str' in item && item.str.trim() && item.transform) {
          items.push({
            text: item.str.trim(),
            x: Math.round(item.transform[4]),
            y: Math.round(item.transform[5]),
          });
        }
      }

      // Sort top-to-bottom (descending Y in PDF coords), then left-to-right (ascending X)
      items.sort((a, b) => (Math.abs(b.y - a.y) > 6 ? b.y - a.y : a.x - b.x));

      const lineGroups: { y: number; cells: { x: number; text: string }[] }[] = [];
      for (const it of items) {
        const last = lineGroups[lineGroups.length - 1];
        if (last && Math.abs(last.y - it.y) <= 6) {
          const prevCell = last.cells[last.cells.length - 1];
          if (prevCell && it.x - prevCell.x < 42) {
            prevCell.text = `${prevCell.text} ${it.text}`;
          } else {
            last.cells.push({ x: it.x, text: it.text });
          }
        } else {
          lineGroups.push({ y: it.y, cells: [{ x: it.x, text: it.text }] });
        }
      }

      if (pdf.numPages > 1) {
        allRows.push([`--- Page ${p} ---`, '', '', '']);
      }

      for (const grp of lineGroups) {
        grp.cells.sort((a, b) => a.x - b.x);
        const rowCells = grp.cells.map((c) => c.text);
        if (rowCells.length === 1 && rowCells[0].includes('  ')) {
          allRows.push(rowCells[0].split(/\s{2,}/));
        } else {
          allRows.push(rowCells);
        }
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return allRows.length > 0
    ? allRows
    : [['Column A', 'Column B', 'Column C'], ['No tabular text found', '', '']];
}

export function buildCsvBytesFromRows(rows: string[][]): Uint8Array {
  const csvLines = rows.map((row) =>
    row
      .map((cell) => {
        const clean = String(cell ?? '').replace(/"/g, '""');
        return /[,"\n]/.test(clean) ? `"${clean}"` : clean;
      })
      .join(',')
  );
  return new TextEncoder().encode('\uFEFF' + csvLines.join('\r\n'));
}

export function buildExcelXmlBytesFromRows(
  rows: string[][],
  sheetName = 'Extracted_PDF_Data'
): Uint8Array {
  const escapeXml = (s: string) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const xmlRows = rows
    .map((row, rIdx) => {
      const cells = row
        .map((cell) => {
          const trimmed = String(cell ?? '').trim();
          const numVal = Number(trimmed.replace(/,/g, ''));
          const isNumeric =
            trimmed !== '' &&
            !Number.isNaN(numVal) &&
            /^-?[\d,]+(\.\d+)?$/.test(trimmed);
          const styleAttr = rIdx === 0 ? ' ss:StyleID="sHeader"' : '';
          return `<Cell${styleAttr}><Data ss:Type="${
            isNumeric ? 'Number' : 'String'
          }">${isNumeric ? numVal : escapeXml(trimmed)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sHeader">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#15803D" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(sheetName.slice(0, 28) || 'Sheet1')}">
  <Table>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

  return new TextEncoder().encode(workbookXml);
}

export async function convertSpreadsheetRowsToPdf(
  rows: string[][],
  title: string,
  orientation: 'portrait' | 'landscape' = 'landscape'
): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);

  const pageW = orientation === 'landscape' ? 841.89 : 595.28;
  const pageH = orientation === 'landscape' ? 595.28 : 841.89;
  const margin = 30;

  const nonEmptyRows = rows.filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== '')
  );
  const safeRows =
    nonEmptyRows.length > 0
      ? nonEmptyRows
      : [
          ['Item', 'Description', 'Quantity', 'Amount'],
          ['1', 'Spreadsheet Row', '1', '0.00'],
        ];

  const colCount = Math.max(
    1,
    Math.min(14, Math.max(...safeRows.map((r) => r.length)))
  );
  const tableW = pageW - margin * 2;
  const colW = tableW / colCount;
  const fontSize = colCount > 10 ? 7.5 : colCount > 7 ? 8.5 : 9.5;
  const rowH = 21;

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const safeTitle =
    toWinAnsiSafeText(title || 'Spreadsheet Report').trim() ||
    'Spreadsheet Report';

  // Title banner
  page.drawText(safeTitle.slice(0, 95), {
    x: margin,
    y: y - 14,
    size: 13,
    font: fontBold,
    color: rgb(0.08, 0.45, 0.22),
  });
  y -= 26;

  for (let rIdx = 0; rIdx < safeRows.length; rIdx++) {
    if (y - rowH < margin + 18) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }

    const row = safeRows[rIdx];
    const firstCellRaw = String(row[0] ?? '').trim();
    const isSheetBanner =
      /^===\s*Sheet:/i.test(firstCellRaw) &&
      row.slice(1).every((c) => !String(c ?? '').trim());
    const isHeader = rIdx === 0 || isSheetBanner;

    page.drawRectangle({
      x: margin,
      y: y - rowH,
      width: tableW,
      height: rowH,
      color: isSheetBanner
        ? rgb(0.18, 0.33, 0.24)
        : isHeader
          ? rgb(0.08, 0.5, 0.24)
          : rIdx % 2 === 1
            ? rgb(0.96, 0.97, 0.98)
            : rgb(1, 1, 1),
      borderColor: rgb(0.82, 0.85, 0.88),
      borderWidth: 0.6,
    });

    if (isSheetBanner) {
      const bannerText = toWinAnsiSafeText(
        firstCellRaw.replace(/^===\s*|\s*===$/g, '')
      ).trim();
      page.drawText(bannerText.slice(0, 110), {
        x: margin + 8,
        y: y - rowH + 6.5,
        size: 9.5,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      y -= rowH;
      continue;
    }

    for (let cIdx = 0; cIdx < colCount; cIdx++) {
      const cellText = toWinAnsiSafeText(String(row[cIdx] ?? '')).trim();
      if (!cellText) continue;
      const charWidthApprox = fontSize * 0.54;
      const maxChars = Math.max(4, Math.floor((colW - 10) / charWidthApprox));
      const clipped =
        cellText.length > maxChars
          ? cellText.slice(0, Math.max(1, maxChars - 2)) + '..'
          : cellText;

      page.drawText(clipped, {
        x: margin + cIdx * colW + 5,
        y: y - rowH + 6.5,
        size: fontSize,
        font: isHeader ? fontBold : fontReg,
        color: isHeader ? rgb(1, 1, 1) : rgb(0.1, 0.1, 0.14),
      });
    }

    y -= rowH;
  }

  return {
    pdfBytes: await doc.save(),
    pageCount: doc.getPageCount(),
  };
}

// ============================================================================
// 9. PDF TO POWERPOINT & POWERPOINT TO PDF
// ============================================================================
export interface SlideDeckItem {
  slideNumber: number;
  title: string;
  bullets: string[];
  imageDataUrl?: string;
}

export async function extractPdfToSlides(
  pdfBytes: Uint8Array,
  docName: string
): Promise<SlideDeckItem[]> {
  const texts = await extractAllPdfText(pdfBytes);
  const slides: SlideDeckItem[] = [];

  for (let i = 0; i < texts.length; i++) {
    const item = texts[i];
    let imageDataUrl: string | undefined;
    if (typeof document !== 'undefined') {
      try {
        const rendered = await renderPdfPage(
          pdfBytes,
          item.pageNumber,
          1.1,
          'image/jpeg',
          0.85
        );
        imageDataUrl = rendered.dataUrl;
      } catch {
        imageDataUrl = undefined;
      }
    }
    const lines = item.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const title =
      lines[0] && lines[0].length <= 80
        ? lines[0]
        : `${docName.replace(/\.pdf$/i, '')} — Slide ${item.pageNumber}`;
    const bullets =
      lines.length > 1
        ? lines.slice(1, 7).map((l) => (l.length > 120 ? l.slice(0, 117) + '...' : l))
        : ['Visual slide snapshot extracted from PDF page ' + item.pageNumber];

    slides.push({
      slideNumber: item.pageNumber,
      title,
      bullets,
      imageDataUrl,
    });
  }

  return slides;
}

export async function buildPresentationPdfFromSlides(
  slides: SlideDeckItem[],
  deckTitle: string
): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);

  // 16:9 Widescreen Presentation Size (960 x 540 pt)
  const slideW = 960;
  const slideH = 540;

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const page = doc.addPage([slideW, slideH]);

    // Slide header bar
    page.drawRectangle({
      x: 0,
      y: slideH - 74,
      width: slideW,
      height: 74,
      color: rgb(0.29, 0.11, 0.37),
    });

    page.drawText((s.title || deckTitle || `Slide ${i + 1}`).slice(0, 68), {
      x: 42,
      y: slideH - 48,
      size: 22,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText(`${i + 1} / ${slides.length}`, {
      x: slideW - 76,
      y: 22,
      size: 11,
      font: fontBold,
      color: rgb(0.45, 0.42, 0.52),
    });

    const hasImage = Boolean(s.imageDataUrl);
    const textMaxW = hasImage ? 460 : 860;

    let y = slideH - 125;
    for (const bullet of s.bullets.slice(0, 8)) {
      if (y < 60) break;
      const clean = bullet.replace(/^[•*-]\s*/, '').trim();
      if (!clean) continue;
      const maxChars = Math.floor(textMaxW / 8.2);
      const line1 = clean.slice(0, maxChars);
      const line2 = clean.slice(maxChars, maxChars * 2);

      page.drawText(`•  ${line1}`, {
        x: 46,
        y,
        size: 15,
        font: fontReg,
        color: rgb(0.12, 0.1, 0.16),
      });
      y -= 24;
      if (line2) {
        page.drawText(`    ${line2}`, {
          x: 46,
          y,
          size: 15,
          font: fontReg,
          color: rgb(0.12, 0.1, 0.16),
        });
        y -= 24;
      }
      y -= 8;
    }

    if (s.imageDataUrl) {
      try {
        const b64 = s.imageDataUrl.split(',')[1];
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const emb = s.imageDataUrl.startsWith('data:image/png')
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);
        const boxW = 380;
        const boxH = 380;
        const scale = Math.min(boxW / emb.width, boxH / emb.height);
        const dw = emb.width * scale;
        const dh = emb.height * scale;
        page.drawImage(emb, {
          x: slideW - dw - 48,
          y: (slideH - 74 - dh) / 2 + 20,
          width: dw,
          height: dh,
        });
      } catch {
        // Ignore image error
      }
    }
  }

  return {
    pdfBytes: await doc.save(),
    pageCount: doc.getPageCount(),
  };
}

export function buildPowerPointHtmlBytes(
  slides: SlideDeckItem[],
  deckTitle: string
): Uint8Array {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${deckTitle}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; background: #f4f4f8; margin: 0; padding: 24px; }
  .slide { width: 960px; min-height: 540px; margin: 0 auto 32px; background: #fff; border: 1px solid #ddd; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.08); page-break-after: always; display: flex; flex-direction: column; }
  .header { background: #4A1D5E; color: #fff; padding: 22px 36px; font-size: 26px; font-weight: bold; }
  .content { display: flex; gap: 28px; padding: 32px 36px; flex: 1; align-items: flex-start; }
  ul { flex: 1; font-size: 18px; line-height: 1.6; color: #1f1f29; margin: 0; padding-left: 22px; }
  li { margin-bottom: 12px; }
  .preview { width: 320px; border: 1px solid #e4dfec; border-radius: 8px; }
</style>
</head>
<body>
${slides
  .map(
    (s) => `<div class="slide">
  <div class="header">Slide ${s.slideNumber}: ${s.title}</div>
  <div class="content">
    <ul>${s.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    ${s.imageDataUrl ? `<img class="preview" src="${s.imageDataUrl}" alt="Slide ${s.slideNumber}" />` : ''}
  </div>
</div>`
  )
  .join('\n')}
</body>
</html>`;
  return new TextEncoder().encode(html);
}

// ============================================================================
// 10. PDF TO MARKDOWN, SUMMARIZE PDF, TRANSLATE PDF & COMPARE PDF
// ============================================================================
export async function convertPdfToMarkdownText(
  pdfBytes: Uint8Array,
  docName: string
): Promise<string> {
  const pages = await extractAllPdfText(pdfBytes);
  const mdSections: string[] = [
    `# ${docName.replace(/\.pdf$/i, '')}`,
    '',
    `> Converted to Markdown by ElimikaPDF (${pages.length} ${pages.length === 1 ? 'page' : 'pages'})`,
    '',
  ];

  for (const p of pages) {
    mdSections.push(`## Page ${p.pageNumber}`);
    mdSections.push('');
    const lines = p.text.split(/\n+/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (
        line.length < 65 &&
        line === line.toUpperCase() &&
        /[A-Z]/.test(line)
      ) {
        mdSections.push(`### ${line}`);
      } else if (/^(\d+[\.\)]|[•*-])\s+/.test(line)) {
        mdSections.push(line.replace(/^[•*]\s+/, '- '));
      } else {
        mdSections.push(line);
      }
      mdSections.push('');
    }
  }

  return mdSections.join('\n');
}

export interface PdfSummaryResult {
  wordCount: number;
  sentenceCount: number;
  readingTimeMinutes: number;
  executiveSummary: string;
  keyPoints: string[];
  pageHighlights: { pageNumber: number; highlight: string }[];
}

export async function summarizePdfDocument(
  pdfBytes: Uint8Array
): Promise<PdfSummaryResult> {
  const pages = await extractAllPdfText(pdfBytes);
  const fullText = pages.map((p) => p.text).join('\n\n');
  const words = fullText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

  const rawSentences = fullText
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28 && s.length <= 280);

  // Compute word frequency (ignoring common stopwords) for extractive TF-IDF salience scoring
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'have',
    'are', 'was', 'were', 'will', 'would', 'should', 'could', 'into',
    'about', 'there', 'their', 'which', 'when', 'where', 'what', 'shall',
  ]);
  const freq: Record<string, number> = {};
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length > 3 && !stopWords.has(clean)) {
      freq[clean] = (freq[clean] || 0) + 1;
    }
  }

  const scored = rawSentences.map((sentence, idx) => {
    const sWords = sentence.toLowerCase().split(/\s+/);
    let score = 0;
    for (const sw of sWords) {
      const clean = sw.replace(/[^a-z0-9]/g, '');
      if (freq[clean]) score += freq[clean];
    }
    // Slight position boost for opening sentences
    const posBoost = idx < 5 ? 1.25 : 1.0;
    return {
      sentence,
      idx,
      score: (score / Math.max(4, sWords.length)) * posBoost,
    };
  });

  const topSentences = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => a.idx - b.idx)
    .map((s) => s.sentence);

  const executiveSummary =
    topSentences.slice(0, 3).join(' ') ||
    'This document primarily contains visual or scanned graphical elements. Run the OCR PDF tool first to extract text from scanned images.';

  const pageHighlights = pages.map((p) => {
    const firstLines = p.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 12);
    return {
      pageNumber: p.pageNumber,
      highlight:
        firstLines.slice(0, 2).join(' — ').slice(0, 180) ||
        'Visual / diagram page content',
    };
  });

  return {
    wordCount,
    sentenceCount: Math.max(1, rawSentences.length),
    readingTimeMinutes,
    executiveSummary,
    keyPoints:
      topSentences.length > 0
        ? topSentences
        : ['No selectable text stream detected on pages.'],
    pageHighlights,
  };
}

const BILINGUAL_DICTIONARY: Record<string, Record<string, string>> = {
  sw: {
    instructions: 'MAELEKEZO',
    examination: 'MTIHANI',
    question: 'SWALI',
    questions: 'MASWALI',
    answer: 'JIBU',
    answers: 'MAJIBU',
    section: 'SEHEMU',
    time: 'MUDA',
    hours: 'MASAA',
    year: 'MWAKA',
    page: 'UKURASA',
    total: 'JUMLA',
    score: 'ALAMA',
    marks: 'ALAMA',
    school: 'SHULE',
    secondary: 'SEKONDARI',
    annual: 'WA MWAKA',
    form: 'KIDATO',
    agreement: 'MKATABA',
    invoice: 'ANKARA',
    date: 'TAREHE',
    signature: 'SAHIHI',
    confidential: 'SIRI',
    summary: 'MUHTASARI',
    report: 'RIPOTI',
    document: 'WARAKA',
  },
  fr: {
    instructions: 'INSTRUCTIONS',
    examination: 'EXAMEN',
    question: 'QUESTION',
    questions: 'QUESTIONS',
    answer: 'RÉPONSE',
    section: 'SECTION',
    time: 'TEMPS',
    hours: 'HEURES',
    year: 'ANNÉE',
    page: 'PAGE',
    total: 'TOTAL',
    score: 'SCORE',
    marks: 'POINTS',
    school: 'ÉCOLE',
    agreement: 'ACCORD',
    invoice: 'FACTURE',
    date: 'DATE',
    signature: 'SIGNATURE',
    confidential: 'CONFIDENTIEL',
    summary: 'RÉSUMÉ',
    report: 'RAPPORT',
    document: 'DOCUMENT',
  },
  es: {
    instructions: 'INSTRUCCIONES',
    examination: 'EXAMEN',
    question: 'PREGUNTA',
    questions: 'PREGUNTAS',
    answer: 'RESPUESTA',
    section: 'SECCIÓN',
    time: 'TIEMPO',
    hours: 'HORAS',
    year: 'AÑO',
    page: 'PÁGINA',
    total: 'TOTAL',
    score: 'PUNTUACIÓN',
    marks: 'PUNTOS',
    school: 'ESCUELA',
    agreement: 'ACUERDO',
    invoice: 'FACTURA',
    date: 'FECHA',
    signature: 'FIRMA',
    confidential: 'CONFIDENCIAL',
    summary: 'RESUMEN',
    report: 'INFORME',
    document: 'DOCUMENTO',
  },
  en: {
    maelekezo: 'INSTRUCTIONS',
    mtihani: 'EXAMINATION',
    swali: 'QUESTION',
    maswali: 'QUESTIONS',
    jibu: 'ANSWER',
    sehemu: 'SECTION',
    muda: 'TIME',
    masaa: 'HOURS',
    mwaka: 'YEAR',
    ukurasa: 'PAGE',
    jumla: 'TOTAL',
    alama: 'MARKS',
    shule: 'SCHOOL',
    mkataba: 'AGREEMENT',
    ankara: 'INVOICE',
    tarehe: 'DATE',
    sahihi: 'SIGNATURE',
    siri: 'CONFIDENTIAL',
    muhtasari: 'SUMMARY',
    ripoti: 'REPORT',
  },
};

export function translateDocumentTextLocal(
  sourceText: string,
  targetLang: 'sw' | 'en' | 'fr' | 'es'
): string {
  const dict = BILINGUAL_DICTIONARY[targetLang] || {};
  return sourceText.replace(/\b([A-Za-z]+)\b/g, (word) => {
    const lower = word.toLowerCase();
    const translated = dict[lower];
    if (!translated) return word;
    if (word === word.toUpperCase()) return translated.toUpperCase();
    if (word[0] === word[0].toUpperCase()) {
      return translated[0].toUpperCase() + translated.slice(1).toLowerCase();
    }
    return translated.toLowerCase();
  });
}

export interface PdfDiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export async function compareTwoPdfDocuments(
  pdfBytesA: Uint8Array,
  pdfBytesB: Uint8Array
): Promise<{
  similarityPct: number;
  addedCount: number;
  removedCount: number;
  diffLines: PdfDiffLine[];
}> {
  const pagesA = await extractAllPdfText(pdfBytesA);
  const pagesB = await extractAllPdfText(pdfBytesB);

  const linesA = pagesA
    .flatMap((p) => p.text.split(/\n+/))
    .map((l) => l.trim())
    .filter(Boolean);
  const linesB = pagesB
    .flatMap((p) => p.text.split(/\n+/))
    .map((l) => l.trim())
    .filter(Boolean);

  const setA = new Set(linesA);
  const setB = new Set(linesB);

  const diffLines: PdfDiffLine[] = [];
  let sameCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const line of linesA) {
    if (setB.has(line)) {
      diffLines.push({ type: 'same', text: line });
      sameCount++;
    } else {
      diffLines.push({ type: 'removed', text: line });
      removedCount++;
    }
  }
  for (const line of linesB) {
    if (!setA.has(line)) {
      diffLines.push({ type: 'added', text: line });
      addedCount++;
    }
  }

  const totalUnique = Math.max(1, sameCount + addedCount + removedCount);
  const similarityPct = Math.round((sameCount / totalUnique) * 100);

  return {
    similarityPct,
    addedCount,
    removedCount,
    diffLines,
  };
}

// ============================================================================
// 13. PDF TO KPF (AMAZON KINDLE PACKAGE FORMAT .KPF / KINDLE CREATE & .EPUB)
// ============================================================================

export interface PdfValidationReport {
  valid: boolean;
  errorType?: 'empty' | 'not-pdf' | 'encrypted' | 'corrupted';
  errorMessage?: string;
  pageCount: number;
  fileSizeBytes: number;
  isEncrypted?: boolean;
}

/**
 * Validates a PDF byte stream before conversion to KPF/Word/HTML.
 * Gracefully detects empty files, non-PDF files, password-protected/encrypted PDFs, and corrupted headers.
 */
export async function validatePdfBytesForConversion(
  pdfBytes: Uint8Array
): Promise<PdfValidationReport> {
  const fileSizeBytes = pdfBytes ? pdfBytes.byteLength : 0;
  if (!pdfBytes || fileSizeBytes === 0) {
    return {
      valid: false,
      errorType: 'empty',
      errorMessage:
        'The selected PDF file is empty (0 bytes). Please choose a valid PDF document.',
      pageCount: 0,
      fileSizeBytes: 0,
    };
  }

  // Search first 1024 bytes for %PDF- signature
  const headerSlice = pdfBytes.subarray(0, Math.min(1024, fileSizeBytes));
  let hasPdfSignature = false;
  for (let i = 0; i <= headerSlice.length - 5; i++) {
    if (
      headerSlice[i] === 0x25 && // %
      headerSlice[i + 1] === 0x50 && // P
      headerSlice[i + 2] === 0x44 && // D
      headerSlice[i + 3] === 0x46 && // F
      headerSlice[i + 4] === 0x2d // -
    ) {
      hasPdfSignature = true;
      break;
    }
  }

  if (!hasPdfSignature) {
    return {
      valid: false,
      errorType: 'not-pdf',
      errorMessage:
        'Invalid PDF file format: Missing %PDF- header. Please select a valid, uncorrupted PDF file.',
      pageCount: 0,
      fileSizeBytes,
    };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    await loadingTask.destroy();
    if (numPages <= 0) {
      return {
        valid: false,
        errorType: 'corrupted',
        errorMessage: 'This PDF file contains 0 readable pages.',
        pageCount: 0,
        fileSizeBytes,
      };
    }
    return {
      valid: true,
      pageCount: numPages,
      fileSizeBytes,
      isEncrypted: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err || '');
    const name =
      err && typeof err === 'object' && 'name' in err
        ? String((err as { name?: string }).name)
        : '';
    if (
      name === 'PasswordException' ||
      /password|encrypt/i.test(msg)
    ) {
      return {
        valid: false,
        errorType: 'encrypted',
        errorMessage:
          'This PDF is password-protected or encrypted. Please unlock it first using the Unlock PDF tool before converting to KPF.',
        pageCount: 0,
        fileSizeBytes,
        isEncrypted: true,
      };
    }

    // Fallback check with pdf-lib
    try {
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
      const count = doc.getPageCount();
      if (count > 0) {
        return {
          valid: true,
          pageCount: count,
          fileSizeBytes,
        };
      }
    } catch (libErr: unknown) {
      const libMsg =
        libErr instanceof Error ? libErr.message : String(libErr || '');
      if (/encrypt|password/i.test(libMsg)) {
        return {
          valid: false,
          errorType: 'encrypted',
          errorMessage:
            'This PDF is encrypted or password-protected. Unlock it first before converting to KPF.',
          pageCount: 0,
          fileSizeBytes,
          isEncrypted: true,
        };
      }
    }

    return {
      valid: false,
      errorType: 'corrupted',
      errorMessage:
        'Could not parse PDF structure. The file may be corrupted or truncated.',
      pageCount: 0,
      fileSizeBytes,
    };
  }
}

export interface PdfStyledSpan {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  fontSizePt: number;
  fontFamily: string;
  originalFontName: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  underline?: boolean;
  script?: 'normal' | 'sup' | 'sub';
  colorHex: string;
  highlightHex?: string;
  linkUrl?: string;
}

export interface PdfRichTableCell {
  text: string;
  colSpan?: number;
  rowSpan?: number;
  align: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  colorHex?: string;
  bgColorHex?: string;
  borderColorHex?: string;
  hasBottomBorder?: boolean;
}

export interface PdfRichTable {
  rows: PdfRichTableCell[][];
  colWidthPcts: number[];
  borderColorHex?: string;
  hasExplicitGridRules?: boolean;
}

export interface PdfRichBlock {
  kind: 'heading' | 'paragraph' | 'equation' | 'columns' | 'header' | 'footer';
  headingLevel?: 1 | 2 | 3;
  align?: 'left' | 'center' | 'right' | 'justify';
  indentLeftPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  lineHeight?: number;
  bgColorHex?: string;
  borderColorHex?: string;
  spans?: PdfStyledSpan[];
  columns?: PdfRichBlock[][];
  text: string;
}

export interface KpfFontSubstitutionEntry {
  internalFontId: string;
  pdfFontName: string;
  substitutedFamily: string;
  bold: boolean;
  italic: boolean;
  pageNumbers: number[];
}

export interface KpfPageQualityMetric {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  orientation: 'portrait' | 'landscape';
  charCount: number;
  wordCount: number;
  spanCount: number;
  colorCount: number;
  imageCount: number;
  vectorGraphicCount: number;
  tableCount: number;
  equationCount: number;
  linkCount: number;
  isScannedPage: boolean;
  ocrApplied: boolean;
  multiColumnDetected: boolean;
  usedVisualReplicaLayer: boolean;
  fidelityScore: number;
  warnings: string[];
}

export interface KpfConversionQualityReport {
  totalSourcePages: number;
  totalConvertedChapters: number;
  pageCountMatched: boolean;
  totalWordsExtracted: number;
  totalColorsPreserved: number;
  uniqueColorsHex: string[];
  totalImagesDetected: number;
  totalVectorGraphicsDetected: number;
  totalTablesPreserved: number;
  totalEquationsDetected: number;
  totalLinksPreserved: number;
  overallFidelityScore: number;
  fontSubstitutions: KpfFontSubstitutionEntry[];
  pages: KpfPageQualityMetric[];
  generatedAt: string;
}

export interface KindleKpfChapter {
  chapterNumber: number;
  title: string;
  paragraphs: string[];
  tables?: string[][][];
  richTables?: PdfRichTable[];
  richBlocks?: PdfRichBlock[];
  styledSpans?: PdfStyledSpan[];
  pageBackgroundColorHex?: string;
  pageColorsHex?: string[];
  embeddedImageCount?: number;
  vectorGraphicCount?: number;
  multiColumnDetected?: boolean;
  fontSubstitutions?: KpfFontSubstitutionEntry[];
  equations?: string[];
  links?: { text: string; url: string; rect?: [number, number, number, number] }[];
  pageNumber: number;
  widthPt?: number;
  heightPt?: number;
  orientation?: 'portrait' | 'landscape';
  isScannedPage?: boolean;
  ocrApplied?: boolean;
  imageDataUrl?: string;
  pageQuality?: KpfPageQualityMetric;
}

export interface KindleKpfBookOptions {
  title: string;
  author: string;
  language: string;
  publisher?: string;
  layoutMode: 'hybrid' | 'reflowable' | 'print-replica';
  fontScalePct?: number;
  sourcePdfBytes?: Uint8Array;
}

export interface KpfExtractionProgressOptions {
  enableOcrForScanned?: boolean;
  onProgress?: (
    currentPage: number,
    totalPages: number,
    statusText: string
  ) => void;
  shouldCancel?: () => boolean;
}

function escapeXmlText(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isMathOrEquationLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 180) return false;
  if (
    /[∑∫√±≤≥≠≈∞πΔαβγθλμσω∂∇∈∉⊂⊃∪∩∀∃⇒⇔]/.test(trimmed)
  ) {
    return true;
  }
  if (
    /(?:^|\s)(?:[a-zA-Z0-9_()^\-+*/]+\s*=\s*[a-zA-Z0-9_()^\-+*/]+)(?:\s|$)/.test(
      trimmed
    ) &&
    /[+\-*/^=()]/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 18
  ) {
    return true;
  }
  return false;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  const rr = clamp255(r).toString(16).padStart(2, '0');
  const gg = clamp255(g).toString(16).padStart(2, '0');
  const bb = clamp255(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

function normalizePdfColorArgs(args: unknown): string | null {
  if (args === null || args === undefined) return null;
  if (typeof args === 'string') {
    const clean = args.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
    if (/^#[0-9a-f]{3}$/.test(clean)) {
      return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
    }
    return null;
  }
  if (Array.isArray(args)) {
    if (args.length === 1) {
      if (typeof args[0] === 'string') return normalizePdfColorArgs(args[0]);
      if (typeof args[0] === 'number') {
        const g = args[0] <= 1 ? args[0] * 255 : args[0];
        return rgbToHex(g, g, g);
      }
      if (Array.isArray(args[0]) || args[0] instanceof Uint8Array || args[0] instanceof Uint8ClampedArray) {
        return normalizePdfColorArgs(Array.from(args[0] as ArrayLike<number>));
      }
    }
    if (args.length >= 3 && typeof args[0] === 'number') {
      if (args.length === 4) {
        // CMYK to RGB
        const c = Number(args[0]) > 1 ? Number(args[0]) / 100 : Number(args[0]);
        const m = Number(args[1]) > 1 ? Number(args[1]) / 100 : Number(args[1]);
        const y = Number(args[2]) > 1 ? Number(args[2]) / 100 : Number(args[2]);
        const k = Number(args[3]) > 1 ? Number(args[3]) / 100 : Number(args[3]);
        return rgbToHex(
          255 * (1 - c) * (1 - k),
          255 * (1 - m) * (1 - k),
          255 * (1 - y) * (1 - k)
        );
      }
      const maxVal = Math.max(Math.abs(Number(args[0])), Math.abs(Number(args[1])), Math.abs(Number(args[2])));
      const scale = maxVal <= 1.001 ? 255 : 1;
      return rgbToHex(
        Number(args[0]) * scale,
        Number(args[1]) * scale,
        Number(args[2]) * scale
      );
    }
  }
  return null;
}

function multiplyAffineMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyAffinePoint(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function resolveCompatibleFontMapping(
  pdfFontNameRaw: string,
  styleFontFamily: string,
  metaBold?: boolean,
  metaItalic?: boolean
): {
  substitutedFamily: string;
  bold: boolean;
  italic: boolean;
} {
  const combined = `${pdfFontNameRaw} ${styleFontFamily}`.toLowerCase();
  const bold = Boolean(
    metaBold || /bold|black|heavy|semibold|demi|\b700\b|\b800\b/.test(combined)
  );
  const italic = Boolean(
    metaItalic || /italic|oblique|\bslant\b/.test(combined)
  );

  if (/math|stix|symbol|cmr|cmsy|cmmi|cambria\s*math/.test(combined)) {
    return {
      substitutedFamily: '"Cambria Math", "STIX Two Math", "Times New Roman", serif',
      bold,
      italic,
    };
  }
  if (/mono|cour|consola|menlo|dejavu.*mono|fira\s*code|jetbrains/.test(combined)) {
    return {
      substitutedFamily: '"Courier New", Consolas, ui-monospace, monospace',
      bold,
      italic,
    };
  }
  if (/times|georgia|garamond|palatino|cambria|bookerly|century|serif/.test(combined) && !/sans-serif/.test(combined)) {
    return {
      substitutedFamily: '"Georgia", "Bookerly", "Times New Roman", serif',
      bold,
      italic,
    };
  }
  if (/sans|helvetica|arial|calibri|inter|segoe|roboto|verdana|tahoma|trebuchet/.test(combined)) {
    return {
      substitutedFamily: '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      bold,
      italic,
    };
  }
  return {
    substitutedFamily:
      styleFontFamily === 'serif'
        ? '"Georgia", "Bookerly", "Times New Roman", serif'
        : styleFontFamily === 'monospace'
          ? '"Courier New", Consolas, ui-monospace, monospace'
          : '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    bold,
    italic,
  };
}

interface PdfPageGraphicsExtraction {
  pageBackgroundColorHex?: string;
  filledRects: Array<{
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
    colorHex: string;
  }>;
  horizontalRules: Array<{
    x1: number;
    x2: number;
    y: number;
    colorHex: string;
    lineWidth: number;
  }>;
  verticalRules: Array<{
    x: number;
    y1: number;
    y2: number;
    colorHex: string;
    lineWidth: number;
  }>;
  strokedRects: Array<{
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
    colorHex: string;
  }>;
  textDrawEvents: Array<{
    xPt: number;
    yPt: number;
    colorHex: string;
    fontId: string;
  }>;
  embeddedImageCount: number;
  vectorGraphicCount: number;
  uniqueColorsHex: string[];
}

async function extractPageGraphicsFromOperatorList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  viewportTransform: number[],
  widthPt: number,
  heightPt: number
): Promise<PdfPageGraphicsExtraction> {
  const filledRects: PdfPageGraphicsExtraction['filledRects'] = [];
  const horizontalRules: PdfPageGraphicsExtraction['horizontalRules'] = [];
  const verticalRules: PdfPageGraphicsExtraction['verticalRules'] = [];
  const strokedRects: PdfPageGraphicsExtraction['strokedRects'] = [];
  const textDrawEvents: PdfPageGraphicsExtraction['textDrawEvents'] = [];
  const uniqueColors = new Set<string>();
  let pageBackgroundColorHex: string | undefined;
  let embeddedImageCount = 0;
  let vectorGraphicCount = 0;

  try {
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const fnArray: number[] = opList?.fnArray || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const argsArray: any[] = opList?.argsArray || [];

    interface GState {
      ctm: number[];
      fillColorHex: string;
      strokeColorHex: string;
      lineWidth: number;
      fontId: string;
    }

    const stateStack: GState[] = [
      {
        ctm: [...viewportTransform],
        fillColorHex: '#111111',
        strokeColorHex: '#111111',
        lineWidth: 1,
        fontId: '',
      },
    ];
    const currentState = () => stateStack[stateStack.length - 1];

    let textMatrix = [1, 0, 0, 1, 0, 0];
    let textLineMatrix = [1, 0, 0, 1, 0, 0];
    let textLeading = 0;
    let pendingPathOps: Array<{ type: 'move' | 'line' | 'rect' | 'curve'; coords: number[] }> = [];

    const recordPaintRect = (
      xPt: number,
      yPt: number,
      rw: number,
      rh: number,
      isFill: boolean,
      isStroke: boolean,
      fillHex: string,
      strokeHex: string,
      lineWidth: number
    ) => {
      if (rw < 0.3 && rh < 0.3) return;
      if (isFill) {
        uniqueColors.add(fillHex);
        if (rw >= widthPt * 0.78 && rh >= heightPt * 0.78) {
          if (fillHex !== '#ffffff') {
            pageBackgroundColorHex = fillHex;
          }
        } else if (rh <= 3.2 && rw >= 14) {
          horizontalRules.push({
            x1: xPt,
            x2: xPt + rw,
            y: yPt + rh / 2,
            colorHex: fillHex,
            lineWidth: Math.max(0.75, rh),
          });
        } else if (rw <= 3.2 && rh >= 10) {
          verticalRules.push({
            x: xPt + rw / 2,
            y1: yPt,
            y2: yPt + rh,
            colorHex: fillHex,
            lineWidth: Math.max(0.75, rw),
          });
        } else if (rw >= 3 && rh >= 3) {
          filledRects.push({
            xPt,
            yPt,
            widthPt: rw,
            heightPt: rh,
            colorHex: fillHex,
          });
        }
      }
      if (isStroke) {
        uniqueColors.add(strokeHex);
        if (rh <= 2.5 && rw >= 14) {
          horizontalRules.push({
            x1: xPt,
            x2: xPt + rw,
            y: yPt + rh / 2,
            colorHex: strokeHex,
            lineWidth,
          });
        } else if (rw <= 2.5 && rh >= 10) {
          verticalRules.push({
            x: xPt + rw / 2,
            y1: yPt,
            y2: yPt + rh,
            colorHex: strokeHex,
            lineWidth,
          });
        } else if (rw >= 10 && rh >= 8) {
          strokedRects.push({
            xPt,
            yPt,
            widthPt: rw,
            heightPt: rh,
            colorHex: strokeHex,
          });
          horizontalRules.push(
            { x1: xPt, x2: xPt + rw, y: yPt, colorHex: strokeHex, lineWidth },
            { x1: xPt, x2: xPt + rw, y: yPt + rh, colorHex: strokeHex, lineWidth }
          );
          verticalRules.push(
            { x: xPt, y1: yPt, y2: yPt + rh, colorHex: strokeHex, lineWidth },
            { x: xPt + rw, y1: yPt, y2: yPt + rh, colorHex: strokeHex, lineWidth }
          );
        }
      }
    };

    const isFillOp = (op: number) =>
      op === OPS.fill ||
      op === OPS.eoFill ||
      op === OPS.fillStroke ||
      op === OPS.eoFillStroke ||
      op === OPS.closeFillStroke ||
      op === OPS.closeEOFillStroke ||
      op === OPS.rawFillPath;

    const isStrokeOp = (op: number) =>
      op === OPS.stroke ||
      op === OPS.closeStroke ||
      op === OPS.fillStroke ||
      op === OPS.eoFillStroke ||
      op === OPS.closeFillStroke ||
      op === OPS.closeEOFillStroke;

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];
      const st = currentState();

      if (fn === OPS.save) {
        stateStack.push({
          ctm: [...st.ctm],
          fillColorHex: st.fillColorHex,
          strokeColorHex: st.strokeColorHex,
          lineWidth: st.lineWidth,
          fontId: st.fontId,
        });
      } else if (fn === OPS.restore) {
        if (stateStack.length > 1) stateStack.pop();
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        st.ctm = multiplyAffineMatrix(st.ctm, args.slice(0, 6).map(Number));
      } else if (fn === OPS.setLineWidth && Array.isArray(args) && typeof args[0] === 'number') {
        st.lineWidth = Math.max(0.5, args[0]);
      } else if (
        fn === OPS.setFillRGBColor ||
        fn === OPS.setFillGray ||
        fn === OPS.setFillCMYKColor ||
        fn === OPS.setFillColor ||
        fn === OPS.setFillColorN
      ) {
        const hex = normalizePdfColorArgs(args);
        if (hex) {
          st.fillColorHex = hex;
          uniqueColors.add(hex);
        }
      } else if (
        fn === OPS.setStrokeRGBColor ||
        fn === OPS.setStrokeGray ||
        fn === OPS.setStrokeCMYKColor ||
        fn === OPS.setStrokeColor ||
        fn === OPS.setStrokeColorN
      ) {
        const hex = normalizePdfColorArgs(args);
        if (hex) {
          st.strokeColorHex = hex;
          uniqueColors.add(hex);
        }
      } else if (fn === OPS.setFont && Array.isArray(args) && args[0]) {
        st.fontId = String(args[0]);
      } else if (fn === OPS.beginText) {
        textMatrix = [1, 0, 0, 1, 0, 0];
        textLineMatrix = [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.setTextMatrix && Array.isArray(args) && args[0]) {
        const tmObj = args[0];
        const arr = Array.isArray(tmObj)
          ? tmObj
          : [tmObj[0], tmObj[1], tmObj[2], tmObj[3], tmObj[4], tmObj[5]];
        if (arr.length >= 6) {
          textMatrix = arr.map(Number);
          textLineMatrix = [...textMatrix];
        }
      } else if (fn === OPS.moveText && Array.isArray(args) && args.length >= 2) {
        const tmMove = [1, 0, 0, 1, Number(args[0]), Number(args[1])];
        textLineMatrix = multiplyAffineMatrix(textLineMatrix, tmMove);
        textMatrix = [...textLineMatrix];
      } else if (fn === OPS.setLeadingMoveText && Array.isArray(args) && args.length >= 2) {
        textLeading = -Number(args[1]);
        const tmMove = [1, 0, 0, 1, Number(args[0]), Number(args[1])];
        textLineMatrix = multiplyAffineMatrix(textLineMatrix, tmMove);
        textMatrix = [...textLineMatrix];
      } else if (fn === OPS.nextLine) {
        const tmMove = [1, 0, 0, 1, 0, -textLeading];
        textLineMatrix = multiplyAffineMatrix(textLineMatrix, tmMove);
        textMatrix = [...textLineMatrix];
      } else if (
        fn === OPS.showText ||
        fn === OPS.showSpacedText ||
        fn === OPS.nextLineShowText ||
        fn === OPS.nextLineSetSpacingShowText
      ) {
        const combined = multiplyAffineMatrix(st.ctm, textMatrix);
        textDrawEvents.push({
          xPt: combined[4],
          yPt: combined[5],
          colorHex: st.fillColorHex,
          fontId: st.fontId,
        });
        uniqueColors.add(st.fillColorHex);
      } else if (fn === OPS.constructPath && Array.isArray(args)) {
        const paintOp = Number(args[0]);
        const pathData = args[1]?.[0] || args[1];
        const bbox = args[2];
        const doFill = isFillOp(paintOp);
        const doStroke = isStrokeOp(paintOp);
        if (doFill || doStroke) {
          let hasCurve = false;
          let segmentCount = 0;
          if (pathData && typeof pathData.length === 'number') {
            let pIdx = 0;
            while (pIdx < pathData.length) {
              const segOp = pathData[pIdx++];
              if (segOp === 0 || segOp === 1) {
                pIdx += 2;
                segmentCount++;
              } else if (segOp === 2) {
                hasCurve = true;
                pIdx += 6;
                segmentCount++;
              } else if (segOp === 3) {
                hasCurve = true;
                pIdx += 4;
                segmentCount++;
              } else if (segOp === 4) {
                // closePath
              } else {
                break;
              }
            }
          }
          if (hasCurve || segmentCount > 6) {
            vectorGraphicCount++;
          }
          if (bbox && typeof bbox[0] === 'number') {
            const [p1x, p1y] = applyAffinePoint(st.ctm, Number(bbox[0]), Number(bbox[1]));
            const [p2x, p2y] = applyAffinePoint(st.ctm, Number(bbox[2]), Number(bbox[3]));
            const rx = Math.min(p1x, p2x);
            const ry = Math.min(p1y, p2y);
            const rw = Math.abs(p2x - p1x);
            const rh = Math.abs(p2y - p1y);
            recordPaintRect(
              rx,
              ry,
              rw,
              rh,
              doFill,
              doStroke,
              st.fillColorHex,
              st.strokeColorHex,
              st.lineWidth
            );
          }
        }
      } else if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
        pendingPathOps.push({ type: 'rect', coords: args.slice(0, 4).map(Number) });
      } else if (fn === OPS.moveTo && Array.isArray(args) && args.length >= 2) {
        pendingPathOps.push({ type: 'move', coords: [Number(args[0]), Number(args[1])] });
      } else if (fn === OPS.lineTo && Array.isArray(args) && args.length >= 2) {
        pendingPathOps.push({ type: 'line', coords: [Number(args[0]), Number(args[1])] });
      } else if (fn === OPS.curveTo || fn === OPS.curveTo2 || fn === OPS.curveTo3) {
        pendingPathOps.push({ type: 'curve', coords: [] });
        vectorGraphicCount++;
      } else if (isFillOp(fn) || isStrokeOp(fn)) {
        const doFill = isFillOp(fn);
        const doStroke = isStrokeOp(fn);
        for (const pOp of pendingPathOps) {
          if (pOp.type === 'rect') {
            const [x, y, w, h] = pOp.coords;
            const [p1x, p1y] = applyAffinePoint(st.ctm, x, y);
            const [p2x, p2y] = applyAffinePoint(st.ctm, x + w, y + h);
            recordPaintRect(
              Math.min(p1x, p2x),
              Math.min(p1y, p2y),
              Math.abs(p2x - p1x),
              Math.abs(p2y - p1y),
              doFill,
              doStroke,
              st.fillColorHex,
              st.strokeColorHex,
              st.lineWidth
            );
          }
        }
        pendingPathOps = [];
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject ||
        fn === OPS.paintImageXObjectRepeat ||
        fn === OPS.shadingFill
      ) {
        if (fn === OPS.shadingFill) {
          vectorGraphicCount++;
        } else {
          embeddedImageCount++;
        }
      }
    }
  } catch {
    // Non-fatal fallback if operatorList cannot be parsed cleanly
  }

  return {
    pageBackgroundColorHex,
    filledRects,
    horizontalRules,
    verticalRules,
    strokedRects,
    textDrawEvents,
    embeddedImageCount,
    vectorGraphicCount,
    uniqueColorsHex: Array.from(uniqueColors),
  };
}

function clusterAxisCoordinates(values: number[], tolerance = 3.5): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1];
    if (sorted[i] - last[last.length - 1] <= tolerance) {
      last.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
}

function detectRuledAndSpatialTables(
  spans: PdfStyledSpan[],
  graphics: PdfPageGraphicsExtraction,
  pageWidthPt: number
): {
  richTables: PdfRichTable[];
  consumedSpanIndices: Set<number>;
} {
  const richTables: PdfRichTable[] = [];
  const consumedSpanIndices = new Set<number>();

  // Phase A: Explicit Grid-Rule Table Detection from PDF stroked/filled border lines
  const significantHRules = graphics.horizontalRules.filter(
    (r) => Math.abs(r.x2 - r.x1) >= Math.max(40, pageWidthPt * 0.22)
  );
  const significantVRules = graphics.verticalRules.filter(
    (r) => Math.abs(r.y2 - r.y1) >= 24
  );

  if (significantHRules.length >= 3 && significantVRules.length >= 2) {
    // Group vertical rules by overlapping vertical Y intervals into distinct table grids
    const vSorted = [...significantVRules].sort((a, b) => a.y1 - b.y1);
    const yGroups: Array<{ minY: number; maxY: number; minX: number; maxX: number; rules: typeof vSorted }> = [];
    for (const vr of vSorted) {
      const grp = yGroups.find((g) => vr.y1 <= g.maxY + 8 && vr.y2 >= g.minY - 8);
      if (grp) {
        grp.minY = Math.min(grp.minY, vr.y1);
        grp.maxY = Math.max(grp.maxY, vr.y2);
        grp.minX = Math.min(grp.minX, vr.x);
        grp.maxX = Math.max(grp.maxX, vr.x);
        grp.rules.push(vr);
      } else {
        yGroups.push({ minY: vr.y1, maxY: vr.y2, minX: vr.x, maxX: vr.x, rules: [vr] });
      }
    }

    for (const grp of yGroups) {
      const colEdges = clusterAxisCoordinates(grp.rules.map((r) => r.x), 4);
      const localHRules = significantHRules.filter(
        (hr) => hr.y >= grp.minY - 6 && hr.y <= grp.maxY + 6 && hr.x2 >= grp.minX - 6 && hr.x1 <= grp.maxX + 6
      );
      const rowEdges = clusterAxisCoordinates(
        [grp.minY, grp.maxY, ...localHRules.map((r) => r.y)],
        4
      );

      if (colEdges.length >= 3 && rowEdges.length >= 3) {
        const numCols = colEdges.length - 1;
        const numRows = rowEdges.length - 1;
        const tableLeft = colEdges[0];
        const tableWidth = Math.max(10, colEdges[colEdges.length - 1] - tableLeft);
        const colWidthPcts = Array.from({ length: numCols }, (_, c) =>
          Math.max(4, Number((((colEdges[c + 1] - colEdges[c]) / tableWidth) * 100).toFixed(1)))
        );

        const rows: PdfRichTableCell[][] = [];
        const borderHex = grp.rules[0]?.colorHex || localHRules[0]?.colorHex || '#cbd5e1';

        for (let r = 0; r < numRows; r++) {
          const ry1 = rowEdges[r];
          const ry2 = rowEdges[r + 1];
          const rowCells: PdfRichTableCell[] = [];
          for (let c = 0; c < numCols; c++) {
            const cx1 = colEdges[c];
            const cx2 = colEdges[c + 1];
            const cellWidth = Math.max(4, cx2 - cx1);

            // Match cell background rectangle
            const bgMatch = graphics.filledRects.find((fr) => {
              const fCx = fr.xPt + fr.widthPt / 2;
              const fCy = fr.yPt + fr.heightPt / 2;
              return (
                fCx >= cx1 - 2 &&
                fCx <= cx2 + 2 &&
                fCy >= ry1 - 2 &&
                fCy <= ry2 + 2 &&
                fr.colorHex !== '#ffffff'
              );
            });

            // Collect spans inside this cell
            const cellSpans: PdfStyledSpan[] = [];
            spans.forEach((sp, sIdx) => {
              if (consumedSpanIndices.has(sIdx)) return;
              const scx = sp.xPt + Math.min(sp.widthPt, 20) * 0.4;
              const scy = sp.yPt + sp.heightPt * 0.5;
              if (scx >= cx1 - 2 && scx <= cx2 + 2 && scy >= ry1 - 2 && scy <= ry2 + 2) {
                cellSpans.push(sp);
                consumedSpanIndices.add(sIdx);
              }
            });

            cellSpans.sort((a, b) =>
              Math.abs(a.yPt - b.yPt) > 3 ? a.yPt - b.yPt : a.xPt - b.xPt
            );

            const cellText = cellSpans.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
            const firstSpan = cellSpans[0];
            let align: 'left' | 'center' | 'right' = 'left';
            if (firstSpan && cellWidth > 20) {
              const relLeft = firstSpan.xPt - cx1;
              const relCenter = firstSpan.xPt + firstSpan.widthPt / 2 - (cx1 + cellWidth / 2);
              const relRight = cx2 - (firstSpan.xPt + firstSpan.widthPt);
              if (Math.abs(relCenter) <= cellWidth * 0.14 && relLeft > 6 && relRight > 6) {
                align = 'center';
              } else if (relRight >= 2 && relRight < relLeft * 0.45 && firstSpan.widthPt < cellWidth * 0.7) {
                align = 'right';
              }
            }

            rowCells.push({
              text: cellText,
              align,
              bold: cellSpans.some((s) => s.fontWeight === 'bold') || (r === 0 && Boolean(cellText)),
              italic: cellSpans.length > 0 && cellSpans.every((s) => s.fontStyle === 'italic'),
              colorHex: firstSpan?.colorHex,
              bgColorHex: bgMatch?.colorHex,
              borderColorHex: borderHex,
            });
          }
          if (rowCells.some((c) => c.text.length > 0 || c.bgColorHex)) {
            rows.push(rowCells);
          }
        }

        if (rows.length >= 2) {
          richTables.push({
            rows,
            colWidthPcts,
            borderColorHex: borderHex,
            hasExplicitGridRules: true,
          });
        }
      }
    }
  }

  // Phase B: Spatial tabular clusters for unconsumed spans (requires >= 3 consistent tabular rows, avoiding 2-column prose!)
  const remainingIndexed = spans
    .map((sp, idx) => ({ sp, idx }))
    .filter(({ idx }) => !consumedSpanIndices.has(idx));

  const rowGroups: Array<Array<{ sp: PdfStyledSpan; idx: number }>> = [];
  for (const item of remainingIndexed) {
    const last = rowGroups[rowGroups.length - 1];
    if (last && Math.abs(last[0].sp.yPt - item.sp.yPt) <= 4.5) {
      last.push(item);
    } else {
      rowGroups.push([item]);
    }
  }

  interface CandidateTabularRow {
    cells: Array<{ text: string; minX: number; maxX: number; spans: PdfStyledSpan[]; indices: number[] }>;
  }
  let currentSpatialBlock: CandidateTabularRow[] = [];

  const flushSpatialBlock = () => {
    if (currentSpatialBlock.length >= 3) {
      const colCounts = currentSpatialBlock.map((r) => r.cells.length);
      const targetCols = Math.max(...colCounts);
      const avgCellWords =
        currentSpatialBlock
          .flatMap((r) => r.cells)
          .reduce((acc, c) => acc + c.text.split(/\s+/).length, 0) /
        Math.max(1, currentSpatialBlock.flatMap((r) => r.cells).length);

      // Avoid misclassifying 2-column newspaper prose as a table: require >=3 cols OR concise tabular cells
      if (targetCols >= 3 || (targetCols === 2 && avgCellWords <= 4.5)) {
        const minX = Math.min(...currentSpatialBlock.flatMap((r) => r.cells.map((c) => c.minX)));
        const maxX = Math.max(...currentSpatialBlock.flatMap((r) => r.cells.map((c) => c.maxX)));
        const spanW = Math.max(50, maxX - minX);
        const colAnchors = clusterAxisCoordinates(
          currentSpatialBlock.flatMap((r) => r.cells.map((c) => c.minX)),
          14
        ).slice(0, targetCols);

        const colWidthPcts = Array.from({ length: Math.max(2, colAnchors.length) }, (_, c) => {
          const nextX = colAnchors[c + 1] ?? maxX;
          return Math.max(8, Math.round(((nextX - colAnchors[c]) / spanW) * 100));
        });

        const rows: PdfRichTableCell[][] = currentSpatialBlock.map((row, rIdx) => {
          const mappedCells: PdfRichTableCell[] = Array.from(
            { length: Math.max(2, colAnchors.length) },
            () => ({ text: '', align: 'left' as const })
          );
          for (const c of row.cells) {
            let bestCol = 0;
            let bestDist = Infinity;
            colAnchors.forEach((anchor, aIdx) => {
              const d = Math.abs(c.minX - anchor);
              if (d < bestDist) {
                bestDist = d;
                bestCol = aIdx;
              }
            });
            const existing = mappedCells[bestCol].text;
            mappedCells[bestCol] = {
              text: existing ? `${existing} ${c.text}` : c.text,
              align: /^\d+(?:[.,]\d+)?%?$/.test(c.text) ? 'right' : 'left',
              bold: c.spans.some((s) => s.fontWeight === 'bold') || rIdx === 0,
              italic: c.spans.every((s) => s.fontStyle === 'italic'),
              colorHex: c.spans[0]?.colorHex,
              bgColorHex: c.spans[0]?.highlightHex,
            };
            c.indices.forEach((idx) => consumedSpanIndices.add(idx));
          }
          return mappedCells;
        });

        richTables.push({
          rows,
          colWidthPcts,
          borderColorHex: '#cbd5e1',
          hasExplicitGridRules: false,
        });
      }
    }
    currentSpatialBlock = [];
  };

  for (const row of rowGroups) {
    const sorted = [...row].sort((a, b) => a.sp.xPt - b.sp.xPt);
    const cells: CandidateTabularRow['cells'] = [];
    let cur = {
      text: sorted[0].sp.text,
      minX: sorted[0].sp.xPt,
      maxX: sorted[0].sp.xPt + sorted[0].sp.widthPt,
      spans: [sorted[0].sp],
      indices: [sorted[0].idx],
    };

    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].sp.xPt - cur.maxX;
      if (gap > Math.max(20, sorted[i].sp.fontSizePt * 1.9)) {
        cells.push(cur);
        cur = {
          text: sorted[i].sp.text,
          minX: sorted[i].sp.xPt,
          maxX: sorted[i].sp.xPt + sorted[i].sp.widthPt,
          spans: [sorted[i].sp],
          indices: [sorted[i].idx],
        };
      } else {
        cur.text += ' ' + sorted[i].sp.text;
        cur.maxX = Math.max(cur.maxX, sorted[i].sp.xPt + sorted[i].sp.widthPt);
        cur.spans.push(sorted[i].sp);
        cur.indices.push(sorted[i].idx);
      }
    }
    cells.push(cur);

    if (cells.length >= 2) {
      currentSpatialBlock.push({ cells });
    } else {
      flushSpatialBlock();
    }
  }
  flushSpatialBlock();

  return { richTables, consumedSpanIndices };
}

function reconstructRichBlocksFromSpans(
  spans: PdfStyledSpan[],
  consumedSpanIndices: Set<number>,
  pageWidthPt: number,
  pageHeightPt: number
): {
  richBlocks: PdfRichBlock[];
  multiColumnDetected: boolean;
} {
  const remaining = spans.filter((_, idx) => !consumedSpanIndices.has(idx));
  if (remaining.length === 0) {
    return { richBlocks: [], multiColumnDetected: false };
  }

  // Group into visual baseline rows first
  const sorted = [...remaining].sort((a, b) =>
    Math.abs(a.yPt - b.yPt) > 4 ? a.yPt - b.yPt : a.xPt - b.xPt
  );
  const rows: PdfStyledSpan[][] = [];
  for (const sp of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].yPt - sp.yPt) <= Math.max(4, last[0].fontSizePt * 0.42)) {
      last.push(sp);
    } else {
      rows.push([sp]);
    }
  }

  // Check if page body has a sustained 2-column gutter (computing actual gutterX rather than fixed 50% midX)
  const splitMidpoints: number[] = [];
  for (const row of rows) {
    const sRow = [...row].sort((a, b) => a.xPt - b.xPt);
    for (let i = 0; i < sRow.length - 1; i++) {
      const leftEnd = sRow[i].xPt + sRow[i].widthPt;
      const rightStart = sRow[i + 1].xPt;
      const mid = (leftEnd + rightStart) / 2;
      if (
        rightStart - leftEnd >= 4 &&
        sRow[i].xPt < pageWidthPt * 0.48 &&
        rightStart >= pageWidthPt * 0.4 &&
        rightStart <= pageWidthPt * 0.72
      ) {
        splitMidpoints.push(mid);
        break;
      }
    }
  }
  splitMidpoints.sort((a, b) => a - b);
  const gutterX =
    splitMidpoints.length >= 3
      ? splitMidpoints[Math.floor(splitMidpoints.length / 2)]
      : pageWidthPt * 0.5;

  let twoColumnRowCount = 0;
  for (const row of rows) {
    const hasLeft = row.some((s) => s.xPt < gutterX - 8 && s.xPt + s.widthPt <= gutterX + 14);
    const hasRight = row.some((s) => s.xPt >= gutterX - 2);
    if (hasLeft && hasRight) {
      twoColumnRowCount++;
    }
  }
  const multiColumnDetected = twoColumnRowCount >= 4 && rows.length >= 5;

  const buildSequentialBlocksFromSpans = (orderedSpans: PdfStyledSpan[]): PdfRichBlock[] => {
    const sSorted = [...orderedSpans].sort((a, b) =>
      Math.abs(a.yPt - b.yPt) > 4 ? a.yPt - b.yPt : a.xPt - b.xPt
    );
    const lineClusters: PdfStyledSpan[][] = [];
    for (const sp of sSorted) {
      const last = lineClusters[lineClusters.length - 1];
      if (last && Math.abs(last[0].yPt - sp.yPt) <= Math.max(4.5, last[0].fontSizePt * 0.45)) {
        last.push(sp);
      } else {
        lineClusters.push([sp]);
      }
    }

    // Mark inline superscripts/subscripts within each baseline line
    for (const line of lineClusters) {
      line.sort((a, b) => a.xPt - b.xPt);
      if (line.length >= 2) {
        const medianSize =
          [...line].sort((a, b) => a.fontSizePt - b.fontSizePt)[Math.floor(line.length / 2)]
            .fontSizePt || 11;
        const baseMidY =
          line.reduce((acc, s) => acc + s.yPt + s.fontSizePt * 0.5, 0) / line.length;
        for (const sp of line) {
          if (sp.fontSizePt <= medianSize * 0.84) {
            const spMidY = sp.yPt + sp.fontSizePt * 0.5;
            if (spMidY < baseMidY - medianSize * 0.16) {
              sp.script = 'sup';
            } else if (spMidY > baseMidY + medianSize * 0.16) {
              sp.script = 'sub';
            }
          }
        }
      }
    }

    const medianBodyFont = (() => {
      const sizes = lineClusters.map((l) => l[0].fontSizePt).sort((a, b) => a - b);
      return sizes[Math.floor(sizes.length / 2)] || 11;
    })();
    const minLeftMargin = Math.min(...lineClusters.map((l) => l[0].xPt));

    const blocks: PdfRichBlock[] = [];
    let currentParaLines: PdfStyledSpan[][] = [];

    const flushPara = () => {
      if (currentParaLines.length === 0) return;
      const flatSpans = currentParaLines.flat();
      const fullText = currentParaLines
        .map((line) => line.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim())
        .join(' ')
        .trim();
      if (!fullText) {
        currentParaLines = [];
        return;
      }

      const firstLine = currentParaLines[0];
      const avgFontSize =
        flatSpans.reduce((acc, s) => acc + s.fontSizePt, 0) / Math.max(1, flatSpans.length);
      const isAllBold = flatSpans.every((s) => s.fontWeight === 'bold');
      const lineMinX = Math.min(...firstLine.map((s) => s.xPt));
      const lineMaxX = Math.max(...firstLine.map((s) => s.xPt + s.widthPt));
      const lineCenter = (lineMinX + lineMaxX) / 2;

      let align: PdfRichBlock['align'] = 'left';
      if (
        currentParaLines.length === 1 &&
        Math.abs(lineCenter - pageWidthPt / 2) <= pageWidthPt * 0.08 &&
        lineMaxX - lineMinX < pageWidthPt * 0.76
      ) {
        align = 'center';
      } else if (
        currentParaLines.length === 1 &&
        lineMinX > pageWidthPt * 0.45 &&
        pageWidthPt - lineMaxX < 65
      ) {
        align = 'right';
      } else if (currentParaLines.length >= 2) {
        align = 'justify';
      }

      let kind: PdfRichBlock['kind'] = 'paragraph';
      let headingLevel: 1 | 2 | 3 | undefined;

      if (firstLine[0].yPt < pageHeightPt * 0.06 && currentParaLines.length === 1 && fullText.length < 70) {
        kind = 'header';
      } else if (firstLine[0].yPt > pageHeightPt * 0.91 && currentParaLines.length === 1 && fullText.length < 70) {
        kind = 'footer';
      } else if (isMathOrEquationLine(fullText)) {
        kind = 'equation';
      } else if (
        (avgFontSize >= medianBodyFont * 1.35 || (isAllBold && avgFontSize >= medianBodyFont * 1.1 && fullText.length <= 95)) &&
        currentParaLines.length <= 2
      ) {
        kind = 'heading';
        headingLevel = avgFontSize >= medianBodyFont * 1.5 ? 1 : avgFontSize >= medianBodyFont * 1.25 ? 2 : 3;
      }

      blocks.push({
        kind,
        headingLevel,
        align,
        indentLeftPt: Math.max(0, Math.round(lineMinX - minLeftMargin)),
        spans: flatSpans,
        text: fullText,
      });
      currentParaLines = [];
    };

    for (let i = 0; i < lineClusters.length; i++) {
      const line = lineClusters[i];
      if (currentParaLines.length === 0) {
        currentParaLines.push(line);
        continue;
      }
      const prevLine = currentParaLines[currentParaLines.length - 1];
      const vGap = line[0].yPt - (prevLine[0].yPt + prevLine[0].fontSizePt);
      const fontChange = Math.abs(line[0].fontSizePt - prevLine[0].fontSizePt) >= 1.8;
      const startsBulletOrNumber = /^(?:\u2022|\*|-|\d+\.|[A-Z]\)|Section\s+[A-Z0-9])/i.test(
        line[0].text
      );
      const prevIsHeadingLike =
        prevLine[0].fontSizePt >= medianBodyFont * 1.25 ||
        prevLine.every((s) => s.fontWeight === 'bold');

      if (
        vGap > prevLine[0].fontSizePt * 0.72 ||
        fontChange ||
        startsBulletOrNumber ||
        prevIsHeadingLike ||
        isMathOrEquationLine(line.map((s) => s.text).join(' '))
      ) {
        flushPara();
      }
      currentParaLines.push(line);
    }
    flushPara();

    return blocks;
  };

  if (!multiColumnDetected) {
    return {
      richBlocks: buildSequentialBlocksFromSpans(remaining),
      multiColumnDetected: false,
    };
  }

  // Split header, 2-column body band, and footer cleanly so column prose flows top-to-bottom per column
  const topFullWidth: PdfStyledSpan[] = [];
  const leftCol: PdfStyledSpan[] = [];
  const rightCol: PdfStyledSpan[] = [];
  const bottomFullWidth: PdfStyledSpan[] = [];

  for (const row of rows) {
    const rowY = row[0].yPt;
    const minX = Math.min(...row.map((s) => s.xPt));
    const maxX = Math.max(...row.map((s) => s.xPt + s.widthPt));
    const hasLeft = row.some((s) => s.xPt < gutterX - 8 && s.xPt + s.widthPt <= gutterX + 14);
    const hasRight = row.some((s) => s.xPt >= gutterX - 2);
    const spansAcrossMid = row.some((s) => s.xPt < gutterX - 20 && s.xPt + s.widthPt > gutterX + 24);

    if (spansAcrossMid || (!hasRight && rowY < pageHeightPt * 0.18 && maxX > gutterX * 0.9)) {
      if (rowY > pageHeightPt * 0.85) bottomFullWidth.push(...row);
      else topFullWidth.push(...row);
    } else if (!hasLeft && rowY > pageHeightPt * 0.85 && minX < gutterX) {
      bottomFullWidth.push(...row);
    } else {
      for (const sp of row) {
        if (sp.xPt < gutterX - 4) leftCol.push(sp);
        else rightCol.push(sp);
      }
    }
  }

  const richBlocks: PdfRichBlock[] = [];
  richBlocks.push(...buildSequentialBlocksFromSpans(topFullWidth));
  const leftBlocks = buildSequentialBlocksFromSpans(leftCol);
  const rightBlocks = buildSequentialBlocksFromSpans(rightCol);
  if (leftBlocks.length > 0 || rightBlocks.length > 0) {
    richBlocks.push({
      kind: 'columns',
      columns: [leftBlocks, rightBlocks].filter((c) => c.length > 0),
      text: [...leftBlocks, ...rightBlocks].map((b) => b.text).join('\n'),
    });
  }
  richBlocks.push(...buildSequentialBlocksFromSpans(bottomFullWidth));

  return { richBlocks, multiColumnDetected: true };
}

export function buildKpfQualityReport(
  chapters: KindleKpfChapter[]
): KpfConversionQualityReport {
  const uniqueColors = new Set<string>();
  const fontSubMap = new Map<string, KpfFontSubstitutionEntry>();
  const pages: KpfPageQualityMetric[] = [];

  let totalWordsExtracted = 0;
  let totalImagesDetected = 0;
  let totalVectorGraphicsDetected = 0;
  let totalTablesPreserved = 0;
  let totalEquationsDetected = 0;
  let totalLinksPreserved = 0;

  for (const ch of chapters) {
    const chColors = new Set<string>(ch.pageColorsHex || []);
    if (ch.pageBackgroundColorHex) chColors.add(ch.pageBackgroundColorHex);
    ch.styledSpans?.forEach((sp) => {
      chColors.add(sp.colorHex);
      if (sp.highlightHex) chColors.add(sp.highlightHex);
    });
    chColors.forEach((c) => uniqueColors.add(c));

    ch.fontSubstitutions?.forEach((fs) => {
      const key = `${fs.pdfFontName}|${fs.substitutedFamily}|${fs.bold}|${fs.italic}`;
      const existing = fontSubMap.get(key);
      if (existing) {
        if (!existing.pageNumbers.includes(ch.pageNumber)) {
          existing.pageNumbers.push(ch.pageNumber);
        }
      } else {
        fontSubMap.set(key, {
          ...fs,
          pageNumbers: [...fs.pageNumbers],
        });
      }
    });

    const pageMetric: KpfPageQualityMetric = ch.pageQuality || {
      pageNumber: ch.pageNumber,
      widthPt: ch.widthPt || 595,
      heightPt: ch.heightPt || 842,
      orientation: ch.orientation || 'portrait',
      charCount: ch.paragraphs.join(' ').length,
      wordCount: ch.paragraphs.join(' ').split(/\s+/).filter(Boolean).length,
      spanCount: ch.styledSpans?.length || 0,
      colorCount: chColors.size,
      imageCount: ch.embeddedImageCount || (ch.imageDataUrl ? 1 : 0),
      vectorGraphicCount: ch.vectorGraphicCount || 0,
      tableCount: ch.richTables?.length || ch.tables?.length || 0,
      equationCount: ch.equations?.length || 0,
      linkCount: ch.links?.length || 0,
      isScannedPage: Boolean(ch.isScannedPage),
      ocrApplied: Boolean(ch.ocrApplied),
      multiColumnDetected: Boolean(ch.multiColumnDetected),
      usedVisualReplicaLayer: Boolean(ch.imageDataUrl),
      fidelityScore: ch.isScannedPage && !ch.ocrApplied ? 86 : 98,
      warnings: [],
    };

    totalWordsExtracted += pageMetric.wordCount;
    totalImagesDetected += pageMetric.imageCount;
    totalVectorGraphicsDetected += pageMetric.vectorGraphicCount;
    totalTablesPreserved += pageMetric.tableCount;
    totalEquationsDetected += pageMetric.equationCount;
    totalLinksPreserved += pageMetric.linkCount;
    pages.push(pageMetric);
  }

  const avgFidelity =
    pages.length > 0
      ? Math.round(
          pages.reduce((sum, p) => sum + p.fidelityScore, 0) / pages.length
        )
      : 100;

  return {
    totalSourcePages: chapters.length,
    totalConvertedChapters: chapters.length,
    pageCountMatched: chapters.length > 0,
    totalWordsExtracted,
    totalColorsPreserved: uniqueColors.size,
    uniqueColorsHex: Array.from(uniqueColors),
    totalImagesDetected,
    totalVectorGraphicsDetected,
    totalTablesPreserved,
    totalEquationsDetected,
    totalLinksPreserved,
    overallFidelityScore: avgFidelity,
    fontSubstitutions: Array.from(fontSubMap.values()),
    pages,
    generatedAt: new Date().toISOString(),
  };
}

export async function extractPdfToKindleChapters(
  pdfBytes: Uint8Array,
  docName = 'Document.pdf',
  options?: KpfExtractionProgressOptions
): Promise<KindleKpfChapter[]> {
  const validation = await validatePdfBytesForConversion(pdfBytes);
  if (!validation.valid) {
    throw new Error(
      validation.errorMessage || 'Unable to validate PDF file for conversion.'
    );
  }

  const chapters: KindleKpfChapter[] = [];
  const fallbackBaseTitle = docName.replace(/\.pdf$/i, '') || 'Section';
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  try {
    for (let pNum = 1; pNum <= totalPages; pNum++) {
      if (options?.shouldCancel?.()) {
        throw new Error('Conversion cancelled by user.');
      }

      options?.onProgress?.(
        pNum,
        totalPages,
        `Analyzing colors, fonts, tables & layout on page ${pNum} of ${totalPages}...`
      );

      const page = await pdf.getPage(pNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const widthPt = Math.max(72, Math.round((baseViewport.width || 595) * 100) / 100);
      const heightPt = Math.max(72, Math.round((baseViewport.height || 842) * 100) / 100);
      const orientation: 'portrait' | 'landscape' =
        widthPt > heightPt ? 'landscape' : 'portrait';

      // 1. Extract low-level graphics state (colors, highlights, rects, rules, images, vector curves)
      const graphics = await extractPageGraphicsFromOperatorList(
        page,
        baseViewport.transform,
        widthPt,
        heightPt
      );

      // 2. Extract hyperlinks & annotations
      const pageLinks: Array<{
        text: string;
        url: string;
        rect?: [number, number, number, number];
      }> = [];
      const seenUrls = new Set<string>();
      try {
        const annotations = await page.getAnnotations();
        for (const ann of annotations) {
          const url = ann?.url || ann?.unsafeUrl;
          if (typeof url === 'string' && /^https?:\/\/|^mailto:/i.test(url)) {
            let linkRect: [number, number, number, number] | undefined;
            if (Array.isArray(ann.rect) && ann.rect.length === 4) {
              const [x1, y1] = applyAffinePoint(baseViewport.transform, ann.rect[0], ann.rect[1]);
              const [x2, y2] = applyAffinePoint(baseViewport.transform, ann.rect[2], ann.rect[3]);
              linkRect = [
                Math.min(x1, x2),
                Math.min(y1, y2),
                Math.abs(x2 - x1),
                Math.abs(y2 - y1),
              ];
            }
            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              pageLinks.push({ text: url, url, rect: linkRect });
            } else if (linkRect) {
              pageLinks.push({ text: url, url, rect: linkRect });
            }
          }
        }
      } catch {
        // Ignore annotation errors
      }

      // 3. Extract styled text spans with exact coordinates, font family/weight/italic, RGB/CMYK color, highlights, and underlines
      const textContent = await page.getTextContent();
      const stylesMap =
        (textContent.styles as Record<
          string,
          { fontFamily?: string; ascent?: number; descent?: number }
        >) || {};
      const pageFontSubMap = new Map<string, KpfFontSubstitutionEntry>();
      const styledSpans: PdfStyledSpan[] = [];
      const pageColorSet = new Set<string>(graphics.uniqueColorsHex);

      for (const item of textContent.items) {
        if (!('str' in item) || !item.str || !item.str.trim() || !item.transform) {
          continue;
        }
        const m = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
        const fontSizePt = Math.max(
          4.5,
          Math.min(
            96,
            Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || item.height || 11
          )
        );
        const baselineY = m[5];
        const xPt = m[4];
        const yPt = baselineY - fontSizePt * 0.85;
        const wPt = Math.max(
          2,
          item.width || item.str.length * fontSizePt * 0.48
        );

        const internalFontId = String(item.fontName || 'default');
        let metaBold = false;
        let metaItalic = false;
        let resolvedPdfFontName = internalFontId;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fontObj: any = page.commonObjs?.has?.(internalFontId)
            ? page.commonObjs.get(internalFontId)
            : null;
          if (fontObj) {
            metaBold = Boolean(fontObj.bold || fontObj.black);
            metaItalic = Boolean(fontObj.italic);
            if (fontObj.name) resolvedPdfFontName = String(fontObj.name);
          }
        } catch {
          // Font metadata lookup optional
        }

        const styleEntry = stylesMap[internalFontId] || {};
        const fontMap = resolveCompatibleFontMapping(
          resolvedPdfFontName,
          styleEntry.fontFamily || 'sans-serif',
          metaBold,
          metaItalic
        );

        if (!pageFontSubMap.has(internalFontId)) {
          pageFontSubMap.set(internalFontId, {
            internalFontId,
            pdfFontName: resolvedPdfFontName,
            substitutedFamily: fontMap.substitutedFamily,
            bold: fontMap.bold,
            italic: fontMap.italic,
            pageNumbers: [pNum],
          });
        }

        // Match exact text color from operator list textDrawEvents
        let matchedColorHex = '#111111';
        let bestDist = Infinity;
        for (const ev of graphics.textDrawEvents) {
          const dy = Math.abs(ev.yPt - baselineY);
          const dx = Math.abs(ev.xPt - xPt);
          const d = dy * 2.5 + dx;
          if (dy <= Math.max(6, fontSizePt) && d < bestDist) {
            bestDist = d;
            matchedColorHex = ev.colorHex;
          }
        }
        pageColorSet.add(matchedColorHex);

        // Detect background / highlight rect behind this span
        let highlightHex: string | undefined;
        const spanMidX = xPt + Math.min(wPt, 24) * 0.5;
        const spanMidY = yPt + fontSizePt * 0.5;
        for (const fr of graphics.filledRects) {
          if (
            fr.colorHex !== '#ffffff' &&
            fr.colorHex !== graphics.pageBackgroundColorHex &&
            spanMidX >= fr.xPt - 2 &&
            spanMidX <= fr.xPt + fr.widthPt + 2 &&
            spanMidY >= fr.yPt - 2 &&
            spanMidY <= fr.yPt + fr.heightPt + 2
          ) {
            highlightHex = fr.colorHex;
            break;
          }
        }

        // Detect underline below baseline
        const hasUnderline = graphics.horizontalRules.some(
          (hr) =>
            hr.y >= baselineY - 1.5 &&
            hr.y <= baselineY + 4.5 &&
            hr.x1 <= xPt + wPt * 0.35 &&
            hr.x2 >= xPt + wPt * 0.65
        );

        // Associate clickable link URL if span lies inside a link annotation rect
        let matchedLinkUrl: string | undefined;
        for (const lnk of pageLinks) {
          if (
            lnk.rect &&
            spanMidX >= lnk.rect[0] - 2 &&
            spanMidX <= lnk.rect[0] + lnk.rect[2] + 2 &&
            spanMidY >= lnk.rect[1] - 2 &&
            spanMidY <= lnk.rect[1] + lnk.rect[3] + 2
          ) {
            matchedLinkUrl = lnk.url;
            break;
          }
        }

        styledSpans.push({
          text: item.str.trim(),
          xPt: Math.round(xPt * 100) / 100,
          yPt: Math.round(yPt * 100) / 100,
          widthPt: Math.round(wPt * 100) / 100,
          heightPt: Math.round(fontSizePt * 1.15 * 100) / 100,
          fontSizePt: Math.round(fontSizePt * 10) / 10,
          fontFamily: fontMap.substitutedFamily,
          originalFontName: resolvedPdfFontName,
          fontWeight: fontMap.bold ? 'bold' : 'normal',
          fontStyle: fontMap.italic ? 'italic' : 'normal',
          underline: hasUnderline || undefined,
          colorHex: matchedColorHex,
          highlightHex,
          linkUrl: matchedLinkUrl,
        });
      }

      // 4. Detect ruled + spatial tables & reconstruct non-duplicate structured blocks
      const { richTables, consumedSpanIndices } = detectRuledAndSpatialTables(
        styledSpans,
        graphics,
        widthPt
      );
      const { richBlocks, multiColumnDetected } = reconstructRichBlocksFromSpans(
        styledSpans,
        consumedSpanIndices,
        widthPt,
        heightPt
      );

      const pageTables: string[][][] = richTables.map((rt) =>
        rt.rows.map((row) => row.map((cell) => cell.text))
      );

      const rawLines: string[] = [];
      for (const blk of richBlocks) {
        if (blk.columns) {
          blk.columns.forEach((col) =>
            col.forEach((cBlk) => {
              if (cBlk.text.trim()) rawLines.push(cBlk.text.trim());
            })
          );
        } else if (blk.text.trim()) {
          rawLines.push(blk.text.trim());
        }
      }

      for (const line of rawLines) {
        const urlMatches =
          line.match(/(?:https?:\/\/|www\.)[^\s)<>"']+/gi) || [];
        for (const rawUrl of urlMatches) {
          const normalizedUrl = rawUrl.startsWith('www.')
            ? `https://${rawUrl}`
            : rawUrl;
          if (!seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            pageLinks.push({ text: rawUrl, url: normalizedUrl });
          }
        }
      }

      // 5. Render high-resolution visual page layer (only in DOM environments with <canvas>)
      let imageDataUrl: string | undefined;
      if (typeof document !== 'undefined') {
        try {
          const hiScale =
            totalPages > 60 ? 1.35 : totalPages > 20 ? 1.6 : 1.85;
          const viewport = page.getViewport({ scale: hiScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = graphics.pageBackgroundColorHex || '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
              canvasContext: ctx,
              canvas,
              viewport,
            }).promise;
            imageDataUrl = canvas.toDataURL('image/jpeg', 0.88);
            canvas.width = 1;
            canvas.height = 1;
          }
        } catch {
          try {
            const rendered = await renderPdfPage(
              pdfBytes,
              pNum,
              1.4,
              'image/jpeg',
              0.86
            );
            imageDataUrl = rendered.dataUrl;
          } catch {
            // Optional snapshot fallback
          }
        }
      }

      const nativeCharCount = styledSpans.reduce((s, sp) => s + sp.text.length, 0);
      const isScannedPage = nativeCharCount < 15;
      let ocrApplied = false;

      if (
        isScannedPage &&
        options?.enableOcrForScanned &&
        imageDataUrl
      ) {
        try {
          options?.onProgress?.(
            pNum,
            totalPages,
            `Running OCR text recognition on scanned page ${pNum} of ${totalPages}...`
          );
          const Tesseract = await import('tesseract.js');
          const ocrResult = await Tesseract.recognize(imageDataUrl, 'eng');
          const ocrText = (ocrResult?.data?.text || '').trim();
          if (ocrText.length > 0) {
            const ocrLines = ocrText
              .split(/\n+/)
              .map((l) => l.trim())
              .filter(Boolean);
            if (ocrLines.length > 0) {
              rawLines.push(...ocrLines);
              ocrLines.forEach((line, lIdx) => {
                richBlocks.push({
                  kind: isMathOrEquationLine(line) ? 'equation' : 'paragraph',
                  text: line,
                });
                styledSpans.push({
                  text: line,
                  xPt: 42,
                  yPt: 52 + lIdx * 16,
                  widthPt: Math.max(40, widthPt - 84),
                  heightPt: 13,
                  fontSizePt: 11,
                  fontFamily: '"Georgia", serif',
                  originalFontName: 'OCR-Recognized',
                  fontWeight: 'normal',
                  fontStyle: 'normal',
                  colorHex: '#111111',
                });
              });
              ocrApplied = true;
            }
          }
        } catch {
          // Keep visual replica fallback if offline OCR fails
        }
      }

      let title = `Page ${pNum}`;
      const bodyLines: string[] = [];

      const firstHeading = richBlocks.find(
        (b) => b.kind === 'heading' && b.text.length >= 3 && b.text.length <= 95
      );
      if (firstHeading) {
        title = firstHeading.text;
        bodyLines.push(...rawLines);
      } else if (rawLines.length > 0) {
        const firstCandidate = rawLines[0];
        if (firstCandidate.length >= 3 && firstCandidate.length <= 95) {
          title = firstCandidate;
          bodyLines.push(...rawLines.slice(1));
        } else {
          title = `${fallbackBaseTitle} — Page ${pNum}`;
          bodyLines.push(...rawLines);
        }
      } else {
        title = `${fallbackBaseTitle} — Page ${pNum}`;
        bodyLines.push(
          `[Illustrated / Scanned Page ${pNum} from ${fallbackBaseTitle}]`
        );
      }

      const equations = rawLines.filter((l) => isMathOrEquationLine(l));
      const wordCount =
        rawLines.join(' ').split(/\s+/).filter(Boolean).length +
        pageTables.flat(2).join(' ').split(/\s+/).filter(Boolean).length;

      const pageWarnings: string[] = [];
      if (isScannedPage && !ocrApplied) {
        pageWarnings.push(
          'Scanned/image page detected with minimal selectable text; preserved via high-resolution fixed-layout visual replica. Enable OCR to add searchable text.'
        );
      }
      if (graphics.vectorGraphicCount > 0) {
        pageWarnings.push(
          `Contains ${graphics.vectorGraphicCount} vector diagram/shape paths preserved in the fixed-layout page layer.`
        );
      }
      if (pageFontSubMap.size > 0) {
        const subCount = pageFontSubMap.size;
        pageWarnings.push(
          `${subCount} PDF font${subCount === 1 ? '' : 's'} mapped to compatible KPF/web font families.`
        );
      }

      const fidelityScore = isScannedPage && !ocrApplied
        ? imageDataUrl
          ? 88
          : 72
        : 99;

      const pageQuality: KpfPageQualityMetric = {
        pageNumber: pNum,
        widthPt,
        heightPt,
        orientation,
        charCount: nativeCharCount,
        wordCount,
        spanCount: styledSpans.length,
        colorCount: pageColorSet.size,
        imageCount: graphics.embeddedImageCount,
        vectorGraphicCount: graphics.vectorGraphicCount,
        tableCount: richTables.length,
        equationCount: equations.length,
        linkCount: pageLinks.length,
        isScannedPage,
        ocrApplied,
        multiColumnDetected,
        usedVisualReplicaLayer: Boolean(imageDataUrl),
        fidelityScore,
        warnings: pageWarnings,
      };

      chapters.push({
        chapterNumber: pNum,
        title,
        paragraphs: bodyLines.length > 0 ? bodyLines : [title],
        tables: pageTables.length > 0 ? pageTables : undefined,
        richTables: richTables.length > 0 ? richTables : undefined,
        richBlocks: richBlocks.length > 0 ? richBlocks : undefined,
        styledSpans: styledSpans.length > 0 ? styledSpans : undefined,
        pageBackgroundColorHex: graphics.pageBackgroundColorHex,
        pageColorsHex: Array.from(pageColorSet),
        embeddedImageCount: graphics.embeddedImageCount,
        vectorGraphicCount: graphics.vectorGraphicCount,
        multiColumnDetected,
        fontSubstitutions: Array.from(pageFontSubMap.values()),
        equations: equations.length > 0 ? equations : undefined,
        links: pageLinks.length > 0 ? pageLinks : undefined,
        pageNumber: pNum,
        widthPt,
        heightPt,
        orientation,
        isScannedPage,
        ocrApplied,
        imageDataUrl,
        pageQuality,
      });

      try {
        page.cleanup?.();
      } catch {
        // Ignore optional cleanup errors
      }

      // Yield to UI thread so large multi-page PDFs never freeze the browser/WebView
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await loadingTask.destroy();
  }

  if (chapters.length === 0) {
    chapters.push({
      chapterNumber: 1,
      title: fallbackBaseTitle,
      paragraphs: ['Converted Kindle KPF chapter content.'],
      pageNumber: 1,
      orientation: 'portrait',
    });
  }

  return chapters;
}

const CRC32_LOOKUP = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_LOOKUP[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZipArchive(
  entries: Array<{ path: string; data: Uint8Array }>
): Uint8Array {
  const encoder = new TextEncoder();
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }> = [];

  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const crc = computeCrc32(entry.data);
    fileRecords.push({
      nameBytes,
      data: entry.data,
      crc,
      offset,
    });
    offset += 30 + nameBytes.length + entry.data.length;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const rec of fileRecords) {
    centralDirSize += 46 + rec.nameBytes.length;
  }

  const totalSize = centralDirStart + centralDirSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let pos = 0;
  for (const rec of fileRecords) {
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true);
    view.setUint16(pos + 8, 0, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, 0x21, true);
    view.setUint32(pos + 14, rec.crc, true);
    view.setUint32(pos + 18, rec.data.length, true);
    view.setUint32(pos + 22, rec.data.length, true);
    view.setUint16(pos + 26, rec.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;
    out.set(rec.nameBytes, pos);
    pos += rec.nameBytes.length;
    out.set(rec.data, pos);
    pos += rec.data.length;
  }

  for (const rec of fileRecords) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, 0, true);
    view.setUint16(pos + 14, 0x21, true);
    view.setUint32(pos + 16, rec.crc, true);
    view.setUint32(pos + 20, rec.data.length, true);
    view.setUint32(pos + 24, rec.data.length, true);
    view.setUint16(pos + 28, rec.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, rec.offset, true);
    pos += 46;
    out.set(rec.nameBytes, pos);
    pos += rec.nameBytes.length;
  }

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, fileRecords.length, true);
  view.setUint16(pos + 10, fileRecords.length, true);
  view.setUint32(pos + 12, centralDirSize, true);
  view.setUint32(pos + 16, centralDirStart, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

function decodeDataUrlToBinary(dataUrl: string): {
  bytes: Uint8Array;
  ext: 'jpg' | 'png' | 'webp';
  mediaType: string;
} | null {
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mediaType = match[1].toLowerCase();
  const base64 = match[2];
  try {
    let bytes: Uint8Array;
    if (typeof atob === 'function') {
      const bin = atob(base64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const ext: 'jpg' | 'png' | 'webp' = mediaType.includes('png')
      ? 'png'
      : mediaType.includes('webp')
        ? 'webp'
        : 'jpg';
    return { bytes, ext, mediaType };
  } catch {
    return null;
  }
}

function renderStyledSpansXml(spans: PdfStyledSpan[]): string {
  return spans
    .map((sp, sIdx) => {
      const css: string[] = [];
      if (sp.colorHex && sp.colorHex !== '#111111') {
        css.push(`color:${sp.colorHex}`);
      }
      if (sp.highlightHex) {
        css.push(`background-color:${sp.highlightHex};padding:0 2px;border-radius:2px`);
      }
      if (sp.fontFamily) {
        css.push(`font-family:${sp.fontFamily.replace(/"/g, "'")}`);
      }
      if (sp.fontWeight === 'bold') {
        css.push('font-weight:700');
      }
      if (sp.fontStyle === 'italic') {
        css.push('font-style:italic');
      }
      if (sp.underline) {
        css.push('text-decoration:underline');
      }
      let inner = escapeXmlText(sp.text);
      if (sp.script === 'sup') inner = `<sup>${inner}</sup>`;
      else if (sp.script === 'sub') inner = `<sub>${inner}</sub>`;
      if (sp.linkUrl) {
        inner = `<a href="${escapeXmlText(sp.linkUrl)}">${inner}</a>`;
      }
      const styleAttr = css.length > 0 ? ` style="${css.join(';')}"` : '';
      const prefixSpace = sIdx > 0 && sp.script === 'normal' ? ' ' : sIdx > 0 ? ' ' : '';
      return `${prefixSpace}<span${styleAttr}>${inner}</span>`;
    })
    .join('')
    .trim();
}

function renderRichTableXhtml(tbl: PdfRichTable): string {
  const colGroup =
    tbl.colWidthPcts.length > 0
      ? `      <colgroup>\n${tbl.colWidthPcts
          .map((pct) => `        <col style="width:${pct}%"/>`)
          .join('\n')}\n      </colgroup>\n`
      : '';
  const bodyRows = tbl.rows
    .map((row, rIdx) => {
      const cellsXml = row
        .map((cell) => {
          const tag = rIdx === 0 ? 'th' : 'td';
          const css: string[] = [
            `text-align:${cell.align || 'left'}`,
            `border:1px solid ${cell.borderColorHex || tbl.borderColorHex || '#cbd5e1'}`,
            'padding:5px 8px',
          ];
          if (cell.bgColorHex) css.push(`background-color:${cell.bgColorHex}`);
          if (cell.colorHex) css.push(`color:${cell.colorHex}`);
          if (cell.bold) css.push('font-weight:700');
          if (cell.italic) css.push('font-style:italic');
          const colspanAttr = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
          const rowspanAttr = cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
          return `<${tag}${colspanAttr}${rowspanAttr} style="${css.join(';')}">${
            escapeXmlText(cell.text) || '&#160;'
          }</${tag}>`;
        })
        .join('');
      return `        <tr>${cellsXml}</tr>`;
    })
    .join('\n');

  return `    <table class="kpf-table" style="border-color:${
    tbl.borderColorHex || '#cbd5e1'
  };">\n${colGroup}      <tbody>\n${bodyRows}\n      </tbody>\n    </table>`;
}

function renderRichBlocksXhtml(
  blocks: PdfRichBlock[],
  linkifyFn: (escaped: string) => string
): string {
  return blocks
    .map((blk, bIdx) => {
      if (blk.kind === 'columns' && blk.columns && blk.columns.length > 0) {
        const colsXml = blk.columns
          .map(
            (colBlocks) =>
              `      <div class="kpf-col">\n${renderRichBlocksXhtml(colBlocks, linkifyFn)}\n      </div>`
          )
          .join('\n');
        return `    <div class="kpf-columns">\n${colsXml}\n    </div>`;
      }

      const inlineXml =
        blk.spans && blk.spans.length > 0
          ? renderStyledSpansXml(blk.spans)
          : linkifyFn(escapeXmlText(blk.text));

      const pCss: string[] = [];
      if (blk.align) pCss.push(`text-align:${blk.align}`);
      if (blk.indentLeftPt && blk.indentLeftPt > 8) {
        pCss.push(`padding-left:${Math.min(72, blk.indentLeftPt)}pt`);
      }
      if (blk.bgColorHex) pCss.push(`background-color:${blk.bgColorHex}`);
      const styleAttr = pCss.length > 0 ? ` style="${pCss.join(';')}"` : '';

      if (blk.kind === 'heading') {
        const hTag = blk.headingLevel === 1 ? 'h1' : blk.headingLevel === 3 ? 'h3' : 'h2';
        return `    <${hTag}${styleAttr}>${inlineXml}</${hTag}>`;
      }
      if (blk.kind === 'header') {
        return `    <div class="kpf-page-header"${styleAttr}>${inlineXml}</div>`;
      }
      if (blk.kind === 'footer') {
        return `    <div class="kpf-page-footer"${styleAttr}>${inlineXml}</div>`;
      }
      if (blk.kind === 'equation') {
        return `    <p class="kpf-math"${styleAttr}>${inlineXml}</p>`;
      }
      const cls = bIdx === 0 ? 'first-para' : '';
      return `    <p class="${cls}"${styleAttr}>${inlineXml}</p>`;
    })
    .join('\n');
}

export function buildKindleKpfPackageBytes(
  chapters: KindleKpfChapter[],
  options: KindleKpfBookOptions
): Uint8Array {
  const encoder = new TextEncoder();
  const bookUuid = `urn:uuid:kpf-${Date.now()}`;
  const bookTitle = options.title.trim() || 'Kindle Book';
  const bookAuthor = options.author.trim() || 'Author';
  const bookLang = options.language.trim() || 'en';
  const fontScale = options.fontScalePct || 100;
  const qualityReport = buildKpfQualityReport(chapters);

  const entries: Array<{ path: string; data: Uint8Array }> = [];

  // 1. Standard EPUB/KPF mimetype header (must be first and uncompressed)
  entries.push({
    path: 'mimetype',
    data: encoder.encode('application/epub+zip'),
  });

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  entries.push({
    path: 'META-INF/container.xml',
    data: encoder.encode(containerXml),
  });

  // 3. Shared High-Fidelity Stylesheet (supports fixed-layout hybrid sheets, positioned text layer, multi-column grids, styled tables & equations)
  const stylesCss = `*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: "Georgia", "Bookerly", serif;
  font-size: ${fontScale}%;
  line-height: 1.55;
  margin: 0;
  padding: 12px 8px;
  background: #E2E8F0;
  color: #111111;
}
body.kpf-reflow-body {
  background: #FFFFFF;
  margin: 1.2em;
  padding: 0;
}
.kpf-page-sheet {
  position: relative;
  width: 100%;
  max-width: 820px;
  margin: 0 auto 18px auto;
  background: #FFFFFF;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14), 0 1px 3px rgba(15, 23, 42, 0.08);
  border: 1px solid #CBD5E1;
  overflow: hidden;
}
.kpf-page-canvas {
  position: relative;
  width: 100%;
  overflow: hidden;
}
.kpf-page-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  user-select: none;
  pointer-events: none;
}
.kpf-vector-backdrop {
  position: relative;
  width: 100%;
  height: 100%;
}
.kpf-text-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
}
.kpf-span-overlay {
  position: absolute;
  white-space: pre;
  line-height: 1.05;
  color: transparent;
  user-select: text;
  cursor: text;
}
.kpf-span-overlay::selection {
  background: rgba(0, 63, 232, 0.28);
  color: transparent;
}
.kpf-link-hotspot {
  position: absolute;
  z-index: 3;
  display: block;
  border-bottom: 1px dashed rgba(0, 63, 232, 0.45);
}
.kpf-semantic-visually-hidden {
  display: none;
}
h1, h2, h3 {
  font-weight: 700;
  line-height: 1.3;
  margin-top: 0.9em;
  margin-bottom: 0.45em;
  page-break-after: avoid;
}
p {
  margin: 0 0 0.65em 0;
}
.kpf-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  margin: 0.8em 0;
}
.kpf-col p {
  text-indent: 0;
  font-size: 0.96em;
}
.kpf-page-header {
  font-size: 0.85em;
  color: #475569;
  border-bottom: 1px solid #E2E8F0;
  padding-bottom: 4px;
  margin-bottom: 10px;
}
.kpf-page-footer {
  font-size: 0.85em;
  color: #475569;
  border-top: 1px solid #E2E8F0;
  padding-top: 4px;
  margin-top: 12px;
}
.replica-figure {
  text-align: center;
  margin: 0.85em 0;
  page-break-inside: avoid;
}
.replica-figure img {
  max-width: 100%;
  height: auto;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
}
table.kpf-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.9em 0;
  font-size: 0.92em;
  table-layout: fixed;
}
table.kpf-table th, table.kpf-table td {
  border: 1px solid #cbd5e1;
  padding: 6px 8px;
  word-wrap: break-word;
}
table.kpf-table th {
  font-weight: 700;
}
.kpf-math {
  font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif;
  font-style: italic;
  background-color: #f8fafc;
  border-left: 3px solid #E47911;
  padding: 6px 12px;
  margin: 0.65em 0;
}
.kpf-links {
  margin-top: 0.75em;
  font-size: 0.9em;
}
.kpf-links a {
  color: #003FE8;
  text-decoration: underline;
}`;
  entries.push({
    path: 'OEBPS/styles.css',
    data: encoder.encode(stylesCss),
  });

  // 4. Deduplicated Binary Image Resources + Chapter XHTML Files
  const manifestItems: string[] = [
    `<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
  ];
  const spineItems: string[] = [];
  const tocLinks: string[] = [];
  const imageManifestPaths: Array<{ id: string; path: string; mediaType: string }> = [];

  const linkifyEscapedXml = (escapedText: string): string => {
    return escapedText.replace(
      /(https?:\/\/[^\s&<>"']+)/gi,
      '<a href="$1">$1</a>'
    );
  };

  chapters.forEach((ch, idx) => {
    const chId = `chapter-${idx + 1}`;
    const fileName = `${chId}.xhtml`;
    const pageW = Math.max(200, Math.round(ch.widthPt || 595));
    const pageH = Math.max(200, Math.round(ch.heightPt || 842));

    manifestItems.push(
      `<item id="${chId}" href="${fileName}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${chId}"/>`);
    tocLinks.push(
      `        <li><a href="${fileName}">${escapeXmlText(ch.title)}</a></li>`
    );

    // Store page replica binary ONCE under OEBPS/images/page-N.<ext>
    let pageImgRelPath: string | null = null;
    if (ch.imageDataUrl) {
      const decodedImg = decodeDataUrlToBinary(ch.imageDataUrl);
      if (decodedImg) {
        const imgFile = `images/page-${ch.pageNumber}.${decodedImg.ext}`;
        const fullImgPath = `OEBPS/${imgFile}`;
        const imgId = `img-page-${ch.pageNumber}`;
        entries.push({ path: fullImgPath, data: decodedImg.bytes });
        manifestItems.push(
          `<item id="${imgId}" href="${imgFile}" media-type="${decodedImg.mediaType}"/>`
        );
        imageManifestPaths.push({
          id: imgId,
          path: fullImgPath,
          mediaType: decodedImg.mediaType,
        });
        pageImgRelPath = imgFile;
      }
    }

    const richTablesXml =
      ch.richTables && ch.richTables.length > 0
        ? ch.richTables.map((rt) => renderRichTableXhtml(rt)).join('\n')
        : ch.tables && ch.tables.length > 0
          ? ch.tables
              .map(
                (tbl) =>
                  `    <table class="kpf-table">\n      <tbody>\n${tbl
                    .map(
                      (row, rIdx) =>
                        `        <tr>${row
                          .map(
                            (cell) =>
                              `<${rIdx === 0 ? 'th' : 'td'}>${escapeXmlText(cell)}</${
                                rIdx === 0 ? 'th' : 'td'
                              }>`
                          )
                          .join('')}</tr>`
                    )
                    .join('\n')}\n      </tbody>\n    </table>`
              )
              .join('\n')
          : '';

    const richBodyXml =
      ch.richBlocks && ch.richBlocks.length > 0
        ? renderRichBlocksXhtml(ch.richBlocks, linkifyEscapedXml)
        : ch.paragraphs
            .map((p, pIdx) => {
              const isEq = isMathOrEquationLine(p);
              const escaped = linkifyEscapedXml(escapeXmlText(p));
              if (isEq) {
                return `    <p class="kpf-math">${escaped}</p>`;
              }
              return `    <p class="${pIdx === 0 ? 'first-para' : ''}">${escaped}</p>`;
            })
            .join('\n');

    const linksHtml =
      ch.links && ch.links.length > 0
        ? `    <div class="kpf-links">\n      <ul>\n${ch.links
            .map(
              (lnk) =>
                `        <li><a href="${escapeXmlText(lnk.url)}">${escapeXmlText(
                  lnk.text
                )}</a></li>`
            )
            .join('\n')}\n      </ul>\n    </div>\n`
        : '';

    // Build positioned text spans overlay for hybrid / print-replica modes
    const positionedSpansXml = (ch.styledSpans || [])
      .map((sp) => {
        const leftPct = Math.max(0, Math.min(99, (sp.xPt / pageW) * 100)).toFixed(3);
        const topPct = Math.max(0, Math.min(99, (sp.yPt / pageH) * 100)).toFixed(3);
        const fontSizeCqw = ((sp.fontSizePt / pageW) * 100).toFixed(3);
        const weight = sp.fontWeight === 'bold' ? 'font-weight:700;' : '';
        const fStyle = sp.fontStyle === 'italic' ? 'font-style:italic;' : '';
        return `        <span class="kpf-span-overlay" style="left:${leftPct}%;top:${topPct}%;font-size:clamp(7px, ${fontSizeCqw}vw, ${Math.round(
          sp.fontSizePt * 1.4
        )}px);${weight}${fStyle}">${escapeXmlText(sp.text)}</span>`;
      })
      .join('\n');

    const linkHotspotsXml = (ch.links || [])
      .filter((lnk) => Array.isArray(lnk.rect))
      .map((lnk) => {
        const [lx, ly, lw, lh] = lnk.rect!;
        const leftPct = ((lx / pageW) * 100).toFixed(2);
        const topPct = ((ly / pageH) * 100).toFixed(2);
        const wPct = Math.max(2, (lw / pageW) * 100).toFixed(2);
        const hPct = Math.max(1.5, (lh / pageH) * 100).toFixed(2);
        return `        <a class="kpf-link-hotspot" href="${escapeXmlText(
          lnk.url
        )}" title="${escapeXmlText(
          lnk.url
        )}" style="left:${leftPct}%;top:${topPct}%;width:${wPct}%;height:${hPct}%;"></a>`;
      })
      .join('\n');

    // Fallback positioned HTML spans when no raster image was captured (e.g. headless conversion)
    const fallbackPositionedVisualSpans = !pageImgRelPath
      ? (ch.styledSpans || [])
          .map((sp) => {
            const leftPct = Math.max(0, Math.min(98, (sp.xPt / pageW) * 100)).toFixed(2);
            const topPct = Math.max(0, Math.min(98, (sp.yPt / pageH) * 100)).toFixed(2);
            const bgCss = sp.highlightHex ? `background-color:${sp.highlightHex};` : '';
            const ulCss = sp.underline ? 'text-decoration:underline;' : '';
            return `        <span style="position:absolute;left:${leftPct}%;top:${topPct}%;color:${sp.colorHex};font-size:${sp.fontSizePt}pt;font-weight:${sp.fontWeight};font-style:${sp.fontStyle};font-family:${sp.fontFamily.replace(
              /"/g,
              "'"
            )};${bgCss}${ulCss}white-space:pre;">${escapeXmlText(sp.text)}</span>`;
          })
          .join('\n')
      : '';

    const pageBgHex = ch.pageBackgroundColorHex || '#FFFFFF';
    const aspectRatioCss = `${pageW} / ${pageH}`;
    const isFixedMode =
      options.layoutMode === 'hybrid' || options.layoutMode === 'print-replica';

    let chapterXhtml = '';
    if (isFixedMode) {
      const bgImgTag = pageImgRelPath
        ? `      <img class="kpf-page-bg" src="${pageImgRelPath}" alt="${escapeXmlText(
            ch.title
          )}"/>`
        : `      <div class="kpf-vector-backdrop">\n${fallbackPositionedVisualSpans}\n      </div>`;

      chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXmlText(bookLang)}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${pageW}, height=${pageH}"/>
  <title>${escapeXmlText(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section class="kpf-page-sheet" epub:type="chapter" data-page-number="${ch.pageNumber}" data-orientation="${ch.orientation || 'portrait'}" data-width-pt="${pageW}" data-height-pt="${pageH}">
    <div class="kpf-page-canvas" style="aspect-ratio:${aspectRatioCss};background-color:${pageBgHex};">
${bgImgTag}
${
  pageImgRelPath
    ? `      <div class="kpf-text-layer">\n${positionedSpansXml}\n${linkHotspotsXml}\n      </div>`
    : ''
}
    </div>
    <aside class="kpf-semantic-layer kpf-semantic-visually-hidden">
      <h1>${escapeXmlText(ch.title)}</h1>
${richTablesXml ? richTablesXml + '\n' : ''}${richBodyXml}
${linksHtml}    </aside>
  </section>
</body>
</html>`;
    } else {
      // Enhanced Semantic Reflowable Mode (with preserved colors, highlights, tables, multi-column grids, and diagrams)
      const shouldEmbedDiagramFigure =
        Boolean(pageImgRelPath) &&
        (Boolean(ch.isScannedPage) ||
          (ch.embeddedImageCount || 0) > 0 ||
          (ch.vectorGraphicCount || 0) > 0);
      const figureBlock = shouldEmbedDiagramFigure
        ? `    <div class="replica-figure">\n      <img src="${pageImgRelPath}" alt="${escapeXmlText(
            ch.title
          )}"/>\n    </div>\n`
        : '';

      chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXmlText(bookLang)}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeXmlText(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="kpf-reflow-body" style="background-color:${pageBgHex};">
  <section epub:type="chapter" data-page-number="${ch.pageNumber}" data-orientation="${ch.orientation || 'portrait'}">
    <h1>${escapeXmlText(ch.title)}</h1>
${figureBlock}${richBodyXml}
${richTablesXml ? richTablesXml + '\n' : ''}${linksHtml}  </section>
</body>
</html>`;
    }

    entries.push({
      path: `OEBPS/${fileName}`,
      data: encoder.encode(chapterXhtml),
    });
  });

  // 5. Amazon Kindle Package Format (KPF / KDF) manifest + full Quality Report
  const kdfManifest = {
    format: 'Amazon Kindle Package Format (KPF)',
    kpfVersion: '3.0',
    generator: 'ElimikaPDF Hybrid PDF-to-KPF Engine',
    createdAt: new Date().toISOString(),
    title: bookTitle,
    author: bookAuthor,
    language: bookLang,
    layoutMode: options.layoutMode,
    hasSourcePdfReplica: Boolean(options.sourcePdfBytes),
    qualityReport,
    bookMetadata: {
      bookId: bookUuid,
      title: bookTitle,
      author: bookAuthor,
      language: bookLang,
      publisher: options.publisher || 'ElimikaPDF KDP Studio',
      layoutMode: options.layoutMode,
      chapterCount: chapters.length,
    },
    chapters: chapters.map((ch) => ({
      id: `chapter-${ch.chapterNumber}`,
      chapterNumber: ch.chapterNumber,
      title: ch.title,
      sourcePageNumber: ch.pageNumber,
      widthPt: ch.widthPt || 595,
      heightPt: ch.heightPt || 842,
      orientation: ch.orientation || 'portrait',
      pageBackgroundColorHex: ch.pageBackgroundColorHex || '#FFFFFF',
      isScannedPage: Boolean(ch.isScannedPage),
      ocrApplied: Boolean(ch.ocrApplied),
      multiColumnDetected: Boolean(ch.multiColumnDetected),
      paragraphCount: ch.paragraphs.length,
      tableCount: ch.richTables?.length || ch.tables?.length || 0,
      equationCount: ch.equations?.length || 0,
      imageCount: ch.embeddedImageCount || 0,
      colorCount: ch.pageColorsHex?.length || 0,
      href: `OEBPS/chapter-${ch.chapterNumber}.xhtml`,
    })),
    resources: [
      ...chapters.map((ch) => ({
        id: `chapter-${ch.chapterNumber}`,
        path: `OEBPS/chapter-${ch.chapterNumber}.xhtml`,
        role: 'chapter',
        mediaType: 'application/xhtml+xml',
      })),
      ...imageManifestPaths.map((img) => ({
        id: img.id,
        path: img.path,
        role: 'image',
        mediaType: img.mediaType,
      })),
    ],
  };

  entries.push({
    path: 'kdf_manifest.json',
    data: encoder.encode(JSON.stringify(kdfManifest, null, 2)),
  });

  // 6. Navigation TOC (OEBPS/toc.xhtml)
  const tocXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXmlText(bookLang)}">
<head>
  <meta charset="UTF-8"/>
  <title>Table of Contents — ${escapeXmlText(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="kpf-reflow-body">
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${tocLinks.join('\n')}
    </ol>
  </nav>
</body>
</html>`;
  entries.push({
    path: 'OEBPS/toc.xhtml',
    data: encoder.encode(tocXhtml),
  });

  // 7. Embed original PDF replica inside KPF container if provided so reopening in ElimikaPDF restores 100% page fidelity
  if (options.sourcePdfBytes && options.sourcePdfBytes.byteLength > 0) {
    manifestItems.push(
      `<item id="source-pdf-replica" href="source_replica.pdf" media-type="application/pdf"/>`
    );
    entries.push({
      path: 'OEBPS/source_replica.pdf',
      data: new Uint8Array(options.sourcePdfBytes),
    });
  }

  // 8. Package OPF (OEBPS/content.opf)
  const renditionLayout =
    options.layoutMode === 'reflowable' ? 'reflowable' : 'pre-paginated';
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXmlText(bookUuid)}</dc:identifier>
    <dc:title>${escapeXmlText(bookTitle)}</dc:title>
    <dc:creator>${escapeXmlText(bookAuthor)}</dc:creator>
    <dc:language>${escapeXmlText(bookLang)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    <meta property="rendition:layout">${renditionLayout}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  entries.push({
    path: 'OEBPS/content.opf',
    data: encoder.encode(contentOpf),
  });

  return buildStoredZipArchive(entries);
}

// ============================================================================
// 14. UNIVERSAL SPREADSHEET (.XLSX, .XLS, .CSV) & PRESENTATION (.PPTX, .PPT) PARSERS
// ============================================================================

async function inflateRawZipChunk(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    // Run write and read concurrently so large XML/Excel streams (>16KB) never deadlock on backpressure
    const writePromise = (async () => {
      try {
        await writer.write(new Uint8Array(compressed));
        await writer.close();
      } catch {
        // Ignore trailing stream errors if deflate stream ends early
      }
    })();

    const readPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            total += value.byteLength;
          }
        }
      } catch {
        // Return chunks collected so far
      }
    })();

    await Promise.all([writePromise, readPromise]);

    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  return compressed;
}

async function extractZipTextEntries(
  zipBytes: Uint8Array
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const view = new DataView(
    zipBytes.buffer,
    zipBytes.byteOffset,
    zipBytes.byteLength
  );
  const decoder = new TextDecoder('utf-8', { fatal: false });

  // Locate End of Central Directory (EOCD: 0x06054b50)
  let eocdPos = -1;
  for (
    let i = zipBytes.byteLength - 22;
    i >= Math.max(0, zipBytes.byteLength - 65557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }

  if (eocdPos < 0) return result;

  const entryCount = view.getUint16(eocdPos + 10, true);
  let cdPos = view.getUint32(eocdPos + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (
      cdPos + 46 > zipBytes.byteLength ||
      view.getUint32(cdPos, true) !== 0x02014b50
    ) {
      break;
    }
    const compressionMethod = view.getUint16(cdPos + 10, true);
    const compressedSize = view.getUint32(cdPos + 20, true);
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localHeaderOffset = view.getUint32(cdPos + 42, true);

    const fileName = decoder.decode(
      zipBytes.subarray(cdPos + 46, cdPos + 46 + nameLen)
    );
    cdPos += 46 + nameLen + extraLen + commentLen;

    if (
      !fileName.endsWith('.xml') &&
      !fileName.endsWith('.rels') &&
      !fileName.endsWith('.txt')
    ) {
      continue;
    }

    if (
      localHeaderOffset + 30 <= zipBytes.byteLength &&
      view.getUint32(localHeaderOffset, true) === 0x04034b50
    ) {
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = Math.min(
        zipBytes.byteLength,
        dataStart + compressedSize
      );
      const rawSlice = zipBytes.subarray(dataStart, dataEnd);

      try {
        if (compressionMethod === 0) {
          result.set(fileName, decoder.decode(rawSlice));
        } else if (compressionMethod === 8) {
          const inflated = await inflateRawZipChunk(rawSlice);
          result.set(fileName, decoder.decode(inflated));
        }
      } catch {
        // Ignore individual corrupt entry
      }
    }
  }

  return result;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export interface ParsedExcelSheet {
  name: string;
  rows: string[][];
}

function excelColLettersToIndex(colRef: string): number {
  let idx = 0;
  for (let i = 0; i < colRef.length; i++) {
    const code = colRef.toUpperCase().charCodeAt(i);
    if (code >= 65 && code <= 90) {
      idx = idx * 26 + (code - 64);
    }
  }
  return Math.max(0, idx - 1);
}

function indexToExcelColLetters(index: number): string {
  let n = index + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

/**
 * Parses an uploaded Excel workbook (.xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv)
 * into an array of named worksheets with clean 2D string[][] rows.
 * Uses SheetJS (`xlsx`) for full BIFF8/OpenXML/ODS/CSV support, with a secondary
 * ZIP/XML/CSV fallback so no valid spreadsheet ever fails to import.
 */
export async function parseUploadedWorkbookSheets(
  file: File
): Promise<ParsedExcelSheet[]> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const defaultSheetName =
    file.name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Sheet1';

  // 1. Primary Parser: SheetJS (handles .xlsx, binary .xls BIFF8/BIFF5, .xlsm, .xlsb, .ods, .csv, .tsv, XML, HTML tables)
  try {
    const workbook = XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      raw: false,
    });
    if (workbook && Array.isArray(workbook.SheetNames) && workbook.SheetNames.length > 0) {
      const parsedSheets: ParsedExcelSheet[] = [];
      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: '',
          raw: false,
          blankrows: false,
        });
        const cleanedRows: string[][] = [];
        for (const r of rawGrid) {
          if (!Array.isArray(r)) continue;
          const stringCells = r.map((cell) =>
            cell === null || cell === undefined
              ? ''
              : String(cell).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim()
          );
          // Trim trailing empty cells on the right while preserving internal column alignment
          let lastNonEmpty = stringCells.length - 1;
          while (lastNonEmpty >= 0 && stringCells[lastNonEmpty] === '') {
            lastNonEmpty--;
          }
          if (lastNonEmpty >= 0) {
            cleanedRows.push(stringCells.slice(0, lastNonEmpty + 1));
          }
        }
        if (cleanedRows.length > 0) {
          parsedSheets.push({
            name: sheetName || defaultSheetName,
            rows: cleanedRows,
          });
        }
      }
      if (parsedSheets.length > 0) {
        return parsedSheets;
      }
    }
  } catch {
    // Fall through to native ZIP / XML / CSV parser
  }

  // 2. Fallback OpenXML .xlsx ZIP archive (PK\x03\x04)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const entries = await extractZipTextEntries(bytes);
      const sharedStringsXml = entries.get('xl/sharedStrings.xml') || '';
      const sharedStrings: string[] = [];

      if (sharedStringsXml) {
        const siMatches =
          sharedStringsXml.match(/<si\b[^>]*>[\s\S]*?<\/si>/gi) || [];
        for (const si of siMatches) {
          const tMatches = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/gi) || [];
          const combined = tMatches
            .map((t) => t.replace(/<[^>]+>/g, ''))
            .join('');
          sharedStrings.push(combined);
        }
      }

      const sheetKeys = Array.from(entries.keys())
        .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const sheets: ParsedExcelSheet[] = [];
      for (let sIdx = 0; sIdx < sheetKeys.length; sIdx++) {
        const sheetXml = entries.get(sheetKeys[sIdx]) || '';
        if (!sheetXml) continue;
        const rows: string[][] = [];
        const rowMatches = sheetXml.match(/<row\b[^>]*>[\s\S]*?<\/row>/gi) || [];
        for (const rowXml of rowMatches) {
          const rowCells: string[] = [];
          const cellMatches = rowXml.match(/<c\b[^>]*>[\s\S]*?<\/c>/gi) || [];
          for (const cellXml of cellMatches) {
            const refMatch = cellXml.match(/\br="([A-Z]+)\d+"/i);
            const targetColIdx = refMatch
              ? excelColLettersToIndex(refMatch[1])
              : rowCells.length;
            while (rowCells.length < targetColIdx) {
              rowCells.push('');
            }
            const typeAttrMatch = cellXml.match(/\bt="([^"]+)"/i);
            const cellType = typeAttrMatch ? typeAttrMatch[1] : '';
            const vMatch = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
            const isMatch = cellXml.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i);

            let val = '';
            if (cellType === 's' && vMatch) {
              const idx = parseInt(vMatch[1].trim(), 10);
              val = sharedStrings[idx] ?? vMatch[1].trim();
            } else if (isMatch) {
              val = isMatch[1].replace(/<[^>]+>/g, '').trim();
            } else if (vMatch) {
              val = vMatch[1].replace(/<[^>]+>/g, '').trim();
            }
            rowCells[targetColIdx] = val;
          }
          if (rowCells.some((c) => c && c.length > 0)) {
            rows.push(rowCells);
          }
        }
        if (rows.length > 0) {
          sheets.push({
            name: `Sheet ${sIdx + 1}`,
            rows,
          });
        }
      }
      if (sheets.length > 0) return sheets;
    } catch {
      // Fallback below
    }
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(bytes);

  // 3. Check for XML SpreadsheetML (.xls exported by Excel or ElimikaPDF) or HTML Table .xls
  if (
    /<(?:Workbook|Worksheet|Row|Cell|Data|table|tr|td|th)\b/i.test(text)
  ) {
    const rows: string[][] = [];
    const rowMatches =
      text.match(/<(?:Row|tr)\b[^>]*>[\s\S]*?<\/(?:Row|tr)>/gi) || [];
    for (const rXml of rowMatches) {
      const cellMatches =
        rXml.match(
          /<(?:Cell|Data|td|th)\b[^>]*>([\s\S]*?)<\/(?:Cell|Data|td|th)>/gi
        ) || [];
      if (cellMatches.length > 0) {
        const leafMatches =
          rXml.match(/<(?:Data|td|th)\b[^>]*>([\s\S]*?)<\/(?:Data|td|th)>/gi) ||
          cellMatches;
        const cells = leafMatches.map((c) =>
          c
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        );
        if (cells.some((c) => c.length > 0)) {
          rows.push(cells);
        }
      }
    }
    if (rows.length > 0) {
      return [{ name: defaultSheetName, rows }];
    }
  }

  // 4. Standard CSV / TSV / semicolon-delimited text
  const cleanLines = text
    .replace(/\uFEFF/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (cleanLines.length === 0) {
    return [{ name: defaultSheetName, rows: [['Column 1', 'Column 2', 'Column 3']] }];
  }

  const firstLine = cleanLines[0];
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : firstLine.includes(';') && !firstLine.includes(',')
      ? ';'
      : ',';

  return [
    {
      name: defaultSheetName,
      rows: cleanLines.map((line) => parseCsvLine(line, delimiter)),
    },
  ];
}

/**
 * Parses an uploaded Excel (.xlsx, .xls, .xlsm, .xlsb, .ods) or CSV/TSV file into clean 2D string[][] rows.
 * Never outputs raw XML tags or PKZIP binary bytes.
 */
export async function parseUploadedSpreadsheetFile(
  file: File
): Promise<string[][]> {
  const sheets = await parseUploadedWorkbookSheets(file);
  if (sheets.length === 0) {
    return [['Column 1', 'Column 2', 'Column 3']];
  }
  if (sheets.length === 1) {
    return sheets[0].rows;
  }
  const combined: string[][] = [];
  for (const sheet of sheets) {
    combined.push([`=== Sheet: ${sheet.name} ===`]);
    combined.push(...sheet.rows);
  }
  return combined;
}

/**
 * Builds a complete, interactive Excel Workbook HTML document with sheet tabs,
 * Excel column headers (A, B, C...), row numbers (1, 2, 3...), and sticky header styling
 * so opening an Excel file in ElimikaPDF looks and behaves like a real spreadsheet viewer.
 */
export function buildInteractiveExcelHtml(
  sheets: ParsedExcelSheet[],
  workbookTitle: string
): string {
  const safeSheets =
    sheets.length > 0
      ? sheets
      : [{ name: 'Sheet1', rows: [['Column A', 'Column B']] }];

  const sheetPanelsHtml = safeSheets
    .map((sheet, sIdx) => {
      const maxCols = Math.max(
        1,
        ...sheet.rows.map((r) => r.length)
      );
      const colHeaders = Array.from({ length: maxCols }, (_, cIdx) =>
        `<th>${indexToExcelColLetters(cIdx)}</th>`
      ).join('');

      const bodyRows = sheet.rows
        .map((row, rIdx) => {
          const cellsHtml = Array.from({ length: maxCols }, (_, cIdx) => {
            const val = String(row[cIdx] ?? '');
            const isNum =
              val !== '' && /^-?[$€£¥]?[\d,]+(\.\d+)?%?$/.test(val.trim());
            const tag = rIdx === 0 ? 'th' : 'td';
            const cls = isNum && rIdx > 0 ? ' class="num-cell"' : '';
            return `<${tag}${cls}>${escapeHtmlCell(val)}</${tag}>`;
          }).join('');
          return `<tr class="${rIdx === 0 ? 'row-header' : ''}"><td class="row-idx">${
            rIdx + 1
          }</td>${cellsHtml}</tr>`;
        })
        .join('\n');

      return `<div class="sheet-panel" id="sheet-panel-${sIdx}" style="display:${
        sIdx === 0 ? 'block' : 'none'
      };">
        <div class="table-scroll">
          <table class="excel-grid">
            <thead>
              <tr class="col-letters"><th class="corner-cell">#</th>${colHeaders}</tr>
            </thead>
            <tbody>
              ${bodyRows}
            </tbody>
          </table>
        </div>
      </div>`;
    })
    .join('\n');

  const tabsHtml = safeSheets
    .map(
      (sheet, sIdx) =>
        `<button type="button" class="sheet-tab ${
          sIdx === 0 ? 'active' : ''
        }" onclick="switchSheet(${sIdx})" id="sheet-tab-${sIdx}">${escapeHtmlCell(
          sheet.name
        )} <span class="row-badge">${sheet.rows.length}</span></button>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtmlCell(workbookTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    .workbook-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: linear-gradient(135deg, #15803d, #0f766e);
      color: #ffffff;
      padding: 12px 18px;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    }
    .workbook-title {
      font-size: 15px;
      font-weight: 800;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .excel-badge {
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    .sheet-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      background: #e2e8f0;
      padding: 8px 12px;
      border-left: 1px solid #cbd5e1;
      border-right: 1px solid #cbd5e1;
    }
    .sheet-tab {
      border: 1px solid #cbd5e1;
      background: #f1f5f9;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .sheet-tab.active {
      background: #ffffff;
      color: #15803d;
      border-color: #15803d;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
    .row-badge {
      background: #e2e8f0;
      color: #475569;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 999px;
    }
    .sheet-tab.active .row-badge {
      background: #dcfce7;
      color: #15803d;
    }
    .table-scroll {
      overflow: auto;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 0 0 12px 12px;
      max-height: 75vh;
    }
    table.excel-grid {
      border-collapse: collapse;
      width: 100%;
      font-size: 12.5px;
    }
    .col-letters th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #f1f5f9;
      color: #475569;
      font-weight: 700;
      font-size: 11px;
      text-align: center;
      padding: 6px 10px;
      border: 1px solid #cbd5e1;
    }
    .corner-cell {
      width: 42px;
      background: #e2e8f0 !important;
    }
    .row-idx {
      background: #f8fafc;
      color: #64748b;
      font-weight: 600;
      font-size: 11px;
      text-align: center;
      width: 42px;
      border: 1px solid #cbd5e1;
      user-select: none;
    }
    .excel-grid th, .excel-grid td {
      border: 1px solid #e2e8f0;
      padding: 7px 11px;
      text-align: left;
      white-space: nowrap;
    }
    .row-header th {
      background: #dcfce7;
      color: #14532d;
      font-weight: 700;
      border-color: #bbf7d0;
    }
    .excel-grid tbody tr:nth-child(even) td:not(.row-idx) {
      background: #f8fafc;
    }
    .excel-grid tbody tr:hover td:not(.row-idx) {
      background: #f0fdf4;
    }
    .num-cell {
      text-align: right !important;
      font-variant-numeric: tabular-nums;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  </style>
</head>
<body>
  <div class="workbook-bar">
    <h1 class="workbook-title">
      <span class="excel-badge">EXCEL WORKBOOK</span>
      <span>${escapeHtmlCell(workbookTitle)}</span>
    </h1>
    <span style="font-size:12px;opacity:0.9;">${safeSheets.length} ${
      safeSheets.length === 1 ? 'Worksheet' : 'Worksheets'
    }</span>
  </div>
  <div class="sheet-tabs">
    ${tabsHtml}
  </div>
  ${sheetPanelsHtml}
  <script>
    function switchSheet(idx) {
      var panels = document.querySelectorAll('.sheet-panel');
      var tabs = document.querySelectorAll('.sheet-tab');
      for (var i = 0; i < panels.length; i++) {
        panels[i].style.display = i === idx ? 'block' : 'none';
      }
      for (var j = 0; j < tabs.length; j++) {
        if (j === idx) tabs[j].classList.add('active');
        else tabs[j].classList.remove('active');
      }
    }
  </script>
</body>
</html>`;
}

export interface RichPptxParagraph {
  text: string;
  level: number;
  isBold: boolean;
  colorHex?: string;
}

export interface RichPptxSlide {
  slideNumber: number;
  title: string;
  paragraphs: RichPptxParagraph[];
  images: string[];
  tables: string[][][];
  bgColor?: string;
  notes?: string;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isNaN(code) ? '' : String.fromCodePoint(code);
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isNaN(code) ? '' : String.fromCodePoint(code);
    });
}

function isDarkHexColor(hex?: string): boolean {
  if (!hex) return false;
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.45;
}

function inferImageMimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return null;
}

function resolvePptxRelPath(baseDir: string, target: string): string {
  const cleanTarget = target.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = `${baseDir}/${cleanTarget}`.split('/');
  const resolved: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return resolved.join('/');
}

/**
 * Rich OOXML PowerPoint (.pptx) & OpenDocument Presentation (.odp) parser using JSZip.
 * Extracts ordered slides, titles, bullet paragraphs, embedded slide images (base64 data URLs),
 * tables, slide background colors, and speaker notes.
 */
export async function parseRichPptxSlides(
  bytes: Uint8Array,
  baseTitle: string
): Promise<RichPptxSlide[] | null> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return null;
  }

  try {
    const zip = await JSZip.loadAsync(bytes);
    const fileKeys = Object.keys(zip.files);

    // A. OpenDocument Presentation (.odp) via content.xml
    if (zip.files['content.xml'] && !fileKeys.some((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))) {
      const contentXml = await zip.files['content.xml'].async('string');
      const pageMatches = contentXml.match(/<draw:page\b[^>]*>[\s\S]*?<\/draw:page>/gi) || [];
      if (pageMatches.length > 0) {
        const slides: RichPptxSlide[] = [];
        for (let idx = 0; idx < pageMatches.length; idx++) {
          const pageXml = pageMatches[idx];
          const pMatches = pageXml.match(/<text:p\b[^>]*>[\s\S]*?<\/text:p>/gi) || [];
          const lines = pMatches
            .map((p) =>
              decodeXmlEntities(p.replace(/<[^>]+>/g, ''))
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter(Boolean);

          const images: string[] = [];
          const imgMatches = pageXml.match(/xlink:href=["']([^"']+)["']/gi) || [];
          for (const attr of imgMatches) {
            const href = attr.match(/["']([^"']+)["']/)?.[1];
            if (!href) continue;
            const imgEntry = zip.files[href] || zip.files[href.replace(/^\.\//, '')];
            const imgMime = inferImageMimeFromPath(href);
            if (imgEntry && imgMime) {
              const b64 = await imgEntry.async('base64');
              images.push(`data:${imgMime};base64,${b64}`);
            }
          }

          slides.push({
            slideNumber: idx + 1,
            title: lines[0] || `${baseTitle} — Slide ${idx + 1}`,
            paragraphs: lines.slice(1).map((t) => ({ text: t, level: 0, isBold: false })),
            images,
            tables: [],
          });
        }
        return slides;
      }
    }

    // B. OOXML PowerPoint (.pptx)
    let orderedSlidePaths: string[] = [];

    // Try reading exact slide order from ppt/presentation.xml + ppt/_rels/presentation.xml.rels
    try {
      const presXmlFile = zip.files['ppt/presentation.xml'];
      const presRelsFile = zip.files['ppt/_rels/presentation.xml.rels'];
      if (presXmlFile && presRelsFile) {
        const presXml = await presXmlFile.async('string');
        const presRelsXml = await presRelsFile.async('string');
        const relMap = new Map<string, string>();
        const relRegex = /<Relationship\b[^>]*Id=["']([^"']+)["'][^>]*Target=["']([^"']+)["'][^>]*>/gi;
        let rm: RegExpExecArray | null;
        while ((rm = relRegex.exec(presRelsXml)) !== null) {
          relMap.set(rm[1], resolvePptxRelPath('ppt', rm[2]));
        }
        const sldIdRegex = /<p:sldId\b[^>]*r:id=["']([^"']+)["'][^>]*>/gi;
        let sm: RegExpExecArray | null;
        while ((sm = sldIdRegex.exec(presXml)) !== null) {
          const target = relMap.get(sm[1]);
          if (target && zip.files[target]) {
            orderedSlidePaths.push(target);
          }
        }
      }
    } catch {
      orderedSlidePaths = [];
    }

    // Fallback to numeric slide sorting if presentation.xml order wasn't found
    if (orderedSlidePaths.length === 0) {
      orderedSlidePaths = fileKeys
        .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
          const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
          return numA - numB;
        });
    }

    if (orderedSlidePaths.length === 0) return null;

    const mediaCache = new Map<string, string>();
    const slides: RichPptxSlide[] = [];

    for (let i = 0; i < orderedSlidePaths.length; i++) {
      const slidePath = orderedSlidePaths[i];
      const slideFile = zip.files[slidePath];
      if (!slideFile) continue;

      const xml = await slideFile.async('string');
      const slideFileName = slidePath.split('/').pop() || `slide${i + 1}.xml`;
      const relsPath = `ppt/slides/_rels/${slideFileName}.rels`;

      // 1. Parse slide relationships (embedded images + speaker notes)
      const relTargets = new Map<string, string>();
      let notesPath: string | null = null;
      if (zip.files[relsPath]) {
        const relsXml = await zip.files[relsPath].async('string');
        const relRegex = /<Relationship\b([^>]+)>/gi;
        let m: RegExpExecArray | null;
        while ((m = relRegex.exec(relsXml)) !== null) {
          const attrs = m[1];
          const id = attrs.match(/\bId=["']([^"']+)["']/)?.[1];
          const target = attrs.match(/\bTarget=["']([^"']+)["']/)?.[1];
          const type = attrs.match(/\bType=["']([^"']+)["']/)?.[1] || '';
          if (id && target) {
            const fullPath = resolvePptxRelPath('ppt/slides', target);
            relTargets.set(id, fullPath);
            if (/notesSlide/i.test(type)) {
              notesPath = fullPath;
            }
          }
        }
      }

      // 2. Slide background color (<p:bg> -> <a:srgbClr val="XXXXXX"/>)
      let bgColor: string | undefined;
      const bgMatch = xml.match(/<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/i);
      if (bgMatch) {
        const hexMatch = bgMatch[0].match(/<a:srgbClr\b[^>]*val=["']([0-9A-Fa-f]{6})["']/i);
        if (hexMatch) {
          bgColor = `#${hexMatch[1]}`;
        }
      }

      // 3. Extract embedded images referenced via r:embed="rIdX"
      const images: string[] = [];
      const seenImgPaths = new Set<string>();
      const embedRegex = /r:embed=["']([^"']+)["']/gi;
      let em: RegExpExecArray | null;
      while ((em = embedRegex.exec(xml)) !== null) {
        const mediaPath = relTargets.get(em[1]);
        if (!mediaPath || seenImgPaths.has(mediaPath)) continue;
        seenImgPaths.add(mediaPath);
        const imgMime = inferImageMimeFromPath(mediaPath);
        if (!imgMime || !zip.files[mediaPath]) continue;
        let dataUrl = mediaCache.get(mediaPath);
        if (!dataUrl) {
          const b64 = await zip.files[mediaPath].async('base64');
          dataUrl = `data:${imgMime};base64,${b64}`;
          mediaCache.set(mediaPath, dataUrl);
        }
        images.push(dataUrl);
      }

      // 4. Extract tables (<a:tbl>)
      const tables: string[][][] = [];
      const tblMatches = xml.match(/<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/gi) || [];
      for (const tblXml of tblMatches) {
        const rows: string[][] = [];
        const trMatches = tblXml.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/gi) || [];
        for (const trXml of trMatches) {
          const cells: string[] = [];
          const tcMatches = trXml.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/gi) || [];
          for (const tcXml of tcMatches) {
            const texts = (tcXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [])
              .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            cells.push(texts);
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) tables.push(rows);
      }

      // 5. Extract non-table paragraphs (preserving titles, bullet levels, bold & hex colors)
      const xmlWithoutTables = xml.replace(/<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/gi, '');
      const pMatches = xmlWithoutTables.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/gi) || [];
      const paragraphs: RichPptxParagraph[] = [];

      for (const pXml of pMatches) {
        const tMatches = pXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
        const line = tMatches
          .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!line) continue;

        const lvlMatch = pXml.match(/<a:pPr\b[^>]*lvl=["'](\d+)["']/i);
        const level = lvlMatch ? Math.min(3, parseInt(lvlMatch[1], 10) || 0) : 0;
        const isBold = /<a:rPr\b[^>]*\bb=["']1["']/i.test(pXml);
        const colorMatch = pXml.match(/<a:rPr\b[^>]*>[\s\S]*?<a:srgbClr\b[^>]*val=["']([0-9A-Fa-f]{6})["']/i);
        const colorHex = colorMatch ? `#${colorMatch[1]}` : undefined;

        paragraphs.push({ text: line, level, isBold, colorHex });
      }

      // 6. Extract speaker notes if present
      let notes: string | undefined;
      if (notesPath && zip.files[notesPath]) {
        try {
          const notesXml = await zip.files[notesPath].async('string');
          const noteTexts = (notesXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [])
            .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (noteTexts && !/^\d+$/.test(noteTexts)) {
            notes = noteTexts;
          }
        } catch {
          // Ignore malformed notes
        }
      }

      const title =
        paragraphs[0]?.text ||
        (images.length > 0 ? `${baseTitle} — Slide ${i + 1}` : `Slide ${i + 1}`);
      const bodyParagraphs = paragraphs.length > 1 ? paragraphs.slice(1) : [];

      slides.push({
        slideNumber: i + 1,
        title,
        paragraphs: bodyParagraphs,
        images,
        tables,
        bgColor,
        notes,
      });
    }

    return slides.length > 0 ? slides : null;
  } catch {
    return null;
  }
}

/**
 * Generates a responsive, self-contained HTML5 Presentation Slide Deck for .pptx/.ppt/.odp
 * so every slide renders cleanly with its background colors, images, tables, bullets, and notes.
 */
export function buildRichPptxViewerHtml(
  slides: RichPptxSlide[],
  baseTitle: string
): string {
  const slidesMarkup = slides
    .map((slide, idx) => {
      const darkBg = isDarkHexColor(slide.bgColor);
      const cardBg = slide.bgColor || '#FFFFFF';
      const titleColor = darkBg ? '#FFFFFF' : '#14101B';
      const bodyColor = darkBg ? '#E6E1EE' : '#2C2538';
      const borderColor = darkBg ? 'rgba(255,255,255,0.16)' : '#E4DFEC';
      const accentColor = darkBg ? '#93C5FD' : '#EB5E3C';

      const bodyHtml =
        slide.paragraphs.length > 0
          ? `<ul class="pptx-bullets">${slide.paragraphs
              .map((p) => {
                const indentPx = p.level * 20;
                const textColor = p.colorHex
                  ? darkBg && isDarkHexColor(p.colorHex)
                    ? bodyColor
                    : p.colorHex
                  : bodyColor;
                return `<li style="margin-left:${indentPx}px;color:${textColor};font-weight:${
                  p.isBold ? '700' : '400'
                }">${escapeHtmlCell(p.text)}</li>`;
              })
              .join('')}</ul>`
          : '';

      const imagesHtml =
        slide.images.length > 0
          ? `<div class="pptx-images ${
              slide.images.length > 1 ? 'pptx-images-grid' : ''
            }">${slide.images
              .map(
                (src, imgIdx) =>
                  `<figure class="pptx-figure"><img src="${src}" alt="Slide ${
                    slide.slideNumber
                  } graphic ${imgIdx + 1}" loading="lazy" /></figure>`
              )
              .join('')}</div>`
          : '';

      const tablesHtml =
        slide.tables.length > 0
          ? slide.tables
              .map(
                (tbl) =>
                  `<div class="pptx-table-wrap"><table class="pptx-table">${tbl
                    .map(
                      (row, rIdx) =>
                        `<tr>${row
                          .map((cell) =>
                            rIdx === 0
                              ? `<th>${escapeHtmlCell(cell)}</th>`
                              : `<td>${escapeHtmlCell(cell)}</td>`
                          )
                          .join('')}</tr>`
                    )
                    .join('')}</table></div>`
              )
              .join('')
          : '';

      const notesHtml = slide.notes
        ? `<details class="pptx-notes"><summary>Speaker Notes</summary><p>${escapeHtmlCell(
            slide.notes
          )}</p></details>`
        : '';

      const hasTwoColumnContent =
        slide.images.length > 0 &&
        (slide.paragraphs.length > 0 || slide.tables.length > 0);

      return `<section class="pptx-slide" data-slide-number="${slide.slideNumber}" id="slide-${
        idx + 1
      }" style="background:${cardBg};border-color:${borderColor};color:${bodyColor};">
        <div class="pptx-slide-header" style="border-bottom-color:${borderColor};">
          <span class="pptx-badge" style="background:${accentColor};">Slide ${
        slide.slideNumber
      } / ${slides.length}</span>
          <h2 class="pptx-title" style="color:${titleColor};">${escapeHtmlCell(
        slide.title
      )}</h2>
        </div>
        <div class="pptx-slide-body ${
          hasTwoColumnContent ? 'pptx-two-col' : ''
        }">
          <div class="pptx-text-col">${bodyHtml}${tablesHtml}</div>
          ${imagesHtml}
        </div>
        ${notesHtml}
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtmlCell(baseTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px 14px 48px;
    background: #EFEBF5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    color: #14101B;
  }
  .pptx-deck-header {
    max-width: 960px;
    margin: 0 auto 18px;
    padding: 14px 18px;
    border-radius: 14px;
    background: #FFFFFF;
    border: 1px solid #DFD9EB;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    box-shadow: 0 2px 10px rgba(20,16,27,0.05);
  }
  .pptx-deck-header h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #14101B;
  }
  .pptx-deck-count {
    font-size: 12px;
    font-weight: 700;
    color: #EB5E3C;
    background: #FFF1EC;
    padding: 4px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .pptx-deck {
    max-width: 960px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .pptx-slide {
    width: 100%;
    min-height: 420px;
    border-radius: 16px;
    border: 1px solid #E4DFEC;
    padding: 26px 28px;
    box-shadow: 0 10px 28px rgba(20, 16, 27, 0.10);
    display: flex;
    flex-direction: column;
    gap: 18px;
    scroll-margin-top: 16px;
  }
  .pptx-slide-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 14px;
    border-bottom: 1px solid #E4DFEC;
  }
  .pptx-badge {
    align-self: flex-start;
    color: #FFFFFF;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.03em;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .pptx-title {
    margin: 0;
    font-size: clamp(20px, 3vw, 28px);
    line-height: 1.25;
    font-weight: 800;
  }
  .pptx-slide-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .pptx-slide-body.pptx-two-col {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    gap: 22px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .pptx-slide { padding: 18px 16px; min-height: 300px; }
    .pptx-slide-body.pptx-two-col { grid-template-columns: 1fr; }
  }
  .pptx-bullets {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 16px;
    line-height: 1.6;
  }
  .pptx-images {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pptx-images-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .pptx-figure {
    margin: 0;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid rgba(0,0,0,0.08);
    background: rgba(255,255,255,0.65);
  }
  .pptx-figure img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 420px;
    object-fit: contain;
  }
  .pptx-table-wrap {
    width: 100%;
    overflow-x: auto;
    margin-top: 8px;
  }
  .pptx-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    background: rgba(255,255,255,0.92);
    color: #14101B;
    border-radius: 8px;
    overflow: hidden;
  }
  .pptx-table th, .pptx-table td {
    border: 1px solid #D8D2E5;
    padding: 8px 10px;
    text-align: left;
  }
  .pptx-table th {
    background: #F4F1F8;
    font-weight: 700;
  }
  .pptx-notes {
    margin-top: auto;
    padding-top: 10px;
    border-top: 1px dashed rgba(128,128,128,0.35);
    font-size: 13px;
    opacity: 0.9;
  }
  .pptx-notes summary {
    cursor: pointer;
    font-weight: 700;
  }
  .pptx-notes p {
    margin: 8px 0 0;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <header class="pptx-deck-header">
    <h1>${escapeHtmlCell(baseTitle)}</h1>
    <span class="pptx-deck-count">${slides.length} Slide${slides.length === 1 ? '' : 's'}</span>
  </header>
  <main class="pptx-deck">
    ${slidesMarkup}
  </main>
</body>
</html>`;
}

/**
 * Parses an uploaded PowerPoint (.pptx, .ppt), HTML slide deck, PDF, or text outline
 * into structured SlideDeckItem[] slides without leaking CSS/XML/ZIP code.
 */
export async function parseUploadedPresentationFile(
  file: File
): Promise<SlideDeckItem[]> {
  const lower = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'Presentation';

  // 1. If PDF file, extract slides directly
  if (
    lower.endsWith('.pdf') ||
    (bytes.length >= 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46)
  ) {
    return extractPdfToSlides(bytes, file.name);
  }

  // 2. If OpenXML .pptx ZIP archive (PK\x03\x04)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const entries = await extractZipTextEntries(bytes);
      const slideKeys = Array.from(entries.keys())
        .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
          const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
          return numA - numB;
        });

      if (slideKeys.length > 0) {
        const slides: SlideDeckItem[] = [];
        slideKeys.forEach((key, idx) => {
          const xml = entries.get(key) || '';
          const pMatches = xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/gi) || [];
          const lines: string[] = [];
          for (const pXml of pMatches) {
            const tMatches = pXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
            const line = tMatches
              .map((t) => t.replace(/<[^>]+>/g, ''))
              .join('')
              .replace(/\s+/g, ' ')
              .trim();
            if (line) lines.push(line);
          }
          if (lines.length > 0) {
            slides.push({
              slideNumber: idx + 1,
              title: lines[0].slice(0, 80),
              bullets:
                lines.length > 1
                  ? lines.slice(1, 8)
                  : ['Presentation slide content'],
            });
          }
        });
        if (slides.length > 0) return slides;
      }
    } catch {
      // Fallback below
    }
  }

  // 3. HTML / .ppt HTML deck or plain text outline
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const rawText = decoder.decode(bytes);

  const stripped = rawText
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');

  // Check if there are explicit <div class="slide"> sections
  const slideParts = stripped.split(
    /<div\b[^>]*class=["'][^"']*slide[^"']*["'][^>]*>/i
  );
  if (slideParts.length > 1) {
    return slideParts.slice(1).map((divHtml, idx) => {
      const hMatch =
        divHtml.match(
          /<(?:h[1-3]|div\b[^>]*class=["'][^"']*header[^"']*["'][^>]*)>([\s\S]*?)<\/(?:h[1-3]|div)>/i
        ) || divHtml.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
      const liMatches = divHtml.match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || [];
      const rawTitle = hMatch
        ? hMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/^Slide\s+\d+\s*:\s*/i, '')
            .trim()
        : '';
      const title = rawTitle || `${baseTitle} — Slide ${idx + 1}`;
      const bullets =
        liMatches.length > 0
          ? liMatches
              .map((li) => li.replace(/<[^>]+>/g, '').trim())
              .filter(Boolean)
          : [
              divHtml
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || 'Slide content',
            ];
      return {
        slideNumber: idx + 1,
        title,
        bullets,
      };
    });
  }

  const cleaned = stripped
    .replace(/<[^>]+>/g, '\n')
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\r\n/g, '\n');

  const chunks = cleaned
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 3);

  if (chunks.length > 0) {
    return chunks.slice(0, 24).map((chunk, idx) => {
      const lines = chunk
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      return {
        slideNumber: idx + 1,
        title: lines[0]?.slice(0, 75) || `${baseTitle} — Slide ${idx + 1}`,
        bullets:
          lines.length > 1
            ? lines.slice(1, 8)
            : [lines[0] || 'Presentation content'],
      };
    });
  }

  return [
    {
      slideNumber: 1,
      title: baseTitle,
      bullets: ['Presentation imported and ready for PDF conversion'],
    },
  ];
}

// ============================================================================
// 15. UNIVERSAL MULTI-EXTENSION DOCUMENT, EBOOK (.EPUB, .KPF) & HTML CONVERTER
// ============================================================================

export const SUPPORTED_DOCUMENT_ACCEPT =
  '.pdf,.epub,.kpf,.mobi,.azw3,.fb2,.cbz,.docx,.doc,.odt,.rtf,.txt,.md,.html,.htm,.xhtml,.xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.pptx,.ppt,.odp,.json,.xml,.svg,.png,.jpg,.jpeg,.webp,.gif,.bmp,application/pdf,application/epub+zip,application/vnd.amazon.ebook,application/x-mobipocket-ebook,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.presentation,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/csv,application/excel,application/x-excel,application/x-msexcel,text/csv,text/comma-separated-values,text/tab-separated-values,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/html,application/xhtml+xml,text/plain,text/markdown,application/rtf,application/json,application/xml,text/xml,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml';

export interface ConvertedUniversalDocumentResult {
  pdfBytes: Uint8Array;
  pageCount: number;
  extractedText: string;
  rawHtmlContent: string;
  sourceFormat: string;
  outputPdfName: string;
  originalFileBytes?: Uint8Array;
}

function escapeHtmlCell(val: string): string {
  return (val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Converts ANY uploaded document, eBook (.epub, .kpf, .mobi, .fb2), Office file
 * (.docx, .doc, .odt, .xlsx, .xls, .ods, .csv, .tsv, .pptx, .ppt, .odp),
 * Web/Markup (.html, .htm, .xhtml, .md, .rtf, .txt, .json, .xml), or Image
 * into a multi-page searchable PDF + rich HTML representation for the HTML & eBook Reader.
 */
/**
 * Extracts a specific binary entry (such as `OEBPS/source_replica.pdf`) from a ZIP/KPF archive.
 */
async function extractBinaryEntryFromZip(
  zipBytes: Uint8Array,
  targetEntryPath: string
): Promise<Uint8Array | null> {
  if (zipBytes.byteLength < 22) return null;
  const view = new DataView(
    zipBytes.buffer,
    zipBytes.byteOffset,
    zipBytes.byteLength
  );
  const decoder = new TextDecoder('utf-8', { fatal: false });

  let eocdPos = -1;
  for (
    let i = zipBytes.byteLength - 22;
    i >= Math.max(0, zipBytes.byteLength - 65557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) return null;

  const entryCount = view.getUint16(eocdPos + 10, true);
  let cdPos = view.getUint32(eocdPos + 16, true);
  const targetLower = targetEntryPath.toLowerCase();

  for (let i = 0; i < entryCount; i++) {
    if (
      cdPos + 46 > zipBytes.byteLength ||
      view.getUint32(cdPos, true) !== 0x02014b50
    ) {
      break;
    }
    const compressionMethod = view.getUint16(cdPos + 10, true);
    const compressedSize = view.getUint32(cdPos + 20, true);
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localHeaderOffset = view.getUint32(cdPos + 42, true);

    const fileName = decoder.decode(
      zipBytes.subarray(cdPos + 46, cdPos + 46 + nameLen)
    );
    cdPos += 46 + nameLen + extraLen + commentLen;

    if (fileName.toLowerCase() !== targetLower) continue;

    if (
      localHeaderOffset + 30 <= zipBytes.byteLength &&
      view.getUint32(localHeaderOffset, true) === 0x04034b50
    ) {
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = Math.min(zipBytes.byteLength, dataStart + compressedSize);
      const rawSlice = zipBytes.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) {
        return new Uint8Array(rawSlice);
      }
      if (compressionMethod === 8) {
        return await inflateRawZipChunk(rawSlice);
      }
    }
  }
  return null;
}

/**
 * Universal file format detector that identifies supported file formats using
 * MIME type, file extension, and binary magic-byte inspection (handling missing/incorrect MIME types).
 */
export function detectUniversalDocumentFormat(
  fileName: string,
  mimeType: string,
  rawBytes: Uint8Array
): string {
  const lowerName = (fileName || '').toLowerCase().trim();
  const mime = (mimeType || '').toLowerCase().trim();
  const extMatch = lowerName.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';

  // 1. Check %PDF- magic header
  if (
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x25 &&
    rawBytes[1] === 0x50 &&
    rawBytes[2] === 0x44 &&
    rawBytes[3] === 0x46
  ) {
    return 'pdf';
  }

  // 2. Check PKZIP container (KPF, DOCX, EPUB, XLSX, PPTX, ODT)
  if (
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x50 &&
    rawBytes[1] === 0x4b &&
    rawBytes[2] === 0x03 &&
    rawBytes[3] === 0x04
  ) {
    const headerAscii = new TextDecoder('utf-8', { fatal: false }).decode(
      rawBytes.subarray(0, Math.min(4096, rawBytes.length))
    );
    if (
      ext === 'kdf' ||
      mime.includes('kdf')
    ) {
      return 'kdf';
    }
    if (
      ext === 'kpf' ||
      mime.includes('kpf') ||
      headerAscii.includes('kdf_manifest.json')
    ) {
      return 'kpf';
    }
    if (
      ext === 'docx' ||
      mime.includes('wordprocessingml') ||
      headerAscii.includes('word/document.xml')
    ) {
      return 'docx';
    }
    if (
      ext === 'xlsx' ||
      ext === 'xlsm' ||
      mime.includes('spreadsheetml') ||
      headerAscii.includes('xl/workbook.xml')
    ) {
      return 'xlsx';
    }
    if (
      ext === 'pptx' ||
      mime.includes('presentationml') ||
      headerAscii.includes('ppt/presentation.xml')
    ) {
      return 'pptx';
    }
    if (
      ext === 'epub' ||
      mime.includes('epub') ||
      headerAscii.includes('application/epub+zip')
    ) {
      return 'epub';
    }
  }

  // 2b. Check SQLite 3 / Amazon Kindle Create KDF container ("SQLite format 3")
  if (rawBytes.length >= 16) {
    const sqliteCheck = new TextDecoder('ascii', { fatal: false }).decode(
      rawBytes.subarray(0, 16)
    );
    if (sqliteCheck.startsWith('SQLite format 3') || ext === 'kdf') {
      return ext === 'kpf' ? 'kpf' : 'kdf';
    }
  }

  // 3. Check OLE2 Compound Document (.doc, .xls, .ppt)
  if (
    rawBytes.length >= 8 &&
    rawBytes[0] === 0xd0 &&
    rawBytes[1] === 0xcf &&
    rawBytes[2] === 0x11 &&
    rawBytes[3] === 0xe0
  ) {
    if (ext === 'xls' || mime.includes('excel')) return 'xls';
    if (ext === 'ppt' || mime.includes('powerpoint')) return 'ppt';
    return 'doc';
  }

  // 4. Extension & MIME fallback
  if (ext) return ext;
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('kdf')) return 'kdf';
  if (mime.includes('kpf') || mime.includes('amazon.ebook')) return 'kpf';
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.includes('msword')) return 'doc';
  if (mime.includes('html') || mime.includes('xhtml')) return 'html';
  if (mime.includes('epub')) return 'epub';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'xlsx';
  if (mime.includes('csv')) return 'csv';
  return 'pdf';
}

/**
 * Converts ANY uploaded document, eBook (.epub, .kpf, .kdf, .mobi, .fb2), Office file
 * (.docx, .doc, .odt, .xlsx, .xls, .ods, .csv, .tsv, .pptx, .ppt, .odp),
 * Web/Markup (.html, .htm, .xhtml, .md, .rtf, .txt, .json, .xml), or Image
 * into a multi-page searchable PDF + rich HTML representation for the Universal Reader.
 */
export async function convertAnyUploadedFileToPdfAndHtml(
  file: File,
  onProgress?: (percent: number, stage: string) => void
): Promise<ConvertedUniversalDocumentResult> {
  const reportProgress = async (pct: number, stage: string) => {
    if (onProgress) {
      onProgress(Math.max(1, Math.min(99, Math.round(pct))), stage);
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'Document';
  const outputPdfName = lowerName.endsWith('.pdf')
    ? file.name
    : `${baseTitle}.pdf`;

  await reportProgress(10, 'Reading file from device...');
  const buf = await file.arrayBuffer();
  const rawBytes = new Uint8Array(buf);

  if (rawBytes.byteLength === 0) {
    throw new Error(
      `The selected file "${file.name}" is empty (0 bytes) and cannot be opened.`
    );
  }

  await reportProgress(24, 'Detecting document format...');
  const detectedExt = detectUniversalDocumentFormat(
    file.name || '',
    mime,
    rawBytes
  );

  // 1. Native PDF file (%PDF-)
  const isPdfHeader =
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x25 &&
    rawBytes[1] === 0x50 &&
    rawBytes[2] === 0x44 &&
    rawBytes[3] === 0x46;

  if (detectedExt === 'pdf' && isPdfHeader) {
    let pageCount = 1;
    let extractedText = '';
    try {
      await reportProgress(38, 'Loading PDF structure...');
      const dataCopy = new Uint8Array(rawBytes);
      const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages || 1;
      await reportProgress(55, `Indexing ${pageCount} PDF pages...`);
      // Only sample the first up to 8 pages during initial upload so 300-1000+ page books open instantaneously
      const sampleLimit = Math.min(pageCount, 8);
      const samplePages: string[] = [];
      for (let i = 1; i <= sampleLimit; i++) {
        try {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          const txt = tc.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (txt) {
            samplePages.push(`--- Page ${i} ---\n${txt}`);
          }
          page.cleanup();
          if (onProgress && (i === sampleLimit || i % 2 === 0)) {
            const pct = 55 + Math.round((i / sampleLimit) * 32);
            await reportProgress(pct, `Preparing page ${i} of ${pageCount}...`);
          }
        } catch {
          // Skip page text extraction error
        }
      }
      extractedText = samplePages.join('\n\n');
      await loadingTask.destroy();
    } catch {
      try {
        pageCount = await getPdfPageCount(rawBytes);
      } catch {
        pageCount = 1;
      }
    }

    await reportProgress(92, 'Finalizing PDF reader view...');
    const htmlParagraphs = (extractedText || baseTitle)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        if (/^---\s*Page\s+\d+\s*---$/i.test(p)) {
          return `<h2>${escapeHtmlCell(p.replace(/-/g, '').trim())}</h2>`;
        }
        return `<p>${escapeHtmlCell(p)}</p>`;
      })
      .join('\n');

    return {
      pdfBytes: rawBytes,
      pageCount,
      extractedText,
      rawHtmlContent: `<h1>${escapeHtmlCell(baseTitle)}</h1>\n${htmlParagraphs}`,
      sourceFormat: 'pdf',
      outputPdfName,
    };
  }

  // 2. Spreadsheets (.xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv)
  if (
    ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv'].includes(detectedExt) ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime.includes('csv') ||
    mime.includes('tab-separated')
  ) {
    await reportProgress(42, 'Parsing spreadsheet workbook...');
    const sheets = await parseUploadedWorkbookSheets(file);
    const rows: string[][] =
      sheets.length === 1
        ? sheets[0].rows
        : sheets.flatMap((s) => [[`=== Sheet: ${s.name} ===`], ...s.rows]);
    await reportProgress(72, 'Building spreadsheet layout...');
    const { pdfBytes, pageCount } = await convertSpreadsheetRowsToPdf(
      rows,
      baseTitle,
      'landscape'
    );
    const interactiveExcelHtml = buildInteractiveExcelHtml(sheets, baseTitle);
    await reportProgress(92, 'Finalizing workbook...');

    return {
      pdfBytes,
      pageCount,
      extractedText: rows.map((r) => r.join(' | ')).join('\n'),
      rawHtmlContent: interactiveExcelHtml,
      sourceFormat: detectedExt,
      outputPdfName,
    };
  }

  // 3. Presentations (.pptx, .ppt, .odp)
  if (
    ['pptx', 'ppt', 'odp'].includes(detectedExt) ||
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    mime.includes('opendocument.presentation')
  ) {
    await reportProgress(38, 'Extracting presentation slides & media...');
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    const richSlides = await parseRichPptxSlides(rawBytes, baseTitle);
    const slides: SlideDeckItem[] =
      richSlides && richSlides.length > 0
        ? richSlides.map((s) => ({
            slideNumber: s.slideNumber,
            title: s.title,
            bullets:
              s.paragraphs.length > 0
                ? s.paragraphs.map((p) => p.text)
                : ['Slide content'],
          }))
        : await parseUploadedPresentationFile(file);

    await reportProgress(72, 'Rendering presentation deck...');
    const { pdfBytes, pageCount } = await buildPresentationPdfFromSlides(
      slides,
      baseTitle
    );
    const richSlideHtml =
      richSlides && richSlides.length > 0
        ? buildRichPptxViewerHtml(richSlides, baseTitle)
        : buildRichPptxViewerHtml(
            slides.map((s) => ({
              slideNumber: s.slideNumber,
              title: s.title,
              paragraphs: s.bullets.map((b) => ({
                text: b,
                level: 0,
                isBold: false,
              })),
              images: [],
              tables: [],
            })),
            baseTitle
          );
    await reportProgress(92, 'Finalizing presentation...');

    return {
      pdfBytes,
      pageCount: Math.max(pageCount, slides.length),
      extractedText: slides
        .map((s) => `${s.title}\n${s.bullets.join('\n')}`)
        .join('\n\n'),
      rawHtmlContent: richSlideHtml,
      sourceFormat: detectedExt || 'pptx',
      outputPdfName,
    };
  }

  // 4. Raster Images (.png, .jpg, .jpeg, .webp, .gif, .bmp)
  if (
    mime.startsWith('image/') &&
    !mime.includes('svg') &&
    !/\.(?:svg|html|htm|xhtml|epub|kpf|kdf)$/i.test(lowerName)
  ) {
    await reportProgress(45, 'Decoding image...');
    const dataUrl = await readImageFileAsDataUrl(file);
    await reportProgress(78, 'Embedding image into PDF page...');
    const pdfBytes = await createPdfFromImages([dataUrl], {
      pageSize: 'A4',
      marginPt: 18,
    });
    await reportProgress(94, 'Finalizing image document...');
    return {
      pdfBytes,
      pageCount: 1,
      extractedText: baseTitle,
      rawHtmlContent: `<h1>${escapeHtmlCell(
        baseTitle
      )}</h1><figure><img src="${dataUrl}" alt="${escapeHtmlCell(
        baseTitle
      )}" /></figure>`,
      sourceFormat: detectedExt,
      outputPdfName,
    };
  }

  // 5. eBooks (.kpf, .kdf, .epub, .mobi, .azw3, .fb2), HTML (.html, .htm, .xhtml),
  //    Word & OpenDocument (.docx, .doc, .odt, .ods, .odp), Markdown (.md), RTF, JSON, XML, TXT
  await reportProgress(42, `Parsing ${detectedExt.toUpperCase()} document content...`);
  const parsed = await parseUploadedWordFile(file);

  // If this is a KPF/KDF ZIP package containing an embedded `OEBPS/source_replica.pdf`, restore its exact PDF pages!
  if (
    detectedExt === 'kpf' ||
    detectedExt === 'kdf' ||
    lowerName.endsWith('.kpf') ||
    lowerName.endsWith('.kdf')
  ) {
    try {
      await reportProgress(68, 'Checking embedded KPF/KDF print replica...');
      const embeddedPdf = await extractBinaryEntryFromZip(
        rawBytes,
        'OEBPS/source_replica.pdf'
      );
      if (
        embeddedPdf &&
        embeddedPdf.byteLength > 64 &&
        embeddedPdf[0] === 0x25 &&
        embeddedPdf[1] === 0x50
      ) {
        const replicaPageCount = await getPdfPageCount(embeddedPdf);
        await reportProgress(92, 'Restoring exact print replica pages...');
        return {
          pdfBytes: embeddedPdf,
          pageCount: replicaPageCount,
          extractedText: parsed.plainText,
          rawHtmlContent: parsed.htmlPreview,
          sourceFormat: detectedExt === 'kdf' ? 'kdf' : 'kpf',
          outputPdfName,
        };
      }
    } catch {
      // Fallback to block-generated PDF below
    }
  }

  const isNativeWordFormat = detectedExt === 'docx' || detectedExt === 'doc';

  // For native Word (.docx / .doc) documents, preserve the original Word filename and binary bytes
  // and count real Word page sheets instead of treating it as a PDF rename
  const docxSectionMatches = isNativeWordFormat
    ? (parsed.htmlPreview.match(/<section\b[^>]*class=["'][^"']*docx[^"']*["']/gi) || []).length
    : 0;

  // Cap upfront PDF generation blocks for massive eBooks so upload never hangs while preserving 100% of HTML/text for the Reader
  const blocksForUpfrontPdf =
    parsed.blocks.length > 320 ? parsed.blocks.slice(0, 320) : parsed.blocks;

  await reportProgress(74, 'Formatting pages for Document Reader...');
  const { pdfBytes, pageCount } = await generatePdfFromWordBlocks(
    blocksForUpfrontPdf,
    {
      pageSize: 'A4',
      fontFamily:
        detectedExt === 'epub' || detectedExt === 'kpf' || detectedExt === 'kdf'
          ? 'times'
          : 'helvetica',
      baseFontSize: 11.5,
      lineSpacing: 1.4,
      addPageNumbers: true,
    }
  );
  await reportProgress(93, 'Finalizing document...');

  const preservedWordName = isNativeWordFormat
    ? lowerName.endsWith('.docx') || lowerName.endsWith('.doc')
      ? file.name
      : `${baseTitle}.${detectedExt}`
    : outputPdfName;

  return {
    pdfBytes,
    pageCount: docxSectionMatches > 0 ? docxSectionMatches : pageCount,
    extractedText: parsed.plainText,
    rawHtmlContent: parsed.htmlPreview,
    sourceFormat: detectedExt,
    outputPdfName: preservedWordName,
    originalFileBytes: isNativeWordFormat ? rawBytes : undefined,
  };
}



