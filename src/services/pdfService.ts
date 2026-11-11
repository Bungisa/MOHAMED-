import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  PDFName,
  PDFDict,
  PDFStream,
  PDFNumber,
} from 'pdf-lib';
import { AnnotationElement, NativeTextBlock } from '../types/document';

// Configure PDF.js worker using Vite ?url asset resolution
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderedPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
  extractedText: string;
  nativeTextBlocks: NativeTextBlock[];
}

/**
 * Loads a PDF via PDF.js (with pdf-lib fallback) and returns the total page count.
 */
export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  try {
    const dataCopy = new Uint8Array(pdfBytes);
    const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
    const pdf = await loadingTask.promise;
    const count = pdf.numPages;
    await loadingTask.destroy();
    return count;
  } catch {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return doc.getPageCount();
  }
}

async function renderSingleLoadedPdfPage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale = 1.5,
  format: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<RenderedPageInfo> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for PDF rendering.');
  }

  // Fill white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    canvas,
    viewport,
  }).promise;

  // Extract native PDF text and structured clickable text blocks (for iLovePDF-style Content Editing)
  let extractedText = '';
  const nativeTextBlocks: NativeTextBlock[] = [];
  try {
    const baseViewport = page.getViewport({ scale: 1.0 });
    const pageW = baseViewport.width || 595.28;
    const pageH = baseViewport.height || 841.89;
    const textContent = await page.getTextContent();

    extractedText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Group adjacent text items on the same baseline into editable line blocks
    let blockIdx = 0;
    for (const item of textContent.items) {
      if (!('str' in item) || !item.str.trim() || !item.transform) continue;
      const tx = item.transform[4];
      const ty = item.transform[5];
      const fontH = Math.max(
        8,
        Math.round(Math.hypot(item.transform[2], item.transform[3]) || 11)
      );
      const itemW = Math.max(20, item.width || item.str.length * (fontH * 0.52));

      const normX = Math.max(0, Math.min(0.96, tx / pageW));
      const normY = Math.max(0, Math.min(0.96, 1 - (ty + fontH) / pageH));
      const normW = Math.max(0.03, Math.min(1 - normX, itemW / pageW));
      const normH = Math.max(0.018, Math.min(1 - normY, (fontH * 1.35) / pageH));

      // Merge with previous block if on the exact same line and horizontally adjacent
      const prev = nativeTextBlocks[nativeTextBlocks.length - 1];
      if (
        prev &&
        Math.abs(prev.y - normY) < 0.008 &&
        normX - (prev.x + prev.width) < 0.04
      ) {
        const rightEdge = Math.max(prev.x + prev.width, normX + normW);
        prev.text = `${prev.text} ${item.str.trim()}`;
        prev.width = rightEdge - prev.x;
      } else {
        nativeTextBlocks.push({
          id: `native-txt-${pageNumber}-${blockIdx++}`,
          pageNumber,
          text: item.str,
          x: normX,
          y: normY,
          width: normW,
          height: normH,
          fontSize: fontH,
        });
      }
    }
  } catch {
    extractedText = '';
  }

  return {
    pageNumber,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL(format, quality),
    extractedText,
    nativeTextBlocks,
  };
}

/**
 * Renders a specific 1-indexed PDF page to a high-DPI PNG or JPEG Data URL
 * and extracts its native selectable text content.
 */
export async function renderPdfPage(
  pdfBytes: Uint8Array,
  pageNumber: number,
  scale = 1.5,
  format: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<RenderedPageInfo> {
  const dataCopy = new Uint8Array(pdfBytes);
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  const pdf = await loadingTask.promise;
  try {
    return await renderSingleLoadedPdfPage(
      pdf,
      pageNumber,
      scale,
      format,
      quality
    );
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Loads a multi-page PDF once via PDF.js and renders all pages sequentially,
 * streaming progress via `onProgress` so multi-page PDFs load fast and reliably.
 */
export async function renderAllPdfPages(
  pdfBytes: Uint8Array,
  scale = 1.65,
  onProgress?: (renderedPages: RenderedPageInfo[], totalPages: number) => void
): Promise<RenderedPageInfo[]> {
  const dataCopy = new Uint8Array(pdfBytes);
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const renderedList: RenderedPageInfo[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      try {
        const pageInfo = await renderSingleLoadedPdfPage(
          pdf,
          pageNumber,
          scale,
          'image/jpeg',
          0.94
        );
        renderedList.push(pageInfo);
      } catch (pageErr) {
        console.error(`Error rendering page ${pageNumber}:`, pageErr);
        // Fallback blank page canvas so multi-page numbering never breaks
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = 714;
        fallbackCanvas.height = 1010;
        const fCtx = fallbackCanvas.getContext('2d');
        if (fCtx) {
          fCtx.fillStyle = '#FFFFFF';
          fCtx.fillRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
        }
        renderedList.push({
          pageNumber,
          width: fallbackCanvas.width,
          height: fallbackCanvas.height,
          dataUrl: fallbackCanvas.toDataURL('image/jpeg', 0.85),
          extractedText: '',
          nativeTextBlocks: [],
        });
      }

      if (onProgress) {
        onProgress([...renderedList], totalPages);
      }
      // Yield briefly to keep the main thread responsive on multi-page documents
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await loadingTask.destroy();
  }

  return renderedList;
}

/**
 * Extracts all native text across all pages of a PDF.
 */
export async function extractAllPdfText(
  pdfBytes: Uint8Array
): Promise<{ pageNumber: number; text: string }[]> {
  const dataCopy = new Uint8Array(pdfBytes);
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  const pdf = await loadingTask.promise;
  const results: { pageNumber: number; text: string }[] = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const lines: string[] = [];
    let lastY: number | null = null;
    let currentLine = '';

    for (const item of textContent.items) {
      if ('str' in item) {
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          lines.push(currentLine.trim());
          currentLine = item.str;
        } else {
          currentLine += (currentLine ? ' ' : '') + item.str;
        }
        lastY = y;
      }
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

      results.push({
        pageNumber: i,
        text: lines.join('\n'),
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return results;
}

/**
 * Normalizes any byte buffer (Uint8Array, ArrayBuffer, or IndexedDB deserialized view)
 * into a clean, contiguous 0-offset Uint8Array.
 */
export function toCleanUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) {
    if (
      input.byteOffset === 0 &&
      input.byteLength === input.buffer.byteLength
    ) {
      return new Uint8Array(input);
    }
    return new Uint8Array(
      input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    );
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }
  return new Uint8Array(input as ArrayLike<number>);
}

/**
 * Encodes a binary Uint8Array into a self-contained `data:<mimeType>;base64,...` URI
 * in 32KB chunks so browser downloads work inside cross-origin iframes and authenticated
 * Cloud Run proxies without ever hitting network auth redirects or blob partition errors.
 */
export function bytesToDataUrl(
  bytes: Uint8Array,
  mimeType = 'application/pdf'
): string {
  const safeBytes = toCleanUint8Array(bytes);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < safeBytes.length; i += chunkSize) {
    const sub = safeBytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }
  const base64 = btoa(chunks.join(''));
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Ensures a PDF byte array is 100% unencrypted before pdf-lib modifies it.
 * Note: pdf-lib's `{ ignoreEncryption: true }` does NOT decrypt streams—saving a modified
 * encrypted PDF in pdf-lib leaves the `/Encrypt` trailer intact while writing unencrypted
 * streams, which causes every browser and PDF viewer to fail with "Cannot open file".
 * When `srcDoc.isEncrypted` is true, we use PDF.js (which natively decrypts owner-protected PDFs)
 * to rebuild a clean, unencrypted PDF first.
 */
export async function ensureUnencryptedPdfBytes(
  pdfBytes: Uint8Array
): Promise<Uint8Array> {
  const cleanInput = toCleanUint8Array(pdfBytes);
  try {
    const checkDoc = await PDFDocument.load(cleanInput, {
      ignoreEncryption: true,
    });
    if (!checkDoc.isEncrypted) {
      return cleanInput;
    }
  } catch {
    // Fall through to PDF.js decrypted reconstruction
  }

  const pageCount = await getPdfPageCount(cleanInput);
  const pageDataUrls: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const rendered = await renderPdfPage(
      cleanInput,
      i,
      1.5,
      'image/jpeg',
      0.92
    );
    pageDataUrls.push(rendered.dataUrl);
  }
  return createPdfFromImages(pageDataUrls, { pageSize: 'A4', marginPt: 0 });
}

/**
 * Creates a multi-page PDF document from an array of image Data URLs.
 * Saved with `useObjectStreams: false` for 100% compatibility across all mobile & desktop PDF viewers.
 */
export async function createPdfFromImages(
  imageDataUrls: string[],
  options: {
    pageSize: 'A4' | 'Letter' | 'Legal' | 'Fit';
    marginPt?: number;
  } = { pageSize: 'A4', marginPt: 24 }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const margin = options.marginPt ?? 24;

  for (const dataUrl of imageDataUrls) {
    const isPng = dataUrl.startsWith('data:image/png');
    const base64 = dataUrl.split(',')[1];
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const embeddedImg = isPng
      ? await pdfDoc.embedPng(bytes)
      : await pdfDoc.embedJpg(bytes);

    let pageW = embeddedImg.width;
    let pageH = embeddedImg.height;

    if (options.pageSize === 'A4') {
      pageW = 595.28;
      pageH = 841.89;
    } else if (options.pageSize === 'Letter') {
      pageW = 612;
      pageH = 792;
    } else if (options.pageSize === 'Legal') {
      pageW = 612;
      pageH = 1008;
    }

    const page = pdfDoc.addPage([pageW, pageH]);

    if (options.pageSize === 'Fit') {
      page.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH,
      });
    } else {
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;
      const scale = Math.min(
        availW / embeddedImg.width,
        availH / embeddedImg.height
      );
      const drawW = embeddedImg.width * scale;
      const drawH = embeddedImg.height * scale;
      const drawX = (pageW - drawW) / 2;
      const drawY = (pageH - drawH) / 2;

      page.drawImage(embeddedImg, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
      });
    }
  }

  return pdfDoc.save({ useObjectStreams: false });
}

