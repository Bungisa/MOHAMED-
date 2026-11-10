import mammoth from 'mammoth';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  PageBreak,
  AlignmentType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { renderPdfPage, getPdfPageCount } from './pdfService';

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface WordContentBlock {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'table' | 'image';
  text?: string;
  bold?: boolean;
  italic?: boolean;
  rows?: string[][];
  imageDataUrl?: string;
}

export interface WordToPdfOptions {
  pageSize: 'A4' | 'Letter' | 'Legal';
  fontFamily: 'helvetica' | 'times' | 'courier';
  baseFontSize: number; // e.g. 11 or 12
  lineSpacing: number; // e.g. 1.35
  addPageNumbers: boolean;
}

export type PdfToWordMode = 'editable' | 'hybrid' | 'visual';

export interface PdfPageWordContent {
  pageNumber: number;
  title?: string;
  paragraphs: {
    text: string;
    isHeading?: boolean;
    fontSize?: number;
  }[];
  imageDataUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Normalizes Unicode characters that standard PDF WinAnsi fonts cannot encode
 * (such as smart quotes, em-dashes, bullets, non-breaking spaces, math symbols)
 * into clean ASCII/WinAnsi equivalents so `pdf-lib` never throws an encoding error.
 */
function sanitizeWinAnsiText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF]/g, '* ')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2260/g, '!=')
    .replace(/\u00D7/g, 'x')
    .replace(/\u00F7/g, '/')
    // Strip any remaining characters outside printable Latin-1 / WinAnsi range
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

/**
 * Parses an uploaded Word file (.docx, .doc, .rtf, .txt) into structured blocks
 * and plain editable text for preview and PDF generation.
 */
export async function parseUploadedWordFile(file: File): Promise<{
  blocks: WordContentBlock[];
  plainText: string;
  htmlPreview: string;
}> {
  const lowerName = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  // 1. Standard .docx OpenXML parsing via mammoth
  if (
    lowerName.endsWith('.docx') ||
    file.type.includes('wordprocessingml') ||
    new Uint8Array(buf.slice(0, 2)).join(',') === '80,75' // PK zip signature
  ) {
    try {
      const htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      const rawTextResult = await mammoth.extractRawText({ arrayBuffer: buf });
      const html = htmlResult.value || '';
      const blocks = parseHtmlIntoWordBlocks(html);
      const plainText =
        rawTextResult.value?.trim() ||
        blocks
          .map((b) =>
            b.type === 'table' && b.rows
              ? b.rows.map((r) => r.join(' | ')).join('\n')
              : b.text || ''
          )
          .filter(Boolean)
          .join('\n\n');

      if (blocks.length > 0 || plainText.length > 0) {
        return {
          blocks:
            blocks.length > 0
              ? blocks
              : plainTextToWordBlocks(plainText || 'Empty Word Document'),
          plainText,
          htmlPreview: html,
        };
      }
    } catch (err) {
      console.warn('Mammoth .docx parse fallback to text extraction:', err);
    }
  }

  // 2. Fallback for .txt, .rtf, or legacy .doc files
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let rawStr = decoder.decode(buf);

  if (lowerName.endsWith('.rtf') || rawStr.startsWith('{\\rtf')) {
    // Strip RTF control words and groups
    rawStr = rawStr
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\line/g, '\n')
      .replace(/\\tab/g, '    ')
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
      .replace(/[{}]/g, '');
  } else if (lowerName.endsWith('.doc')) {
    // Extract readable text runs from legacy binary .doc
    const matches = rawStr.match(/[\x20-\x7E\n\r\t]{4,}/g);
    if (matches && matches.length > 0) {
      rawStr = matches
        .filter(
          (m) =>
            !m.includes('Microsoft') &&
            !m.includes('Word.Document') &&
            !m.includes('Normal.dot') &&
            !m.includes('Times New Roman')
        )
        .join('\n');
    }
  }

  const cleanText = rawStr.replace(/\r\n/g, '\n').trim();
  const blocks = plainTextToWordBlocks(
    cleanText || `Document imported from ${file.name}`
  );
  return {
    blocks,
    plainText: cleanText,
    htmlPreview: '',
  };
}

