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

export interface WordInlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  colorHex?: string;
  bgColorHex?: string;
  fontSizePt?: number;
}

export interface WordRichTableCell {
  text: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  italic?: boolean;
  colorHex?: string;
  bgColorHex?: string;
  colSpan?: number;
}

export interface WordContentBlock {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'table' | 'image';
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  fontSizePt?: number;
  colorHex?: string;
  bgColorHex?: string;
  indentLeftPt?: number;
  indentRightPt?: number;
  firstLineIndentPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  bottomBorderColor?: string;
  pageBreakBefore?: boolean;
  runs?: WordInlineRun[];
  rows?: string[][];
  colWidthRatios?: number[];
  richCells?: WordRichTableCell[][];
  imageDataUrl?: string;
  imageWidthPt?: number;
  imageHeightPt?: number;
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
    .replace(/\u21D2/g, '=>')
    .replace(/\u21D4/g, '<=>')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2260/g, '!=')
    .replace(/\u2248/g, '~=')
    .replace(/\u00D7/g, 'x')
    .replace(/\u00F7/g, '/')
    .replace(/\u00B1/g, '+/-')
    .replace(/\u221E/g, 'inf')
    .replace(/\u221A/g, 'sqrt')
    .replace(/\u2211/g, 'sum')
    .replace(/\u222B/g, 'int')
    .replace(/\u03C0/g, 'pi')
    .replace(/\u0394/g, 'Delta')
    .replace(/\u03B1/g, 'alpha')
    .replace(/\u03B2/g, 'beta')
    .replace(/\u03B3/g, 'gamma')
    .replace(/\u03B8/g, 'theta')
    .replace(/\u03BB/g, 'lambda')
    .replace(/\u03BC/g, 'mu')
    .replace(/\u03C3/g, 'sigma')
    .replace(/\u03C9/g, 'omega')
    // Strip any remaining characters outside printable Latin-1 / WinAnsi range
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function parseHexToRgb(
  hex: string | undefined,
  fallback: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  if (!hex) return fallback;
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3,6}$/.test(clean) || clean.toLowerCase() === 'auto') {
    return fallback;
  }
  const full =
    clean.length === 3
      ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
      : clean.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return fallback;
  }
  return { r, g, b };
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

function extractCssPropertyFromElement(
  el: Element,
  propName: string
): string | undefined {
  const styleAttr = el.getAttribute('style') || '';
  if (!styleAttr) return undefined;
  const regex = new RegExp(`(?:^|;)\\s*${propName}\\s*:\\s*([^;]+)`, 'i');
  const m = styleAttr.match(regex);
  return m ? m[1].trim() : undefined;
}

function parseElementAlign(
  el: Element
): 'left' | 'center' | 'right' | 'justify' | undefined {
  const alignAttr = (
    el.getAttribute('align') ||
    extractCssPropertyFromElement(el, 'text-align') ||
    ''
  )
    .toLowerCase()
    .trim();
  if (alignAttr === 'center' || alignAttr === 'middle') return 'center';
  if (alignAttr === 'right' || alignAttr === 'end') return 'right';
  if (alignAttr === 'justify' || alignAttr === 'both') return 'justify';
  if (alignAttr === 'left' || alignAttr === 'start') return 'left';
  return undefined;
}

/**
 * Parses any HTML document or fragment into structured Word/PDF content blocks
 * (headings, paragraphs, bullet/numbered lists, tables, and embedded images)
 * while preserving alignments, colors, indents, and table cell formatting.
 */
export function parseHtmlIntoWordBlocks(html: string): WordContentBlock[] {
  if (!html || !html.trim()) return [];

  // Extract <title> before stripping <head>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const extractedTitle = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim())
    : '';

  // Convert inline <svg>...</svg> into <img src="data:image/svg+xml;utf8,..." />
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
            align: parseElementAlign(node),
          });
        }
        return;
      }

      if (tag === 'table') {
        const rows: string[][] = [];
        const richCells: WordRichTableCell[][] = [];
        const trList = node.querySelectorAll('tr');
        trList.forEach((tr, rIdx) => {
          const rowCells: string[] = [];
          const richRow: WordRichTableCell[] = [];
          tr.querySelectorAll(':scope > th, :scope > td').forEach((cell) => {
            const cText = normalizeText(cell.textContent);
            const cAlign = parseElementAlign(cell);
            const isTh = cell.tagName.toLowerCase() === 'th' || rIdx === 0;
            const bg = extractCssPropertyFromElement(cell, 'background-color') ||
              extractCssPropertyFromElement(cell, 'background');
            const bgHex =
              bg && /^#[0-9a-fA-F]{3,6}$/.test(bg.trim())
                ? bg.trim()
                : undefined;
            const colSpan = Number(cell.getAttribute('colspan') || '1') || 1;
            rowCells.push(cText);
            richRow.push({
              text: cText,
              align: cAlign,
              bold: isTh || cell.querySelector('strong, b') !== null,
              bgColorHex: bgHex,
              colSpan,
            });
          });
          if (rowCells.some((c) => c.length > 0)) {
            rows.push(rowCells);
            richCells.push(richRow);
          }
        });
        if (rows.length > 0) {
          blocks.push({ type: 'table', rows, richCells });
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
              align: parseElementAlign(li),
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
          blocks.push({
            type: 'image',
            imageDataUrl: src.trim(),
            align: parseElementAlign(node),
          });
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
            blocks.push({
              type: 'image',
              imageDataUrl: src.trim(),
              align: parseElementAlign(node),
            });
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
            align: parseElementAlign(node),
          });
        }
        return;
      }

      // Generic container or inline element
      if (!hasBlockChild(node)) {
        node.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (isRenderableImgSrc(src)) {
            blocks.push({
              type: 'image',
              imageDataUrl: src.trim(),
              align: parseElementAlign(node),
            });
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
            align: parseElementAlign(node),
          });
        }
        return;
      }

      // Element has block children
      let inlineBuffer = '';
      const flushInline = () => {
        const clean = inlineBuffer.replace(/\s+/g, ' ').trim();
        if (clean) {
          blocks.push({ type: 'p', text: clean, align: parseElementAlign(node) });
        }
        inlineBuffer = '';
      };

      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
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
    const structuredText = decodeHtmlEntities(
      cleanedHtml
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
      blocks.push(...plainTextToWordBlocks(line));
    }
  }

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

    const alignStyle = b.align ? ` style="text-align:${b.align};"` : '';
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      parts.push(
        `<${b.type}${alignStyle}>${escapeHtmlText(b.text || '')}</${b.type}>`
      );
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
        `<figure${alignStyle}><img src="${b.imageDataUrl}" alt="Embedded figure" style="max-width:100%;height:auto;" /></figure>`
      );
    } else if (b.text && b.text.trim()) {
      let inner = escapeHtmlText(b.text);
      if (b.bold) inner = `<strong>${inner}</strong>`;
      if (b.italic) inner = `<em>${inner}</em>`;
      if (b.underline) inner = `<u>${inner}</u>`;
      parts.push(`<p${alignStyle}>${inner}</p>`);
    }
  }
  flushList();

  return parts.join('\n');
}