function hexToRgbColor(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2) || '00', 16) / 255;
  const g = parseInt(clean.substring(2, 4) || '00', 16) / 255;
  const b = parseInt(clean.substring(4, 6) || '00', 16) / 255;
  return rgb(
    Number.isNaN(r) ? 0 : r,
    Number.isNaN(g) ? 0 : g,
    Number.isNaN(b) ? 0 : b
  );
}

/**
 * Bakes overlay annotations, page numbers, and watermarks into a PDF document using pdf-lib.
 */
export async function bakeAnnotationsIntoPdf(
  pdfBytes: Uint8Array,
  annotations: AnnotationElement[],
  options?: {
    addPageNumbers?: boolean;
    pageNumberPosition?: 'bottom-center' | 'bottom-right';
    watermarkText?: string;
    watermarkOpacity?: number;
    filteredPageDataUrls?: Record<number, string>;
  }
): Promise<Uint8Array> {
  const unencryptedBytes = await ensureUnencryptedPdfBytes(pdfBytes);
  const pdfDoc = await PDFDocument.load(unencryptedBytes, {
    ignoreEncryption: true,
  });
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdfDoc.embedFont(
    StandardFonts.HelveticaBoldOblique
  );
  const pages = pdfDoc.getPages();

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const page = pages[i];
    const { width, height } = page.getSize();

    // If a Color Filter (e.g., OCV BLACK, Vivid Light) or Brightness switch was applied to this page, embed the processed page base image
    const filteredDataUrl = options?.filteredPageDataUrls?.[pageNumber];
    if (filteredDataUrl) {
      try {
        const isPng = filteredDataUrl.startsWith('data:image/png');
        const b64 = filteredDataUrl.split(',')[1];
        const imgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const embeddedFiltered = isPng
          ? await pdfDoc.embedPng(imgBytes)
          : await pdfDoc.embedJpg(imgBytes);
        page.drawImage(embeddedFiltered, {
          x: 0,
          y: 0,
          width,
          height,
          opacity: 1,
        });
      } catch (err) {
        console.error('Failed to embed filtered page image:', err);
      }
    }

    const pageAnns = annotations.filter((a) => a.pageNumber === pageNumber);

    for (const ann of pageAnns) {
      // If this annotation replaced or moved an existing native element, restore the background at its original footprint
      if (ann.origRect) {
        const ox = ann.origRect.x * width;
        const ow = ann.origRect.width * width;
        const oh = ann.origRect.height * height;
        const oy = height - ann.origRect.y * height - oh;
        if (ann.origBgDataUrl) {
          try {
            const isPng = ann.origBgDataUrl.startsWith('data:image/png');
            const b64 = ann.origBgDataUrl.split(',')[1];
            const bgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const embeddedBg = isPng
              ? await pdfDoc.embedPng(bgBytes)
              : await pdfDoc.embedJpg(bgBytes);
            page.drawImage(embeddedBg, {
              x: ox,
              y: oy,
              width: ow,
              height: oh,
              opacity: 1,
            });
          } catch {
            page.drawRectangle({
              x: ox,
              y: oy,
              width: ow,
              height: oh,
              color: rgb(1, 1, 1),
              opacity: 1,
            });
          }
        } else {
          page.drawRectangle({
            x: ox - 1,
            y: oy - 1,
            width: ow + 2,
            height: oh + 2,
            color: rgb(1, 1, 1),
            opacity: 1,
          });
        }
      }

      const pdfX = ann.x * width;
      const pdfW = ann.width * width;
      const pdfH = ann.height * height;
      // PDF coordinate origin is bottom-left
      const pdfY = height - ann.y * height - pdfH;
      const strokeColor = hexToRgbColor(ann.color || '#4A1D5E');
      const opacity = ann.opacity ?? 1;

      if (ann.type === 'whiteout') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          color: rgb(1, 1, 1),
          opacity: 1,
        });
      } else if (ann.type === 'draw' && ann.points && ann.points.length > 1) {
        for (let pIdx = 0; pIdx < ann.points.length - 1; pIdx++) {
          const p1 = ann.points[pIdx];
          const p2 = ann.points[pIdx + 1];
          page.drawLine({
            start: { x: p1.x * width, y: height - p1.y * height },
            end: { x: p2.x * width, y: height - p2.y * height },
            thickness: ann.strokeWidth || 2.5,
            color: strokeColor,
            opacity,
          });
        }
      } else if (ann.type === 'highlight') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          color: strokeColor,
          opacity: 0.35,
        });
      } else if (ann.type === 'underline') {
        page.drawLine({
          start: { x: pdfX, y: pdfY },
          end: { x: pdfX + pdfW, y: pdfY },
          thickness: ann.strokeWidth || 2,
          color: strokeColor,
          opacity,
        });
      } else if (ann.type === 'strikethrough') {
        page.drawLine({
          start: { x: pdfX, y: pdfY + pdfH / 2 },
          end: { x: pdfX + pdfW, y: pdfY + pdfH / 2 },
          thickness: ann.strokeWidth || 2,
          color: strokeColor,
          opacity,
        });
      } else if (ann.type === 'rectangle') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          borderColor: strokeColor,
          borderWidth: ann.strokeWidth || 2,
          color: ann.fillColor ? hexToRgbColor(ann.fillColor) : undefined,
          opacity,
        });
      } else if (ann.type === 'circle') {
        page.drawEllipse({
          x: pdfX + pdfW / 2,
          y: pdfY + pdfH / 2,
          xScale: pdfW / 2,
          yScale: pdfH / 2,
          borderColor: strokeColor,
          borderWidth: ann.strokeWidth || 2,
          color: ann.fillColor ? hexToRgbColor(ann.fillColor) : undefined,
          opacity,
        });
      } else if (ann.type === 'line' || ann.type === 'arrow') {
        const startX = ann.x * width;
        const startY = height - ann.y * height;
        const endX = (ann.endX ?? ann.x + ann.width) * width;
        const endY = height - (ann.endY ?? ann.y + ann.height) * height;

        page.drawLine({
          start: { x: startX, y: startY },
          end: { x: endX, y: endY },
          thickness: ann.strokeWidth || 2.5,
          color: strokeColor,
          opacity,
        });

        if (ann.type === 'arrow') {
          const angle = Math.atan2(endY - startY, endX - startX);
          const headLen = 10;
          page.drawLine({
            start: { x: endX, y: endY },
            end: {
              x: endX - headLen * Math.cos(angle - Math.PI / 6),
              y: endY - headLen * Math.sin(angle - Math.PI / 6),
            },
            thickness: ann.strokeWidth || 2.5,
            color: strokeColor,
            opacity,
          });
          page.drawLine({
            start: { x: endX, y: endY },
            end: {
              x: endX - headLen * Math.cos(angle + Math.PI / 6),
              y: endY - headLen * Math.sin(angle + Math.PI / 6),
            },
            thickness: ann.strokeWidth || 2.5,
            color: strokeColor,
            opacity,
          });
        }
      } else if (ann.type === 'text') {
        // Skip untouched empty placeholder text boxes that didn't replace native PDF text
        if (!ann.text?.trim() && !ann.replacesNativeTextId) {
          continue;
        }
        const hasBg =
          ann.backgroundColor && ann.backgroundColor !== 'transparent';
        const hasBorder = Boolean(
          ann.fillColor && ann.fillColor !== 'transparent'
        );
        if (hasBg || hasBorder) {
          page.drawRectangle({
            x: pdfX,
            y: pdfY,
            width: pdfW,
            height: pdfH,
            color: hasBg ? hexToRgbColor(ann.backgroundColor!) : undefined,
            borderColor: hasBorder ? hexToRgbColor(ann.fillColor!) : undefined,
            borderWidth: hasBorder ? ann.strokeWidth || 1.5 : 0,
            opacity,
          });
        }
        if (ann.text && ann.text.trim()) {
          const fontSize = ann.fontSize || 14;
          const chosenFont =
            ann.fontWeight === 'bold' && ann.fontStyle === 'italic'
              ? fontBoldItalic
              : ann.fontWeight === 'bold'
                ? fontBold
                : ann.fontStyle === 'italic'
                  ? fontItalic
                  : fontRegular;
          const lines = ann.text.split('\n');
          lines.forEach((line, idx) => {
            page.drawText(line, {
              x: pdfX + 4,
              y: height - ann.y * height - fontSize * (idx + 0.95) - 3,
              size: fontSize,
              font: chosenFont,
              color: strokeColor,
              opacity,
            });
          });
        }
      } else if (ann.type === 'comment' && ann.text) {
        const boxFill =
          ann.backgroundColor && ann.backgroundColor !== 'transparent'
            ? hexToRgbColor(ann.backgroundColor)
            : rgb(1, 0.97, 0.82);
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: Math.max(pdfW, 140),
          height: Math.max(pdfH, 48),
          color: boxFill,
          borderColor: strokeColor,
          borderWidth: 1.2,
          opacity: 0.96,
        });
        page.drawText(`Note: ${ann.text.slice(0, 85)}`, {
          x: pdfX + 6,
          y: pdfY + Math.max(pdfH, 48) - 16,
          size: 9.5,
          font: fontRegular,
          color: strokeColor,
        });
      } else if (ann.type === 'image' && ann.imageDataUrl) {
        try {
          const isPng = ann.imageDataUrl.startsWith('data:image/png');
          const base64 = ann.imageDataUrl.split(',')[1];
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const embedded = isPng
            ? await pdfDoc.embedPng(bytes)
            : await pdfDoc.embedJpg(bytes);
          page.drawImage(embedded, {
            x: pdfX,
            y: pdfY,
            width: pdfW,
            height: pdfH,
            opacity,
          });
        } catch (err) {
          console.error('Failed to embed annotation image:', err);
        }
      }
    }

    // Optional Watermark
    if (options?.watermarkText && options.watermarkText.trim()) {
      const wmText = options.watermarkText.trim();
      page.drawText(wmText, {
        x: width * 0.18,
        y: height * 0.42,
        size: 44,
        font: fontBold,
        color: rgb(0.45, 0.2, 0.55),
        opacity: options.watermarkOpacity ?? 0.16,
        rotate: degrees(35),
      });
    }

    // Optional Page Numbers
    if (options?.addPageNumbers) {
      const label = `Page ${pageNumber} of ${pages.length}`;
      const xPos =
        options.pageNumberPosition === 'bottom-right' ? width - 110 : width / 2 - 35;
      page.drawText(label, {
        x: xPos,
        y: 24,
        size: 10,
        font: fontRegular,
        color: rgb(0.35, 0.33, 0.4),
      });
    }
  }

  return pdfDoc.save({ useObjectStreams: false });
}

