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

export function wordBlocksToReadableText(blocks: WordContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'table' && b.rows) {
        return b.rows.map((r) => r.join(' | ')).join('\n');
      }
      if (b.type === 'h1') return `# ${b.text || ''}`;
      if (b.type === 'h2') return `## ${b.text || ''}`;
      if (b.type === 'h3') return `### ${b.text || ''}`;
      return b.text || '';
    })
    .filter((line) => line.trim().length > 0)
    .join('\n\n');
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, ' - ')
    .replace(/&bull;/gi, '* ')
    .replace(/&copy;/gi, '(c)')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/**
 * Parses any HTML document or fragment into structured Word/PDF content blocks
 * (headings, paragraphs, bullet/numbered lists, tables, and embedded images)
 * while stripping <style>, <script>, <head>, comments, and raw HTML tags so
 * raw code is never copied into the output PDF.
 */
export function parseHtmlIntoWordBlocks(html: string): WordContentBlock[] {
  if (!html || !html.trim()) return [];

  // Extract <title> before stripping <head>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const extractedTitle = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim())
    : '';

  // Convert inline <svg>...</svg> into <img src="data:image/svg+xml;utf8,..." /> so SVG graphics & illustrations are preserved as image blocks without leaking raw SVG text nodes
  const htmlWithInlineSvgImages = html.replace(
    /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
    (svgMarkup) => {
      const encoded = encodeURIComponent(svgMarkup.trim());
      return `<img src="data:image/svg+xml;utf8,${encoded}" alt="SVG Graphic" />`;
    }
  );

  // Strip comments, <script>, <style>, <noscript>, <template>, <iframe>, and <head> for block text extraction
  const cleanedHtml = htmlWithInlineSvgImages
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');

  const isRenderableImgSrc = (src: string): boolean => {
    const trimmed = (src || '').trim();
    return (
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('/')
    );
  };

  const blocks: WordContentBlock[] = [];

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedHtml, 'text/html');
    // Also remove any stray script/style/meta/link inside body
    doc
      .querySelectorAll('script, style, noscript, template, meta, link')
      .forEach((el) => el.remove());

    const BLOCK_TAGS = new Set([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'ul',
      'ol',
      'dl',
      'table',
      'blockquote',
      'pre',
      'div',
      'section',
      'article',
      'main',
      'header',
      'footer',
      'aside',
      'nav',
      'form',
      'fieldset',
      'figure',
      'figcaption',
      'details',
      'summary',
      'address',
      'hr',
      'img',
    ]);

    const hasBlockChild = (el: Element): boolean => {
      for (let i = 0; i < el.children.length; i++) {
        const childTag = el.children[i].tagName.toLowerCase();
        if (BLOCK_TAGS.has(childTag)) return true;
        if (hasBlockChild(el.children[i])) return true;
      }
      return false;
    };

    const normalizeText = (raw: string | null | undefined): string =>
      (raw || '').replace(/\s+/g, ' ').trim();

    const walkNode = (node: Element) => {
      const tag = node.tagName.toLowerCase();

      if (tag === 'hr') return;

      if (
        tag === 'h1' ||
        tag === 'h2' ||
        tag === 'h3' ||
        tag === 'h4' ||
        tag === 'h5' ||
        tag === 'h6'
      ) {
        const text = normalizeText(node.textContent);
        if (text) {
          const mappedType: 'h1' | 'h2' | 'h3' =
            tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'h3';
          blocks.push({
            type: mappedType,
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
          tr.querySelectorAll(':scope > th, :scope > td').forEach((cell) => {
            rowCells.push(normalizeText(cell.textContent));
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
        const items = node.querySelectorAll(':scope > li');
        items.forEach((li, idx) => {
          const text = normalizeText(li.textContent);
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

      if (tag === 'dl') {
        Array.from(node.children).forEach((child) => {
          const cTag = child.tagName.toLowerCase();
          const text = normalizeText(child.textContent);
          if (!text) return;
          if (cTag === 'dt') {
            blocks.push({ type: 'p', text, bold: true });
          } else if (cTag === 'dd') {
            blocks.push({ type: 'li', text: `* ${text}` });
          }
        });
        return;
      }

      if (tag === 'img') {
        const src = node.getAttribute('src') || '';
        if (isRenderableImgSrc(src)) {
          blocks.push({ type: 'image', imageDataUrl: src.trim() });
        }
        return;
      }

      if (tag === 'pre') {
        const rawPre = (node.textContent || '').replace(/\r\n/g, '\n').trim();
        if (rawPre) {
          rawPre.split('\n').forEach((line) => {
            if (line.trim()) {
              blocks.push({ type: 'p', text: line });
            }
          });
        }
        return;
      }

      if (tag === 'p' || tag === 'blockquote' || tag === 'figcaption') {
        node.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (isRenderableImgSrc(src)) {
            blocks.push({ type: 'image', imageDataUrl: src.trim() });
          }
        });

        const text = normalizeText(node.textContent);
        if (text) {
          const strongEl = node.querySelector('strong, b');
          const emEl = node.querySelector('em, i');
          const hasStrong =
            strongEl !== null &&
            normalizeText(strongEl.textContent).length >= text.length * 0.75;
          const hasEm =
            emEl !== null &&
            normalizeText(emEl.textContent).length >= text.length * 0.75;
          blocks.push({
            type: 'p',
            text,
            bold: hasStrong,
            italic: hasEm || tag === 'blockquote',
          });
        }
        return;
      }

      // Generic container or inline element (div, section, article, header, span, etc.)
      if (!hasBlockChild(node)) {
        node.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (isRenderableImgSrc(src)) {
            blocks.push({ type: 'image', imageDataUrl: src.trim() });
          }
        });
        const text = normalizeText(node.textContent);
        if (text) {
          const isBold =
            tag === 'strong' ||
            tag === 'b' ||
            tag === 'summary' ||
            (node.querySelector('strong, b') !== null &&
              normalizeText(node.querySelector('strong, b')?.textContent)
                .length >=
                text.length * 0.75);
          blocks.push({
            type: 'p',
            text,
            bold: isBold,
          });
        }
        return;
      }

      // Element has block children: flush any inline text runs between block children
      let inlineBuffer = '';
      const flushInline = () => {
        const clean = inlineBuffer.replace(/\s+/g, ' ').trim();
        if (clean) {
          blocks.push({ type: 'p', text: clean });
        }
        inlineBuffer = '';
      };

      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          // TEXT_NODE
          inlineBuffer += ' ' + (child.textContent || '');
        } else if (child.nodeType === 1) {
          const childEl = child as Element;
          const childTag = childEl.tagName.toLowerCase();
          if (childTag === 'br') {
            flushInline();
          } else if (BLOCK_TAGS.has(childTag) || hasBlockChild(childEl)) {
            flushInline();
            walkNode(childEl);
          } else {
            inlineBuffer += ' ' + (childEl.textContent || '');
          }
        }
      });
      flushInline();
    };

    if (doc.body) {
      walkNode(doc.body);
    }
  } else {
    // Fallback structured parser when DOMParser is unavailable (e.g. Node CLI tests)
    const imageUrls: string[] = [];
    const withImagePlaceholders = cleanedHtml.replace(
      /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
      (_, srcAttr: string) => {
        if (isRenderableImgSrc(srcAttr)) {
          const idx = imageUrls.length;
          imageUrls.push(srcAttr.trim());
          return `\n__HTML_IMG_${idx}__\n`;
        }
        return '\n';
      }
    );

    const tableBlocks: string[][][] = [];
    const withTablePlaceholders = withImagePlaceholders.replace(
      /<table\b[^>]*>([\s\S]*?)<\/table>/gi,
      (_, tableInner: string) => {
        const rows: string[][] = [];
        const trMatches = tableInner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
        for (const tr of trMatches) {
          const cellMatches =
            tr.match(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
          const cells = cellMatches.map((c) =>
            decodeHtmlEntities(
              c
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
            )
          );
          if (cells.some((c) => c.length > 0)) {
            rows.push(cells);
          }
        }
        if (rows.length > 0) {
          const idx = tableBlocks.length;
          tableBlocks.push(rows);
          return `\n__HTML_TABLE_${idx}__\n`;
        }
        return '\n';
      }
    );

    const structuredText = decodeHtmlEntities(
      withTablePlaceholders
        .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n### $1\n')
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(
          /<\/(?:p|div|section|article|header|footer|tr|blockquote|pre)>/gi,
          '\n\n'
        )
        .replace(/<[^>]+>/g, ' ')
    );

    const lines = structuredText.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const imgMatch = line.match(/^__HTML_IMG_(\d+)__$/);
      if (imgMatch) {
        const url = imageUrls[Number(imgMatch[1])];
        if (url) blocks.push({ type: 'image', imageDataUrl: url });
        continue;
      }
      const tblMatch = line.match(/^__HTML_TABLE_(\d+)__$/);
      if (tblMatch) {
        const rows = tableBlocks[Number(tblMatch[1])];
        if (rows) blocks.push({ type: 'table', rows });
        continue;
      }
      blocks.push(...plainTextToWordBlocks(line));
    }
  }

  // Prepend <title> if present and not already duplicated by the first heading
  if (
    extractedTitle &&
    (!blocks[0] ||
      (blocks[0].text || '').toLowerCase() !== extractedTitle.toLowerCase())
  ) {
    blocks.unshift({
      type: 'h1',
      text: extractedTitle,
      bold: true,
    });
  }

  return blocks;
}

