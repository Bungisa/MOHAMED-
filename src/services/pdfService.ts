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
  scale = 1.2,
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
          0.88
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
 * Creates a multi-page PDF document from an array of image Data URLs.
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

  return pdfDoc.save();
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
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
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

  return pdfDoc.save();
}

/**
 * Merges multiple PDF byte arrays into a single unified PDF document.
 */
export async function mergePdfs(pdfByteArrays: Uint8Array[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const bytes of pdfByteArrays) {
    const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const copiedPages = await mergedPdf.copyPages(
      srcDoc,
      srcDoc.getPageIndices()
    );
    copiedPages.forEach((p) => mergedPdf.addPage(p));
  }

  return mergedPdf.save();
}

/**
 * Extracts a 1-indexed array of page numbers from a PDF into a new PDF.
 */
export async function extractPdfPages(
  pdfBytes: Uint8Array,
  pageNumbers: number[]
): Promise<Uint8Array> {
  try {
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
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
    return await newDoc.save();
  } catch (err) {
    console.warn(
      'Direct copyPages failed on PDF; using high-resolution page render fallback for Split PDF:',
      err
    );
    const totalCount = await getPdfPageCount(pdfBytes);
    const validPages = pageNumbers.filter((n) => n >= 1 && n <= totalCount);
    const targetPages = validPages.length > 0 ? validPages : [1];
    const pageImages: string[] = [];
    for (const pNum of targetPages) {
      const rendered = await renderPdfPage(
        pdfBytes,
        pNum,
        1.4,
        'image/jpeg',
        0.9
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
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();

  for (const spec of pageSpecs) {
    if (spec.isBlank) {
      outDoc.addPage([595.28, 841.89]);
    } else if (
      spec.sourcePageNumber &&
      spec.sourcePageNumber >= 1 &&
      spec.sourcePageNumber <= srcDoc.getPageCount()
    ) {
      const [copiedPage] = await outDoc.copyPages(srcDoc, [
        spec.sourcePageNumber - 1,
      ]);
      if (spec.addRotationDeg) {
        const currentRot = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees((currentRot + spec.addRotationDeg) % 360));
      }
      outDoc.addPage(copiedPage);
    }
  }

  return outDoc.save();
}

/**
 * Compresses a PDF by either optimizing object streams ('low') or
 * rasterizing pages at controlled resolution & JPEG quality ('medium' | 'extreme').
 */
export async function compressPdfDocument(
  pdfBytes: Uint8Array,
  level: 'low' | 'medium' | 'extreme'
): Promise<Uint8Array> {
  if (level === 'low') {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return doc.save({ useObjectStreams: true });
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

  // If High quality without High Compression and standard A4, optimize object streams first
  if (quality === 'high' && !highCompression && pageSize === 'A4') {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return doc.save({ useObjectStreams: true });
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
 * Triggers a clean browser file download for a Uint8Array or Blob.
 */
export function downloadBytesAsFile(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/pdf'
): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
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
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  if (pageNumber < 1 || pageNumber > pages.length) {
    return { pdfBytes, removedCount: 0 };
  }

  const page = pages[pageNumber - 1];
  const resources = page.node.Resources();
  if (!resources) {
    return { pdfBytes, removedCount: 0 };
  }

  const xObjectRef = resources.get(PDFName.of('XObject'));
  const xObjectDict = pdfDoc.context.lookupMaybe(xObjectRef, PDFDict);
  if (!xObjectDict) {
    return { pdfBytes, removedCount: 0 };
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
    return { pdfBytes, removedCount: 0 };
  }

  const saved = await pdfDoc.save();
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