/**
 * Merges multiple PDF byte arrays into a single unified PDF document.
 */
export async function mergePdfs(pdfByteArrays: Uint8Array[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const rawBytes of pdfByteArrays) {
    const cleanBytes = await ensureUnencryptedPdfBytes(rawBytes);
    const srcDoc = await PDFDocument.load(cleanBytes, {
      ignoreEncryption: true,
    });
    const copiedPages = await mergedPdf.copyPages(
      srcDoc,
      srcDoc.getPageIndices()
    );
    copiedPages.forEach((p) => mergedPdf.addPage(p));
  }

  return mergedPdf.save({ useObjectStreams: false });
}

/**
 * Extracts a 1-indexed array of page numbers from a PDF into a new, universally compatible PDF.
 * Automatically handles owner-encrypted PDFs and validates the extracted PDF with PDF.js so
 * downloaded split PDFs open cleanly in every mobile and desktop PDF viewer and browser.
 */
export async function extractPdfPages(
  pdfBytes: Uint8Array,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const cleanBytes = toCleanUint8Array(pdfBytes);
  try {
    const srcDoc = await PDFDocument.load(cleanBytes, {
      ignoreEncryption: true,
    });
    if (srcDoc.isEncrypted) {
      throw new Error(
        'Source PDF has encrypted streams; using PDF.js decrypted page render for split output.'
      );
    }
    const totalPages = srcDoc.getPageCount();
    const newDoc = await PDFDocument.create();
    const validIndices = pageNumbers
      .map((n) => n - 1)
      .filter((idx) => idx >= 0 && idx < totalPages);

    if (validIndices.length === 0 && totalPages > 0) {
      validIndices.push(0);
    }

    const copied = await newDoc.copyPages(srcDoc, validIndices);
    copied.forEach((p) => newDoc.addPage(p));

    // Save with useObjectStreams: false so standard PDF xref table is written for universal viewer support
    const savedBytes = await newDoc.save({ useObjectStreams: false });
    if (!savedBytes || savedBytes.byteLength < 64) {
      throw new Error('Saved split PDF was unexpectedly empty.');
    }

    // Verify with PDF.js that the extracted PDF parses and its first page stream is 100% valid
    const verifyCopy = new Uint8Array(savedBytes);
    const loadingTask = pdfjsLib.getDocument({ data: verifyCopy });
    const verifiedPdf = await loadingTask.promise;
    try {
      if (verifiedPdf.numPages !== validIndices.length) {
        throw new Error('Page count mismatch in extracted PDF.');
      }
      const firstPage = await verifiedPdf.getPage(1);
      await firstPage.getOperatorList();
    } finally {
      await loadingTask.destroy();
    }

    return savedBytes;
  } catch (err) {
    console.warn(
      'Direct copyPages fallback triggered for Split PDF; rendering clean decrypted pages:',
      err
    );
    const totalCount = await getPdfPageCount(cleanBytes);
    const validPages = pageNumbers.filter((n) => n >= 1 && n <= totalCount);
    const targetPages = validPages.length > 0 ? validPages : [1];
    const pageImages: string[] = [];
    for (const pNum of targetPages) {
      const rendered = await renderPdfPage(
        cleanBytes,
        pNum,
        1.5,
        'image/jpeg',
        0.92
      );
      pageImages.push(rendered.dataUrl);
    }
    return createPdfFromImages(pageImages, { pageSize: 'A4', marginPt: 0 });
  }
}