function escapeHtmlText(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts structured WordContentBlock[] into clean, semantic HTML for the HTML & eBook Reader.
 */
export function wordBlocksToCleanHtml(
  blocks: WordContentBlock[],
  docTitle?: string
): string {
  const parts: string[] = [];
  if (
    docTitle &&
    (!blocks[0] ||
      (blocks[0].text || '').toLowerCase() !== docTitle.toLowerCase())
  ) {
    parts.push(`<h1>${escapeHtmlText(docTitle)}</h1>`);
  }

  let inList = false;
  const flushList = () => {
    if (inList) {
      parts.push('</ul>');
      inList = false;
    }
  };

  for (const b of blocks) {
    if (b.type === 'li') {
      if (!inList) {
        parts.push('<ul>');
        inList = true;
      }
      const cleanItem = (b.text || '').replace(/^(\*|-|\u2022|\d+\.)\s+/, '');
      parts.push(`<li>${escapeHtmlText(cleanItem)}</li>`);
      continue;
    }

    flushList();

    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      parts.push(`<${b.type}>${escapeHtmlText(b.text || '')}</${b.type}>`);
    } else if (b.type === 'table' && b.rows && b.rows.length > 0) {
      parts.push('<table>');
      b.rows.forEach((row, rIdx) => {
        const tag = rIdx === 0 ? 'th' : 'td';
        const cells = row
          .map((c) => `<${tag}>${escapeHtmlText(c)}</${tag}>`)
          .join('');
        parts.push(`<tr>${cells}</tr>`);
      });
      parts.push('</table>');
    } else if (b.type === 'image' && b.imageDataUrl) {
      parts.push(
        `<figure><img src="${b.imageDataUrl}" alt="Embedded figure" style="max-width:100%;height:auto;" /></figure>`
      );
    } else if (b.text && b.text.trim()) {
      let inner = escapeHtmlText(b.text);
      if (b.bold) inner = `<strong>${inner}</strong>`;
      if (b.italic) inner = `<em>${inner}</em>`;
      parts.push(`<p>${inner}</p>`);
    }
  }
  flushList();

  return parts.join('\n');
}