/**
 * Prepares HTML for 100% browser-accurate rendering inside an iframe (`srcDoc`).
 * Preserves the original `<!DOCTYPE html>`, `<head>`, `<style>` (including `@keyframes` animations,
 * transitions, gradients, and custom colors), `<script>` (JS/Canvas animations), `<svg>`, and `<img>` pictures.
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

  const baseHelperStyle = `<style id="elimika-browser-helper">
    html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
    img, svg, video, canvas { max-width: 100%; height: auto; }
    table { max-width: 100%; }
  </style>
  <script id="elimika-offline-resource-guard">
    window.addEventListener('error', function(e) {
      var t = e && e.target;
      if (t && t.tagName === 'IMG' && !t.dataset.elimikaFallback) {
        t.dataset.elimikaFallback = '1';
        var altText = (t.getAttribute('alt') || t.getAttribute('src') || 'Local Image').slice(0, 48);
        t.style.display = 'inline-block';
        t.style.padding = '8px 12px';
        t.style.border = '1px dashed #94a3b8';
        t.style.borderRadius = '6px';
        t.style.background = '#f8fafc';
        t.style.color = '#475569';
        t.style.fontSize = '12px';
        t.alt = '[Offline Image: ' + altText + ']';
      }
    }, true);
  </script>`;

  // Neutralize top-frame breakouts while keeping safe local scripts & animations
  const safeHtml = trimmed
    .replace(/\btop\.location\b/gi, 'window.location')
    .replace(/\bparent\.location\b/gi, 'window.location')
    .replace(/<base\b[^>]*>/gi, '');

  if (
    /^(?:<!doctype\s+html|<html\b)/i.test(safeHtml) ||
    /<html\b[^>]*>[\s\S]*<\/html>/i.test(safeHtml)
  ) {
    const viewportMeta = /<meta\b[^>]*name=["']viewport["']/i.test(safeHtml)
      ? ''
      : '<meta name="viewport" content="width=device-width, initial-scale=1.0" />';
    if (/<head\b[^>]*>/i.test(safeHtml)) {
      return safeHtml.replace(
        /<head\b([^>]*)>/i,
        `<head$1><meta charset="utf-8">${viewportMeta}${baseHelperStyle}`
      );
    }
    return safeHtml.replace(
      /<html\b([^>]*)>/i,
      `<html$1><head><meta charset="utf-8">${viewportMeta}${baseHelperStyle}</head>`
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlText(fallbackTitle || 'HTML Document')}</title>
  ${baseHelperStyle}
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: Calibri, 'Segoe UI', system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      background: #ffffff;
      overflow-wrap: break-word;
    }
    img, svg, video, canvas { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; display: block; overflow-x: auto; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; }
    pre { background: #0f172a; color: #f8fafc; padding: 14px; border-radius: 8px; overflow-x: auto; }
    blockquote { border-left: 4px solid #e11d48; margin: 1em 0; padding: 0.5em 1em; background: #fff1f2; }
  </style>
</head>
<body>
${safeHtml}
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

  const styleBlocks: string[] = [];
  const headMatch = rawHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    const stylesInHead = headMatch[1].match(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi
    );
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
  return (
    combined || (fallbackTitle ? `<h1>${escapeHtmlText(fallbackTitle)}</h1>` : '')
  );
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
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    const writePromise = (async () => {
      try {
        await writer.write(new Uint8Array(compressed));
        await writer.close();
      } catch {
        // Ignore stream close errors
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
    const isMediaSvg =
      lowerEntry.endsWith('.svg') &&
      (lowerEntry.startsWith('word/media/') ||
        lowerEntry.startsWith('xl/media/') ||
        lowerEntry.includes('/images/'));

    const isTextEntry =
      !isMediaSvg &&
      (lowerEntry.endsWith('.xml') ||
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
        lowerEntry.endsWith('.rels'));

    const isImageEntry =
      isMediaSvg ||
      lowerEntry.endsWith('.png') ||
      lowerEntry.endsWith('.jpg') ||
      lowerEntry.endsWith('.jpeg') ||
      lowerEntry.endsWith('.jfif') ||
      lowerEntry.endsWith('.gif') ||
      lowerEntry.endsWith('.bmp') ||
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
            const mime = lowerEntry.endsWith('.svg')
              ? 'image/svg+xml'
              : lowerEntry.endsWith('.png')
                ? 'image/png'
                : lowerEntry.endsWith('.gif')
                  ? 'image/gif'
                  : lowerEntry.endsWith('.bmp')
                    ? 'image/bmp'
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

// ============================================================================
// MICROSOFT WORD (.DOCX) HIGH-FIDELITY OOXML LAYOUT PARSER
// Preserves paragraph alignments (center/right/justify/left), indents, tabs,
// inline font sizes/colors/highlights, styles.xml, numbering.xml, headers/footers,
// embedded media images, and exact table column widths, cell shading & spans!
// ============================================================================
interface DocxStyleDefinition {
  styleId: string;
  basedOn?: string;
  headingLevel?: 'h1' | 'h2' | 'h3';
  align?: 'left' | 'center' | 'right' | 'justify';
  fontSizePt?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  colorHex?: string;
  bgColorHex?: string;
  indentLeftPt?: number;
  indentRightPt?: number;
  firstLineIndentPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  bottomBorderColor?: string;
}

function getXmlAttr(el: Element | null, attrLocalName: string): string {
  if (!el) return '';
  return (
    el.getAttribute(`w:${attrLocalName}`) ||
    el.getAttribute(`r:${attrLocalName}`) ||
    el.getAttribute(attrLocalName) ||
    ''
  );
}

function findDirectChildByLocalName(
  parent: Element | null,
  localName: string
): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    const tag = c.tagName.toLowerCase();
    if (tag === `w:${localName.toLowerCase()}` || tag === localName.toLowerCase()) {
      return c;
    }
  }
  return null;
}

function findAllDescendantsByLocalName(
  parent: Element | globalThis.Document,
  localName: string
): Element[] {
  const out: Element[] = [];
  const lower = localName.toLowerCase();
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const tag = el.tagName.toLowerCase();
    if (tag === `w:${lower}` || tag === lower || tag.endsWith(`:${lower}`)) {
      out.push(el);
    }
  }
  return out;
}

function mapWordHighlightNameToHex(name: string): string | undefined {
  const map: Record<string, string> = {
    yellow: '#FEF08A',
    green: '#BBF7D0',
    cyan: '#A5F3FC',
    magenta: '#F5D0FE',
    blue: '#BFDBFE',
    red: '#FECACA',
    darkBlue: '#1E3A8A',
    darkCyan: '#155E75',
    darkGreen: '#166534',
    darkMagenta: '#86198F',
    darkRed: '#991B1B',
    darkYellow: '#CA8A04',
    darkGray: '#9CA3AF',
    lightGray: '#E5E7EB',
  };
  return map[name] || undefined;
}

function parseWordJcToAlign(
  val: string
): 'left' | 'center' | 'right' | 'justify' | undefined {
  const lower = (val || '').toLowerCase();
  if (lower === 'center') return 'center';
  if (lower === 'right' || lower === 'end') return 'right';
  if (
    lower === 'both' ||
    lower === 'justify' ||
    lower === 'distribute' ||
    lower === 'mediumkashida'
  ) {
    return 'justify';
  }
  if (lower === 'left' || lower === 'start') return 'left';
  return undefined;
}

function parseDocxStylesXml(
  stylesXml: string
): Map<string, DocxStyleDefinition> {
  const map = new Map<string, DocxStyleDefinition>();
  if (!stylesXml || typeof DOMParser === 'undefined') return map;

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(stylesXml, 'application/xml');

    // Default document font size from docDefaults
    let defaultFontSizePt = 11;
    const rPrDefault = findAllDescendantsByLocalName(xmlDoc, 'rPrDefault')[0];
    if (rPrDefault) {
      const szEl = findAllDescendantsByLocalName(rPrDefault, 'sz')[0];
      const szVal = Number(getXmlAttr(szEl, 'val'));
      if (szVal > 0) defaultFontSizePt = szVal / 2;
    }

    const styleEls = findAllDescendantsByLocalName(xmlDoc, 'style');
    for (const styleEl of styleEls) {
      const styleId = getXmlAttr(styleEl, 'styleId');
      if (!styleId) continue;

      const nameEl = findDirectChildByLocalName(styleEl, 'name');
      const styleName = getXmlAttr(nameEl, 'val').toLowerCase();
      const basedOnEl = findDirectChildByLocalName(styleEl, 'basedOn');
      const basedOn = getXmlAttr(basedOnEl, 'val') || undefined;

      const def: DocxStyleDefinition = {
        styleId,
        basedOn,
        fontSizePt: defaultFontSizePt,
      };

      if (
        styleName === 'title' ||
        styleName === 'heading 1' ||
        styleId.toLowerCase() === 'heading1' ||
        styleId.toLowerCase() === 'title'
      ) {
        def.headingLevel = 'h1';
        def.bold = true;
        def.fontSizePt = 18;
      } else if (
        styleName === 'subtitle' ||
        styleName === 'heading 2' ||
        styleId.toLowerCase() === 'heading2' ||
        styleId.toLowerCase() === 'subtitle'
      ) {
        def.headingLevel = 'h2';
        def.bold = true;
        def.fontSizePt = 14;
      } else if (
        styleName.startsWith('heading ') ||
        /^heading[3-9]$/i.test(styleId)
      ) {
        def.headingLevel = 'h3';
        def.bold = true;
        def.fontSizePt = 12.5;
      }

      const pPr = findDirectChildByLocalName(styleEl, 'pPr');
      if (pPr) {
        const jcEl = findDirectChildByLocalName(pPr, 'jc');
        const align = parseWordJcToAlign(getXmlAttr(jcEl, 'val'));
        if (align) def.align = align;

        const indEl = findDirectChildByLocalName(pPr, 'ind');
        if (indEl) {
          const leftTwips = Number(
            getXmlAttr(indEl, 'left') || getXmlAttr(indEl, 'start') || '0'
          );
          const rightTwips = Number(
            getXmlAttr(indEl, 'right') || getXmlAttr(indEl, 'end') || '0'
          );
          const firstLineTwips = Number(getXmlAttr(indEl, 'firstLine') || '0');
          const hangingTwips = Number(getXmlAttr(indEl, 'hanging') || '0');
          if (leftTwips > 0) def.indentLeftPt = leftTwips / 20;
          if (rightTwips > 0) def.indentRightPt = rightTwips / 20;
          if (firstLineTwips > 0) def.firstLineIndentPt = firstLineTwips / 20;
          else if (hangingTwips > 0) def.firstLineIndentPt = -hangingTwips / 20;
        }

        const spacingEl = findDirectChildByLocalName(pPr, 'spacing');
        if (spacingEl) {
          const beforeTwips = Number(getXmlAttr(spacingEl, 'before') || '0');
          const afterTwips = Number(getXmlAttr(spacingEl, 'after') || '0');
          if (beforeTwips > 0) def.spaceBeforePt = beforeTwips / 20;
          if (afterTwips > 0) def.spaceAfterPt = afterTwips / 20;
        }

        const outlineEl = findDirectChildByLocalName(pPr, 'outlineLvl');
        if (outlineEl && !def.headingLevel) {
          const lvl = Number(getXmlAttr(outlineEl, 'val'));
          if (lvl === 0) def.headingLevel = 'h1';
          else if (lvl === 1) def.headingLevel = 'h2';
          else if (lvl >= 2 && lvl <= 5) def.headingLevel = 'h3';
        }
      }

      const rPr = findDirectChildByLocalName(styleEl, 'rPr');
      if (rPr) {
        const bEl = findDirectChildByLocalName(rPr, 'b');
        if (bEl && getXmlAttr(bEl, 'val') !== '0' && getXmlAttr(bEl, 'val') !== 'false') {
          def.bold = true;
        }
        const iEl = findDirectChildByLocalName(rPr, 'i');
        if (iEl && getXmlAttr(iEl, 'val') !== '0' && getXmlAttr(iEl, 'val') !== 'false') {
          def.italic = true;
        }
        const uEl = findDirectChildByLocalName(rPr, 'u');
        if (uEl && getXmlAttr(uEl, 'val') !== 'none') {
          def.underline = true;
        }
        const szEl = findDirectChildByLocalName(rPr, 'sz');
        const szVal = Number(getXmlAttr(szEl, 'val'));
        if (szVal > 0) def.fontSizePt = szVal / 2;

        const colorEl = findDirectChildByLocalName(rPr, 'color');
        const colorVal = getXmlAttr(colorEl, 'val');
        if (colorVal && /^[0-9a-fA-F]{6}$/.test(colorVal)) {
          def.colorHex = `#${colorVal}`;
        }
      }

      map.set(styleId, def);
    }

    // Resolve single-level basedOn inheritance
    map.forEach((def) => {
      if (def.basedOn && map.has(def.basedOn)) {
        const parent = map.get(def.basedOn)!;
        if (!def.align && parent.align) def.align = parent.align;
        if (def.bold === undefined && parent.bold) def.bold = parent.bold;
        if (def.italic === undefined && parent.italic) def.italic = parent.italic;
        if (!def.colorHex && parent.colorHex) def.colorHex = parent.colorHex;
        if (!def.headingLevel && parent.headingLevel) {
          def.headingLevel = parent.headingLevel;
        }
      }
    });
  } catch {
    // Return partial style map on XML error
  }

  return map;
}

function pruneMcAlternateContentFallbacks(root: Element | globalThis.Document): void {
  const altEls = findAllDescendantsByLocalName(root, 'AlternateContent');
  for (const alt of altEls) {
    let choiceEl: Element | null = null;
    let fallbackEl: Element | null = null;
    for (let i = 0; i < alt.children.length; i++) {
      const c = alt.children[i];
      const local = c.tagName.replace(/^.*:/, '').toLowerCase();
      if (local === 'choice') choiceEl = c;
      else if (local === 'fallback') fallbackEl = c;
    }
    if (choiceEl && fallbackEl) {
      // Before removing <mc:Fallback>, propagate VML pre-resolved hex fillcolor attributes
      // (e.g., <v:roundrect fillcolor="#fbe4d5">) onto corresponding <wps:wsp> shapes in <mc:Choice>
      const vmlShapesWithFill: string[] = [];
      const fbAll = fallbackEl.getElementsByTagName('*');
      for (let i = 0; i < fbAll.length; i++) {
        const fc = fbAll[i].getAttribute('fillcolor') || '';
        if (fc && /^#?[0-9a-fA-F]{6}$/.test(fc.trim().split(' ')[0])) {
          vmlShapesWithFill.push(fc.trim().split(' ')[0]);
        }
      }
      if (vmlShapesWithFill.length > 0) {
        const choiceWspEls = findAllDescendantsByLocalName(choiceEl, 'wsp');
        for (let i = 0; i < choiceWspEls.length; i++) {
          const fillCandidate =
            vmlShapesWithFill[Math.min(i, vmlShapesWithFill.length - 1)];
          if (fillCandidate) {
            choiceWspEls[i].setAttribute('data-vml-fillcolor', fillCandidate);
          }
        }
      }

      const choiceHasUsableNodes =
        findAllDescendantsByLocalName(choiceEl, 'txbxContent').length > 0 ||
        findAllDescendantsByLocalName(choiceEl, 'blip').length > 0 ||
        Boolean((choiceEl.textContent || '').trim());
      if (choiceHasUsableNodes && fallbackEl.parentNode) {
        fallbackEl.parentNode.removeChild(fallbackEl);
      } else if (!choiceHasUsableNodes && choiceEl.parentNode) {
        choiceEl.parentNode.removeChild(choiceEl);
      }
    }
  }
}

function hasAncestorWithLocalName(
  el: Element,
  stopAt: Element,
  targetLocalName: string
): boolean {
  const lowerTarget = targetLocalName.toLowerCase();
  let curr = el.parentElement;
  while (curr && curr !== stopAt) {
    const local = curr.tagName.replace(/^.*:/, '').toLowerCase();
    if (local === lowerTarget) return true;
    curr = curr.parentElement;
  }
  return false;
}

function resolveWordSchemeColorHex(schemeVal: string, lumOff?: number): string | undefined {
  const key = (schemeVal || '').toLowerCase();
  // Standard Office theme palette (including Accent 2 orange/peach used in exam banners)
  const baseMap: Record<string, string> = {
    accent1: '#DBEAFE',
    accent2: '#FBE4D5',
    accent3: '#E2E8F0',
    accent4: '#FEF3C7',
    accent5: '#E0E7FF',
    accent6: '#DCFCE7',
    lt2: '#F1F5F9',
    dk1: '#0F172A',
    dk2: '#1E293B',
  };
  if (lumOff && lumOff >= 50000 && key === 'accent2') {
    return '#FBE4D5';
  }
  return baseMap[key];
}

function extractShapeContainerStyle(txbxEl: Element): {
  bgColorHex?: string;
  borderColorHex?: string;
  isRounded?: boolean;
  widthPt?: number;
} {
  let bgColorHex: string | undefined;
  let borderColorHex: string | undefined;
  let isRounded = false;
  let widthPt: number | undefined;

  let curr: Element | null = txbxEl.parentElement;
  let shapeRoot: Element | null = null;
  while (curr) {
    const local = curr.tagName.replace(/^.*:/, '').toLowerCase();
    if (
      local === 'wsp' ||
      local === 'shape' ||
      local === 'roundrect' ||
      local === 'rect'
    ) {
      shapeRoot = curr;
      if (local === 'roundrect') isRounded = true;
      break;
    }
    curr = curr.parentElement;
  }

  if (!shapeRoot) return {};

  // Check VML fillcolor attribute or propagated data-vml-fillcolor (e.g. <v:roundrect fillcolor="#fbe4d5">)
  const rawVmlFill =
    shapeRoot.getAttribute('fillcolor') ||
    shapeRoot.getAttribute('data-vml-fillcolor') ||
    '';
  const vmlFillToken = rawVmlFill.trim().split(' ')[0];
  if (vmlFillToken && /^#?[0-9a-fA-F]{6}$/.test(vmlFillToken)) {
    const clean = vmlFillToken.replace(/^#/, '');
    if (clean.toLowerCase() !== 'ffffff') {
      bgColorHex = `#${clean}`;
    }
  }

  // Check DrawingML <wps:spPr> -> <a:prstGeom prst="roundRect"> & <a:solidFill>
  const spPr = findDirectChildByLocalName(shapeRoot, 'spPr');
  if (spPr) {
    const prstGeom = findDirectChildByLocalName(spPr, 'prstGeom');
    const prst = (prstGeom?.getAttribute('prst') || '').toLowerCase();
    if (prst.includes('round')) isRounded = true;

    const xfrm = findDirectChildByLocalName(spPr, 'xfrm');
    const ext = xfrm ? findDirectChildByLocalName(xfrm, 'ext') : null;
    if (ext) {
      const cx = Number(ext.getAttribute('cx') || '0');
      if (cx > 0) widthPt = cx / 12700;
    }

    const noFill = findDirectChildByLocalName(spPr, 'noFill');
    const solidFill = findDirectChildByLocalName(spPr, 'solidFill');
    if (noFill) {
      bgColorHex = undefined;
    } else if (solidFill) {
      const srgb = findDirectChildByLocalName(solidFill, 'srgbClr');
      const val = getXmlAttr(srgb, 'val');
      if (val && /^[0-9a-fA-F]{6}$/.test(val) && val.toLowerCase() !== 'ffffff') {
        bgColorHex = `#${val}`;
      } else {
        const scheme = findDirectChildByLocalName(solidFill, 'schemeClr');
        const schemeVal = getXmlAttr(scheme, 'val');
        if (schemeVal) {
          const lumOffEl = scheme
            ? findDirectChildByLocalName(scheme, 'lumOff')
            : null;
          const lumOff = Number(getXmlAttr(lumOffEl, 'val') || '0');
          bgColorHex = resolveWordSchemeColorHex(schemeVal, lumOff);
        }
      }
    }

    // Also check <wps:style><a:fillRef> when spPr does not specify noFill or solidFill
    if (!bgColorHex && !noFill) {
      const styleNode = findDirectChildByLocalName(shapeRoot, 'style');
      const fillRef = styleNode
        ? findDirectChildByLocalName(styleNode, 'fillRef')
        : null;
      if (fillRef && Number(fillRef.getAttribute('idx') || '0') > 0) {
        const srgb = findDirectChildByLocalName(fillRef, 'srgbClr');
        const srgbVal = getXmlAttr(srgb, 'val');
        if (
          srgbVal &&
          /^[0-9a-fA-F]{6}$/.test(srgbVal) &&
          srgbVal.toLowerCase() !== 'ffffff'
        ) {
          bgColorHex = `#${srgbVal}`;
        } else {
          const scheme = findDirectChildByLocalName(fillRef, 'schemeClr');
          const schemeVal = getXmlAttr(scheme, 'val');
          if (schemeVal) {
            bgColorHex = resolveWordSchemeColorHex(schemeVal, 60000);
          }
        }
      }
    }

    const lnEl = findDirectChildByLocalName(spPr, 'ln');
    if (lnEl && !findDirectChildByLocalName(lnEl, 'noFill')) {
      const lnFill = findDirectChildByLocalName(lnEl, 'solidFill');
      const lnSrgb = lnFill ? findDirectChildByLocalName(lnFill, 'srgbClr') : null;
      const lnVal = getXmlAttr(lnSrgb, 'val');
      if (lnVal && /^[0-9a-fA-F]{6}$/.test(lnVal)) {
        borderColorHex = `#${lnVal}`;
      }
    }
  }

  return { bgColorHex, borderColorHex, isRounded, widthPt };
}

function buildRelsMapFromXml(
  relsXml: string,
  entries: Map<string, string>,
  parser: DOMParser
): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml) return map;

  // Build case-insensitive lookup index for ZIP entries
  const lowerEntryLookup = new Map<string, string>();
  entries.forEach((val, key) => {
    lowerEntryLookup.set(key.replace(/\\/g, '/').toLowerCase(), val);
  });

  try {
    const relDoc = parser.parseFromString(relsXml, 'application/xml');
    const relEls = findAllDescendantsByLocalName(relDoc, 'Relationship');
    for (const rel of relEls) {
      const id = rel.getAttribute('Id') || '';
      const target = (rel.getAttribute('Target') || '').replace(/\\/g, '/');
      if (id && target) {
        const cleanTarget = target
          .replace(/^\/+/, '')
          .replace(/^(\.\.\/)+/, '');
        const wordTarget = cleanTarget.startsWith('word/')
          ? cleanTarget
          : `word/${cleanTarget}`;
        if (entries.has(wordTarget)) {
          map.set(id, entries.get(wordTarget)!);
        } else if (entries.has(cleanTarget)) {
          map.set(id, entries.get(cleanTarget)!);
        } else if (lowerEntryLookup.has(wordTarget.toLowerCase())) {
          map.set(id, lowerEntryLookup.get(wordTarget.toLowerCase())!);
        } else if (lowerEntryLookup.has(cleanTarget.toLowerCase())) {
          map.set(id, lowerEntryLookup.get(cleanTarget.toLowerCase())!);
        } else if (/^https?:\/\/|^mailto:/i.test(target)) {
          map.set(id, target);
        }
      }
    }
  } catch {
    // Ignore malformed .rels
  }
  return map;
}

function parseDocxZipWithFullWordLayout(
  entries: Map<string, string>,
  fallbackTitle: string
): {
  blocks: WordContentBlock[];
  plainText: string;
  htmlPreview: string;
} | null {
  const docXml = entries.get('word/document.xml');
  if (!docXml || typeof DOMParser === 'undefined') return null;

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, 'application/xml');
    pruneMcAlternateContentFallbacks(xmlDoc);

    const bodyEl = findAllDescendantsByLocalName(xmlDoc, 'body')[0];
    if (!bodyEl) return null;

    // 1. Parse word/styles.xml
    const stylesMap = parseDocxStylesXml(entries.get('word/styles.xml') || '');

    // 2. Parse word/_rels/document.xml.rels for embedded images & hyperlinks
    const docRelsMap = buildRelsMapFromXml(
      entries.get('word/_rels/document.xml.rels') || '',
      entries,
      parser
    );

    // 3. Parse word/numbering.xml to determine whether numId/ilvl is bullet or ordered
    const numFormatMap = new Map<string, string>(); // key: `${numId}:${ilvl}` -> 'bullet' | 'decimal' | ...
    const numberingXml = entries.get('word/numbering.xml') || '';
    if (numberingXml) {
      const numDoc = parser.parseFromString(numberingXml, 'application/xml');
      const abstractMap = new Map<string, Map<string, string>>();
      for (const absEl of findAllDescendantsByLocalName(numDoc, 'abstractNum')) {
        const absId = getXmlAttr(absEl, 'abstractNumId');
        const lvlMap = new Map<string, string>();
        for (const lvlEl of findAllDescendantsByLocalName(absEl, 'lvl')) {
          const ilvl = getXmlAttr(lvlEl, 'ilvl') || '0';
          const numFmtEl = findDirectChildByLocalName(lvlEl, 'numFmt');
          const fmtVal = getXmlAttr(numFmtEl, 'val') || 'bullet';
          lvlMap.set(ilvl, fmtVal);
        }
        if (absId) abstractMap.set(absId, lvlMap);
      }
      for (const numEl of findAllDescendantsByLocalName(numDoc, 'num')) {
        const numId = getXmlAttr(numEl, 'numId');
        const absRef = findDirectChildByLocalName(numEl, 'abstractNumId');
        const absId = getXmlAttr(absRef, 'val');
        const lvlMap = abstractMap.get(absId);
        if (numId && lvlMap) {
          lvlMap.forEach((fmt, ilvl) => {
            numFormatMap.set(`${numId}:${ilvl}`, fmt);
          });
        }
      }
    }

    const listCounters = new Map<string, number>();
    const blocks: WordContentBlock[] = [];
    const htmlBodyParts: string[] = [];
    const sidebarBorderImages: string[] = [];

    // Forward declaration so processParagraph and processTable can call each other recursively
    let processTable: (
      tblEl: Element,
      activeRelsMap?: Map<string, string>
    ) => { html: string; tableBlock: WordContentBlock | null };

    // Parse a single <w:p> paragraph element into both HTML and WordContentBlock(s)
    const processParagraph = (
      pEl: Element,
      insideTableCell = false,
      activeRelsMap: Map<string, string> = docRelsMap
    ): { html: string; pBlocks: WordContentBlock[]; isEmptySpacer: boolean } => {
      const pBlocks: WordContentBlock[] = [];
      const pPr = findDirectChildByLocalName(pEl, 'pPr');
      const pStyleEl = findDirectChildByLocalName(pPr, 'pStyle');
      const styleId = getXmlAttr(pStyleEl, 'val');
      const styleDef = styleId ? stylesMap.get(styleId) : undefined;

      let headingLevel = styleDef?.headingLevel;
      let align = styleDef?.align;
      let fontSizePt = styleDef?.fontSizePt || 11;
      let pBold = styleDef?.bold;
      let pItalic = styleDef?.italic;
      let pUnderline = styleDef?.underline;
      let pColorHex = styleDef?.colorHex;
      let pBgColorHex = styleDef?.bgColorHex;
      let indentLeftPt = styleDef?.indentLeftPt || 0;
      let indentRightPt = styleDef?.indentRightPt || 0;
      let firstLineIndentPt = styleDef?.firstLineIndentPt || 0;
      let spaceBeforePt = styleDef?.spaceBeforePt ?? 0;
      let spaceAfterPt = styleDef?.spaceAfterPt ?? (insideTableCell ? 2 : 5);
      let bottomBorderColor = styleDef?.bottomBorderColor;
      let pageBreakBefore = false;
      let hasUnderscoreTabLeader = false;
      let listPrefix = '';
      let isListParagraph = false;

      if (pPr) {
        const jcEl = findDirectChildByLocalName(pPr, 'jc');
        const jcAlign = parseWordJcToAlign(getXmlAttr(jcEl, 'val'));
        if (jcAlign) align = jcAlign;

        const tabsEl = findDirectChildByLocalName(pPr, 'tabs');
        if (tabsEl) {
          for (const tEl of findAllDescendantsByLocalName(tabsEl, 'tab')) {
            const ldr = getXmlAttr(tEl, 'leader').toLowerCase();
            if (ldr === 'underscore' || ldr === 'heavy' || ldr === 'dot') {
              hasUnderscoreTabLeader = true;
            }
          }
        }

        const indEl = findDirectChildByLocalName(pPr, 'ind');
        if (indEl) {
          const l = Number(
            getXmlAttr(indEl, 'left') || getXmlAttr(indEl, 'start') || '0'
          );
          const r = Number(
            getXmlAttr(indEl, 'right') || getXmlAttr(indEl, 'end') || '0'
          );
          const fl = Number(getXmlAttr(indEl, 'firstLine') || '0');
          const hg = Number(getXmlAttr(indEl, 'hanging') || '0');
          if (l > 0) indentLeftPt = l / 20;
          if (r > 0) indentRightPt = r / 20;
          if (fl > 0) firstLineIndentPt = fl / 20;
          else if (hg > 0) firstLineIndentPt = -hg / 20;
        }

        const spacingEl = findDirectChildByLocalName(pPr, 'spacing');
        if (spacingEl) {
          const b = Number(getXmlAttr(spacingEl, 'before') || '-1');
          const a = Number(getXmlAttr(spacingEl, 'after') || '-1');
          if (b >= 0) spaceBeforePt = b / 20;
          if (a >= 0) spaceAfterPt = a / 20;
        }

        const shdEl = findDirectChildByLocalName(pPr, 'shd');
        const fillVal = getXmlAttr(shdEl, 'fill');
        if (
          fillVal &&
          /^[0-9a-fA-F]{6}$/.test(fillVal) &&
          fillVal.toLowerCase() !== 'ffffff'
        ) {
          pBgColorHex = `#${fillVal}`;
        }

        const pBdrEl = findDirectChildByLocalName(pPr, 'pBdr');
        if (pBdrEl) {
          const botEl = findDirectChildByLocalName(pBdrEl, 'bottom');
          if (botEl && getXmlAttr(botEl, 'val') !== 'none') {
            const c = getXmlAttr(botEl, 'color');
            bottomBorderColor =
              c && /^[0-9a-fA-F]{6}$/.test(c) ? `#${c}` : '#CBD5E1';
          }
        }

        if (findDirectChildByLocalName(pPr, 'pageBreakBefore')) {
          pageBreakBefore = true;
        }

        const numPrEl = findDirectChildByLocalName(pPr, 'numPr');
        if (numPrEl) {
          isListParagraph = true;
          const ilvlEl = findDirectChildByLocalName(numPrEl, 'ilvl');
          const numIdEl = findDirectChildByLocalName(numPrEl, 'numId');
          const ilvl = Number(getXmlAttr(ilvlEl, 'val') || '0');
          const numId = getXmlAttr(numIdEl, 'val') || '1';
          const fmt =
            numFormatMap.get(`${numId}:${ilvl}`) ||
            numFormatMap.get(`${numId}:0`) ||
            'bullet';
          if (indentLeftPt === 0) {
            indentLeftPt = (ilvl + 1) * 16;
          }
          if (fmt === 'bullet') {
            listPrefix = ilvl === 0 ? '• ' : ilvl === 1 ? '◦ ' : '▪ ';
          } else {
            const counterKey = `${numId}:${ilvl}`;
            const nextCount = (listCounters.get(counterKey) || 0) + 1;
            listCounters.set(counterKey, nextCount);
            listPrefix = `${nextCount}. `;
          }
        }
      }

      const runs: WordInlineRun[] = [];
      const htmlRunFragments: string[] = [];
      if (listPrefix) {
        runs.push({
          text: listPrefix,
          bold: true,
          colorHex: pColorHex,
          fontSizePt,
        });
        htmlRunFragments.push(
          `<span class="word-list-marker">${escapeHtmlText(listPrefix)}</span>`
        );
      }

      const embeddedImages: Array<{
        dataUrl: string;
        widthPt: number;
        heightPt: number;
      }> = [];

      const processDrawingOrRunContainer = (
        rEl: Element,
        linkHref?: string
      ) => {
        const rPr = findDirectChildByLocalName(rEl, 'rPr');
        let bold = pBold;
        let italic = pItalic;
        let underline = pUnderline;
        let strike = false;
        let colorHex = pColorHex;
        let bgColorHex: string | undefined;
        let runFontSizePt = fontSizePt;
        let vertAlign: string | undefined;

        if (rPr) {
          const bEl = findDirectChildByLocalName(rPr, 'b');
          if (bEl) {
            const v = getXmlAttr(bEl, 'val');
            bold = v !== '0' && v !== 'false';
          }
          const iEl = findDirectChildByLocalName(rPr, 'i');
          if (iEl) {
            const v = getXmlAttr(iEl, 'val');
            italic = v !== '0' && v !== 'false';
          }
          const uEl = findDirectChildByLocalName(rPr, 'u');
          if (uEl) {
            const v = getXmlAttr(uEl, 'val');
            underline = v !== 'none' && v !== '0' && v !== 'false';
          }
          const sEl = findDirectChildByLocalName(rPr, 'strike');
          if (sEl) {
            const v = getXmlAttr(sEl, 'val');
            strike = v !== '0' && v !== 'false';
          }
          const szEl = findDirectChildByLocalName(rPr, 'sz');
          const szVal = Number(getXmlAttr(szEl, 'val'));
          if (szVal > 0) runFontSizePt = szVal / 2;

          const colorEl = findDirectChildByLocalName(rPr, 'color');
          const cVal = getXmlAttr(colorEl, 'val');
          if (cVal && /^[0-9a-fA-F]{6}$/.test(cVal)) {
            colorHex = `#${cVal}`;
          }

          const hlEl = findDirectChildByLocalName(rPr, 'highlight');
          const hlVal = getXmlAttr(hlEl, 'val');
          if (hlVal) {
            bgColorHex = mapWordHighlightNameToHex(hlVal);
          }
          const rShdEl = findDirectChildByLocalName(rPr, 'shd');
          const rShdFill = getXmlAttr(rShdEl, 'fill');
          if (
            !bgColorHex &&
            rShdFill &&
            /^[0-9a-fA-F]{6}$/.test(rShdFill) &&
            rShdFill.toLowerCase() !== 'ffffff'
          ) {
            bgColorHex = `#${rShdFill}`;
          }

          const vaEl = findDirectChildByLocalName(rPr, 'vertAlign');
          if (vaEl) vertAlign = getXmlAttr(vaEl, 'val');
        }

        // 1. Check for embedded images (<w:drawing> / <w:pict> -> a:blip r:embed or v:imagedata r:id)
        // Skip blips that are inside a nested <w:txbxContent> so they are rendered inside their textbox instead of twice!
        const allBlipEls = findAllDescendantsByLocalName(rEl, 'blip').filter(
          (el) => !hasAncestorWithLocalName(el, rEl, 'txbxContent')
        );
        const allImgDataEls = findAllDescendantsByLocalName(
          rEl,
          'imagedata'
        ).filter((el) => !hasAncestorWithLocalName(el, rEl, 'txbxContent'));

        const seenImageEmbedIds = new Set<string>();
        const registerRunImage = (embedId: string, sourceEl: Element) => {
          if (!embedId || seenImageEmbedIds.has(embedId)) return;
          seenImageEmbedIds.add(embedId);
          const imgDataUrl =
            activeRelsMap.get(embedId) || docRelsMap.get(embedId);
          if (!imgDataUrl || !imgDataUrl.startsWith('data:image/')) return;

          // Find dimensions specific to this drawing/pict container
          let drawContainer: Element | null = sourceEl.parentElement;
          while (drawContainer && drawContainer !== rEl) {
            const lName = drawContainer.tagName
              .replace(/^.*:/, '')
              .toLowerCase();
            if (lName === 'inline' || lName === 'anchor' || lName === 'shape') {
              break;
            }
            drawContainer = drawContainer.parentElement;
          }
          const extentEl = drawContainer
            ? findAllDescendantsByLocalName(drawContainer, 'extent')[0]
            : findAllDescendantsByLocalName(rEl, 'extent')[0];

          let widthPt = 240;
          let heightPt = 140;
          if (extentEl) {
            const cx = Number(extentEl.getAttribute('cx') || '0');
            const cy = Number(extentEl.getAttribute('cy') || '0');
            if (cx > 0 && cy > 0) {
              widthPt = Math.min(480, Math.max(20, cx / 12700));
              heightPt = Math.min(760, Math.max(20, cy / 12700));
            }
          }

          // Detect tall left-margin decorative sidebar pattern (e.g. Feza Schools left geometric strip)
          const isVerticalSidebarGraphic =
            widthPt < 140 && heightPt > widthPt * 2.3 && heightPt > 260;

          if (isVerticalSidebarGraphic) {
            if (!sidebarBorderImages.includes(imgDataUrl)) {
              sidebarBorderImages.push(imgDataUrl);
            }
            return;
          }

          embeddedImages.push({ dataUrl: imgDataUrl, widthPt, heightPt });
          const isLogoLike = widthPt >= 100 && widthPt <= 340 && heightPt <= 180;
          const imgCssStyle = isLogoLike
            ? `width:${Math.round(
                widthPt * 1.15
              )}px;max-width:72%;max-height:135px;object-fit:contain;display:block;margin:4px auto 8px auto;`
            : `width:${Math.round(
                widthPt * 1.25
              )}px;max-width:100%;height:auto;vertical-align:middle;margin:4px 0;`;

          htmlRunFragments.push(
            `<img src="${imgDataUrl}" alt="Embedded Word Graphic" style="${imgCssStyle}" />`
          );
        };

        for (const blip of allBlipEls) {
          const embedId =
            blip.getAttribute('r:embed') ||
            blip.getAttribute('embed') ||
            blip.getAttribute('r:link') ||
            '';
          registerRunImage(embedId, blip);
        }
        for (const vImg of allImgDataEls) {
          const rId =
            vImg.getAttribute('r:id') ||
            vImg.getAttribute('o:relid') ||
            vImg.getAttribute('id') ||
            '';
          registerRunImage(rId, vImg);
        }

        // 2. Extract ALL Word Text Boxes (<w:txbxContent>) inside drawings/shapes/group-shapes
        // Because pruneMcAlternateContentFallbacks already removed <mc:Fallback>, every <w:txbxContent> is a distinct real shape!
        const txbxEls = findAllDescendantsByLocalName(
          rEl,
          'txbxContent'
        ).filter((el) => !hasAncestorWithLocalName(el, rEl, 'txbxContent'));

        if (txbxEls.length > 0) {
          const renderedBoxes: Array<{
            html: string;
            isCompactBadge: boolean;
          }> = [];

          for (const txbx of txbxEls) {
            const shapeStyle = extractShapeContainerStyle(txbx);
            const txbxParts: string[] = [];
            let txbxTextLen = 0;
            let hasTableInTxbx = false;

            const processTxbxChild = (txChild: Element) => {
              const txLocal = txChild.tagName.replace(/^.*:/, '').toLowerCase();
              if (txLocal === 'p') {
                const subRes = processParagraph(txChild, true, activeRelsMap);
                if (!subRes.isEmptySpacer) {
                  txbxParts.push(subRes.html);
                  pBlocks.push(...subRes.pBlocks);
                  txbxTextLen += subRes.pBlocks.reduce(
                    (acc, b) => acc + (b.text || '').length,
                    0
                  );
                }
              } else if (txLocal === 'tbl') {
                const tblRes = processTable(txChild, activeRelsMap);
                if (tblRes.html) {
                  hasTableInTxbx = true;
                  txbxParts.push(tblRes.html);
                }
                if (tblRes.tableBlock) {
                  pBlocks.push(tblRes.tableBlock);
                }
              } else if (txLocal === 'sdt') {
                const sdtContent = findDirectChildByLocalName(
                  txChild,
                  'sdtContent'
                );
                if (sdtContent) {
                  for (let sIdx = 0; sIdx < sdtContent.children.length; sIdx++) {
                    processTxbxChild(sdtContent.children[sIdx]);
                  }
                }
              }
            };

            for (let tIdx = 0; tIdx < txbx.children.length; tIdx++) {
              processTxbxChild(txbx.children[tIdx]);
            }

            if (txbxParts.length > 0) {
              const isCompactBadge =
                !hasTableInTxbx &&
                txbxParts.length === 1 &&
                txbxTextLen > 0 &&
                txbxTextLen <= 24 &&
                (Boolean(shapeStyle.bgColorHex) ||
                  Boolean(shapeStyle.isRounded) ||
                  (shapeStyle.widthPt !== undefined &&
                    shapeStyle.widthPt < 170));

              const boxCss: string[] = [];
              if (shapeStyle.bgColorHex) {
                boxCss.push(`background-color:${shapeStyle.bgColorHex}`);
                boxCss.push('padding:5px 12px');
              } else if (shapeStyle.borderColorHex) {
                boxCss.push(`border:1px solid ${shapeStyle.borderColorHex}`);
                boxCss.push('padding:6px 10px');
              }
              if (shapeStyle.isRounded) {
                boxCss.push('border-radius:6px');
              } else if (shapeStyle.bgColorHex) {
                boxCss.push('border-radius:3px');
              }

              if (isCompactBadge) {
                if (!shapeStyle.bgColorHex) {
                  boxCss.push('background-color:#FBE4D5');
                  boxCss.push('padding:4px 12px');
                  boxCss.push('border-radius:6px');
                }
                boxCss.push('display:inline-block');
                boxCss.push('text-align:center');
                boxCss.push('font-weight:700');
              } else {
                boxCss.push('margin:6pt 0');
              }

              renderedBoxes.push({
                html: `<div class="word-textbox" style="${boxCss.join(
                  ';'
                )}">${txbxParts.join('')}</div>`,
                isCompactBadge,
              });
            }
          }

          if (renderedBoxes.length > 0) {
            if (
              renderedBoxes.length > 1 &&
              renderedBoxes.every((b) => b.isCompactBadge)
            ) {
              htmlRunFragments.push(
                `<div class="word-textbox-group" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center;margin:8pt 0;background:#FBE4D5;padding:6px 10px;border-radius:6px;">${renderedBoxes
                  .map((b) => b.html)
                  .join('')}</div>`
              );
            } else {
              for (const b of renderedBoxes) {
                if (b.isCompactBadge) {
                  htmlRunFragments.push(
                    `<div style="text-align:center;margin:8pt 0;">${b.html}</div>`
                  );
                } else {
                  htmlRunFragments.push(b.html);
                }
              }
            }
          }
        }

        // 3. Collect text, tabs, and breaks in child order
        let runTextBuffer = '';
        const flushRunTextBuffer = () => {
          if (!runTextBuffer) return;
          const textChunk = runTextBuffer;
          runTextBuffer = '';

          runs.push({
            text: textChunk,
            bold,
            italic,
            underline: underline || Boolean(linkHref),
            strike,
            colorHex: colorHex || (linkHref ? '#2563EB' : undefined),
            bgColorHex,
            fontSizePt: runFontSizePt,
          });

          const inlineStyles: string[] = [];
          if (runFontSizePt && Math.abs(runFontSizePt - fontSizePt) >= 0.5) {
            inlineStyles.push(`font-size:${runFontSizePt}pt`);
          }
          if (colorHex) inlineStyles.push(`color:${colorHex}`);
          if (bgColorHex) {
            inlineStyles.push(
              `background-color:${bgColorHex};padding:0 2px;border-radius:2px`
            );
          }
          if (bold) inlineStyles.push('font-weight:700');
          if (italic) inlineStyles.push('font-style:italic');
          if (underline && strike) {
            inlineStyles.push('text-decoration:underline line-through');
          } else if (underline) {
            inlineStyles.push('text-decoration:underline');
          } else if (strike) {
            inlineStyles.push('text-decoration:line-through');
          }

          let frag = escapeHtmlText(textChunk);
          if (vertAlign === 'superscript') frag = `<sup>${frag}</sup>`;
          else if (vertAlign === 'subscript') frag = `<sub>${frag}</sub>`;

          if (inlineStyles.length > 0) {
            frag = `<span style="${inlineStyles.join(';')}">${frag}</span>`;
          }
          if (linkHref) {
            frag = `<a href="${escapeHtmlText(
              linkHref
            )}" target="_blank" rel="noopener noreferrer" style="color:#2563EB;text-decoration:underline;">${frag}</a>`;
          }
          htmlRunFragments.push(frag);
        };

        for (let i = 0; i < rEl.children.length; i++) {
          const child = rEl.children[i];
          const cTag = child.tagName.toLowerCase();
          if (cTag === 'w:t' || cTag === 't' || cTag === 'w:deltext') {
            runTextBuffer += child.textContent || '';
          } else if (cTag === 'w:tab' || cTag === 'tab') {
            flushRunTextBuffer();
            if (underline || hasUnderscoreTabLeader) {
              runs.push({
                text: ' ________________ ',
                underline: true,
                fontSizePt: runFontSizePt,
              });
              htmlRunFragments.push(
                '<span class="word-tab-line" style="display:inline-block;min-width:115px;border-bottom:1px solid #1E293B;margin:0 6px;vertical-align:baseline;">&nbsp;</span>'
              );
            } else {
              runs.push({ text: '    ', fontSizePt: runFontSizePt });
              htmlRunFragments.push(
                '<span class="word-tab" style="display:inline-block;min-width:26px;">&emsp;</span>'
              );
            }
          } else if (cTag === 'w:br' || cTag === 'br' || cTag === 'w:cr') {
            flushRunTextBuffer();
            const brType = getXmlAttr(child, 'type');
            if (brType === 'page') {
              pageBreakBefore = true;
            } else {
              runs.push({ text: '\n', fontSizePt: runFontSizePt });
              htmlRunFragments.push('<br />');
            }
          }
        }
        flushRunTextBuffer();
      };

      // Parse Office MathML (<m:oMath>, <m:oMathPara>) into readable mathematical notation & HTML
      const parseOfficeMathNode = (
        mathEl: Element
      ): { text: string; html: string } => {
        const local = mathEl.tagName.replace(/^.*:/, '').toLowerCase();
        if (local === 't') {
          const t = mathEl.textContent || '';
          return { text: t, html: escapeHtmlText(t) };
        }
        if (local === 'f') {
          const numEl = findDirectChildByLocalName(mathEl, 'num');
          const denEl = findDirectChildByLocalName(mathEl, 'den');
          const num = numEl
            ? parseOfficeMathChildren(numEl)
            : { text: '', html: '' };
          const den = denEl
            ? parseOfficeMathChildren(denEl)
            : { text: '', html: '' };
          return {
            text: `(${num.text})/(${den.text})`,
            html: `<span class="word-math-frac" style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;padding:0 3px;font-size:0.92em;"><span style="border-bottom:1px solid currentColor;padding:0 2px;">${num.html}</span><span style="padding:0 2px;">${den.html}</span></span>`,
          };
        }
        if (local === 'rad') {
          const degEl = findDirectChildByLocalName(mathEl, 'deg');
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const deg = degEl
            ? parseOfficeMathChildren(degEl)
            : { text: '', html: '' };
          const body = eEl
            ? parseOfficeMathChildren(eEl)
            : { text: '', html: '' };
          return {
            text: deg.text ? `${deg.text}√(${body.text})` : `√(${body.text})`,
            html: `${deg.html ? `<sup>${deg.html}</sup>` : ''}&radic;<span style="border-top:1px solid currentColor;padding:0 2px;">${body.html}</span>`,
          };
        }
        if (local === 'ssup') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const supEl = findDirectChildByLocalName(mathEl, 'sup');
          const base = eEl
            ? parseOfficeMathChildren(eEl)
            : { text: '', html: '' };
          const sup = supEl
            ? parseOfficeMathChildren(supEl)
            : { text: '', html: '' };
          return {
            text: `${base.text}^(${sup.text})`,
            html: `${base.html}<sup>${sup.html}</sup>`,
          };
        }
        if (local === 'ssub') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const subEl = findDirectChildByLocalName(mathEl, 'sub');
          const base = eEl
            ? parseOfficeMathChildren(eEl)
            : { text: '', html: '' };
          const sub = subEl
            ? parseOfficeMathChildren(subEl)
            : { text: '', html: '' };
          return {
            text: `${base.text}_(${sub.text})`,
            html: `${base.html}<sub>${sub.html}</sub>`,
          };
        }
        if (local === 'ssubsup') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const subEl = findDirectChildByLocalName(mathEl, 'sub');
          const supEl = findDirectChildByLocalName(mathEl, 'sup');
          const base = eEl
            ? parseOfficeMathChildren(eEl)
            : { text: '', html: '' };
          const sub = subEl
            ? parseOfficeMathChildren(subEl)
            : { text: '', html: '' };
          const sup = supEl
            ? parseOfficeMathChildren(supEl)
            : { text: '', html: '' };
          return {
            text: `${base.text}_(${sub.text})^(${sup.text})`,
            html: `${base.html}<sub>${sub.html}</sub><sup>${sup.html}</sup>`,
          };
        }
        if (local === 'nary') {
          const naryPr = findDirectChildByLocalName(mathEl, 'naryPr');
          const chrEl = naryPr ? findDirectChildByLocalName(naryPr, 'chr') : null;
          const symbol = getXmlAttr(chrEl, 'val') || '∑';
          const subEl = findDirectChildByLocalName(mathEl, 'sub');
          const supEl = findDirectChildByLocalName(mathEl, 'sup');
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const sub = subEl
            ? parseOfficeMathChildren(subEl)
            : { text: '', html: '' };
          const sup = supEl
            ? parseOfficeMathChildren(supEl)
            : { text: '', html: '' };
          const body = eEl
            ? parseOfficeMathChildren(eEl)
            : { text: '', html: '' };
          return {
            text: `${symbol}${sub.text ? `_(${sub.text})` : ''}${sup.text ? `^(${sup.text})` : ''} ${body.text}`,
            html: `<span style="font-size:1.15em;">${escapeHtmlText(symbol)}</span>${sub.html ? `<sub>${sub.html}</sub>` : ''}${sup.html ? `<sup>${sup.html}</sup>` : ''} ${body.html}`,
          };
        }
        if (local === 'd') {
          const dPr = findDirectChildByLocalName(mathEl, 'dPr');
          const begChr =
            getXmlAttr(
              dPr ? findDirectChildByLocalName(dPr, 'begChr') : null,
              'val'
            ) || '(';
          const endChr =
            getXmlAttr(
              dPr ? findDirectChildByLocalName(dPr, 'endChr') : null,
              'val'
            ) || ')';
          const inner = parseOfficeMathChildren(mathEl);
          return {
            text: `${begChr}${inner.text}${endChr}`,
            html: `${escapeHtmlText(begChr)}${inner.html}${escapeHtmlText(endChr)}`,
          };
        }
        if (local === 'eqarr' || local === 'm') {
          const rows = findAllDescendantsByLocalName(mathEl, 'mr');
          if (rows.length > 0) {
            const rParts = rows.map((r) => parseOfficeMathChildren(r));
            return {
              text: `[${rParts.map((p) => p.text).join('; ')}]`,
              html: `[${rParts.map((p) => p.html).join('; ')}]`,
            };
          }
        }
        return parseOfficeMathChildren(mathEl);
      };

      const parseOfficeMathChildren = (
        container: Element
      ): { text: string; html: string } => {
        let tOut = '';
        let hOut = '';
        for (let i = 0; i < container.children.length; i++) {
          const c = container.children[i];
          const cLocal = c.tagName.replace(/^.*:/, '').toLowerCase();
          if (
            cLocal === 'rpr' ||
            cLocal === 'ctrlpr' ||
            cLocal === 'fpr' ||
            cLocal === 'radpr' ||
            cLocal === 'ssuppr' ||
            cLocal === 'ssubpr' ||
            cLocal === 'narypr' ||
            cLocal === 'dpr' ||
            cLocal === 'mpr'
          ) {
            continue;
          }
          const sub = parseOfficeMathNode(c);
          tOut += sub.text;
          hOut += sub.html;
        }
        return { text: tOut, html: hOut };
      };

      for (let i = 0; i < pEl.children.length; i++) {
        const child = pEl.children[i];
        const cTag = child.tagName.toLowerCase();
        const cLocal = cTag.replace(/^.*:/, '');
        if (cLocal === 'r' || cLocal === 'drawing' || cLocal === 'pict') {
          processDrawingOrRunContainer(child);
        } else if (cLocal === 'hyperlink') {
          const rId = getXmlAttr(child, 'id');
          const href = rId ? activeRelsMap.get(rId) : undefined;
          for (const subR of findAllDescendantsByLocalName(child, 'r')) {
            if (!hasAncestorWithLocalName(subR, child, 'txbxContent')) {
              processDrawingOrRunContainer(subR, href);
            }
          }
        } else if (cLocal === 'omathpara' || cLocal === 'omath') {
          const mathRes = parseOfficeMathNode(child);
          if (mathRes.text.trim()) {
            runs.push({
              text: ` ${mathRes.text.trim()} `,
              italic: true,
              fontSizePt,
            });
            htmlRunFragments.push(
              `<span class="word-math" style="font-family:'Cambria Math','Times New Roman',serif;font-style:italic;background:#F8FAFC;padding:2px 6px;border-radius:4px;border:1px solid #E2E8F0;margin:0 2px;display:inline-block;">${mathRes.html}</span>`
            );
          }
        } else if (
          cLocal === 'sdt' ||
          cLocal === 'smarttag' ||
          cLocal === 'ins' ||
          cLocal === 'fldsimple' ||
          cLocal === 'alternatecontent' ||
          cLocal === 'customxml'
        ) {
          const innerRuns = findAllDescendantsByLocalName(child, 'r').filter(
            (el) => !hasAncestorWithLocalName(el, child, 'txbxContent')
          );
          if (innerRuns.length > 0) {
            for (const subR of innerRuns) {
              processDrawingOrRunContainer(subR);
            }
          } else {
            processDrawingOrRunContainer(child);
          }
        }
      }

      for (const img of embeddedImages) {
        pBlocks.push({
          type: 'image',
          imageDataUrl: img.dataUrl,
          imageWidthPt: img.widthPt,
          imageHeightPt: img.heightPt,
          align: align || 'center',
        });
      }

      const combinedText = runs
        .map((r) => r.text)
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim();

      const pCss: string[] = [];
      if (align) pCss.push(`text-align:${align}`);
      if (fontSizePt) pCss.push(`font-size:${fontSizePt}pt`);
      if (pColorHex) pCss.push(`color:${pColorHex}`);
      if (pBgColorHex) {
        pCss.push(
          `background-color:${pBgColorHex};padding:5px 10px;border-radius:4px`
        );
      }
      if (indentLeftPt > 0) pCss.push(`margin-left:${indentLeftPt}pt`);
      if (indentRightPt > 0) pCss.push(`margin-right:${indentRightPt}pt`);
      if (firstLineIndentPt !== 0) {
        pCss.push(`text-indent:${firstLineIndentPt}pt`);
      }
      pCss.push(`margin-top:${spaceBeforePt}pt`);
      pCss.push(`margin-bottom:${spaceAfterPt}pt`);
      if (bottomBorderColor) {
        pCss.push(
          `border-bottom:1.5px solid ${bottomBorderColor};padding-bottom:4px`
        );
      }
      if (pageBreakBefore) {
        pCss.push('page-break-before:always');
      }

      const hasRenderableContent =
        Boolean(combinedText) ||
        embeddedImages.length > 0 ||
        htmlRunFragments.length > 0 ||
        pBlocks.length > 0;

      const tag = headingLevel || 'p';
      const innerHtml = htmlRunFragments.join('') || '&nbsp;';
      const html = hasRenderableContent
        ? `<${tag} style="${pCss.join(';')}">${innerHtml}</${tag}>`
        : `<p style="margin:0;height:6pt;">&nbsp;</p>`;

      if (combinedText) {
        const allBold =
          pBold ||
          (runs.length > 0 && runs.every((r) => !r.text.trim() || r.bold));
        const allItalic =
          pItalic ||
          (runs.length > 0 && runs.every((r) => !r.text.trim() || r.italic));
        const allUnderline =
          pUnderline ||
          (runs.length > 0 && runs.every((r) => !r.text.trim() || r.underline));

        pBlocks.push({
          type: headingLevel || (isListParagraph ? 'li' : 'p'),
          text: combinedText,
          bold: allBold,
          italic: allItalic,
          underline: allUnderline,
          align,
          fontSizePt,
          colorHex: pColorHex,
          bgColorHex: pBgColorHex,
          indentLeftPt,
          indentRightPt,
          firstLineIndentPt,
          spaceBeforePt,
          spaceAfterPt,
          bottomBorderColor,
          pageBreakBefore,
          runs,
        });
      }

      return {
        html,
        pBlocks,
        isEmptySpacer: !hasRenderableContent && !pageBreakBefore,
      };
    };

    // Parse a <w:tbl> table element preserving column widths, spans, shading & borders
    processTable = (
      tblEl: Element,
      activeRelsMap: Map<string, string> = docRelsMap
    ): { html: string; tableBlock: WordContentBlock | null } => {
      const tblPr = findDirectChildByLocalName(tblEl, 'tblPr');
      const tblBorders = tblPr
        ? findDirectChildByLocalName(tblPr, 'tblBorders')
        : null;
      let tableDefaultHasBorder = true;
      if (tblBorders) {
        const topB = findDirectChildByLocalName(tblBorders, 'top');
        const insideHB = findDirectChildByLocalName(tblBorders, 'insideH');
        const topVal = getXmlAttr(topB, 'val').toLowerCase();
        const insideHVal = getXmlAttr(insideHB, 'val').toLowerCase();
        if (
          (topVal === 'none' || topVal === 'nil') &&
          (insideHVal === 'none' || insideHVal === 'nil')
        ) {
          tableDefaultHasBorder = false;
        }
      }

      const tblGrid = findDirectChildByLocalName(tblEl, 'tblGrid');
      const gridCols: number[] = [];
      if (tblGrid) {
        for (const colEl of findAllDescendantsByLocalName(tblGrid, 'gridCol')) {
          const w = Number(getXmlAttr(colEl, 'w') || '0');
          if (w > 0) gridCols.push(w);
        }
      }

      const totalGridW = gridCols.reduce((acc, w) => acc + w, 0);
      const colWidthRatios =
        totalGridW > 0 ? gridCols.map((w) => w / totalGridW) : undefined;

      const rows: string[][] = [];
      const richCells: WordRichTableCell[][] = [];
      const trHtmls: string[] = [];

      const trList: Element[] = [];
      for (let i = 0; i < tblEl.children.length; i++) {
        const c = tblEl.children[i];
        const tag = c.tagName.toLowerCase();
        if (tag === 'w:tr' || tag === 'tr') trList.push(c);
      }

      trList.forEach((trEl, rIdx) => {
        const rowCells: string[] = [];
        const richRow: WordRichTableCell[] = [];
        const tdHtmls: string[] = [];

        const tcList: Element[] = [];
        for (let i = 0; i < trEl.children.length; i++) {
          const c = trEl.children[i];
          const tag = c.tagName.toLowerCase();
          if (tag === 'w:tc' || tag === 'tc') tcList.push(c);
        }

        tcList.forEach((tcEl, cIdx) => {
          const tcPr = findDirectChildByLocalName(tcEl, 'tcPr');
          let colSpan = 1;
          let bgColorHex: string | undefined;
          let vAlign = 'middle';
          let cellHasBottomLineOnly = false;
          let cellHideAllBorders = !tableDefaultHasBorder;

          if (tcPr) {
            const gsEl = findDirectChildByLocalName(tcPr, 'gridSpan');
            const gsVal = Number(getXmlAttr(gsEl, 'val') || '1');
            if (gsVal > 1) colSpan = gsVal;

            const shdEl = findDirectChildByLocalName(tcPr, 'shd');
            const fillVal = getXmlAttr(shdEl, 'fill');
            if (
              fillVal &&
              /^[0-9a-fA-F]{6}$/.test(fillVal) &&
              fillVal.toLowerCase() !== 'auto' &&
              fillVal.toLowerCase() !== 'ffffff'
            ) {
              bgColorHex = `#${fillVal}`;
            }

            const vaEl = findDirectChildByLocalName(tcPr, 'vAlign');
            const vaVal = getXmlAttr(vaEl, 'val').toLowerCase();
            if (vaVal === 'top') vAlign = 'top';
            else if (vaVal === 'bottom') vAlign = 'bottom';

            const tcBorders = findDirectChildByLocalName(tcPr, 'tcBorders');
            if (tcBorders) {
              const botB = findDirectChildByLocalName(tcBorders, 'bottom');
              const topB = findDirectChildByLocalName(tcBorders, 'top');
              const leftB = findDirectChildByLocalName(tcBorders, 'left');
              const botVal = getXmlAttr(botB, 'val').toLowerCase();
              const topVal = getXmlAttr(topB, 'val').toLowerCase();
              const leftVal = getXmlAttr(leftB, 'val').toLowerCase();
              if (
                botVal &&
                botVal !== 'none' &&
                botVal !== 'nil' &&
                (!topVal || topVal === 'none' || topVal === 'nil') &&
                (!leftVal || leftVal === 'none' || leftVal === 'nil')
              ) {
                cellHasBottomLineOnly = true;
              } else if (
                botVal &&
                botVal !== 'none' &&
                botVal !== 'nil'
              ) {
                cellHideAllBorders = false;
              }
            }
          }

          const cellParagraphHtmls: string[] = [];
          const cellBlocks: WordContentBlock[] = [];
          for (let i = 0; i < tcEl.children.length; i++) {
            const child = tcEl.children[i];
            const local = child.tagName.replace(/^.*:/, '').toLowerCase();
            if (local === 'p') {
              const res = processParagraph(child, true, activeRelsMap);
              if (!res.isEmptySpacer || cellParagraphHtmls.length === 0) {
                cellParagraphHtmls.push(res.html);
              }
              cellBlocks.push(...res.pBlocks);
            } else if (local === 'tbl') {
              const subTbl = processTable(child, activeRelsMap);
              if (subTbl.html) cellParagraphHtmls.push(subTbl.html);
              if (subTbl.tableBlock) cellBlocks.push(subTbl.tableBlock);
            }
          }

          const cellText = cellBlocks
            .map((b) => b.text || '')
            .filter(Boolean)
            .join('\n');
          const firstBlock = cellBlocks[0];
          const cellAlign = firstBlock?.align || 'left';
          const cellBold =
            firstBlock?.bold || (rIdx === 0 && !firstBlock?.colorHex);
          const cellColor = firstBlock?.colorHex;

          rowCells.push(cellText);
          richRow.push({
            text: cellText,
            align: cellAlign,
            bold: cellBold,
            italic: firstBlock?.italic,
            colorHex: cellColor,
            bgColorHex,
            colSpan,
          });

          for (let s = 1; s < colSpan; s++) {
            rowCells.push('');
          }

          const tdCss: string[] = [
            'padding:4px 8px',
            `vertical-align:${vAlign}`,
          ];
          if (cellHasBottomLineOnly) {
            tdCss.push('border:none');
            tdCss.push('border-bottom:1px solid #1E293B');
          } else if (cellHideAllBorders) {
            tdCss.push('border:none');
          } else {
            tdCss.push('border:1px solid #64748B');
          }

          if (bgColorHex) {
            tdCss.push(`background-color:${bgColorHex}`);
          }
          if (colWidthRatios && colWidthRatios[cIdx] && colSpan === 1) {
            tdCss.push(`width:${(colWidthRatios[cIdx] * 100).toFixed(1)}%`);
          }

          const colspanAttr = colSpan > 1 ? ` colspan="${colSpan}"` : '';
          tdHtmls.push(
            `<td${colspanAttr} style="${tdCss.join(';')}">${
              cellParagraphHtmls.join('') || '&nbsp;'
            }</td>`
          );
        });

        if (rowCells.length > 0) {
          rows.push(rowCells);
          richCells.push(richRow);
          trHtmls.push(`<tr>${tdHtmls.join('')}</tr>`);
        }
      });

      if (rows.length === 0) {
        return { html: '', tableBlock: null };
      }

      const colGroupHtml =
        colWidthRatios && colWidthRatios.length > 0
          ? `<colgroup>${colWidthRatios
              .map((r) => `<col style="width:${(r * 100).toFixed(2)}%;" />`)
              .join('')}</colgroup>`
          : '';

      const html = `<table class="word-table" style="width:100%;border-collapse:collapse;margin:6pt 0;table-layout:fixed;">${colGroupHtml}<tbody>${trHtmls.join(
        ''
      )}</tbody></table>`;

      return {
        html,
        tableBlock: {
          type: 'table',
          rows,
          colWidthRatios,
          richCells,
        },
      };
    };

    // Parse all header*.xml and footer*.xml files with their dedicated word/_rels/header*.xml.rels
    const extractHeaderFooterSection = (entryName: string): string => {
      const xmlStr = entries.get(entryName);
      if (!xmlStr) return '';
      try {
        const hfDoc = parser.parseFromString(xmlStr, 'application/xml');
        pruneMcAlternateContentFallbacks(hfDoc);
        const baseFile = entryName.replace(/^word\//, '');
        const hfRelsXml = entries.get(`word/_rels/${baseFile}.rels`) || '';
        const hfRelsMap = hfRelsXml
          ? buildRelsMapFromXml(hfRelsXml, entries, parser)
          : docRelsMap;

        const rootEl = hfDoc.documentElement;
        if (!rootEl) return '';
        const parts: string[] = [];
        for (let i = 0; i < rootEl.children.length; i++) {
          const child = rootEl.children[i];
          const local = child.tagName.replace(/^.*:/, '').toLowerCase();
          if (local === 'p') {
            const res = processParagraph(child, true, hfRelsMap);
            if (!res.isEmptySpacer) {
              parts.push(res.html);
            }
          } else if (local === 'tbl') {
            const res = processTable(child, hfRelsMap);
            if (res.html) parts.push(res.html);
          } else if (local === 'sdt') {
            const sdtContent = findDirectChildByLocalName(child, 'sdtContent');
            if (sdtContent) {
              for (let j = 0; j < sdtContent.children.length; j++) {
                const sub = sdtContent.children[j];
                const subLocal = sub.tagName.replace(/^.*:/, '').toLowerCase();
                if (subLocal === 'p') {
                  const res = processParagraph(sub, true, hfRelsMap);
                  if (!res.isEmptySpacer) parts.push(res.html);
                } else if (subLocal === 'tbl') {
                  const res = processTable(sub, hfRelsMap);
                  if (res.html) parts.push(res.html);
                }
              }
            }
          }
        }
        return parts.join('\n').trim();
      } catch {
        return '';
      }
    };

    const headerParts: string[] = [];
    for (const hName of ['word/header1.xml', 'word/header2.xml', 'word/header3.xml']) {
      const hContent = extractHeaderFooterSection(hName);
      if (hContent && !headerParts.includes(hContent)) {
        headerParts.push(hContent);
      }
    }
    const footerParts: string[] = [];
    for (const fName of ['word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml']) {
      const fContent = extractHeaderFooterSection(fName);
      if (fContent && !footerParts.includes(fContent)) {
        footerParts.push(fContent);
      }
    }

    const headerHtml = headerParts.join('\n');
    const footerHtml = footerParts.join('\n');

    // Walk top-level children of <w:body> in exact document order, collapsing excessive empty spacer streaks
    let emptyParagraphStreak = 0;
    const appendBodyNode = (nodeEl: Element) => {
      const local = nodeEl.tagName.replace(/^.*:/, '').toLowerCase();
      if (local === 'p') {
        const res = processParagraph(nodeEl, false, docRelsMap);
        if (res.isEmptySpacer) {
          emptyParagraphStreak++;
          if (emptyParagraphStreak === 1 && htmlBodyParts.length > 0) {
            htmlBodyParts.push(res.html);
          } else if (emptyParagraphStreak === 6 && htmlBodyParts.length > 0) {
            // 6+ empty paragraphs in Word is a manual page-break spacer used after floating cover-page shapes
            htmlBodyParts.push('<hr class="word-page-divider" />');
          }
        } else {
          emptyParagraphStreak = 0;
          htmlBodyParts.push(res.html);
          blocks.push(...res.pBlocks);
        }
      } else if (local === 'tbl') {
        emptyParagraphStreak = 0;
        const res = processTable(nodeEl, docRelsMap);
        if (res.html) htmlBodyParts.push(res.html);
        if (res.tableBlock) blocks.push(res.tableBlock);
      } else if (local === 'sdt') {
        const sdtContent = findDirectChildByLocalName(nodeEl, 'sdtContent');
        if (sdtContent) {
          for (let j = 0; j < sdtContent.children.length; j++) {
            appendBodyNode(sdtContent.children[j]);
          }
        }
      }
    };

    for (let i = 0; i < bodyEl.children.length; i++) {
      appendBodyNode(bodyEl.children[i]);
    }

    if (blocks.length === 0 && htmlBodyParts.length === 0) return null;

    // Extract optional Word section page margins (<w:sectPr> -> <w:pgMar>)
    const hasLeftSidebarStrip = sidebarBorderImages.length > 0;
    let pagePaddingCss = hasLeftSidebarStrip
      ? '18mm 16mm 18mm 24mm'
      : '20mm 18mm';
    const sectPrEl = findAllDescendantsByLocalName(bodyEl, 'sectPr')[0];
    if (sectPrEl) {
      const pgMarEl = findDirectChildByLocalName(sectPrEl, 'pgMar');
      if (pgMarEl) {
        const topTwips = Number(getXmlAttr(pgMarEl, 'top') || '1080');
        const bottomTwips = Number(getXmlAttr(pgMarEl, 'bottom') || '1080');
        const leftTwips = Number(getXmlAttr(pgMarEl, 'left') || '1080');
        const rightTwips = Number(getXmlAttr(pgMarEl, 'right') || '1080');
        const topPt = Math.max(14, Math.min(72, Math.round(topTwips / 20)));
        const bottomPt = Math.max(14, Math.min(72, Math.round(bottomTwips / 20)));
        const leftPt = hasLeftSidebarStrip
          ? Math.max(42, Math.min(80, Math.round(leftTwips / 20) + 22))
          : Math.max(14, Math.min(72, Math.round(leftTwips / 20)));
        const rightPt = Math.max(14, Math.min(72, Math.round(rightTwips / 20)));
        pagePaddingCss = `${topPt}pt ${rightPt}pt ${bottomPt}pt ${leftPt}pt`;
      }
    }

    const sidebarStripHtml = hasLeftSidebarStrip
      ? `<div class="word-left-border-strip" aria-hidden="true"><img src="${sidebarBorderImages[0]}" alt="" /></div>`
      : '';

    const plainText = wordBlocksToReadableText(blocks);
    const wordPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlText(fallbackTitle)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px 6px;
      background: #E2E8F0;
      font-family: Calibri, 'Segoe UI', Candara, 'Helvetica Neue', Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.42;
      color: #111827;
    }
    .word-page-sheet {
      position: relative;
      max-width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #FFFFFF;
      box-shadow: 0 8px 30px rgba(15, 23, 42, 0.14), 0 1px 3px rgba(15, 23, 42, 0.08);
      border: 1px solid #CBD5E1;
      padding: ${pagePaddingCss};
      overflow-wrap: break-word;
      word-wrap: break-word;
    }
    .word-left-border-strip {
      position: absolute;
      left: 4px;
      top: 8px;
      bottom: 8px;
      width: 26px;
      overflow: hidden;
      pointer-events: none;
      z-index: 1;
    }
    .word-left-border-strip img {
      width: 100%;
      height: auto;
      display: block;
    }
    @media (max-width: 640px) {
      body { padding: 4px 2px; font-size: 9.5pt; }
      .word-page-sheet {
        padding: ${hasLeftSidebarStrip ? '14px 10px 16px 34px' : '14px 12px'};
        min-height: auto;
      }
      .word-left-border-strip {
        left: 2px;
        width: 22px;
      }
      .word-tab-line {
        min-width: 72px !important;
      }
    }
    .word-doc-header {
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 6pt;
      margin-bottom: 10pt;
      color: #334155;
      font-size: 9.5pt;
    }
    .word-doc-footer {
      border-top: 1px solid #E2E8F0;
      padding-top: 6pt;
      margin-top: 14pt;
      color: #475569;
      font-size: 9.5pt;
    }
    .word-page-divider {
      border: 0;
      border-top: 2px dashed #CBD5E1;
      margin: 18pt 0;
    }
    h1, h2, h3, p {
      margin-top: 0;
    }
    h1 { font-size: 16pt; font-weight: 700; color: #0F172A; line-height: 1.25; }
    h2 { font-size: 13pt; font-weight: 700; color: #1E293B; line-height: 1.3; }
    h3 { font-size: 11.5pt; font-weight: 700; color: #334155; line-height: 1.35; }
    .word-list-marker {
      display: inline-block;
      min-width: 14pt;
      font-weight: 700;
    }
    table.word-table td, table.word-table th {
      word-break: break-word;
      font-size: 9.5pt;
    }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <article class="word-page-sheet">
    ${sidebarStripHtml}
    ${headerHtml ? `<header class="word-doc-header">${headerHtml}</header>` : ''}
    ${htmlBodyParts.join('\n')}
    ${footerHtml ? `<footer class="word-doc-footer">${footerHtml}</footer>` : ''}
  </article>
</body>
</html>`;

    return {
      blocks,
      plainText,
      htmlPreview: wordPageHtml,
    };
  } catch (err) {
    console.warn('Error in parseDocxZipWithFullWordLayout:', err);
    return null;
  }
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
      if (kdfJson.bookMetadata) {
        if (kdfJson.bookMetadata.title) {
          bookTitle = String(kdfJson.bookMetadata.title);
        }
        if (kdfJson.bookMetadata.author) {
          bookAuthor = String(kdfJson.bookMetadata.author);
        }
      }
      if (kdfJson.title) bookTitle = String(kdfJson.title);
      if (kdfJson.author) bookAuthor = String(kdfJson.author);
      if (Array.isArray(kdfJson.chapters)) {
        for (const ch of kdfJson.chapters) {
          const href = ch?.href || ch?.path;
          if (
            typeof href === 'string' &&
            /\.(?:xhtml|html|htm)$/i.test(href) &&
            entries.has(href)
          ) {
            orderedChapterPaths.push(href);
          }
        }
      }
      if (
        orderedChapterPaths.length === 0 &&
        Array.isArray(kdfJson.resources)
      ) {
        for (const res of kdfJson.resources) {
          if (
            res &&
            typeof res.path === 'string' &&
            /\.(?:xhtml|html|htm)$/i.test(res.path) &&
            res.role !== 'navigation' &&
            entries.has(res.path)
          ) {
            orderedChapterPaths.push(res.path);
          }
        }
      }
    } catch {
      // Ignore malformed kdf_manifest.json
    }
  }

  if (orderedChapterPaths.length === 0) {
    let opfPath = '';
    const containerXml = entries.get('META-INF/container.xml') || '';
    const fullPathMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
    if (fullPathMatch && entries.has(fullPathMatch[1])) {
      opfPath = fullPathMatch[1];
    } else {
      opfPath =
        Array.from(entries.keys()).find((k) =>
          k.toLowerCase().endsWith('.opf')
        ) || '';
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

      const manifestMap = new Map<string, string>();
      const itemRegex = /<item\b([^>]*)\/?>/gi;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(opfXml)) !== null) {
        const attrs = itemMatch[1];
        const idAttr = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
        const hrefAttr = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
        const propsAttr =
          attrs.match(/\bproperties=["']([^"']+)["']/i)?.[1] || '';
        if (idAttr && hrefAttr && !propsAttr.includes('nav')) {
          manifestMap.set(idAttr, hrefAttr);
        }
      }

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
      const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(
        val.trim()
      )}`;
      imageByBasename.set(key, svgDataUrl);
      const base = key.split('/').pop() || key;
      imageByBasename.set(base, svgDataUrl);
    }
  });

  const inlineArchiveAssets = (htmlStr: string): string => {
    return htmlStr.replace(
      /\b(src|href|xlink:href)=["']([^"']+)["']/gi,
      (full, attr, rawPath: string) => {
        const cleanPath = rawPath
          .split('#')[0]
          .split('?')[0]
          .replace(/^\.\.\//g, '')
          .replace(/^\.\//g, '');
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
      bookAuthor
        ? `<p><strong>Author:</strong> ${escapeHtmlText(bookAuthor)}</p>`
        : ''
    }</header>`
  );

  for (let idx = 0; idx < orderedChapterPaths.length; idx++) {
    const path = orderedChapterPaths[idx];
    const rawChapter = entries.get(path) || '';
    if (!rawChapter.trim()) continue;
    const chapterRaw = inlineArchiveAssets(rawChapter);

    const chapterBlocks = parseHtmlIntoWordBlocks(chapterRaw);
    if (chapterBlocks.length > 0) {
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
 * Parses an uploaded Word (.docx, .doc), eBook (.epub, .kpf, .mobi, .fb2), OpenDocument (.odt),
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

  // 1. Inspect ZIP archive (.docx, .epub, .kpf, .odt)
  if (isZipArchive) {
    try {
      const zipEntries = await extractTextEntriesFromZip(bytes);

      // 1a. High-fidelity Microsoft Word (.docx) OOXML Layout Parser (word/document.xml)
      if (zipEntries.has('word/document.xml')) {
        const parsedDocx = parseDocxZipWithFullWordLayout(
          zipEntries,
          baseTitle
        );
        if (parsedDocx && parsedDocx.blocks.length > 0) {
          return parsedDocx;
        }
      }

      // 1b. eBooks (.epub, .kpf) and OpenDocument (.odt)
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
      console.warn('ZIP archive parse fallback:', err);
    }
  }

  // 2. Fallback .docx OpenXML parsing via mammoth if custom OOXML parser didn't match
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

  // 3. Decode text with automatic BOM & <meta charset> encoding detection (UTF-8, UTF-16LE/BE, Windows-1252/ISO-8859-1)
  let rawStr = '';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    rawStr = new TextDecoder('utf-16le', { fatal: false }).decode(buf);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    rawStr = new TextDecoder('utf-16be', { fatal: false }).decode(buf);
  } else {
    rawStr = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const charsetMatch = rawStr
      .slice(0, 2048)
      .match(/charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i);
    const declaredCharset = charsetMatch ? charsetMatch[1].toLowerCase() : '';
    if (
      declaredCharset &&
      (declaredCharset.includes('1252') ||
        declaredCharset.includes('8859-1') ||
        declaredCharset.includes('latin1'))
    ) {
      try {
        rawStr = new TextDecoder('windows-1252', { fatal: false }).decode(buf);
      } catch {
        // Keep UTF-8 decoded text
      }
    }
  }

  // 3a. Standalone SVG vector graphic / animated SVG file
  if (
    lowerName.endsWith('.svg') ||
    (file.type || '').toLowerCase().includes('svg')
  ) {
    const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(
      rawStr.trim()
    )}`;
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
        const cleanTitle = inner
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return cleanTitle ? `<h2>${cleanTitle}</h2>\n` : '';
      })
      .replace(/<subtitle\b[^>]*>([\s\S]*?)<\/subtitle>/gi, '<h3>$1</h3>\n')
      .replace(/<emphasis\b[^>]*>([\s\S]*?)<\/emphasis>/gi, '<em>$1</em>');
    const blocks = parseHtmlIntoWordBlocks(fbHtml);
    const plainText = wordBlocksToReadableText(blocks);
    return {
      blocks: blocks.length > 0 ? blocks : plainTextToWordBlocks(baseTitle),
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
      if (
        Array.isArray(parsedJson) &&
        parsedJson.length > 0 &&
        typeof parsedJson[0] === 'object' &&
        parsedJson[0] !== null
      ) {
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

  // 3d. Check if file is HTML / XHTML (.html, .htm, .xhtml)
  const isOleBinaryDoc =
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;

  const isHtmlContent =
    !isOleBinaryDoc &&
    (lowerName.endsWith('.html') ||
      lowerName.endsWith('.htm') ||
      lowerName.endsWith('.xhtml') ||
      (file.type || '').toLowerCase().includes('html') ||
      /<(?:!doctype\s+html|html|head|body|style|div|table|h[1-6]|p|section|article|ul|ol|svg|canvas)\b/i.test(
        rawStr
      ));

  if (isHtmlContent) {
    const blocks = parseHtmlIntoWordBlocks(rawStr);
    const readableText = wordBlocksToReadableText(blocks);
    const finalBlocks =
      blocks.length > 0
        ? blocks
        : plainTextToWordBlocks(
            readableText || `Webpage imported from ${file.name}`
          );
    return {
      blocks: finalBlocks,
      plainText: readableText || baseTitle,
      htmlPreview: prepareBrowserFidelityHtml(rawStr, baseTitle),
    };
  }

  // 3e. Non-ZIP .kpf / .mobi / .azw3 binary or KDF SQLite stream fallback
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
          !/^(?:SQLite format|BOOKMOBI|TPZ|EXTH|INDX|TAGX|IDXT|FDST|kindle_|ion_)/i.test(
            m
          )
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

  // 3f. Legacy Microsoft Word 97-2003 (.doc) binary OLE2 Compound Document or RTF
  if (lowerName.endsWith('.rtf') || rawStr.startsWith('{\\rtf')) {
    rawStr = rawStr
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\line/g, '\n')
      .replace(/\\tab/g, '    ')
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
      .replace(/[{}]/g, '');
  } else if (lowerName.endsWith('.doc') || isOleBinaryDoc) {
    // Extract both UTF-16LE and Windows-1252 printable runs from OLE2 WordDocument binary stream
    const utf16Decoder = new TextDecoder('utf-16le', { fatal: false });
    const utf16Str = utf16Decoder.decode(buf);
    const utf16Matches =
      utf16Str.match(/[A-Za-z0-9 ,.;:'"?!()\-+*/=%$#@&\n\r\t]{12,}/g) || [];
    const ansiMatches = rawStr.match(/[\x20-\x7E\n\r\t]{6,}/g) || [];
    const noisePattern =
      /^(?:Microsoft|Word\.Document|Normal\.dot|Times New Roman|Calibri|Arial|Cambria|Default Paragraph Font|Root Entry|SummaryInformation|DocumentSummaryInformation|CompObj|1Table|0Table|MSWordDoc|bjbj)/i;

    const combinedCandidates = [...utf16Matches, ...ansiMatches]
      .map((s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim())
      .filter((s) => s.length >= 6 && !noisePattern.test(s) && /[A-Za-z]{3,}/.test(s));

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const chunk of combinedCandidates) {
      for (const line of chunk.split('\n')) {
        const cleanLine = line.replace(/\s+/g, ' ').trim();
        if (cleanLine.length >= 4 && !noisePattern.test(cleanLine) && !seen.has(cleanLine)) {
          seen.add(cleanLine);
          deduped.push(cleanLine);
        }
      }
    }

    const extractedDocText =
      deduped.join('\n\n') ||
      `Legacy Microsoft Word (.doc) document "${file.name}" imported.`;
    const docBlocks = plainTextToWordBlocks(extractedDocText);
    const legacyBannerHtml = `<div style="background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:10pt;line-height:1.4;">
      <strong>Legacy Word 97–2003 (.DOC) Compatibility Mode:</strong> Binary OLE2 text and paragraphs were extracted safely. For full OpenXML page margins, cell shading, and Office Math equations, re-save as <code>.docx</code> in Microsoft Word or convert to PDF below.
    </div>`;
    const bodyHtml = wordBlocksToCleanHtml(docBlocks, baseTitle);
    const fullLegacyHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtmlText(
      baseTitle
    )}</title><style>body{margin:0;padding:16px;background:#E2E8F0;font-family:Calibri,'Segoe UI',sans-serif;color:#111827;}.sheet{max-width:210mm;margin:0 auto;background:#fff;padding:20mm 18mm;border:1px solid #CBD5E1;box-shadow:0 6px 24px rgba(15,23,42,0.12);}</style></head><body><article class="sheet">${legacyBannerHtml}${bodyHtml}</article></body></html>`;

    return {
      blocks: docBlocks,
      plainText: extractedDocText,
      htmlPreview: fullLegacyHtml,
    };
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
 * Generates a high-resolution, multi-page PDF document from structured Word blocks,
 * preserving Microsoft Word alignments (center/right/justify/left), indents,
 * font sizes, colors, background shading, proportional table column widths, and images.
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
          boldItalic: StandardFonts.TimesRomanBoldItalic,
        }
      : options.fontFamily === 'courier'
        ? {
            regular: StandardFonts.Courier,
            bold: StandardFonts.CourierBold,
            italic: StandardFonts.CourierOblique,
            boldItalic: StandardFonts.CourierBoldOblique,
          }
        : {
            regular: StandardFonts.Helvetica,
            bold: StandardFonts.HelveticaBold,
            italic: StandardFonts.HelveticaOblique,
            boldItalic: StandardFonts.HelveticaBoldOblique,
          };

  const fontRegular = await pdfDoc.embedFont(fontPair.regular);
  const fontBold = await pdfDoc.embedFont(fontPair.bold);
  const fontItalic = await pdfDoc.embedFont(fontPair.italic);
  const fontBoldItalic = await pdfDoc.embedFont(fontPair.boldItalic);

  const pageDimensions: [number, number] =
    options.pageSize === 'Letter'
      ? [612, 792]
      : options.pageSize === 'Legal'
        ? [612, 1008]
        : [595.28, 841.89]; // A4

  const [pageW, pageH] = pageDimensions;
  const marginX = 50;
  const marginTop = 52;
  const marginBottom = 52;
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
    if (block.pageBreakBefore && cursorY < pageH - marginTop - 10) {
      currentPage = pdfDoc.addPage([pageW, pageH]);
      cursorY = pageH - marginTop;
    }

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
          const targetW = block.imageWidthPt || embedded.width;
          const targetH = block.imageHeightPt || embedded.height;
          const maxImgW = contentWidth * 0.92;
          const maxImgH = (pageH - marginTop - marginBottom) * 0.58;
          const scale = Math.min(
            1,
            maxImgW / Math.max(1, targetW),
            maxImgH / Math.max(1, targetH)
          );
          const drawW = targetW * scale;
          const drawH = targetH * scale;

          ensureVerticalSpace(drawH + 14);
          let imgX = marginX;
          if (block.align === 'center') {
            imgX = marginX + (contentWidth - drawW) / 2;
          } else if (block.align === 'right') {
            imgX = marginX + contentWidth - drawW;
          }

          currentPage.drawImage(embedded, {
            x: imgX,
            y: cursorY - drawH,
            width: drawW,
            height: drawH,
          });
          cursorY -= drawH + 14;
        }
      } catch {
        // Ignore unsupported embedded image formats
      }
      continue;
    }

    if (block.type === 'table' && block.rows && block.rows.length > 0) {
      const colCount = Math.max(...block.rows.map((r) => r.length), 1);
      const colWidths: number[] =
        block.colWidthRatios && block.colWidthRatios.length === colCount
          ? block.colWidthRatios.map((r) => Math.max(28, r * contentWidth))
          : Array.from({ length: colCount }, () => contentWidth / colCount);

      const cellFontSize = Math.max(8.5, options.baseFontSize - 1.5);
      const cellPadding = 5;

      for (let rIdx = 0; rIdx < block.rows.length; rIdx++) {
        const row = block.rows[rIdx];
        const richRow = block.richCells?.[rIdx];
        const isHeader = rIdx === 0;

        const wrappedCells = Array.from({ length: colCount }, (_, cIdx) => {
          const cellMeta = richRow?.[cIdx];
          const cFont =
            cellMeta?.bold ?? isHeader
              ? fontBold
              : cellMeta?.italic
                ? fontItalic
                : fontRegular;
          return wrapTextToLines(
            row[cIdx] || '',
            cFont,
            cellFontSize,
            Math.max(22, colWidths[cIdx] - cellPadding * 2)
          );
        });

        const maxLines = Math.max(
          ...wrappedCells.map((lines) => lines.length),
          1
        );
        const lineHeight = cellFontSize * 1.25;
        const rowHeight = maxLines * lineHeight + cellPadding * 2;

        ensureVerticalSpace(rowHeight + 4);

        let curCellX = marginX;
        for (let cIdx = 0; cIdx < colCount; cIdx++) {
          const cWidth = colWidths[cIdx];
          const cellY = cursorY - rowHeight;
          const cellMeta = richRow?.[cIdx];

          const cellBg = cellMeta?.bgColorHex
            ? parseHexToRgb(cellMeta.bgColorHex, { r: 0.96, g: 0.97, b: 0.98 })
            : isHeader
              ? { r: 0.95, g: 0.96, b: 0.98 }
              : undefined;

          currentPage.drawRectangle({
            x: curCellX,
            y: cellY,
            width: cWidth,
            height: rowHeight,
            color: cellBg ? rgb(cellBg.r, cellBg.g, cellBg.b) : undefined,
            borderColor: rgb(0.78, 0.8, 0.85),
            borderWidth: 0.7,
          });

          const cFont =
            cellMeta?.bold ?? isHeader
              ? fontBold
              : cellMeta?.italic
                ? fontItalic
                : fontRegular;
          const textColor = parseHexToRgb(cellMeta?.colorHex, {
            r: 0.08,
            g: 0.09,
            b: 0.13,
          });
          const cellAlign = cellMeta?.align || 'left';

          const cellLines = wrappedCells[cIdx];
          cellLines.forEach((line, lIdx) => {
            if (!line) return;
            const lw = cFont.widthOfTextAtSize(line, cellFontSize);
            let tx = curCellX + cellPadding;
            if (cellAlign === 'center') {
              tx = curCellX + Math.max(cellPadding, (cWidth - lw) / 2);
            } else if (cellAlign === 'right') {
              tx = curCellX + Math.max(cellPadding, cWidth - cellPadding - lw);
            }
            currentPage.drawText(line, {
              x: tx,
              y:
                cursorY -
                cellPadding -
                cellFontSize * 0.88 -
                lIdx * lineHeight,
              size: cellFontSize,
              font: cFont,
              color: rgb(textColor.r, textColor.g, textColor.b),
            });
          });

          curCellX += cWidth;
        }

        cursorY -= rowHeight;
      }
      cursorY -= 10;
      continue;
    }

    const rawText = block.text || '';
    if (!rawText.trim()) continue;

    if (block.spaceBeforePt && block.spaceBeforePt > 0) {
      cursorY -= Math.min(28, block.spaceBeforePt);
    } else if (
      block.type === 'h1' ||
      block.type === 'h2' ||
      block.type === 'h3'
    ) {
      cursorY -= 6;
    }

    const fontSize =
      block.fontSizePt && block.fontSizePt >= 7
        ? Math.min(32, block.fontSizePt)
        : block.type === 'h1'
          ? options.baseFontSize + 6.5
          : block.type === 'h2'
            ? options.baseFontSize + 3.5
            : block.type === 'h3'
              ? options.baseFontSize + 1.5
              : options.baseFontSize;

    const chosenFont =
      (block.type === 'h1' ||
        block.type === 'h2' ||
        block.type === 'h3' ||
        block.bold) &&
      block.italic
        ? fontBoldItalic
        : block.type === 'h1' ||
            block.type === 'h2' ||
            block.type === 'h3' ||
            block.bold
          ? fontBold
          : block.italic
            ? fontItalic
            : fontRegular;

    const indentLeft =
      block.indentLeftPt !== undefined
        ? Math.min(contentWidth * 0.45, Math.max(0, block.indentLeftPt))
        : block.type === 'li'
          ? 16
          : 0;
    const indentRight = Math.min(
      contentWidth * 0.3,
      Math.max(0, block.indentRightPt || 0)
    );
    const availWidth = Math.max(80, contentWidth - indentLeft - indentRight);

    const lines = wrapTextToLines(rawText, chosenFont, fontSize, availWidth);
    const lineHeight = fontSize * options.lineSpacing;

    const defaultColor =
      block.type === 'h1' || block.type === 'h2'
        ? { r: 0.08, g: 0.1, b: 0.18 }
        : { r: 0.1, g: 0.1, b: 0.14 };
    const fg = parseHexToRgb(block.colorHex, defaultColor);

    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx];
      ensureVerticalSpace(lineHeight);
      if (line) {
        if (block.bgColorHex) {
          const bg = parseHexToRgb(block.bgColorHex, {
            r: 0.96,
            g: 0.96,
            b: 0.98,
          });
          currentPage.drawRectangle({
            x: marginX + indentLeft - 3,
            y: cursorY - lineHeight + 2,
            width: availWidth + 6,
            height: lineHeight,
            color: rgb(bg.r, bg.g, bg.b),
          });
        }

        const firstLineShift =
          lIdx === 0 && block.firstLineIndentPt
            ? Math.max(-indentLeft, Math.min(48, block.firstLineIndentPt))
            : 0;
        const lineWidth = chosenFont.widthOfTextAtSize(line, fontSize);
        let drawX = marginX + indentLeft + firstLineShift;

        if (block.align === 'center') {
          drawX = marginX + indentLeft + Math.max(0, (availWidth - lineWidth) / 2);
        } else if (block.align === 'right') {
          drawX = marginX + indentLeft + Math.max(0, availWidth - lineWidth);
        }

        const drawY = cursorY - fontSize * 0.88;
        currentPage.drawText(line, {
          x: drawX,
          y: drawY,
          size: fontSize,
          font: chosenFont,
          color: rgb(fg.r, fg.g, fg.b),
        });

        if (block.underline) {
          currentPage.drawLine({
            start: { x: drawX, y: drawY - 1.5 },
            end: { x: drawX + lineWidth, y: drawY - 1.5 },
            thickness: 0.65,
            color: rgb(fg.r, fg.g, fg.b),
          });
        }
      }
      cursorY -= lineHeight;
    }

    if (block.bottomBorderColor) {
      const bdr = parseHexToRgb(block.bottomBorderColor, {
        r: 0.75,
        g: 0.78,
        b: 0.84,
      });
      currentPage.drawLine({
        start: { x: marginX + indentLeft, y: cursorY + 2 },
        end: { x: marginX + indentLeft + availWidth, y: cursorY + 2 },
        thickness: 0.9,
        color: rgb(bdr.r, bdr.g, bdr.b),
      });
      cursorY -= 4;
    }

    const afterSpace =
      block.spaceAfterPt !== undefined
        ? Math.min(24, Math.max(2, block.spaceAfterPt))
        : block.type === 'li'
          ? 3.5
          : fontSize * 0.45;
    cursorY -= afterSpace;
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
          const lines = cleanText.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            children.push(
              new Paragraph({
                spacing: { after: 160, line: 300 },
                children: [
                  new TextRun({
                    text: line.trim(),
                    size: 23,
                    color: '1F1B24',
                  }),
                ],
              })
            );
          }
        }
      }
    }

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