function parseHtmlIntoWordBlocks(html: string): WordContentBlock[] {
  if (!html || !html.trim()) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: WordContentBlock[] = [];

  const walkNode = (node: Element) => {
    const tag = node.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const text = (node.textContent || '').trim();
      if (text) {
        blocks.push({
          type: tag as 'h1' | 'h2' | 'h3',
          text,
          bold: true,
        });
      }
      return;
    }

    if (tag === 'table') {
      const rows: string[][] = [];
      const trList = node.querySelectorAll('tr');
      trList.forEach((tr) => {
        const rowCells: string[] = [];
        tr.querySelectorAll('th, td').forEach((cell) => {
          rowCells.push((cell.textContent || '').trim().replace(/\s+/g, ' '));
        });
        if (rowCells.some((c) => c.length > 0)) {
          rows.push(rowCells);
        }
      });
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows });
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      node.querySelectorAll(':scope > li').forEach((li, idx) => {
        const text = (li.textContent || '').trim();
        if (text) {
          const prefix = tag === 'ol' ? `${idx + 1}. ` : '* ';
          blocks.push({
            type: 'li',
            text: `${prefix}${text}`,
          });
        }
      });
      return;
    }

    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (src.startsWith('data:image/')) {
        blocks.push({ type: 'image', imageDataUrl: src });
      }
      return;
    }

    if (tag === 'p') {
      // Check for embedded images inside paragraph
      node.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          blocks.push({ type: 'image', imageDataUrl: src });
        }
      });

      const text = (node.textContent || '').trim();
      if (text) {
        const hasStrong =
          node.querySelector('strong, b') !== null &&
          (node.querySelector('strong, b')?.textContent || '').trim().length >=
            text.length * 0.8;
        const hasEm =
          node.querySelector('em, i') !== null &&
          (node.querySelector('em, i')?.textContent || '').trim().length >=
            text.length * 0.8;
        blocks.push({
          type: 'p',
          text,
          bold: hasStrong,
          italic: hasEm,
        });
      }
      return;
    }

    // Recurse into container tags (div, section, body, etc.)
    Array.from(node.children).forEach((child) => walkNode(child));
  };

  Array.from(doc.body.children).forEach((child) => walkNode(child));
  return blocks;
}

export function plainTextToWordBlocks(plainText: string): WordContentBlock[] {
  const lines = plainText.replace(/\r\n/g, '\n').split('\n');
  const blocks: WordContentBlock[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Detect markdown or all-caps short headings
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2).trim(), bold: true });
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim(), bold: true });
    } else if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim(), bold: true });
    } else if (
      line.length <= 70 &&
      line === line.toUpperCase() &&
      /[A-Z]/.test(line) &&
      !line.endsWith('.')
    ) {
      blocks.push({ type: 'h2', text: line, bold: true });
    } else if (/^(\*|-|\u2022|\d+\.)\s+/.test(line)) {
      blocks.push({ type: 'li', text: line });
    } else {
      blocks.push({ type: 'p', text: line });
    }
  }

  return blocks;
}

/**
 * Wraps a single paragraph string into lines that fit within `maxWidth` points.
 */