/**
 * Prepares HTML for 100% browser-accurate rendering inside an iframe (`srcDoc`).
 * Preserves the original `<!DOCTYPE html>`, `<head>`, `<style>` (including `@keyframes` animations,
 * transitions, gradients, and custom colors), `<script>` (JS/Canvas animations), `<svg>`, and `<img>` pictures.
 * If the input is an HTML fragment rather than a full document, wraps it in a clean HTML5 document
 * while keeping all embedded `<style>`, `<script>`, `<svg>`, and `<img>` tags intact.
 */
export function prepareBrowserFidelityHtml(
  rawHtml: string,
  fallbackTitle?: string
): string {
  const trimmed = (rawHtml || '').trim();
  if (!trimmed) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtmlText(
      fallbackTitle || 'Document'
    )}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:24px;"><h1>${escapeHtmlText(
      fallbackTitle || 'Document'
    )}</h1></body></html>`;
  }

  // Responsive media helper injected gently so huge images don't overflow horizontally unless styled
  const baseHelperStyle = `<style id="elimika-browser-helper">
    img, svg, video, canvas { max-width: 100%; }
  </style>`;

  // If the file is already a complete HTML document (has <!doctype html> or <html...>)
  if (/^(?:<!doctype\s+html|<html\b)/i.test(trimmed) || /<html\b[^>]*>[\s\S]*<\/html>/i.test(trimmed)) {
    if (/<head\b[^>]*>/i.test(trimmed)) {
      return trimmed.replace(
        /<head\b([^>]*)>/i,
        `<head$1><meta charset="utf-8">${baseHelperStyle}`
      );
    }
    return trimmed.replace(
      /<html\b([^>]*)>/i,
      `<html$1><head><meta charset="utf-8">${baseHelperStyle}</head>`
    );
  }

  // Otherwise wrap the fragment while preserving all <style>, <link>, <script>, <svg>, and <img> tags
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlText(fallbackTitle || 'HTML Document')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      background: #ffffff;
    }
    img, svg, video, canvas { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; }
    pre { background: #0f172a; color: #f8fafc; padding: 14px; border-radius: 8px; overflow-x: auto; }
    blockquote { border-left: 4px solid #e11d48; margin: 1em 0; padding: 0.5em 1em; background: #fff1f2; }
  </style>
</head>
<body>
${trimmed}
</body>
</html>`;
}