/**
 * Reorganizes, rotates, deletes, or inserts blank pages in a PDF.
 * Each item in `pageSpecs` can either reference an existing 1-indexed `sourcePageNumber`
 * or specify `isBlank: true` for a newly inserted page.
 */
export async function organizePdfPages(
  pdfBytes: Uint8Array,
  pageSpecs: {
    sourcePageNumber?: number;
    isBlank?: boolean;
    addRotationDeg?: number;
  }[]
): Promise<Uint8Array> {
  const rawInput = toCleanUint8Array(pdfBytes);
  const cleanBytes = await ensureUnencryptedPdfBytes(rawInput);

  try {
    const srcDoc = await PDFDocument.load(cleanBytes, {
      ignoreEncryption: true,
    });
    if (srcDoc.isEncrypted) {
      throw new Error('Encrypted source PDF; using rendered page fallback.');
    }
    const outDoc = await PDFDocument.create();
    const totalSrcPages = srcDoc.getPageCount();

    for (const spec of pageSpecs) {
      if (spec.isBlank) {
        outDoc.addPage([595.28, 841.89]);
      } else if (
        spec.sourcePageNumber &&
        spec.sourcePageNumber >= 1 &&
        spec.sourcePageNumber <= totalSrcPages
      ) {
        const [copiedPage] = await outDoc.copyPages(srcDoc, [
          spec.sourcePageNumber - 1,
        ]);
        if (spec.addRotationDeg) {
          const currentRot = copiedPage.getRotation().angle || 0;
          copiedPage.setRotation(
            degrees(((currentRot + spec.addRotationDeg) % 360 + 360) % 360)
          );
        }
        outDoc.addPage(copiedPage);
      }
    }

    const savedBytes = await outDoc.save({ useObjectStreams: false });
    if (!savedBytes || savedBytes.byteLength < 64) {
      throw new Error('Saved organized PDF was empty.');
    }

    // Verify with PDF.js that the reorganized PDF loads cleanly
    const verifyCopy = new Uint8Array(savedBytes);
    const loadingTask = pdfjsLib.getDocument({ data: verifyCopy });
    const verifiedPdf = await loadingTask.promise;
    try {
      if (verifiedPdf.numPages !== pageSpecs.length) {
        throw new Error('Organized PDF page count mismatch.');
      }
      const firstPage = await verifiedPdf.getPage(1);
      await firstPage.getOperatorList();
    } finally {
      await loadingTask.destroy();
    }

    return savedBytes;
  } catch (err) {
    console.warn(
      'Direct copyPages fallback triggered in organizePdfPages; rendering clean pages:',
      err
    );
    const totalCount = await getPdfPageCount(cleanBytes);
    const pageImages: string[] = [];

    const rotateDataUrl = (
      dataUrl: string,
      rotDeg: number
    ): Promise<string> => {
      const normRot = ((rotDeg % 360) + 360) % 360;
      if (normRot === 0) return Promise.resolve(dataUrl);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          if (normRot === 90 || normRot === 270) {
            canvas.width = img.height;
            canvas.height = img.width;
          } else {
            canvas.width = img.width;
            canvas.height = img.height;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((normRot * Math.PI) / 180);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
    };

    const createBlankDataUrl = (): string => {
      const canvas = document.createElement('canvas');
      canvas.width = 794;
      canvas.height = 1123;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return canvas.toDataURL('image/jpeg', 0.9);
    };

    for (const spec of pageSpecs) {
      if (spec.isBlank) {
        pageImages.push(createBlankDataUrl());
      } else if (
        spec.sourcePageNumber &&
        spec.sourcePageNumber >= 1 &&
        spec.sourcePageNumber <= totalCount
      ) {
        const rendered = await renderPdfPage(
          cleanBytes,
          spec.sourcePageNumber,
          1.5,
          'image/jpeg',
          0.92
        );
        const rotated = await rotateDataUrl(
          rendered.dataUrl,
          spec.addRotationDeg || 0
        );
        pageImages.push(rotated);
      }
    }

    return createPdfFromImages(pageImages, { pageSize: 'Fit', marginPt: 0 });
  }
}

/**
 * Compresses a PDF by either optimizing streams ('low') or
 * rasterizing pages at controlled resolution & JPEG quality ('medium' | 'extreme').
 */
export async function compressPdfDocument(
  pdfBytes: Uint8Array,
  level: 'low' | 'medium' | 'extreme'
): Promise<Uint8Array> {
  if (level === 'low') {
    const cleanBytes = await ensureUnencryptedPdfBytes(pdfBytes);
    const doc = await PDFDocument.load(cleanBytes, { ignoreEncryption: true });
    return doc.save({ useObjectStreams: false });
  }

  const scale = level === 'medium' ? 1.15 : 0.82;
  const quality = level === 'medium' ? 0.68 : 0.45;
  const pageCount = await getPdfPageCount(pdfBytes);
  const compressedImages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const rendered = await renderPdfPage(
      pdfBytes,
      i,
      scale,
      'image/jpeg',
      quality
    );
    compressedImages.push(rendered.dataUrl);
  }

  const outDoc = await createPdfFromImages(compressedImages, {
    pageSize: 'A4',
    marginPt: 0,
  });

  return outDoc;
}

export type SaveCompressionQuality = 'low' | 'medium' | 'good' | 'high';

/**
 * Compresses a PDF according to the Save & Compress modal settings:
 * Document Quality ('low' | 'medium' | 'good' | 'high'), High Compression switch,
 * and target PDF Page Size ('A4' | 'Letter' | 'Legal' | 'Fit').
 */
export async function compressPdfWithOptions(
  pdfBytes: Uint8Array,
  options: {
    quality: SaveCompressionQuality;
    highCompression: boolean;
    pageSize?: 'A4' | 'Letter' | 'Legal' | 'Fit';
  }
): Promise<Uint8Array> {
  const { quality, highCompression, pageSize = 'A4' } = options;

  // If High quality without High Compression and standard A4, ensure clean unencrypted save
  if (quality === 'high' && !highCompression && pageSize === 'A4') {
    const cleanBytes = await ensureUnencryptedPdfBytes(pdfBytes);
    const doc = await PDFDocument.load(cleanBytes, { ignoreEncryption: true });
    return doc.save({ useObjectStreams: false });
  }

  const qualityMap: Record<
    SaveCompressionQuality,
    { scale: number; jpegQuality: number }
  > = {
    low: {
      scale: highCompression ? 0.65 : 0.78,
      jpegQuality: highCompression ? 0.32 : 0.42,
    },
    medium: {
      scale: highCompression ? 0.85 : 1.0,
      jpegQuality: highCompression ? 0.48 : 0.58,
    },
    good: {
      scale: highCompression ? 1.05 : 1.22,
      jpegQuality: highCompression ? 0.62 : 0.74,
    },
    high: {
      scale: highCompression ? 1.15 : 1.45,
      jpegQuality: highCompression ? 0.72 : 0.88,
    },
  };

  const { scale, jpegQuality } = qualityMap[quality];
  const pageCount = await getPdfPageCount(pdfBytes);
  const compressedImages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const rendered = await renderPdfPage(
      pdfBytes,
      i,
      scale,
      'image/jpeg',
      jpegQuality
    );
    compressedImages.push(rendered.dataUrl);
  }

  return createPdfFromImages(compressedImages, {
    pageSize,
    marginPt: 0,
  });
}

/**
 * Renders all pages of a PDF (or takes rendered page images) and exports either
 * the first page JPEG or a vertically stitched Long Image JPEG as bytes.
 */
