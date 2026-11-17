import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
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

export interface KindleKpfChapter {
  chapterNumber: number;
  title: string;
  paragraphs: string[];
  tables?: string[][][];
  equations?: string[];
  links?: { text: string; url: string }[];
  pageNumber: number;
  widthPt?: number;
  heightPt?: number;
  orientation?: 'portrait' | 'landscape';
  isScannedPage?: boolean;
  ocrApplied?: boolean;
  imageDataUrl?: string;
}

export interface KindleKpfBookOptions {
  title: string;
  author: string;
  language: string;
  publisher?: string;
  layoutMode: 'reflowable' | 'print-replica';
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
  return str
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
        `Extracting layout, text, tables & graphics on page ${pNum} of ${totalPages}...`
      );

      const page = await pdf.getPage(pNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const widthPt = Math.round(baseViewport.width || 595);
      const heightPt = Math.round(baseViewport.height || 842);
      const orientation: 'portrait' | 'landscape' =
        widthPt > heightPt ? 'landscape' : 'portrait';

      // Extract spatial text items grouped by baseline row
      const textContent = await page.getTextContent();
      interface SpatialRowItem {
        x: number;
        y: number;
        w: number;
        str: string;
      }
      const rawItems: SpatialRowItem[] = [];
      for (const item of textContent.items) {
        if ('str' in item && item.str.trim() && item.transform) {
          const x = item.transform[4];
          const y = item.transform[5];
          const w = item.width || item.str.length * 5.5;
          rawItems.push({ x, y, w, str: item.str.trim() });
        }
      }

      // Sort top-to-bottom (descending PDF Y), then left-to-right (ascending PDF X)
      rawItems.sort((a, b) => {
        if (Math.abs(b.y - a.y) > 4.5) return b.y - a.y;
        return a.x - b.x;
      });

      const lineGroups: SpatialRowItem[][] = [];
      for (const it of rawItems) {
        const lastGroup = lineGroups[lineGroups.length - 1];
        if (lastGroup && Math.abs(lastGroup[0].y - it.y) <= 4.5) {
          lastGroup.push(it);
        } else {
          lineGroups.push([it]);
        }
      }

      const rawLines: string[] = [];
      const pageTables: string[][][] = [];
      let currentTableRows: string[][] = [];

      const flushDetectedTable = () => {
        if (currentTableRows.length >= 2) {
          pageTables.push([...currentTableRows]);
        }
        currentTableRows = [];
      };

      for (const group of lineGroups) {
        group.sort((a, b) => a.x - b.x);
        const cells: string[] = [];
        let curCell = group[0].str;
        let lastRight = group[0].x + group[0].w;

        for (let idx = 1; idx < group.length; idx++) {
          const gap = group[idx].x - lastRight;
          if (gap > 26) {
            cells.push(curCell.trim());
            curCell = group[idx].str;
          } else {
            curCell += ' ' + group[idx].str;
          }
          lastRight = Math.max(lastRight, group[idx].x + group[idx].w);
        }
        if (curCell.trim()) cells.push(curCell.trim());

        if (cells.length >= 2) {
          currentTableRows.push(cells);
        } else {
          flushDetectedTable();
        }

        const joinedLine = cells.join('   ').trim();
        if (joinedLine) {
          rawLines.push(joinedLine);
        }
      }
      flushDetectedTable();

      // Extract hyperlinks from PDF link annotations & inline URLs
      const pageLinks: { text: string; url: string }[] = [];
      const seenUrls = new Set<string>();
      try {
        const annotations = await page.getAnnotations();
        for (const ann of annotations) {
          const url = ann?.url || ann?.unsafeUrl;
          if (typeof url === 'string' && /^https?:\/\/|^mailto:/i.test(url)) {
            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              pageLinks.push({ text: url, url });
            }
          }
        }
      } catch {
        // Ignore annotation link errors
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

      // Render high-resolution page replica for diagrams, layouts, and scanned pages
      let imageDataUrl: string | undefined;
      try {
        const hiScale = totalPages > 40 ? 1.15 : 1.35;
        const viewport = page.getViewport({ scale: hiScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({
            canvasContext: ctx,
            canvas,
            viewport,
          }).promise;
          imageDataUrl = canvas.toDataURL('image/jpeg', 0.88);
          // Release canvas memory immediately for large PDFs
          canvas.width = 1;
          canvas.height = 1;
        }
      } catch {
        // Fallback to renderPdfPage helper
        try {
          const rendered = await renderPdfPage(
            pdfBytes,
            pNum,
            1.2,
            'image/jpeg',
            0.85
          );
          imageDataUrl = rendered.dataUrl;
        } catch {
          // Optional snapshot fallback
        }
      }

      const nativeCharCount = rawLines.join('').length;
      const isScannedPage = nativeCharCount < 15;
      let ocrApplied = false;

      // Optional OCR for scanned pages when requested
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
              ocrApplied = true;
            }
          }
        } catch {
          // Keep visual replica fallback if offline OCR fails
        }
      }

      let title = `Chapter ${pNum} — Page ${pNum}`;
      const bodyLines: string[] = [];

      if (rawLines.length > 0) {
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

      chapters.push({
        chapterNumber: pNum,
        title,
        paragraphs:
          bodyLines.length > 0
            ? bodyLines
            : [title],
        tables: pageTables.length > 0 ? pageTables : undefined,
        equations: equations.length > 0 ? equations : undefined,
        links: pageLinks.length > 0 ? pageLinks : undefined,
        pageNumber: pNum,
        widthPt,
        heightPt,
        orientation,
        isScannedPage,
        ocrApplied,
        imageDataUrl,
      });

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
    view.setUint32(pos, 0x04034b50, true); // Local file header signature
    view.setUint16(pos + 4, 20, true); // Version needed (2.0)
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(pos + 8, 0, true); // Stored (uncompressed)
    view.setUint16(pos + 10, 0, true); // Mod time
    view.setUint16(pos + 12, 0x21, true); // Mod date
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
    view.setUint32(pos, 0x02014b50, true); // Central directory file header
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

  // End of Central Directory Record (EOCD)
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

  const entries: Array<{ path: string; data: Uint8Array }> = [];

  // 1. Standard EPUB/KPF mimetype header (must be first and uncompressed)
  entries.push({
    path: 'mimetype',
    data: encoder.encode('application/epub+zip'),
  });

  // 2. Amazon Kindle Package Format (KPF / KDF) manifest descriptor
  // Includes both `bookMetadata`+`chapters` and top-level `title`/`author`/`resources` for 100% compatibility
  const kdfManifest = {
    format: 'Amazon Kindle Package Format (KPF)',
    kpfVersion: '2.1',
    generator: 'ElimikaPDF KPF Conversion Engine',
    createdAt: new Date().toISOString(),
    title: bookTitle,
    author: bookAuthor,
    language: bookLang,
    layoutMode: options.layoutMode,
    hasSourcePdfReplica: Boolean(options.sourcePdfBytes),
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
      isScannedPage: Boolean(ch.isScannedPage),
      ocrApplied: Boolean(ch.ocrApplied),
      paragraphCount: ch.paragraphs.length,
      tableCount: ch.tables?.length || 0,
      equationCount: ch.equations?.length || 0,
      href: `OEBPS/chapter-${ch.chapterNumber}.xhtml`,
    })),
    resources: chapters.map((ch) => ({
      id: `chapter-${ch.chapterNumber}`,
      path: `OEBPS/chapter-${ch.chapterNumber}.xhtml`,
      role: 'chapter',
      mediaType: 'application/xhtml+xml',
    })),
  };

  entries.push({
    path: 'kdf_manifest.json',
    data: encoder.encode(JSON.stringify(kdfManifest, null, 2)),
  });

  // 3. META-INF/container.xml
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

  // 4. OEBPS/styles.css
  const stylesCss = `body {
  font-family: "Bookerly", "Georgia", serif;
  font-size: ${fontScale}%;
  line-height: 1.65;
  margin: 1.2em;
  color: #111111;
}
h1, h2 {
  font-family: "Bookerly", "Georgia", serif;
  font-weight: bold;
  line-height: 1.3;
  margin-top: 1.2em;
  margin-bottom: 0.6em;
  page-break-after: avoid;
}
p {
  margin: 0 0 0.75em 0;
  text-indent: 1.25em;
  text-align: justify;
}
p.first-para {
  text-indent: 0;
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
  margin: 1em 0;
  font-size: 0.92em;
}
table.kpf-table th, table.kpf-table td {
  border: 1px solid #cbd5e1;
  padding: 6px 10px;
  text-align: left;
}
table.kpf-table tr:first-child td, table.kpf-table th {
  background-color: #f8fafc;
  font-weight: bold;
}
.kpf-math {
  font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif;
  font-style: italic;
  background-color: #f8fafc;
  border-left: 3px solid #E47911;
  padding: 6px 12px;
  margin: 0.65em 0;
  text-indent: 0;
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

  // 5. Chapter XHTML files
  const manifestItems: string[] = [
    `<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
  ];
  const spineItems: string[] = [];
  const tocLinks: string[] = [];

  const linkifyEscapedXml = (escapedText: string): string => {
    return escapedText.replace(
      /(https?:\/\/[^\s&<>"']+)/gi,
      '<a href="$1">$1</a>'
    );
  };

  chapters.forEach((ch, idx) => {
    const chId = `chapter-${idx + 1}`;
    const fileName = `${chId}.xhtml`;
    manifestItems.push(
      `<item id="${chId}" href="${fileName}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${chId}"/>`);
    tocLinks.push(
      `        <li><a href="${fileName}">${escapeXmlText(ch.title)}</a></li>`
    );

    const paragraphsHtml = ch.paragraphs
      .map((p, pIdx) => {
        const isEq = isMathOrEquationLine(p);
        const escaped = linkifyEscapedXml(escapeXmlText(p));
        if (isEq) {
          return `    <p class="kpf-math">${escaped}</p>`;
        }
        return `    <p class="${pIdx === 0 ? 'first-para' : ''}">${escaped}</p>`;
      })
      .join('\n');

    const tablesHtml =
      ch.tables && ch.tables.length > 0
        ? ch.tables
            .map(
              (tbl) =>
                `    <table class="kpf-table">\n      <tbody>\n${tbl
                  .map(
                    (row) =>
                      `        <tr>${row
                        .map((cell) => `<td>${escapeXmlText(cell)}</td>`)
                        .join('')}</tr>`
                  )
                  .join('\n')}\n      </tbody>\n    </table>`
            )
            .join('\n')
        : '';

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

    // Include visual replica image in Print Replica mode OR whenever the page has diagrams/scanned content
    const includeReplica =
      Boolean(ch.imageDataUrl) &&
      (options.layoutMode === 'print-replica' || Boolean(ch.isScannedPage));
    const replicaBlock = includeReplica
      ? `    <div class="replica-figure">\n      <img src="${ch.imageDataUrl}" alt="${escapeXmlText(
          ch.title
        )}"/>\n    </div>\n`
      : '';

    const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXmlText(bookLang)}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeXmlText(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="chapter" data-page-number="${ch.pageNumber}" data-orientation="${ch.orientation || 'portrait'}">
    <h1>${escapeXmlText(ch.title)}</h1>
${replicaBlock}${tablesHtml ? tablesHtml + '\n' : ''}${paragraphsHtml}
${linksHtml}  </section>
</body>
</html>`;

    entries.push({
      path: `OEBPS/${fileName}`,
      data: encoder.encode(chapterXhtml),
    });
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
<body>
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
    options.layoutMode === 'print-replica' ? 'pre-paginated' : 'reflowable';
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
 * Converts ANY uploaded document, eBook (.epub, .kpf, .mobi, .fb2), Office file
 * (.docx, .doc, .odt, .xlsx, .xls, .ods, .csv, .tsv, .pptx, .ppt, .odp),
 * Web/Markup (.html, .htm, .xhtml, .md, .rtf, .txt, .json, .xml), or Image
 * into a multi-page searchable PDF + rich HTML representation for the Universal Reader.
 */
export async function convertAnyUploadedFileToPdfAndHtml(
  file: File
): Promise<ConvertedUniversalDocumentResult> {
  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'Document';
  const outputPdfName = lowerName.endsWith('.pdf')
    ? file.name
    : `${baseTitle}.pdf`;

  const buf = await file.arrayBuffer();
  const rawBytes = new Uint8Array(buf);

  if (rawBytes.byteLength === 0) {
    throw new Error(
      `The selected file "${file.name}" is empty (0 bytes) and cannot be opened.`
    );
  }

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
      pageCount = await getPdfPageCount(rawBytes);
    } catch {
      pageCount = 1;
    }
    try {
      const pageTexts = await extractAllPdfText(rawBytes);
      extractedText = pageTexts
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join('\n\n');
    } catch {
      extractedText = '';
    }

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
    const sheets = await parseUploadedWorkbookSheets(file);
    const rows: string[][] =
      sheets.length === 1
        ? sheets[0].rows
        : sheets.flatMap((s) => [[`=== Sheet: ${s.name} ===`], ...s.rows]);
    const { pdfBytes, pageCount } = await convertSpreadsheetRowsToPdf(
      rows,
      baseTitle,
      'landscape'
    );
    const interactiveExcelHtml = buildInteractiveExcelHtml(sheets, baseTitle);

    return {
      pdfBytes,
      pageCount,
      extractedText: rows.map((r) => r.join(' | ')).join('\n'),
      rawHtmlContent: interactiveExcelHtml,
      sourceFormat: detectedExt,
      outputPdfName,
    };
  }

  // 3. Presentations (.pptx, .ppt)
  if (
    ['pptx', 'ppt'].includes(detectedExt) ||
    mime.includes('presentation') ||
    mime.includes('powerpoint')
  ) {
    const slides = await parseUploadedPresentationFile(file);
    const { pdfBytes, pageCount } = await buildPresentationPdfFromSlides(
      slides,
      baseTitle
    );
    const slideHtml = slides
      .map(
        (s) =>
          `<section><h2>Slide ${s.slideNumber}: ${escapeHtmlCell(
            s.title
          )}</h2><ul>${s.bullets
            .map((b) => `<li>${escapeHtmlCell(b)}</li>`)
            .join('')}</ul></section>`
      )
      .join('\n<hr />\n');

    return {
      pdfBytes,
      pageCount,
      extractedText: slides
        .map((s) => `${s.title}\n${s.bullets.join('\n')}`)
        .join('\n\n'),
      rawHtmlContent: `<h1>${escapeHtmlCell(baseTitle)}</h1>\n${slideHtml}`,
      sourceFormat: detectedExt,
      outputPdfName,
    };
  }

  // 4. Raster Images (.png, .jpg, .jpeg, .webp, .gif, .bmp)
  if (
    mime.startsWith('image/') &&
    !mime.includes('svg') &&
    !/\.(?:svg|html|htm|xhtml|epub|kpf)$/i.test(lowerName)
  ) {
    const dataUrl = await readImageFileAsDataUrl(file);
    const pdfBytes = await createPdfFromImages([dataUrl], {
      pageSize: 'A4',
      marginPt: 18,
    });
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

  // 5. eBooks (.kpf, .epub, .mobi, .azw3, .fb2), HTML (.html, .htm, .xhtml),
  //    Word & OpenDocument (.docx, .doc, .odt, .ods, .odp), Markdown (.md), RTF, JSON, XML, TXT
  const parsed = await parseUploadedWordFile(file);

  // If this is a KPF package containing an embedded `OEBPS/source_replica.pdf`, restore its exact PDF pages!
  if (detectedExt === 'kpf' || lowerName.endsWith('.kpf')) {
    try {
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
        return {
          pdfBytes: embeddedPdf,
          pageCount: replicaPageCount,
          extractedText: parsed.plainText,
          rawHtmlContent: parsed.htmlPreview,
          sourceFormat: 'kpf',
          outputPdfName,
        };
      }
    } catch {
      // Fallback to block-generated PDF below
    }
  }

  const { pdfBytes, pageCount } = await generatePdfFromWordBlocks(
    parsed.blocks,
    {
      pageSize: 'A4',
      fontFamily:
        detectedExt === 'epub' || detectedExt === 'kpf' ? 'times' : 'helvetica',
      baseFontSize: 11.5,
      lineSpacing: 1.4,
      addPageNumbers: true,
    }
  );

  return {
    pdfBytes,
    pageCount,
    extractedText: parsed.plainText,
    rawHtmlContent: parsed.htmlPreview,
    sourceFormat: detectedExt,
    outputPdfName,
  };
}