/**
 * Sanitizes raw HTML for safe display inside the built-in HTML & eBook Reader
 * while keeping `<style>` (colors, layouts, @keyframes animations), `<svg>`, `<img>`,
 * headings, paragraphs, tables, lists, blockquotes, pre/code, and inline formatting.
 */
export function sanitizeHtmlForReader(
  rawHtml: string,
  fallbackTitle?: string
): string {
  if (!rawHtml || !rawHtml.trim()) {
    return fallbackTitle ? `<h1>${escapeHtmlText(fallbackTitle)}</h1>` : '';
  }

  // Preserve <style> blocks from <head> before stripping <head> so colors & CSS animations remain visible
  const styleBlocks: string[] = [];
  const headMatch = rawHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    const stylesInHead = headMatch[1].match(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
    if (stylesInHead) {
      styleBlocks.push(...stylesInHead);
    }
  }

  let cleaned = rawHtml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');

  const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    cleaned = bodyMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '').trim();
  }

  const combined = [...styleBlocks, cleaned].filter(Boolean).join('\n');
  return combined || (fallbackTitle ? `<h1>${escapeHtmlText(fallbackTitle)}</h1>` : '');
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

async function inflateRawBytesInWordService(
  compressed: Uint8Array
): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(compressed));
    await writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
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

async function extractTextEntriesFromZip(
  zipBytes: Uint8Array
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (zipBytes.byteLength < 22) return result;
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

    const lowerEntry = fileName.toLowerCase();
    const isTextEntry =
      lowerEntry.endsWith('.xml') ||
      lowerEntry.endsWith('.opf') ||
      lowerEntry.endsWith('.ncx') ||
      lowerEntry.endsWith('.xhtml') ||
      lowerEntry.endsWith('.html') ||
      lowerEntry.endsWith('.htm') ||
      lowerEntry.endsWith('.css') ||
      lowerEntry.endsWith('.svg') ||
      lowerEntry.endsWith('.json') ||
      lowerEntry.endsWith('.txt') ||
      lowerEntry.endsWith('.md') ||
      lowerEntry.endsWith('.fb2') ||
      lowerEntry.endsWith('.rels');

    const isImageEntry =
      lowerEntry.endsWith('.png') ||
      lowerEntry.endsWith('.jpg') ||
      lowerEntry.endsWith('.jpeg') ||
      lowerEntry.endsWith('.gif') ||
      lowerEntry.endsWith('.webp');

    if (!isTextEntry && !isImageEntry) continue;

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
        let decompressedBytes: Uint8Array | null = null;
        if (compressionMethod === 0) {
          decompressedBytes = rawSlice;
        } else if (compressionMethod === 8) {
          decompressedBytes = await inflateRawBytesInWordService(rawSlice);
        }
        if (decompressedBytes) {
          if (isImageEntry) {
            const mime = lowerEntry.endsWith('.png')
              ? 'image/png'
              : lowerEntry.endsWith('.gif')
                ? 'image/gif'
                : lowerEntry.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/jpeg';
            result.set(
              fileName,
              `data:${mime};base64,${uint8ArrayToBase64(decompressedBytes)}`
            );
          } else {
            result.set(fileName, decoder.decode(decompressedBytes));
          }
        }
      } catch {
        // Ignore unreadable entry
      }
    }
  }

  return result;
}

/**
 * Parses an EPUB or KPF (Kindle Package Format) or ODT (OpenDocument) ZIP archive
 * into ordered chapters, WordContentBlock[], and rich HTML (with embedded CSS & images inlined).
 */