export async function exportPdfAsJpegBytes(
  pdfBytes: Uint8Array,
  options: {
    longImage: boolean;
    quality: SaveCompressionQuality;
    highCompression: boolean;
  }
): Promise<{ bytes: Uint8Array; extension: 'jpg' }> {
  const jpegQ =
    options.quality === 'low'
      ? 0.45
      : options.quality === 'medium'
        ? 0.65
        : options.quality === 'good'
          ? 0.8
          : 0.92;
  const finalQ = options.highCompression ? Math.max(0.35, jpegQ - 0.15) : jpegQ;
  const scale = options.highCompression ? 1.1 : 1.4;
  const pageCount = await getPdfPageCount(pdfBytes);

  if (!options.longImage || pageCount <= 1) {
    const first = await renderPdfPage(
      pdfBytes,
      1,
      scale,
      'image/jpeg',
      finalQ
    );
    const base64 = first.dataUrl.split(',')[1];
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return { bytes, extension: 'jpg' };
  }

  const loadedImgs: HTMLImageElement[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const rendered = await renderPdfPage(
      pdfBytes,
      i,
      scale,
      'image/jpeg',
      finalQ
    );
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = rendered.dataUrl;
    });
    loadedImgs.push(img);
  }

  const maxW = Math.max(...loadedImgs.map((img) => img.width), 600);
  const gap = 12;
  const totalH =
    loadedImgs.reduce(
      (acc, img) => acc + Math.round(img.height * (maxW / img.width)),
      0
    ) +
    gap * (loadedImgs.length - 1);

  const canvas = document.createElement('canvas');
  canvas.width = maxW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create canvas for Long Image export.');
  }
  ctx.fillStyle = '#F2EFF6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let curY = 0;
  for (const img of loadedImgs) {
    const drawH = Math.round(img.height * (maxW / img.width));
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, curY, maxW, drawH);
    ctx.drawImage(img, 0, curY, maxW, drawH);
    curY += drawH + gap;
  }

  const dataUrl = canvas.toDataURL('image/jpeg', finalQ);
  const base64 = dataUrl.split(',')[1];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { bytes, extension: 'jpg' };
}

/**
 * Sanitizes a filename so Android DownloadManager, iOS Safari, and desktop browsers
 * never fail with "Download error" due to special characters or excessive length.
 */
export function sanitizeDownloadFilename(
  filename: string,
  mimeType = 'application/pdf'
): string {
  const defaultExt =
    mimeType.includes('wordprocessingml') ||
    filename.toLowerCase().endsWith('.docx')
      ? 'docx'
      : mimeType.includes('msword') || filename.toLowerCase().endsWith('.doc')
        ? 'doc'
        : mimeType.includes('jpeg') || mimeType.includes('jpg')
          ? 'jpg'
          : mimeType.includes('png')
            ? 'png'
            : mimeType.includes('text')
              ? 'txt'
              : 'pdf';

  const trimmed = (filename || `Document.${defaultExt}`).trim();
  const lastDot = trimmed.lastIndexOf('.');
  const rawBase = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const rawExt =
    lastDot > 0
      ? trimmed.slice(lastDot + 1).replace(/[^a-zA-Z0-9]/g, '') || defaultExt
      : defaultExt;

  const cleanBase = rawBase
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 56);

  return `${cleanBase || 'Document'}.${rawExt.toLowerCase()}`;
}

/**
 * Returns an inline `data:application/pdf;base64,...` URI for `<a href={...} download={...}>`.
 * Unlike `/api/downloads/...` (which Android's external DownloadManager requests without the
 * iframe's partitioned auth cookies, causing the Cloud Run proxy to return an HTML login page
 * saved as `.pdf` that "cannot open"), and unlike `blob:` URLs (which fail across partitioned
 * iframes with "Download error"), an inline `data:` URI embeds the exact `%PDF-1.7` bytes
 * directly in the link so every browser decodes and saves a 100% valid, openable PDF file.
 */
export async function prepareServerDownloadUrl(
  bytes: Uint8Array,
  _filename: string,
  mimeType = 'application/pdf'
): Promise<string> {
  return bytesToDataUrl(bytes, mimeType);
}

/**
 * Triggers a synchronous, inline `data:<mimeType>;base64,...` download so the user gesture is
 * preserved and the exact binary file bytes are written directly to disk by any browser
 * without hitting Cloud Run auth proxies or iframe-partitioned `blob:` stores.
 */
export function downloadBytesAsFile(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/pdf'
): void {
  const cleanName = sanitizeDownloadFilename(filename, mimeType);
  const safeBytes = toCleanUint8Array(bytes);

  try {
    // For files up to 25 MB, use a synchronous inline base64 Data URI so the browser writes the exact bytes directly
    if (safeBytes.byteLength <= 25 * 1024 * 1024) {
      const dataUrl = bytesToDataUrl(safeBytes, mimeType);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = cleanName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
  } catch (err) {
    console.warn('Data URL download fallback to Blob URL:', err);
  }

  const blob = new Blob([safeBytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 600000);
}

/**
 * Opens the native mobile Share / Save sheet (Android / iOS) for a PDF or image file,
 * or falls back to `downloadBytesAsFile` if Web Share API for files is not supported.
 */
export async function shareOrDownloadBytesAsFile(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/pdf'
): Promise<void> {
  const cleanName = sanitizeDownloadFilename(filename, mimeType);
  const safeBytes = toCleanUint8Array(bytes);
  try {
    const file = new File([safeBytes as BlobPart], cleanName, {
      type: mimeType,
    });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: cleanName,
        files: [file],
      });
      return;
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return;
    }
  }
  downloadBytesAsFile(safeBytes, cleanName, mimeType);
}

export interface EmbeddedPdfImageInfo {
  key: string;
  pdfXObjectKey?: string;
  kind?: 'picture' | 'box';
  label?: string;
  isFullPageBackground?: boolean;
  width: number;
  height: number;
  x: number; // normalized 0..1 from left
  y: number; // normalized 0..1 from top
  normWidth: number; // normalized 0..1
  normHeight: number; // normalized 0..1
}