function wrapTextToLines(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const clean = sanitizeWinAnsiText(text);
  const paragraphs = clean.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const candidate = `${currentLine} ${word}`;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Generates a high-resolution, multi-page PDF document from structured Word blocks
 * (or edited text), preserving headings, paragraphs, bullet lists, tables, and images.
 */
export async function generatePdfFromWordBlocks(
  blocks: WordContentBlock[],
  options: WordToPdfOptions
): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  const pdfDoc = await PDFDocument.create();

  const fontPair =
    options.fontFamily === 'times'
      ? {
          regular: StandardFonts.TimesRoman,
          bold: StandardFonts.TimesRomanBold,
          italic: StandardFonts.TimesRomanItalic,
        }
      : options.fontFamily === 'courier'
        ? {
            regular: StandardFonts.Courier,
            bold: StandardFonts.CourierBold,
            italic: StandardFonts.CourierOblique,
          }
        : {
            regular: StandardFonts.Helvetica,
            bold: StandardFonts.HelveticaBold,
            italic: StandardFonts.HelveticaOblique,
          };

  const fontRegular = await pdfDoc.embedFont(fontPair.regular);
  const fontBold = await pdfDoc.embedFont(fontPair.bold);
  const fontItalic = await pdfDoc.embedFont(fontPair.italic);

  const pageDimensions: [number, number] =
    options.pageSize === 'Letter'
      ? [612, 792]
      : options.pageSize === 'Legal'
        ? [612, 1008]
        : [595.28, 841.89]; // A4

  const [pageW, pageH] = pageDimensions;
  const marginX = 52;
  const marginTop = 56;
  const marginBottom = 56;
  const contentWidth = pageW - marginX * 2;

  let currentPage = pdfDoc.addPage([pageW, pageH]);
  let cursorY = pageH - marginTop;

  const ensureVerticalSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight < marginBottom) {
      currentPage = pdfDoc.addPage([pageW, pageH]);
      cursorY = pageH - marginTop;
    }
  };

  for (const block of blocks) {
    if (block.type === 'image' && block.imageDataUrl) {
      try {
        const isPng = block.imageDataUrl.startsWith('data:image/png');
        const isJpg =
          block.imageDataUrl.startsWith('data:image/jpeg') ||
          block.imageDataUrl.startsWith('data:image/jpg');
        if (isPng || isJpg) {
          const base64 = block.imageDataUrl.split(',')[1];
          const imgBytes = Uint8Array.from(atob(base64), (c) =>
            c.charCodeAt(0)
          );
          const embedded = isPng
            ? await pdfDoc.embedPng(imgBytes)
            : await pdfDoc.embedJpg(imgBytes);
          const maxImgW = contentWidth * 0.9;
          const maxImgH = (pageH - marginTop - marginBottom) * 0.55;
          const scale = Math.min(
            1,
            maxImgW / Math.max(1, embedded.width),
            maxImgH / Math.max(1, embedded.height)
          );
          const drawW = embedded.width * scale;
          const drawH = embedded.height * scale;

          ensureVerticalSpace(drawH + 16);
          currentPage.drawImage(embedded, {
            x: marginX,
            y: cursorY - drawH,
            width: drawW,
            height: drawH,
          });
          cursorY -= drawH + 16;
        }
      } catch {
        // Ignore unsupported embedded image formats
      }
      continue;
    }

    if (block.type === 'table' && block.rows && block.rows.length > 0) {
      const colCount = Math.max(...block.rows.map((r) => r.length), 1);
      const colWidth = contentWidth / colCount;
      const cellFontSize = Math.max(9, options.baseFontSize - 1.5);
      const cellPadding = 5;

      for (let rIdx = 0; rIdx < block.rows.length; rIdx++) {
        const row = block.rows[rIdx];
        const isHeader = rIdx === 0;
        const cellFont = isHeader ? fontBold : fontRegular;

        // Wrap each cell and determine row height
        const wrappedCells = Array.from({ length: colCount }, (_, cIdx) =>
          wrapTextToLines(
            row[cIdx] || '',
            cellFont,
            cellFontSize,
            Math.max(30, colWidth - cellPadding * 2)
          )
        );
        const maxLines = Math.max(...wrappedCells.map((lines) => lines.length), 1);
        const lineHeight = cellFontSize * 1.25;
        const rowHeight = maxLines * lineHeight + cellPadding * 2;

        ensureVerticalSpace(rowHeight + 4);

        for (let cIdx = 0; cIdx < colCount; cIdx++) {
          const cellX = marginX + cIdx * colWidth;
          const cellY = cursorY - rowHeight;

          currentPage.drawRectangle({
            x: cellX,
            y: cellY,
            width: colWidth,
            height: rowHeight,
            color: isHeader ? rgb(0.95, 0.94, 0.97) : undefined,
            borderColor: rgb(0.78, 0.76, 0.82),
            borderWidth: 0.75,
          });

          const cellLines = wrappedCells[cIdx];
          cellLines.forEach((line, lIdx) => {
            if (!line) return;
            currentPage.drawText(line, {
              x: cellX + cellPadding,
              y:
                cursorY -
                cellPadding -
                cellFontSize * 0.88 -
                lIdx * lineHeight,
              size: cellFontSize,
              font: cellFont,
              color: rgb(0.08, 0.06, 0.11),
            });
          });
        }

        cursorY -= rowHeight;
      }
      cursorY -= 12;
      continue;
    }

    const rawText = block.text || '';
    if (!rawText.trim()) continue;

    const fontSize =
      block.type === 'h1'
        ? options.baseFontSize + 7
        : block.type === 'h2'
          ? options.baseFontSize + 4
          : block.type === 'h3'
            ? options.baseFontSize + 2
            : options.baseFontSize;

    const chosenFont =
      block.type === 'h1' ||
      block.type === 'h2' ||
      block.type === 'h3' ||
      block.bold
        ? fontBold
        : block.italic
          ? fontItalic
          : fontRegular;

    const indent = block.type === 'li' ? 14 : 0;
    const lines = wrapTextToLines(
      rawText,
      chosenFont,
      fontSize,
      contentWidth - indent
    );
    const lineHeight = fontSize * options.lineSpacing;

    if (block.type === 'h1' || block.type === 'h2' || block.type === 'h3') {
      cursorY -= 6;
    }

    for (const line of lines) {
      ensureVerticalSpace(lineHeight);
      if (line) {
        currentPage.drawText(line, {
          x: marginX + indent,
          y: cursorY - fontSize * 0.88,
          size: fontSize,
          font: chosenFont,
          color:
            block.type === 'h1' || block.type === 'h2'
              ? rgb(0.12, 0.08, 0.2)
              : rgb(0.1, 0.09, 0.13),
        });
      }
      cursorY -= lineHeight;
    }

    cursorY -= block.type === 'li' ? 4 : fontSize * 0.55;
  }

  const pages = pdfDoc.getPages();
  if (options.addPageNumbers) {
    pages.forEach((p, idx) => {
      const label = `Page ${idx + 1} of ${pages.length}`;
      const lw = fontRegular.widthOfTextAtSize(label, 9.5);
      p.drawText(label, {
        x: (pageW - lw) / 2,
        y: 24,
        size: 9.5,
        font: fontRegular,
        color: rgb(0.42, 0.39, 0.48),
      });
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return { pdfBytes, pageCount: pages.length };
}

/**
 * Extracts structured page-by-page paragraphs, headings, and rendered page images
 * from a PDF so the user can preview, edit, and export to a genuine `.docx` Word file.
 */
export async function extractPdfPagesForWord(
  pdfBytes: Uint8Array,
  onProgress?: (current: number, total: number) => void
): Promise<PdfPageWordContent[]> {
  const totalPages = await getPdfPageCount(pdfBytes);
  const results: PdfPageWordContent[] = [];

  for (let pNum = 1; pNum <= totalPages; pNum++) {
    if (onProgress) onProgress(pNum, totalPages);
    const rendered = await renderPdfPage(
      pdfBytes,
      pNum,
      1.35,
      'image/jpeg',
      0.88
    );

    // Sort native text blocks top-to-bottom, left-to-right
    const sortedBlocks = [...rendered.nativeTextBlocks].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.012) return a.y - b.y;
      return a.x - b.x;
    });

    const paragraphs: {
      text: string;
      isHeading?: boolean;
      fontSize?: number;
    }[] = [];

    if (sortedBlocks.length > 0) {
      let currentPara = '';
      let currentFontSize = sortedBlocks[0].fontSize || 11;
      let lastY = sortedBlocks[0].y;
      let lastH = sortedBlocks[0].height || 0.02;

      for (let i = 0; i < sortedBlocks.length; i++) {
        const blk = sortedBlocks[i];
        const lineText = blk.text.trim();
        if (!lineText) continue;

        const verticalGap = blk.y - (lastY + lastH);
        const fontDiff = Math.abs((blk.fontSize || 11) - currentFontSize);

        // Start a new paragraph if there is a vertical gap, a font size change, or a bullet/numbered item
        if (
          i > 0 &&
          (verticalGap > 0.014 ||
            fontDiff >= 2.5 ||
            /^(\d+[\.\)]|[ivxIVX]+[\.\)]|\*|-|\u2022)\s/.test(lineText))
        ) {
          if (currentPara.trim()) {
            paragraphs.push({
              text: currentPara.trim(),
              isHeading:
                currentFontSize >= 14.5 ||
                (currentPara.length < 65 &&
                  currentPara === currentPara.toUpperCase() &&
                  /[A-Z]/.test(currentPara)),
              fontSize: currentFontSize,
            });
          }
          currentPara = lineText;
          currentFontSize = blk.fontSize || 11;
        } else {
          currentPara = currentPara ? `${currentPara} ${lineText}` : lineText;
        }

        lastY = blk.y;
        lastH = blk.height || 0.02;
      }

      if (currentPara.trim()) {
        paragraphs.push({
          text: currentPara.trim(),
          isHeading:
            currentFontSize >= 14.5 ||
            (currentPara.length < 65 &&
              currentPara === currentPara.toUpperCase() &&
              /[A-Z]/.test(currentPara)),
          fontSize: currentFontSize,
        });
      }
    } else if (rendered.extractedText.trim()) {
      paragraphs.push({
        text: rendered.extractedText.trim(),
        isHeading: false,
        fontSize: 11,
      });
    }

    results.push({
      pageNumber: pNum,
      paragraphs,
      imageDataUrl: rendered.dataUrl,
      width: rendered.width,
      height: rendered.height,
    });
  }

  return results;
}