async function parseEpubKpfOrOdtZipEntries(
  entries: Map<string, string>,
  fallbackTitle: string
): Promise<{
  blocks: WordContentBlock[];
  plainText: string;
  htmlPreview: string;
} | null> {
  // 1. Check OpenDocument Text / Spreadsheet / Presentation (content.xml)
  if (entries.has('content.xml')) {
    const contentXml = entries.get('content.xml') || '';
    if (
      /<(?:office:document-content|text:p|text:h|table:table)\b/i.test(
        contentXml
      )
    ) {
      const convertedHtml = contentXml
        .replace(
          /<text:h\b[^>]*>([\s\S]*?)<\/text:h>/gi,
          (_, inner) => `<h2>${inner.replace(/<[^>]+>/g, ' ').trim()}</h2>\n`
        )
        .replace(
          /<text:p\b[^>]*>([\s\S]*?)<\/text:p>/gi,
          (_, inner) => `<p>${inner.replace(/<[^>]+>/g, ' ').trim()}</p>\n`
        )
        .replace(/<table:table\b[^>]*>/gi, '<table>')
        .replace(/<\/table:table>/gi, '</table>')
        .replace(/<table:table-row\b[^>]*>/gi, '<tr>')
        .replace(/<\/table:table-row>/gi, '</tr>')
        .replace(/<table:table-cell\b[^>]*>/gi, '<td>')
        .replace(/<\/table:table-cell>/gi, '</td>');

      const blocks = parseHtmlIntoWordBlocks(convertedHtml);
      if (blocks.length > 0) {
        const plainText = wordBlocksToReadableText(blocks);
        return {
          blocks,
          plainText,
          htmlPreview: wordBlocksToCleanHtml(blocks, fallbackTitle),
        };
      }
    }
  }

  // 2. Check KPF (Kindle Package Format) kdf_manifest.json or OPF spine/manifest (EPUB & KPF)
  let bookTitle = fallbackTitle;
  let bookAuthor = '';
  const orderedChapterPaths: string[] = [];

  if (entries.has('kdf_manifest.json')) {
    try {
      const kdfJson = JSON.parse(entries.get('kdf_manifest.json') || '{}');
      if (kdfJson.title) bookTitle = String(kdfJson.title);
      if (kdfJson.author) bookAuthor = String(kdfJson.author);
      if (Array.isArray(kdfJson.resources)) {
        for (const res of kdfJson.resources) {
          if (
            res &&
            typeof res.path === 'string' &&
            /\.(?:xhtml|html|htm)$/i.test(res.path) &&
            res.role !== 'navigation'
          ) {
            orderedChapterPaths.push(res.path);
          }
        }
      }
    } catch {
      // Ignore malformed kdf_manifest.json
    }
  }

  // Locate .opf file if orderedChapterPaths is still empty
  if (orderedChapterPaths.length === 0) {
    let opfPath = '';
    const containerXml = entries.get('META-INF/container.xml') || '';
    const fullPathMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
    if (fullPathMatch && entries.has(fullPathMatch[1])) {
      opfPath = fullPathMatch[1];
    } else {
      opfPath =
        Array.from(entries.keys()).find((k) => k.toLowerCase().endsWith('.opf')) ||
        '';
    }

    if (opfPath) {
      const opfXml = entries.get(opfPath) || '';
      const opfDir = opfPath.includes('/')
        ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1)
        : '';

      const titleMatch = opfXml.match(
        /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i
      );
      if (titleMatch && titleMatch[1].trim()) {
        bookTitle = decodeHtmlEntities(
          titleMatch[1].replace(/<[^>]+>/g, '').trim()
        );
      }
      const creatorMatch = opfXml.match(
        /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i
      );
      if (creatorMatch && creatorMatch[1].trim()) {
        bookAuthor = decodeHtmlEntities(
          creatorMatch[1].replace(/<[^>]+>/g, '').trim()
        );
      }

      // Map manifest id -> href
      const manifestMap = new Map<string, string>();
      const itemRegex = /<item\b([^>]*)\/?>/gi;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(opfXml)) !== null) {
        const attrs = itemMatch[1];
        const idAttr = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
        const hrefAttr = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
        const propsAttr = attrs.match(/\bproperties=["']([^"']+)["']/i)?.[1] || '';
        if (idAttr && hrefAttr && !propsAttr.includes('nav')) {
          manifestMap.set(idAttr, hrefAttr);
        }
      }

      // Read spine itemref order
      const itemrefRegex = /<itemref\b([^>]*)\/?>/gi;
      let refMatch: RegExpExecArray | null;
      while ((refMatch = itemrefRegex.exec(opfXml)) !== null) {
        const idref = refMatch[1].match(/\bidref=["']([^"']+)["']/i)?.[1];
        if (idref && manifestMap.has(idref)) {
          const rawHref = manifestMap.get(idref)!.split('#')[0];
          const resolved = opfDir ? `${opfDir}${rawHref}` : rawHref;
          if (entries.has(resolved)) {
            orderedChapterPaths.push(resolved);
          } else if (entries.has(rawHref)) {
            orderedChapterPaths.push(rawHref);
          }
        }
      }
    }
  }

  // Fallback: collect all .xhtml / .html / .htm entries in the archive
  if (orderedChapterPaths.length === 0) {
    const allHtmlKeys = Array.from(entries.keys())
      .filter((k) => /\.(?:xhtml|html|htm)$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const nonNavKeys = allHtmlKeys.filter(
      (k) => !/(?:^|\/)(?:toc|nav)\.(?:xhtml|html|htm)$/i.test(k)
    );
    orderedChapterPaths.push(
      ...(nonNavKeys.length > 0 ? nonNavKeys : allHtmlKeys)
    );
  }

  if (orderedChapterPaths.length === 0) {
    return null;
  }

  // Collect all .css stylesheets and image data URLs in the archive
  const archiveStyles: string[] = [];
  const imageByBasename = new Map<string, string>();
  entries.forEach((val, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.endsWith('.css') && val.trim()) {
      archiveStyles.push(val);
    } else if (val.startsWith('data:image/')) {
      imageByBasename.set(key, val);
      const base = key.split('/').pop() || key;
      imageByBasename.set(base, val);
    } else if (lowerKey.endsWith('.svg') && val.includes('<svg')) {
      const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(val.trim())}`;
      imageByBasename.set(key, svgDataUrl);
      const base = key.split('/').pop() || key;
      imageByBasename.set(base, svgDataUrl);
    }
  });

  const inlineArchiveAssets = (htmlStr: string): string => {
    return htmlStr.replace(
      /\b(src|href|xlink:href)=["']([^"']+)["']/gi,
      (full, attr, rawPath: string) => {
        const cleanPath = rawPath.split('#')[0].split('?')[0].replace(/^\.\.\//g, '').replace(/^\.\//g, '');
        const base = cleanPath.split('/').pop() || cleanPath;
        const matchedDataUrl =
          imageByBasename.get(cleanPath) || imageByBasename.get(base);
        if (matchedDataUrl) {
          return `${attr}="${matchedDataUrl}"`;
        }
        return full;
      }
    );
  };

  const allBlocks: WordContentBlock[] = [];
  const chapterHtmlFragments: string[] = [];

  if (archiveStyles.length > 0) {
    chapterHtmlFragments.push(`<style>\n${archiveStyles.join('\n')}\n</style>`);
  }

  allBlocks.push({
    type: 'h1',
    text: bookAuthor ? `${bookTitle} — ${bookAuthor}` : bookTitle,
    bold: true,
  });
  chapterHtmlFragments.push(
    `<header class="ebook-header"><h1>${escapeHtmlText(bookTitle)}</h1>${
      bookAuthor ? `<p><strong>Author:</strong> ${escapeHtmlText(bookAuthor)}</p>` : ''
    }</header>`
  );

  for (let idx = 0; idx < orderedChapterPaths.length; idx++) {
    const path = orderedChapterPaths[idx];
    const rawChapter = entries.get(path) || '';
    if (!rawChapter.trim()) continue;
    const chapterRaw = inlineArchiveAssets(rawChapter);

    const chapterBlocks = parseHtmlIntoWordBlocks(chapterRaw);
    if (chapterBlocks.length > 0) {
      // Avoid repeating the book title if chapter 1 starts with it
      if (
        idx === 0 &&
        chapterBlocks[0].type === 'h1' &&
        (chapterBlocks[0].text || '').toLowerCase() === bookTitle.toLowerCase()
      ) {
        allBlocks.push(...chapterBlocks.slice(1));
      } else {
        allBlocks.push(...chapterBlocks);
      }
      chapterHtmlFragments.push(
        `<section data-chapter="${idx + 1}">${sanitizeHtmlForReader(
          chapterRaw
        )}</section>`
      );
    }
  }

  const plainText = wordBlocksToReadableText(allBlocks);
  const htmlPreview =
    chapterHtmlFragments.join('\n<hr />\n') ||
    wordBlocksToCleanHtml(allBlocks, bookTitle);

  return {
    blocks:
      allBlocks.length > 0
        ? allBlocks
        : plainTextToWordBlocks(bookTitle || 'eBook Document'),
    plainText,
    htmlPreview,
  };
}

/**
 * Parses an uploaded Word, eBook (.epub, .kpf, .mobi, .fb2), OpenDocument (.odt),
 * HTML (.html, .htm, .xhtml, .svg), RTF, Markdown (.md), JSON, XML, or Text file
 * into structured blocks, plain editable text, and full-fidelity HTML for browser reading and PDF generation.
 */
export async function parseUploadedWordFile(file: File): Promise<{
  blocks: WordContentBlock[];
  plainText: string;
  htmlPreview: string;
}> {
  const lowerName = file.name.toLowerCase();
  const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'Document';
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isZipArchive =
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  // 1. Check for ZIP-based eBooks (.epub, .kpf) and OpenDocument (.odt, .ods, .odp)
  if (
    isZipArchive &&
    (lowerName.endsWith('.epub') ||
      lowerName.endsWith('.kpf') ||
      lowerName.endsWith('.odt') ||
      lowerName.endsWith('.ods') ||
      lowerName.endsWith('.odp') ||
      !lowerName.endsWith('.docx'))
  ) {
    try {
      const zipEntries = await extractTextEntriesFromZip(bytes);
      if (
        zipEntries.has('kdf_manifest.json') ||
        zipEntries.has('META-INF/container.xml') ||
        zipEntries.has('content.xml') ||
        lowerName.endsWith('.epub') ||
        lowerName.endsWith('.kpf') ||
        lowerName.endsWith('.odt')
      ) {
        const parsedBook = await parseEpubKpfOrOdtZipEntries(
          zipEntries,
          baseTitle
        );
        if (parsedBook && parsedBook.blocks.length > 0) {
          return parsedBook;
        }
      }
    } catch (err) {
      console.warn('ZIP eBook/ODT parse fallback:', err);
    }
  }

  // 2. Standard .docx OpenXML parsing via mammoth
  if (
    lowerName.endsWith('.docx') ||
    file.type.includes('wordprocessingml') ||
    isZipArchive
  ) {
    try {
      const htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      const rawTextResult = await mammoth.extractRawText({ arrayBuffer: buf });
      const html = htmlResult.value || '';
      const blocks = parseHtmlIntoWordBlocks(html);
      const plainText =
        wordBlocksToReadableText(blocks) || rawTextResult.value?.trim() || '';

      if (blocks.length > 0 || plainText.length > 0) {
        const finalBlocks =
          blocks.length > 0
            ? blocks
            : plainTextToWordBlocks(plainText || 'Empty Word Document');
        return {
          blocks: finalBlocks,
          plainText,
          htmlPreview: html || wordBlocksToCleanHtml(finalBlocks, baseTitle),
        };
      }
    } catch (err) {
      console.warn('Mammoth .docx parse fallback to text extraction:', err);
    }
  }

  // 3. Decode UTF-8 text for .html, .htm, .xhtml, .svg, .fb2, .kpf (non-ZIP), .mobi, .json, .xml, .rtf, .doc, .md, or .txt
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let rawStr = decoder.decode(buf);

  // 3a. Standalone SVG vector graphic / animated SVG file
  if (lowerName.endsWith('.svg') || (file.type || '').toLowerCase().includes('svg')) {
    const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(rawStr.trim())}`;
    const blocks: WordContentBlock[] = [
      { type: 'h1', text: baseTitle, bold: true },
      { type: 'image', imageDataUrl: svgDataUrl },
    ];
    return {
      blocks,
      plainText: baseTitle,
      htmlPreview: rawStr,
    };
  }

  // 3b. FictionBook (.fb2) XML eBook format
  if (lowerName.endsWith('.fb2') || /<FictionBook\b/i.test(rawStr)) {
    const fbHtml = rawStr
      .replace(/<binary\b[^>]*>[\s\S]*?<\/binary>/gi, '')
      .replace(/<description\b[^>]*>([\s\S]*?)<\/description>/gi, (_, desc) => {
        const t = desc.match(/<book-title\b[^>]*>([\s\S]*?)<\/book-title>/i);
        return t ? `<h1>${t[1]}</h1>\n` : '';
      })
      .replace(/<title\b[^>]*>([\s\S]*?)<\/title>/gi, (_, inner) => {
        const cleanTitle = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return cleanTitle ? `<h2>${cleanTitle}</h2>\n` : '';
      })
      .replace(/<subtitle\b[^>]*>([\s\S]*?)<\/subtitle>/gi, '<h3>$1</h3>\n')
      .replace(/<emphasis\b[^>]*>([\s\S]*?)<\/emphasis>/gi, '<em>$1</em>');
    const blocks = parseHtmlIntoWordBlocks(fbHtml);
    const plainText = wordBlocksToReadableText(blocks);
    return {
      blocks:
        blocks.length > 0 ? blocks : plainTextToWordBlocks(baseTitle),
      plainText,
      htmlPreview: wordBlocksToCleanHtml(blocks, baseTitle),
    };
  }

  // 3c. JSON (.json) structured document formatting
  if (lowerName.endsWith('.json') || (file.type || '').includes('json')) {
    try {
      const parsedJson = JSON.parse(rawStr);
      const blocks: WordContentBlock[] = [
        { type: 'h1', text: baseTitle, bold: true },
      ];
      if (Array.isArray(parsedJson) && parsedJson.length > 0 && typeof parsedJson[0] === 'object' && parsedJson[0] !== null) {
        const keys = Object.keys(parsedJson[0]).slice(0, 8);
        const rows: string[][] = [keys];
        for (const item of parsedJson.slice(0, 100)) {
          rows.push(
            keys.map((k) => {
              const v = (item as Record<string, unknown>)[k];
              return v === null || v === undefined
                ? ''
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v);
            })
          );
        }
        blocks.push({ type: 'table', rows });
      } else {
        const pretty = JSON.stringify(parsedJson, null, 2);
        pretty.split('\n').forEach((line) => {
          if (line.trim()) blocks.push({ type: 'p', text: line });
        });
      }
      const plainText = wordBlocksToReadableText(blocks);
      return {
        blocks,
        plainText,
        htmlPreview: wordBlocksToCleanHtml(blocks, baseTitle),
      };
    } catch {
      // Fallback to text
    }
  }

  // 3d. Check if file is HTML / XHTML (by extension, MIME type, or HTML tags inside .html/.kpf/.mobi)
  const isHtmlContent =
    lowerName.endsWith('.html') ||
    lowerName.endsWith('.htm') ||
    lowerName.endsWith('.xhtml') ||
    (file.type || '').toLowerCase().includes('html') ||
    /<(?:!doctype\s+html|html|head|body|style|div|table|h[1-6]|p|section|article|ul|ol|svg|canvas)\b/i.test(
      rawStr
    );

  if (isHtmlContent) {
    const blocks = parseHtmlIntoWordBlocks(rawStr);
    const readableText = wordBlocksToReadableText(blocks);
    const finalBlocks =
      blocks.length > 0
        ? blocks
        : plainTextToWordBlocks(
            readableText || `Webpage imported from ${file.name}`
          );
    // Preserve 100% of rawStr in htmlPreview so CSS colors, @keyframes animations, <script>, <svg>, and <img> pictures render just like opening in a browser
    return {
      blocks: finalBlocks,
      plainText: readableText || baseTitle,
      htmlPreview: rawStr,
    };
  }

  // 3d. Non-ZIP .kpf / .mobi / .azw3 binary or KDF stream fallback
  if (
    lowerName.endsWith('.kpf') ||
    lowerName.endsWith('.mobi') ||
    lowerName.endsWith('.azw3') ||
    lowerName.endsWith('.epub')
  ) {
    const matches = rawStr.match(/[\x20-\x7E\n\r\t]{5,}/g) || [];
    const filteredLines = matches
      .map((m) => m.trim())
      .filter(
        (m) =>
          m.length >= 4 &&
          !/^(?:SQLite format|BOOKMOBI|TPZ|EXTH|INDX|TAGX|IDXT|FDST)/i.test(m)
      );
    const cleanText =
      filteredLines.join('\n\n') || `eBook imported from ${file.name}`;
    const blocks = [
      { type: 'h1' as const, text: baseTitle, bold: true },
      ...plainTextToWordBlocks(cleanText),
    ];
    return {
      blocks,
      plainText: wordBlocksToReadableText(blocks),
      htmlPreview: wordBlocksToCleanHtml(blocks, baseTitle),
    };
  }

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
  } else if (lowerName.endsWith('.xml')) {
    rawStr = rawStr
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  const cleanText = rawStr.replace(/\r\n/g, '\n').trim();
  const blocks = plainTextToWordBlocks(
    cleanText || `Document imported from ${file.name}`
  );
  return {
    blocks,
    plainText: cleanText,
    htmlPreview: wordBlocksToCleanHtml(blocks, baseTitle),
  };
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
    creator: 'ElimikaPDF',
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