function multiplyTransformMatrices(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Inspects a 1-indexed PDF page using PDF.js operator list CTM tracking (and pdf-lib XObject metadata)
 * to return all painted pictures and rectangular boxes on the page with their exact normalized
 * bounding boxes (x, y, normWidth, normHeight) and underlying PDF XObject resource keys.
 * Sorted from largest area to smallest area so smaller pictures/boxes always render on top
 * of full-page scan backgrounds and can be individually clicked, manipulated, and removed.
 */
export async function getEmbeddedPdfImagesOnPage(
  pdfBytes: Uint8Array,
  pageNumber: number
): Promise<EmbeddedPdfImageInfo[]> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    if (pageNumber < 1 || pageNumber > pages.length) return [];

    const page = pages[pageNumber - 1];
    const { width: pageW, height: pageH } = page.getSize();

    // Collect XObject pixel dimensions & keys if present in page resources
    const xObjectDims: {
      key: string;
      width: number;
      height: number;
      matched?: boolean;
    }[] = [];
    const resources = page.node.Resources();
    if (resources) {
      const xObjectRef = resources.get(PDFName.of('XObject'));
      const xObjectDict = pdfDoc.context.lookupMaybe(xObjectRef, PDFDict);
      if (xObjectDict) {
        for (const [keyName, valObj] of xObjectDict.entries()) {
          const stream = pdfDoc.context.lookupMaybe(valObj, PDFStream);
          if (!stream) continue;
          const subtype = stream.dict.get(PDFName.of('Subtype'));
          if (subtype && subtype.toString() === '/Image') {
            const wObj = pdfDoc.context.lookupMaybe(
              stream.dict.get(PDFName.of('Width')),
              PDFNumber
            );
            const hObj = pdfDoc.context.lookupMaybe(
              stream.dict.get(PDFName.of('Height')),
              PDFNumber
            );
            xObjectDims.push({
              key: keyName.toString().replace(/^\//, ''),
              width: wObj ? wObj.asNumber() : 0,
              height: hObj ? hObj.asNumber() : 0,
              matched: false,
            });
          }
        }
      }
    }

    const detectedItems: EmbeddedPdfImageInfo[] = [];

    try {
      const dataCopy = new Uint8Array(pdfBytes);
      const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
      const jsPdf = await loadingTask.promise;
      try {
        const jsPage = await jsPdf.getPage(pageNumber);
        const opList = await jsPage.getOperatorList();

        const ctmStack: number[][] = [];
        let ctm = [1, 0, 0, 1, 0, 0];
        let picCount = 0;
        let boxCount = 0;

        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i];

          if (fn === pdfjsLib.OPS.save) {
            ctmStack.push([...ctm]);
          } else if (fn === pdfjsLib.OPS.restore) {
            ctm = ctmStack.pop() || [1, 0, 0, 1, 0, 0];
          } else if (
            fn === pdfjsLib.OPS.transform &&
            Array.isArray(args) &&
            args.length === 6
          ) {
            ctm = multiplyTransformMatrices(ctm, args as number[]);
          } else if (
            fn === pdfjsLib.OPS.paintImageXObject ||
            fn === pdfjsLib.OPS.paintXObject ||
            fn === pdfjsLib.OPS.paintInlineImageXObject
          ) {
            // Map unit square corners (0,0)-(1,1) through current CTM
            const x0 = ctm[4];
            const y0 = ctm[5];
            const x1 = ctm[0] + ctm[2] + ctm[4];
            const y1 = ctm[1] + ctm[3] + ctm[5];

            const minX = Math.min(x0, x1);
            const maxX = Math.max(x0, x1);
            const minY = Math.min(y0, y1);
            const maxY = Math.max(y0, y1);

            const normX = Math.max(0, Math.min(0.98, minX / pageW));
            const normY = Math.max(0, Math.min(0.98, 1 - maxY / pageH));
            const normW = Math.max(
              0.02,
              Math.min(1 - normX, (maxX - minX) / pageW)
            );
            const normH = Math.max(
              0.02,
              Math.min(1 - normY, (maxY - minY) / pageH)
            );

            // Match painted image with its PDF XObject resource by pixel dimensions first, then sequential order
            const opW =
              Array.isArray(args) && typeof args[1] === 'number' ? args[1] : 0;
            const opH =
              Array.isArray(args) && typeof args[2] === 'number' ? args[2] : 0;
            let matchedDim = xObjectDims.find(
              (d) =>
                !d.matched && opW > 0 && d.width === opW && d.height === opH
            );
            if (!matchedDim) {
              matchedDim =
                xObjectDims.find((d) => !d.matched) || xObjectDims[picCount];
            }
            if (matchedDim) {
              matchedDim.matched = true;
            }

            const isFullBg = normW >= 0.92 && normH >= 0.92;
            picCount++;

            detectedItems.push({
              key: `pic-p${pageNumber}-${picCount}`,
              pdfXObjectKey: matchedDim?.key,
              kind: 'picture',
              label: isFullBg
                ? `Page Background Scan #${picCount}`
                : `Picture #${picCount}`,
              isFullPageBackground: isFullBg,
              width: matchedDim?.width || opW || Math.round(normW * pageW),
              height: matchedDim?.height || opH || Math.round(normH * pageH),
              x: normX,
              y: normY,
              normWidth: normW,
              normHeight: normH,
            });
          } else if (
            fn === pdfjsLib.OPS.constructPath &&
            Array.isArray(args) &&
            args.length >= 3 &&
            args[2]
          ) {
            // args[2] in PDF.js constructPath is [minX, minY, maxX, maxY]
            const bounds = args[2] as ArrayLike<number>;
            if (bounds && bounds.length >= 4) {
              const rawMinX = bounds[0];
              const rawMinY = bounds[1];
              const rawMaxX = bounds[2];
              const rawMaxY = bounds[3];

              const p0x = ctm[0] * rawMinX + ctm[2] * rawMinY + ctm[4];
              const p0y = ctm[1] * rawMinX + ctm[3] * rawMinY + ctm[5];
              const p1x = ctm[0] * rawMaxX + ctm[2] * rawMaxY + ctm[4];
              const p1y = ctm[1] * rawMaxX + ctm[3] * rawMaxY + ctm[5];

              const minX = Math.min(p0x, p1x);
              const maxX = Math.max(p0x, p1x);
              const minY = Math.min(p0y, p1y);
              const maxY = Math.max(p0y, p1y);

              const normX = Math.max(0, Math.min(0.98, minX / pageW));
              const normY = Math.max(0, Math.min(0.98, 1 - maxY / pageH));
              const normW = Math.min(1 - normX, (maxX - minX) / pageW);
              const normH = Math.min(1 - normY, (maxY - minY) / pageH);

              // Include meaningful boxes/frames (skip thin lines < 1.5% height/width and full-page backgrounds)
              if (
                normW >= 0.035 &&
                normH >= 0.02 &&
                !(normW >= 0.92 && normH >= 0.92)
              ) {
                const duplicate = detectedItems.some(
                  (d) =>
                    Math.abs(d.x - normX) < 0.01 &&
                    Math.abs(d.y - normY) < 0.01 &&
                    Math.abs(d.normWidth - normW) < 0.01 &&
                    Math.abs(d.normHeight - normH) < 0.01
                );
                if (!duplicate) {
                  boxCount++;
                  detectedItems.push({
                    key: `box-p${pageNumber}-${boxCount}`,
                    kind: 'box',
                    label: `Box #${boxCount}`,
                    isFullPageBackground: false,
                    width: Math.round(normW * pageW),
                    height: Math.round(normH * pageH),
                    x: normX,
                    y: normY,
                    normWidth: normW,
                    normHeight: normH,
                  });
                }
              }
            }
          }
        }
      } finally {
        await loadingTask.destroy();
      }
    } catch {
      // Fallback if operator list fails
    }

    // If xObjectDims had images not caught by operator list, add them as fallback
    if (detectedItems.filter((d) => d.kind === 'picture').length === 0) {
      xObjectDims.forEach((dim, idx) => {
        detectedItems.push({
          key: `pic-p${pageNumber}-${idx + 1}`,
          pdfXObjectKey: dim.key,
          kind: 'picture',
          label: `Picture #${idx + 1}`,
          isFullPageBackground: false,
          width: dim.width,
          height: dim.height,
          x: 0.15 + (idx % 3) * 0.08,
          y: 0.15 + (idx % 3) * 0.08,
          normWidth: 0.35,
          normHeight: 0.25,
        });
      });
    }

    // Filter out full-page background scans (>= 92% of page) when smaller pictures/boxes exist on the page
    const nonFullPageItems = detectedItems.filter(
      (item) => !item.isFullPageBackground
    );
    const finalItems =
      nonFullPageItems.length > 0 ? nonFullPageItems : detectedItems;

    // Sort from largest area to smallest area so smaller pictures/boxes are rendered later in DOM (on top)
    finalItems.sort(
      (a, b) => b.normWidth * b.normHeight - a.normWidth * a.normHeight
    );

    return finalItems;
  } catch (err) {
    console.error('Error inspecting embedded PDF images:', err);
    return [];
  }
}

/**
 * Removes a specific embedded Image XObject (by pdfXObjectKey) from a 1-indexed PDF page
 * by replacing its XObject dictionary entry with an empty transparent Form XObject.
 * When the page is re-rendered, the removed image disappears completely and the true
 * original PDF background underneath (text, lines, colors, or page scan) is preserved!
 */