/**
 * Builds a valid, standard Microsoft Word `.docx` binary file (`Uint8Array`)
 * from the extracted (and optionally user-edited) PDF page contents.
 */
export async function buildDocxFromPdfPages(
  pages: PdfPageWordContent[],
  mode: PdfToWordMode,
  documentTitle: string
): Promise<Uint8Array> {
  const children: Paragraph[] = [];

  for (let idx = 0; idx < pages.length; idx++) {
    const page = pages[idx];

    if (idx > 0) {
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
    }

    const hasText = page.paragraphs.some((p) => p.text.trim().length > 0);

    // 1. Include editable paragraphs when mode is 'editable' or 'hybrid'
    if (mode === 'editable' || mode === 'hybrid') {
      if (pages.length > 1) {
        children.push(
          new Paragraph({
            spacing: { after: 140 },
            children: [
              new TextRun({
                text: `— Page ${page.pageNumber} —`,
                size: 18,
                color: '6E667D',
                italics: true,
              }),
            ],
          })
        );
      }

      for (const para of page.paragraphs) {
        const cleanText = para.text.trim();
        if (!cleanText) continue;

        if (para.isHeading) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 120 },
              children: [
                new TextRun({
                  text: cleanText,
                  bold: true,
                  size: Math.max(26, Math.round((para.fontSize || 14) * 2)),
                  color: '14101B',
                }),
              ],
            })
          );
        } else {
          // Support multi-line user edits within a page paragraph block
          const lines = cleanText.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            children.push(
              new Paragraph({
                spacing: { after: 160, line: 300 },
                children: [
                  new TextRun({
                    text: line.trim(),
                    size: 23, // 11.5pt in half-points
                    color: '1F1B24',
                  }),
                ],
              })
            );
          }
        }
      }
    }

    // 2. Embed page snapshot image when mode is 'visual', 'hybrid', or when a scanned page has no text
    if (
      (mode === 'visual' || mode === 'hybrid' || !hasText) &&
      page.imageDataUrl
    ) {
      try {
        const base64 = page.imageDataUrl.split(',')[1];
        const imgBytes = Uint8Array.from(atob(base64), (c) =>
          c.charCodeAt(0)
        );
        const srcW = page.width || 600;
        const srcH = page.height || 840;
        const targetW = 520;
        const targetH = Math.round((srcH / srcW) * targetW);

        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: hasText ? 200 : 40, after: 160 },
            children: [
              new ImageRun({
                data: imgBytes,
                transformation: {
                  width: targetW,
                  height: targetH,
                },
                type: 'jpg',
              }),
            ],
          })
        );
      } catch (err) {
        console.warn('Could not embed page snapshot into DOCX:', err);
      }
    }
  }

  if (children.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: documentTitle || 'Converted Document',
            bold: true,
            size: 28,
          }),
        ],
      })
    );
  }

  const doc = new Document({
    title: documentTitle,
    creator: 'ScanPro Studio',
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