export async function removeEmbeddedPdfImageFromPage(
  pdfBytes: Uint8Array,
  pageNumber: number,
  targetXObjectKey?: string
): Promise<{ pdfBytes: Uint8Array; removedCount: number }> {
  const cleanInput = toCleanUint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(cleanInput, { ignoreEncryption: true });
  if (pdfDoc.isEncrypted) {
    return { pdfBytes: cleanInput, removedCount: 0 };
  }
  const pages = pdfDoc.getPages();
  if (pageNumber < 1 || pageNumber > pages.length) {
    return { pdfBytes: cleanInput, removedCount: 0 };
  }

  const page = pages[pageNumber - 1];
  const resources = page.node.Resources();
  if (!resources) {
    return { pdfBytes: cleanInput, removedCount: 0 };
  }

  const xObjectRef = resources.get(PDFName.of('XObject'));
  const xObjectDict = pdfDoc.context.lookupMaybe(xObjectRef, PDFDict);
  if (!xObjectDict) {
    return { pdfBytes: cleanInput, removedCount: 0 };
  }

  // Create a valid empty Form XObject replacement so `/<Name> Do` operators in the page stream become transparent no-ops
  const emptyFormStream = pdfDoc.context.formXObject([], {
    BBox: [0, 0, 0, 0],
  });
  const emptyFormRef = pdfDoc.context.register(emptyFormStream);

  let removedCount = 0;
  for (const [keyName, valObj] of xObjectDict.entries()) {
    const cleanKey = keyName.toString().replace(/^\//, '');
    if (targetXObjectKey && cleanKey !== targetXObjectKey) continue;

    const stream = pdfDoc.context.lookupMaybe(valObj, PDFStream);
    if (!stream) continue;

    const subtype = stream.dict.get(PDFName.of('Subtype'));
    if (subtype && subtype.toString() === '/Image') {
      xObjectDict.set(keyName, emptyFormRef);
      removedCount++;
    }
  }

  if (removedCount === 0) {
    return { pdfBytes: cleanInput, removedCount: 0 };
  }

  const saved = await pdfDoc.save({ useObjectStreams: false });
  return { pdfBytes: saved, removedCount };
}

/**
 * Crops a normalized rectangle (0..1) from a rendered page Data URL so an embedded
 * PDF picture can be promoted into a live movable/resizable image element.
 */
export async function cropRegionFromDataUrl(
  sourceDataUrl: string,
  normRect: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sx = Math.max(0, Math.round(normRect.x * img.width));
      const sy = Math.max(0, Math.round(normRect.y * img.height));
      const sw = Math.max(
        10,
        Math.min(img.width - sx, Math.round(normRect.width * img.width))
      );
      const sh = Math.max(
        10,
        Math.min(img.height - sy, Math.round(normRect.height * img.height))
      );

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}

/**
 * Reconstructs the natural background underneath a removed or moved object (`normRect`)
 * by sampling the perimeter pixels just outside the 4 edges (top, bottom, left, right),
 * filtering out dark text/line ink strokes so only the local paper/background tone is used,
 * and smoothly interpolating the background across the rectangle.
 */
export async function reconstructBackgroundPatchFromDataUrl(
  sourceDataUrl: string,
  normRect: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = img.width;
      fullCanvas.height = img.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) {
        resolve('');
        return;
      }
      fullCtx.drawImage(img, 0, 0);

      const sx = Math.max(0, Math.round(normRect.x * img.width));
      const sy = Math.max(0, Math.round(normRect.y * img.height));
      const sw = Math.max(
        4,
        Math.min(img.width - sx, Math.round(normRect.width * img.width))
      );
      const sh = Math.max(
        4,
        Math.min(img.height - sy, Math.round(normRect.height * img.height))
      );

      // Sample a small band outside the bounding box
      const margin = 6;
      const bx0 = Math.max(0, sx - margin);
      const by0 = Math.max(0, sy - margin);
      const bx1 = Math.min(img.width - 1, sx + sw + margin - 1);
      const by1 = Math.min(img.height - 1, sy + sh + margin - 1);
      const bw = Math.max(1, bx1 - bx0 + 1);
      const bh = Math.max(1, by1 - by0 + 1);

      const imgData = fullCtx.getImageData(bx0, by0, bw, bh).data;

      const getPixel = (gx: number, gy: number): [number, number, number] => {
        const cx = Math.max(bx0, Math.min(bx1, gx)) - bx0;
        const cy = Math.max(by0, Math.min(by1, gy)) - by0;
        const idx = (cy * bw + cx) * 4;
        return [imgData[idx], imgData[idx + 1], imgData[idx + 2]];
      };

      // Pick the local background color from a small sample set by choosing the 75th-percentile brightest pixel
      // (this ignores dark ink/border strokes and captures the true paper/background color)
      const pickBackgroundTone = (
        samples: [number, number, number][]
      ): [number, number, number] => {
        if (samples.length === 0) return [255, 255, 255];
        const sorted = [...samples].sort(
          (a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2])
        );
        const pickIdx = Math.min(
          sorted.length - 1,
          Math.floor(sorted.length * 0.75)
        );
        return sorted[pickIdx];
      };

      const topEdge: [number, number, number][] = new Array(sw);
      const bottomEdge: [number, number, number][] = new Array(sw);
      for (let x = 0; x < sw; x++) {
        const gx = sx + x;
        const tSamples: [number, number, number][] = [];
        const bSamples: [number, number, number][] = [];
        for (let d = 2; d <= margin; d++) {
          for (let dx = -2; dx <= 2; dx += 2) {
            tSamples.push(getPixel(gx + dx, sy - d));
            bSamples.push(getPixel(gx + dx, sy + sh - 1 + d));
          }
        }
        topEdge[x] = pickBackgroundTone(tSamples);
        bottomEdge[x] = pickBackgroundTone(bSamples);
      }

      const leftEdge: [number, number, number][] = new Array(sh);
      const rightEdge: [number, number, number][] = new Array(sh);
      for (let y = 0; y < sh; y++) {
        const gy = sy + y;
        const lSamples: [number, number, number][] = [];
        const rSamples: [number, number, number][] = [];
        for (let d = 2; d <= margin; d++) {
          for (let dy = -2; dy <= 2; dy += 2) {
            lSamples.push(getPixel(sx - d, gy + dy));
            rSamples.push(getPixel(sx + sw - 1 + d, gy + dy));
          }
        }
        leftEdge[y] = pickBackgroundTone(lSamples);
        rightEdge[y] = pickBackgroundTone(rSamples);
      }

      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = sw;
      patchCanvas.height = sh;
      const patchCtx = patchCanvas.getContext('2d');
      if (!patchCtx) {
        resolve('');
        return;
      }

      const outImage = patchCtx.createImageData(sw, sh);
      const outData = outImage.data;

      for (let y = 0; y < sh; y++) {
        const v = sh > 1 ? y / (sh - 1) : 0.5;
        const wyTop = 1 / Math.max(0.02, v);
        const wyBot = 1 / Math.max(0.02, 1 - v);
        const lCol = leftEdge[y];
        const rCol = rightEdge[y];

        for (let x = 0; x < sw; x++) {
          const u = sw > 1 ? x / (sw - 1) : 0.5;
          const wxLeft = 1 / Math.max(0.02, u);
          const wxRight = 1 / Math.max(0.02, 1 - u);
          const wSum = wyTop + wyBot + wxLeft + wxRight;

          const tCol = topEdge[x];
          const bCol = bottomEdge[x];

          const r = Math.round(
            (tCol[0] * wyTop +
              bCol[0] * wyBot +
              lCol[0] * wxLeft +
              rCol[0] * wxRight) /
              wSum
          );
          const g = Math.round(
            (tCol[1] * wyTop +
              bCol[1] * wyBot +
              lCol[1] * wxLeft +
              rCol[1] * wxRight) /
              wSum
          );
          const b = Math.round(
            (tCol[2] * wyTop +
              bCol[2] * wyBot +
              lCol[2] * wxLeft +
              rCol[2] * wxRight) /
              wSum
          );

          const pIdx = (y * sw + x) * 4;
          outData[pIdx] = r;
          outData[pIdx + 1] = g;
          outData[pIdx + 2] = b;
          outData[pIdx + 3] = 255;
        }
      }

      patchCtx.putImageData(outImage, 0, 0);
      resolve(patchCanvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve('');
    img.src = sourceDataUrl;
  });
}

export interface PictureTextBoxOverlay {
  id: string;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
  text: string;
  textColor: string;
  boxBgColor: string; // 'transparent' or hex color
  boxBorderColor?: string; // 'transparent' or hex color
  fontSize: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
}

/**
 * Renders one or more colored text boxes directly onto a converted PDF picture (PNG/JPG Data URL)
 * so the user can download the annotated picture or rebuild a PDF from the edited pictures.
 */
export async function compositeTextBoxesOntoImageDataUrl(
  baseImageDataUrl: string,
  textBoxes: PictureTextBoxOverlay[],
  format: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.94
): Promise<string> {
  if (!textBoxes || textBoxes.length === 0) return baseImageDataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(baseImageDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);

      // Scale factor relative to a standard 600pt PDF page width
      const scaleFactor = img.width / 595.28;

      for (const box of textBoxes) {
        if (!box.text || !box.text.trim()) continue;
        const bx = box.x * img.width;
        const by = box.y * img.height;
        const bw = box.width * img.width;
        const bh = box.height * img.height;

        if (box.boxBgColor && box.boxBgColor !== 'transparent') {
          ctx.fillStyle = box.boxBgColor;
          ctx.fillRect(bx, by, bw, bh);
        }

        if (box.boxBorderColor && box.boxBorderColor !== 'transparent') {
          ctx.strokeStyle = box.boxBorderColor;
          ctx.lineWidth = Math.max(1.5, 1.5 * scaleFactor);
          ctx.strokeRect(bx, by, bw, bh);
        }

        const pxFontSize = Math.max(
          10,
          Math.round((box.fontSize || 16) * scaleFactor)
        );
        const styleStr = box.fontStyle === 'italic' ? 'italic ' : '';
        const weightStr = box.fontWeight === 'bold' ? 'bold ' : '';
        ctx.font = `${styleStr}${weightStr}${pxFontSize}px Inter, Helvetica, Arial, sans-serif`;
        ctx.fillStyle = box.textColor || '#FFFFFF';
        ctx.textBaseline = 'top';

        const padding = Math.round(5 * scaleFactor);
        const lines = box.text.split('\n');
        lines.forEach((line, idx) => {
          ctx.fillText(
            line,
            bx + padding,
            by + padding + idx * Math.round(pxFontSize * 1.25)
          );
        });
      }

      resolve(canvas.toDataURL(format, quality));
    };
    img.onerror = () => resolve(baseImageDataUrl);
    img.src = baseImageDataUrl;
  });
}

/**
 * Removes watermarks across all pages of a PDF while preserving document words,
 * anti-aliased font quality, and original document colors.
 *
 * Uses a 2-Pass Pipeline on multi-page PDFs:
 * - Pass 1 (Multi-Page Repeating Watermark Consensus): Samples pages to identify
 *   static/repeating watermark pixels that appear at identical normalized (x, y)
 *   positions with matching RGB/luminance across pages (such as diagonal text stamps,
 *   background emblems, or header/footer watermarks), while ignoring dynamic document words.
 * - Pass 2 (High-DPI Color-Preserving & Text-Preserving Unmixing): Renders each page at
 *   high resolution (scale 2.0) and runs `processWatermarkRemovalOnImageData` to unmix
 *   watermarks from behind text and restore pure #FFFFFF paper while keeping colored
 *   headings, signatures, diagrams, and crisp black words intact.
 */
export async function removeWatermarksFromPdf(
  pdfBytes: Uint8Array,
  options: {
    preserveColor?: boolean;
    strength?: number; // -40 to +60, default 0
    targetWatermarkRgb?: [number, number, number] | null;
    removeSolidBanners?: boolean;
    onProgress?: (currentPage: number, totalPages: number) => void;
  } = {}
): Promise<Uint8Array> {
  const { processWatermarkRemovalOnImageData } = await import(
    './imageProcessingService'
  );
  const preserveColor = options.preserveColor ?? true;
  const strength = options.strength ?? 0;

  const cleanBytes = toCleanUint8Array(pdfBytes);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(cleanBytes) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const outPdf = await PDFDocument.create();

  try {
    // Pass 1: If multi-page PDF (2+ pages), build a normalized consensus grid (360x480)
    // across up to 4 pages to detect repeating static watermark regions.
    const gridW = 360;
    const gridH = 480;
    let repeatingWatermarkGrid: Uint8Array | null = null;

    if (totalPages >= 2) {
      const sampleCount = Math.min(totalPages, 4);
      const sampleGrids: Uint8Array[] = [];

      for (let s = 1; s <= sampleCount; s++) {
        const page = await pdf.getPage(s);
        const vp = page.getViewport({ scale: 0.65 });
        const c = document.createElement('canvas');
        c.width = gridW;
        c.height = gridH;
        const cCtx = c.getContext('2d');
        if (cCtx) {
          cCtx.fillStyle = '#FFFFFF';
          cCtx.fillRect(0, 0, gridW, gridH);
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = Math.max(1, Math.floor(vp.width));
          tempCanvas.height = Math.max(1, Math.floor(vp.height));
          const tCtx = tempCanvas.getContext('2d');
          if (tCtx) {
            tCtx.fillStyle = '#FFFFFF';
            tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            await page.render({
              canvasContext: tCtx,
              viewport: vp,
              canvas: tempCanvas,
            }).promise;
            cCtx.drawImage(tempCanvas, 0, 0, gridW, gridH);
          }
          const imgD = cCtx.getImageData(0, 0, gridW, gridH).data;
          const lumGrid = new Uint8Array(gridW * gridH);
          for (let i = 0; i < gridW * gridH; i++) {
            const idx = i * 4;
            lumGrid[i] = Math.round(
              0.299 * imgD[idx] + 0.587 * imgD[idx + 1] + 0.114 * imgD[idx + 2]
            );
          }
          sampleGrids.push(lumGrid);
        }
      }

      if (sampleGrids.length >= 2) {
        repeatingWatermarkGrid = new Uint8Array(gridW * gridH);
        for (let i = 0; i < gridW * gridH; i++) {
          const baseL = sampleGrids[0][i];
          // A repeating watermark pixel is non-white (< 242) and not deep black ink (> 95),
          // and stays within ±14 luminance across all sampled pages
          if (baseL > 95 && baseL < 242) {
            let matchesAll = true;
            for (let k = 1; k < sampleGrids.length; k++) {
              if (Math.abs(sampleGrids[k][i] - baseL) > 14) {
                matchesAll = false;
                break;
              }
            }
            if (matchesAll) {
              repeatingWatermarkGrid[i] = 1;
            }
          }
        }
      }
    }

    // Pass 2: High-DPI render + Color-Preserving & Text-Preserving Watermark Removal per page
    const renderScale = totalPages > 20 ? 1.65 : 2.0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      options.onProgress?.(pageNum, totalPages);
      const page = await pdf.getPage(pageNum);
      const origViewport = page.getViewport({ scale: 1.0 });
      const hiViewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const w = Math.max(1, Math.floor(hiViewport.width));
      const h = Math.max(1, Math.floor(hiViewport.height));
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);

      await page.render({
        canvasContext: ctx,
        viewport: hiViewport,
        canvas,
      }).promise;

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // If multi-page repeating watermark consensus detected static watermark coordinates,
      // gently lift those non-dark-ink repeating watermark pixels before unmixing
      if (repeatingWatermarkGrid) {
        for (let y = 0; y < h; y++) {
          const gy = Math.min(gridH - 1, Math.floor((y / h) * gridH));
          const rowOff = y * w;
          for (let x = 0; x < w; x++) {
            const gx = Math.min(gridW - 1, Math.floor((x / w) * gridW));
            if (repeatingWatermarkGrid[gy * gridW + gx] === 1) {
              const idx = (rowOff + x) * 4;
              const lum =
                0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
              // Only lift if this specific high-res pixel is not a sharp dark character core (lum > 105)
              if (lum > 105 && lum < 245) {
                data[idx] = Math.min(255, Math.round(data[idx] + (255 - data[idx]) * 0.45));
                data[idx + 1] = Math.min(
                  255,
                  Math.round(data[idx + 1] + (255 - data[idx + 1]) * 0.45)
                );
                data[idx + 2] = Math.min(
                  255,
                  Math.round(data[idx + 2] + (255 - data[idx + 2]) * 0.45)
                );
              }
            }
          }
        }
      }

      processWatermarkRemovalOnImageData(data, w, h, {
        preserveColor,
        strength,
        targetWatermarkRgb: options.targetWatermarkRgb ?? null,
        removeSolidBanners: options.removeSolidBanners ?? !preserveColor,
      });

      ctx.putImageData(imageData, 0, 0);

      const cleanJpegUrl = canvas.toDataURL('image/jpeg', 0.96);
      const b64 = cleanJpegUrl.split(',')[1];
      const jpgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const embeddedJpg = await outPdf.embedJpg(jpgBytes);

      const outPage = outPdf.addPage([origViewport.width, origViewport.height]);
      outPage.drawImage(embeddedJpg, {
        x: 0,
        y: 0,
        width: origViewport.width,
        height: origViewport.height,
      });

      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await loadingTask.destroy();
  }

  return await outPdf.save();
}


