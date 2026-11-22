import mammoth from 'mammoth';
import JSZip from 'jszip';
import { renderAsync as renderDocxPreviewAsync } from 'docx-preview';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, PDFImage } from 'pdf-lib';
export {
  extractPdfPagesForWord,
  buildDocxFromPdfPages,
  buildPdfToWordQualityReport,
  buildWordPagePreviewHtml,
  buildOmmlParagraph,
  isMathOrEquationLine,
  type PdfToWordMode,
  type PdfPageWordContent,
  type PdfWordBlock,
  type PdfWordTable,
  type PdfWordTableCell,
  type PdfWordDiagramRegion,
  type PdfWordEquationEntry,
  type WordConversionQualityReport,
  type WordPageQualityMetric,
} from './pdfToWordEngine';

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
  vertAlign?: 'superscript' | 'subscript';
  tabStopXPt?: number;
  tabLeader?: 'underscore' | 'dot' | 'none';
  inlineImageDataUrl?: string;
  inlineImageWidthPt?: number;
  inlineImageHeightPt?: number;
}

export interface WordRichTableCell {
  text: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  italic?: boolean;
  colorHex?: string;
  bgColorHex?: string;
  colSpan?: number;
  hideAllBorders?: boolean;
  hideTopBorder?: boolean;
  hideBottomBorder?: boolean;
  hideLeftBorder?: boolean;
  hideRightBorder?: boolean;
  bottomBorderOnly?: boolean;
  borderColorHex?: string;
  vMergeContinue?: boolean;
  runs?: WordInlineRun[];
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
  hideTableBorders?: boolean;
  hasExplicitRowShading?: boolean;
  imageDataUrl?: string;
  imageWidthPt?: number;
  imageHeightPt?: number;
  sidebarImageDataUrl?: string;
  docMarginTopPt?: number;
  docMarginBottomPt?: number;
  docMarginLeftPt?: number;
  docMarginRightPt?: number;
}

export interface WordToPdfOptions {
  pageSize: 'A4' | 'Letter' | 'Legal';
  fontFamily: 'helvetica' | 'times' | 'courier';
  baseFontSize: number; // e.g. 11 or 12
  lineSpacing: number; // e.g. 1.35
  addPageNumbers: boolean;
}

/**
 * Normalizes smart punctuation/spaces while preserving Unicode math, logic,
 * set theory, Greek, arrow, and checkmark characters so they can be drawn cleanly.
 */
function normalizeUnicodePunctuation(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2212/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
}

/**
 * Checks whether a single code point can be directly encoded in PDF StandardFont WinAnsi.
 * Characters outside ASCII 0x20-0x7E and selected WinAnsi Latin-1 characters
 * (such as ✓, ∩, ∪, ∅, ∧, ∨, →, θ, α, β, √, ≤, ≥, •) are drawn via canvas/vector glyph renderer.
 */
function isWinAnsiCodePoint(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7e) return true;
  // Standard WinAnsi Latin-1 supplement (excluding soft-hyphen/special gaps and math operators we draw cleanly)
  if (
    code === 0xa0 ||
    (code >= 0xa2 && code <= 0xac) ||
    (code >= 0xae && code <= 0xff && code !== 0xd7 && code !== 0xf7 && code !== 0xb0 && code !== 0xb1)
  ) {
    return true;
  }
  return false;
}

function sanitizeWinAnsiText(input: string): string {
  if (!input) return '';
  return normalizeUnicodePunctuation(input)
    .replace(/[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF]/g, '*')
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
    .replace(/&bull;/gi, '\u2022 ')
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

    const extractMathMlText = (mEl: Element): string => {
      const mTag = mEl.tagName.replace(/^.*:/, '').toLowerCase();
      if (mTag === 'mfrac') {
        const ch = Array.from(mEl.children);
        const num = ch[0] ? extractMathMlText(ch[0]) : '';
        const den = ch[1] ? extractMathMlText(ch[1]) : '';
        return `(${num})/(${den})`;
      }
      if (mTag === 'msqrt') {
        const inner = Array.from(mEl.children).map(extractMathMlText).join('');
        return `√(${inner})`;
      }
      if (mTag === 'mroot') {
        const ch = Array.from(mEl.children);
        const base = ch[0] ? extractMathMlText(ch[0]) : '';
        const deg = ch[1] ? extractMathMlText(ch[1]) : '';
        return deg ? `${deg}√(${base})` : `√(${base})`;
      }
      if (mTag === 'msup') {
        const ch = Array.from(mEl.children);
        const base = ch[0] ? extractMathMlText(ch[0]) : '';
        const sup = ch[1] ? extractMathMlText(ch[1]) : '';
        return `${base}^${sup}`;
      }
      if (mTag === 'msub') {
        const ch = Array.from(mEl.children);
        const base = ch[0] ? extractMathMlText(ch[0]) : '';
        const sub = ch[1] ? extractMathMlText(ch[1]) : '';
        return `${base}_${sub}`;
      }
      if (mTag === 'msubsup') {
        const ch = Array.from(mEl.children);
        const base = ch[0] ? extractMathMlText(ch[0]) : '';
        const sub = ch[1] ? extractMathMlText(ch[1]) : '';
        const sup = ch[2] ? extractMathMlText(ch[2]) : '';
        return `${base}_${sub}^${sup}`;
      }
      if (mEl.children.length === 0) {
        return mEl.textContent || '';
      }
      let out = '';
      mEl.childNodes.forEach((cn) => {
        if (cn.nodeType === 3) {
          out += cn.textContent || '';
        } else if (cn.nodeType === 1) {
          out += extractMathMlText(cn as Element);
        }
      });
      return out;
    };

    const extractCleanNodeText = (el: Element): string => {
      const hasMath = el.querySelector('math, mfrac, msqrt, mroot, msup, msub');
      if (!hasMath) return normalizeText(el.textContent);
      let out = '';
      el.childNodes.forEach((cn) => {
        if (cn.nodeType === 3) {
          out += cn.textContent || '';
        } else if (cn.nodeType === 1) {
          const ce = cn as Element;
          const ct = ce.tagName.replace(/^.*:/, '').toLowerCase();
          if (ct === 'math' || ct === 'mfrac' || ct === 'msqrt' || ct === 'mroot' || ct === 'msup' || ct === 'msub' || ct === 'msubsup') {
            out += ' ' + extractMathMlText(ce) + ' ';
          } else {
            out += extractCleanNodeText(ce);
          }
        }
      });
      return normalizeText(out);
    };

    const walkNode = (node: Element) => {
      const tag = node.tagName.toLowerCase();

      if (tag === 'hr') return;
      if (
        node.classList?.contains('kpf-text-layer') ||
        node.classList?.contains('word-left-border-strip')
      ) {
        return;
      }

      if (
        tag === 'h1' ||
        tag === 'h2' ||
        tag === 'h3' ||
        tag === 'h4' ||
        tag === 'h5' ||
        tag === 'h6'
      ) {
        const text = extractCleanNodeText(node);
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
            const cText = extractCleanNodeText(cell);
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
          const text = extractCleanNodeText(li);
          if (text) {
            const prefix = tag === 'ol' ? `${idx + 1}. ` : '\u2022 ';
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
          const text = extractCleanNodeText(child);
          if (!text) return;
          if (cTag === 'dt') {
            blocks.push({ type: 'p', text, bold: true });
          } else if (cTag === 'dd') {
            blocks.push({ type: 'li', text: `\u2022 ${text}` });
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

        const text = extractCleanNodeText(node);
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
        .replace(/<div\b[^>]*class=["'][^"']*kpf-text-layer[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n### $1\n')
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n\u2022 $1\n')
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

  const isDocxPageSheet = /word-page-sheet/i.test(html);
  if (
    extractedTitle &&
    !isDocxPageSheet &&
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
    body:not(.docx-fidelity-body) img, body:not(.docx-fidelity-body) video, body:not(.docx-fidelity-body) canvas { max-width: 100%; height: auto; }
    body:not(.docx-fidelity-body) svg { max-width: 100%; height: auto; }
    body:not(.docx-fidelity-body) table { max-width: 100%; }
    body.docx-fidelity-body section.docx {
      background: #FFFFFF !important;
      position: relative !important;
    }
    body.docx-fidelity-body section.docx > article,
    body.docx-fidelity-body section.docx > header,
    body.docx-fidelity-body section.docx > footer {
      position: relative !important;
      z-index: 1;
    }
    body.docx-fidelity-body section.docx p {
      position: static !important;
    }
    body.docx-fidelity-body p[class*="docx-num-"]:before {
      display: inline-block;
      min-width: 14pt;
    }
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
    window.addEventListener('DOMContentLoaded', function() {
      if (!document.body || !document.body.classList.contains('docx-fidelity-body')) return;
      var wraps = document.querySelectorAll('.docx-vml-pic-wrap');
      for (var i = 0; i < wraps.length; i++) {
        var wrap = wraps[i];
        var p = wrap.closest('p');
        if (p && !p.closest('td, th')) {
          p.style.position = '';
        }
        for (var j = 0; j < wrap.children.length; j++) {
          var ch = wrap.children[j];
          if (!ch || !ch.style || ch.style.position !== 'absolute') continue;
          var raw = ch.getAttribute('style') || '';
          var posHRelM = raw.match(/mso-position-horizontal-relative\s*:\s*([^;]+)/i);
          var posVRelM = raw.match(/mso-position-vertical-relative\s*:\s*([^;]+)/i);
          var posHRel = posHRelM ? posHRelM[1].trim().toLowerCase() : '';
          var posVRel = posVRelM ? posVRelM[1].trim().toLowerCase() : '';
          if (posHRel !== 'page') {
            ch.style.left = posHRel === 'char' ? 'auto' : '0px';
          }
          if (posVRel !== 'page' && posVRel !== 'margin') {
            if (ch.style.top === '0px' || ch.style.top === '0pt' || ch.style.top === '0') {
              ch.style.top = 'auto';
            }
          }
        }
      }
    });
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

/**
 * Converts legacy Windows Metafile (.wmf / .emf) equation/illustration binaries
 * into web-renderable PNG, JPEG, BMP, or crisp SVG data URLs.
 */
function convertWmfOrEmfToDataUrl(
  bytes: Uint8Array,
  isEmf: boolean
): string | null {
  if (!bytes || bytes.byteLength < 16) return null;

  // 1. Scan for an embedded PNG (89 50 4E 47 0D 0A 1A 0A ... IEND AE 42 60 82)
  for (let i = 0; i <= bytes.length - 8; i++) {
    if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47 &&
      bytes[i + 4] === 0x0d &&
      bytes[i + 5] === 0x0a &&
      bytes[i + 6] === 0x1a &&
      bytes[i + 7] === 0x0a
    ) {
      let endIdx = bytes.length;
      for (let j = i + 8; j <= bytes.length - 8; j++) {
        if (
          bytes[j] === 0x49 &&
          bytes[j + 1] === 0x45 &&
          bytes[j + 2] === 0x4e &&
          bytes[j + 3] === 0x44
        ) {
          endIdx = Math.min(bytes.length, j + 8);
          break;
        }
      }
      return `data:image/png;base64,${uint8ArrayToBase64(bytes.subarray(i, endIdx))}`;
    }
  }

  // 2. Scan for an embedded JPEG (FF D8 FF ... FF D9)
  for (let i = 0; i <= bytes.length - 3; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      let endIdx = bytes.length;
      for (let j = bytes.length - 2; j > i + 4; j--) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          endIdx = j + 2;
          break;
        }
      }
      return `data:image/jpeg;base64,${uint8ArrayToBase64(bytes.subarray(i, endIdx))}`;
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Helper to wrap raw DIB (BITMAPINFOHEADER + pixels) as a valid BMP file
  const wrapDibAsBmpDataUrl = (dibSlice: Uint8Array): string | null => {
    if (dibSlice.byteLength < 44) return null;
    const dv = new DataView(dibSlice.buffer, dibSlice.byteOffset, dibSlice.byteLength);
    const biSize = dv.getUint32(0, true);
    if (biSize !== 40 && biSize !== 108 && biSize !== 124) return null;
    const bpp = dv.getUint16(14, true);
    const clrUsed = dv.getUint32(32, true);
    const paletteEntries = clrUsed > 0 ? clrUsed : bpp <= 8 ? 1 << bpp : 0;
    const bfOffBits = 14 + biSize + paletteEntries * 4;
    if (bfOffBits >= dibSlice.byteLength + 14) return null;
    const bmp = new Uint8Array(14 + dibSlice.byteLength);
    bmp[0] = 0x42; // 'B'
    bmp[1] = 0x4d; // 'M'
    const bmpView = new DataView(bmp.buffer);
    bmpView.setUint32(2, bmp.byteLength, true);
    bmpView.setUint32(10, bfOffBits, true);
    bmp.set(dibSlice, 14);
    return `data:image/bmp;base64,${uint8ArrayToBase64(bmp)}`;
  };

  // 3. Walk WMF or EMF records to extract DIB rasters or render vector/text SVG (Equation 3.0 etc.)
  const svgElements: string[] = [];
  let minX = 0;
  let minY = 0;
  let maxX = 240;
  let maxY = 80;
  let hasExplicitBounds = false;

  const win1252Decoder = new TextDecoder('windows-1252', { fatal: false });
  const utf16Decoder = new TextDecoder('utf-16le', { fatal: false });

  const escapeSvgAttr = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  if (!isEmf) {
    // WMF: optional 22-byte Aldus Placeable Header (0x9AC6CDD7) + 18-byte standard WMF header
    let pos = 0;
    if (bytes.byteLength >= 22 && view.getUint32(0, true) === 0x9ac6cdd7) {
      minX = view.getInt16(6, true);
      minY = view.getInt16(8, true);
      maxX = view.getInt16(10, true);
      maxY = view.getInt16(12, true);
      if (maxX > minX && maxY > minY) {
        hasExplicitBounds = true;
      }
      pos = 22;
    }
    if (pos + 18 <= bytes.byteLength) {
      const headerSizeWords = view.getUint16(pos + 2, true);
      pos += Math.max(18, headerSizeWords * 2);

      let curX = 0;
      let curY = 0;
      let strokeColor = '#0F172A';
      let strokeWidth = 1;
      let textColor = '#0F172A';
      const objects: Array<
        | { kind: 'font'; height: number; name: string; italic: boolean }
        | { kind: 'pen'; color: string; width: number; style: number }
        | { kind: 'brush'; color: string; style: number }
      > = [];
      let curFontName = '';
      let curFontHeight = 14;
      let curFontItalic = false;

      let guard = 0;
      while (pos + 6 <= bytes.byteLength && guard < 20000) {
        guard++;
        const recSizeWords = view.getUint32(pos, true);
        const recSizeBytes = recSizeWords * 2;
        const fn = view.getUint16(pos + 4, true);
        if (fn === 0 || recSizeBytes < 6 || pos + recSizeBytes > bytes.byteLength) {
          break;
        }
        const pData = pos + 6;
        const pLen = recSizeBytes - 6;

        if (fn === 0x0b41 || fn === 0x0f43 || fn === 0x0940) {
          // META_DIBSTRETCHBLT / META_STRETCHDIB / META_DIBBITBLT
          for (let off = pData; off <= pos + recSizeBytes - 44; off += 2) {
            if (
              view.getUint32(off, true) === 40 &&
              view.getUint16(off + 12, true) === 1
            ) {
              const bmpUrl = wrapDibAsBmpDataUrl(
                bytes.subarray(off, pos + recSizeBytes)
              );
              if (bmpUrl) return bmpUrl;
            }
          }
        } else if (fn === 0x020b && pLen >= 4) {
          // META_SETWINDOWORG (y, x)
          const wy = view.getInt16(pData, true);
          const wx = view.getInt16(pData + 2, true);
          if (!hasExplicitBounds) {
            minX = wx;
            minY = wy;
          }
        } else if (fn === 0x020c && pLen >= 4) {
          // META_SETWINDOWEXT (cy, cx)
          const cy = view.getInt16(pData, true);
          const cx = view.getInt16(pData + 2, true);
          if (!hasExplicitBounds && Math.abs(cx) > 0 && Math.abs(cy) > 0) {
            maxX = minX + Math.abs(cx);
            maxY = minY + Math.abs(cy);
            hasExplicitBounds = true;
          }
        } else if (fn === 0x02fb && pLen >= 18) {
          // META_CREATEFONTINDIRECT
          const lfHeight = Math.abs(view.getInt16(pData, true)) || 14;
          const lfItalic = bytes[pData + 10] !== 0;
          const faceBytes = bytes.subarray(pData + 18, pos + recSizeBytes);
          const zeroIdx = faceBytes.indexOf(0);
          const name = win1252Decoder
            .decode(zeroIdx >= 0 ? faceBytes.subarray(0, zeroIdx) : faceBytes)
            .trim();
          objects.push({ kind: 'font', height: lfHeight, name, italic: lfItalic });
        } else if (fn === 0x02fa && pLen >= 10) {
          // META_CREATEPENINDIRECT
          const style = view.getUint16(pData, true);
          const w = Math.max(1, Math.abs(view.getInt16(pData + 2, true)));
          const r = bytes[pData + 6];
          const g = bytes[pData + 7];
          const b = bytes[pData + 8];
          objects.push({
            kind: 'pen',
            style,
            width: w,
            color: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
          });
        } else if (fn === 0x02fc && pLen >= 8) {
          // META_CREATEBRUSHINDIRECT
          const style = view.getUint16(pData, true);
          const r = bytes[pData + 2];
          const g = bytes[pData + 3];
          const b = bytes[pData + 4];
          objects.push({
            kind: 'brush',
            style,
            color: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
          });
        } else if (fn === 0x012d && pLen >= 2) {
          // META_SELECTOBJECT
          const idx = view.getUint16(pData, true);
          const obj = objects[idx];
          if (obj?.kind === 'font') {
            curFontName = obj.name;
            curFontHeight = obj.height;
            curFontItalic = obj.italic;
          } else if (obj?.kind === 'pen') {
            strokeColor = obj.color;
            strokeWidth = obj.width;
          }
        } else if (fn === 0x0209 && pLen >= 4) {
          // META_SETTEXTCOLOR
          const r = bytes[pData];
          const g = bytes[pData + 1];
          const b = bytes[pData + 2];
          textColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        } else if (fn === 0x0214 && pLen >= 4) {
          // META_MOVETO (y, x)
          curY = view.getInt16(pData, true);
          curX = view.getInt16(pData + 2, true);
        } else if (fn === 0x0213 && pLen >= 4) {
          // META_LINETO (y, x)
          const ny = view.getInt16(pData, true);
          const nx = view.getInt16(pData + 2, true);
          svgElements.push(
            `<line x1="${curX}" y1="${curY}" x2="${nx}" y2="${ny}" stroke="${strokeColor}" stroke-width="${Math.max(1, strokeWidth)}" stroke-linecap="round" />`
          );
          curX = nx;
          curY = ny;
        } else if (fn === 0x0325 && pLen >= 2) {
          // META_POLYLINE
          const nPts = view.getUint16(pData, true);
          const pts: string[] = [];
          for (let k = 0; k < nPts && pData + 2 + k * 4 + 4 <= pos + recSizeBytes; k++) {
            const px = view.getInt16(pData + 2 + k * 4, true);
            const py = view.getInt16(pData + 2 + k * 4 + 2, true);
            pts.push(`${px},${py}`);
          }
          if (pts.length >= 2) {
            svgElements.push(
              `<polyline points="${pts.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="${Math.max(1, strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" />`
            );
          }
        } else if (fn === 0x0a32 && pLen >= 8) {
          // META_EXTTEXTOUT: y(i16), x(i16), len(u16), fwOpts(u16)
          const ty = view.getInt16(pData, true);
          const tx = view.getInt16(pData + 2, true);
          const strLen = view.getUint16(pData + 4, true);
          const fwOpts = view.getUint16(pData + 6, true);
          const hasClipRect = (fwOpts & 0x0006) !== 0;
          const strOffset = pData + 8 + (hasClipRect ? 8 : 0);
          if (strLen > 0 && strOffset < pos + recSizeBytes) {
            const rawStrBytes = bytes.subarray(
              strOffset,
              Math.min(pos + recSizeBytes, strOffset + strLen)
            );
            const rawTxt = win1252Decoder.decode(rawStrBytes);
            const mappedTxt = curFontName
              ? mapWordSymbolCharToUnicode(curFontName, rawTxt, false)
              : rawTxt;
            const fontSize = Math.max(8, curFontHeight * 0.92);
            svgElements.push(
              `<text x="${tx}" y="${ty + fontSize * 0.8}" fill="${textColor}" font-size="${fontSize}" font-family="'Cambria Math','Times New Roman',serif" ${curFontItalic ? 'font-style="italic"' : ''}>${escapeSvgAttr(mappedTxt)}</text>`
            );
          }
        } else if (fn === 0x0521 && pLen >= 6) {
          // META_TEXTOUT: len(u16), chars..., y(i16), x(i16)
          const strLen = view.getUint16(pData, true);
          const paddedLen = strLen + (strLen % 2);
          if (strLen > 0 && pData + 2 + paddedLen + 4 <= pos + recSizeBytes) {
            const rawTxt = win1252Decoder.decode(
              bytes.subarray(pData + 2, pData + 2 + strLen)
            );
            const ty = view.getInt16(pData + 2 + paddedLen, true);
            const tx = view.getInt16(pData + 2 + paddedLen + 2, true);
            const mappedTxt = curFontName
              ? mapWordSymbolCharToUnicode(curFontName, rawTxt, false)
              : rawTxt;
            const fontSize = Math.max(8, curFontHeight * 0.92);
            svgElements.push(
              `<text x="${tx}" y="${ty + fontSize * 0.8}" fill="${textColor}" font-size="${fontSize}" font-family="'Cambria Math','Times New Roman',serif" ${curFontItalic ? 'font-style="italic"' : ''}>${escapeSvgAttr(mappedTxt)}</text>`
            );
          }
        }

        pos += recSizeBytes;
      }
    }
  } else if (bytes.byteLength >= 88 && view.getUint32(0, true) === 1 && view.getUint32(40, true) === 0x464d4520) {
    // EMF (Enhanced Metafile): EMR_HEADER rclBounds at offset 8..24
    minX = view.getInt32(8, true);
    minY = view.getInt32(12, true);
    maxX = view.getInt32(16, true);
    maxY = view.getInt32(20, true);
    if (maxX > minX && maxY > minY) {
      hasExplicitBounds = true;
    }
    let pos = 0;
    let guard = 0;
    while (pos + 8 <= bytes.byteLength && guard < 20000) {
      guard++;
      const rType = view.getUint32(pos, true);
      const rSize = view.getUint32(pos + 4, true);
      if (rSize < 8 || pos + rSize > bytes.byteLength) break;

      if (rType === 14) break; // EMR_EOF
      if ((rType === 81 || rType === 76) && rSize > 60) {
        // EMR_STRETCHDIBITS / EMR_BITBLT: scan for BITMAPINFOHEADER
        for (let off = pos + 40; off <= pos + rSize - 44; off += 4) {
          if (
            view.getUint32(off, true) === 40 &&
            view.getUint16(off + 12, true) === 1
          ) {
            const bmpUrl = wrapDibAsBmpDataUrl(bytes.subarray(off, pos + rSize));
            if (bmpUrl) return bmpUrl;
          }
        }
      } else if (rType === 84 && rSize >= 76) {
        // EMR_EXTTEXTOUTW: ptlReference at pos+36(x), pos+40(y); nChars at pos+44; offString at pos+48
        const tx = view.getInt32(pos + 36, true);
        const ty = view.getInt32(pos + 40, true);
        const nChars = view.getUint32(pos + 44, true);
        const offString = view.getUint32(pos + 48, true);
        const strStart = pos + offString;
        if (nChars > 0 && offString > 0 && strStart + nChars * 2 <= pos + rSize) {
          const txt = utf16Decoder.decode(
            bytes.subarray(strStart, strStart + nChars * 2)
          );
          const estH = Math.max(14, (maxY - minY) * 0.55);
          svgElements.push(
            `<text x="${tx}" y="${ty}" fill="#0F172A" font-size="${estH}" font-family="'Cambria Math','Times New Roman',serif">${escapeSvgAttr(txt)}</text>`
          );
        }
      }
      pos += rSize;
    }
  }

  if (svgElements.length > 0) {
    const vbW = Math.max(20, maxX - minX);
    const vbH = Math.max(12, maxY - minY);
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">${svgElements.join('')}</svg>`;
    return `data:image/svg+xml;base64,${uint8ArrayToBase64(new TextEncoder().encode(svgMarkup))}`;
  }

  return null;
}

async function extractTextEntriesFromZip(
  zipBytes: Uint8Array
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (zipBytes.byteLength < 22) return result;

  try {
    const zip = await JSZip.loadAsync(zipBytes);
    const entries = Object.values(zip.files);

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.dir) return;
        const fileName = entry.name;
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

        const isMetafile =
          lowerEntry.endsWith('.wmf') || lowerEntry.endsWith('.emf');

        const isImageEntry =
          isMediaSvg ||
          lowerEntry.endsWith('.png') ||
          lowerEntry.endsWith('.jpg') ||
          lowerEntry.endsWith('.jpeg') ||
          lowerEntry.endsWith('.jfif') ||
          lowerEntry.endsWith('.gif') ||
          lowerEntry.endsWith('.bmp') ||
          lowerEntry.endsWith('.webp');

        if (!isTextEntry && !isImageEntry && !isMetafile) return;

        try {
          if (isMetafile) {
            const rawBytes = await entry.async('uint8array');
            const converted = convertWmfOrEmfToDataUrl(
              rawBytes,
              lowerEntry.endsWith('.emf')
            );
            if (converted) {
              result.set(fileName, converted);
            }
          } else if (isImageEntry) {
            const rawBytes = await entry.async('uint8array');
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
              `data:${mime};base64,${uint8ArrayToBase64(rawBytes)}`
            );
          } else {
            const txt = await entry.async('string');
            result.set(fileName, txt);
          }
        } catch {
          // Ignore unreadable ZIP entry
        }
      })
    );
  } catch (err) {
    console.warn('JSZip extractTextEntriesFromZip error:', err);
  }

  return result;
}

// ============================================================================
// MICROSOFT WORD (.DOCX) HIGH-FIDELITY OOXML LAYOUT PARSER
// Preserves paragraph alignments (center/right/justify/left), indents, tabs,
// inline font sizes/colors/highlights, styles.xml, numbering.xml, headers/footers,
// embedded media images, and exact table column widths, cell shading & spans!
// ============================================================================
interface DocxTableStyleBand {
  bgColorHex?: string;
  bold?: boolean;
  colorHex?: string;
}

interface DocxStyleDefinition {
  styleId: string;
  styleType?: string;
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
  tableHideAllBorders?: boolean;
  tableFirstRow?: DocxTableStyleBand;
  tableLastRow?: DocxTableStyleBand;
  tableBand1Horz?: DocxTableStyleBand;
  tableBand2Horz?: DocxTableStyleBand;
}

function getXmlAttr(el: Element | null, attrLocalName: string): string {
  if (!el) return '';
  return (
    el.getAttribute(`w:${attrLocalName}`) ||
    el.getAttribute(`m:${attrLocalName}`) ||
    el.getAttribute(`r:${attrLocalName}`) ||
    el.getAttribute(`a:${attrLocalName}`) ||
    el.getAttribute(attrLocalName) ||
    ''
  );
}

function findDirectChildByLocalName(
  parent: Element | null,
  localName: string
): Element | null {
  if (!parent) return null;
  const lower = localName.toLowerCase();
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    const tag = c.tagName.toLowerCase();
    const stripped = tag.replace(/^.*:/, '');
    if (stripped === lower) {
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
    const stripped = tag.replace(/^.*:/, '');
    if (stripped === lower) {
      out.push(el);
    }
  }
  return out;
}

function parseWordThemeColors(themeXml: string): Map<string, string> {
  const themeMap = new Map<string, string>();
  // Standard Office theme defaults
  themeMap.set('dk1', '#000000');
  themeMap.set('tx1', '#000000');
  themeMap.set('lt1', '#FFFFFF');
  themeMap.set('bg1', '#FFFFFF');
  themeMap.set('dk2', '#44546A');
  themeMap.set('tx2', '#44546A');
  themeMap.set('lt2', '#E7E6E6');
  themeMap.set('bg2', '#E7E6E6');
  themeMap.set('accent1', '#4472C4');
  themeMap.set('accent2', '#ED7D31');
  themeMap.set('accent3', '#A5A5A5');
  themeMap.set('accent4', '#FFC000');
  themeMap.set('accent5', '#5B9BD5');
  themeMap.set('accent6', '#70AD47');

  if (!themeXml || typeof DOMParser === 'undefined') return themeMap;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(themeXml, 'application/xml');
    const clrScheme = findAllDescendantsByLocalName(doc, 'clrScheme')[0];
    if (!clrScheme) return themeMap;
    for (let i = 0; i < clrScheme.children.length; i++) {
      const slot = clrScheme.children[i];
      const slotName = slot.tagName.replace(/^.*:/, '').toLowerCase();
      const srgb = findDirectChildByLocalName(slot, 'srgbClr');
      const sys = findDirectChildByLocalName(slot, 'sysClr');
      const hex =
        getXmlAttr(srgb, 'val') || sys?.getAttribute('lastClr') || '';
      if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) {
        themeMap.set(slotName, `#${hex.toUpperCase()}`);
      }
    }
    if (themeMap.has('dk1')) themeMap.set('tx1', themeMap.get('dk1')!);
    if (themeMap.has('dk2')) themeMap.set('tx2', themeMap.get('dk2')!);
    if (themeMap.has('lt1')) themeMap.set('bg1', themeMap.get('lt1')!);
    if (themeMap.has('lt2')) themeMap.set('bg2', themeMap.get('lt2')!);
  } catch {
    // Keep defaults
  }
  return themeMap;
}

function applyHexTintOrShade(
  baseHex: string,
  opts: {
    tintByteHex?: string; // e.g. "33" in Word (0..255 proportion toward white)
    shadeByteHex?: string; // e.g. "D9" in Word (0..255 scale toward black)
    lumModPct?: number; // e.g. 20000 = 20%
    lumOffPct?: number; // e.g. 80000 = +80% toward white
  }
): string {
  const clean = baseHex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return baseHex;
  let r = parseInt(clean.slice(0, 2), 16);
  let g = parseInt(clean.slice(2, 4), 16);
  let b = parseInt(clean.slice(4, 6), 16);

  if (opts.tintByteHex && /^[0-9a-fA-F]{2}$/.test(opts.tintByteHex)) {
    const t = parseInt(opts.tintByteHex, 16) / 255;
    r = Math.round(r * t + 255 * (1 - t));
    g = Math.round(g * t + 255 * (1 - t));
    b = Math.round(b * t + 255 * (1 - t));
  }
  if (opts.shadeByteHex && /^[0-9a-fA-F]{2}$/.test(opts.shadeByteHex)) {
    const s = parseInt(opts.shadeByteHex, 16) / 255;
    r = Math.round(r * s);
    g = Math.round(g * s);
    b = Math.round(b * s);
  }
  if (opts.lumModPct !== undefined || opts.lumOffPct !== undefined) {
    const mod = (opts.lumModPct ?? 100000) / 100000;
    const off = (opts.lumOffPct ?? 0) / 100000;
    r = Math.min(255, Math.max(0, Math.round(r * mod + 255 * off)));
    g = Math.min(255, Math.max(0, Math.round(g * mod + 255 * off)));
    b = Math.min(255, Math.max(0, Math.round(b * mod + 255 * off)));
  }

  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function resolveWordShdFillHex(
  shdEl: Element | null,
  themeMap?: Map<string, string>
): string | undefined {
  if (!shdEl) return undefined;
  const valAttr = getXmlAttr(shdEl, 'val').toLowerCase();
  if (valAttr === 'nil') return undefined;

  const fillVal = getXmlAttr(shdEl, 'fill');
  if (
    fillVal &&
    /^[0-9a-fA-F]{6}$/.test(fillVal) &&
    fillVal.toLowerCase() !== 'auto' &&
    fillVal.toLowerCase() !== 'ffffff'
  ) {
    return `#${fillVal.toUpperCase()}`;
  }

  const themeFill = getXmlAttr(shdEl, 'themeFill').toLowerCase();
  if (themeFill) {
    const base =
      themeMap?.get(themeFill) ||
      resolveWordSchemeColorHex(themeFill, undefined, themeMap);
    if (base) {
      const tint = getXmlAttr(shdEl, 'themeFillTint');
      const shade = getXmlAttr(shdEl, 'themeFillShade');
      const resolved = applyHexTintOrShade(base, {
        tintByteHex: tint || undefined,
        shadeByteHex: shade || undefined,
      });
      if (resolved.toLowerCase() !== '#ffffff') {
        return resolved;
      }
    }
  }
  return undefined;
}

function mapWordSymbolCharToUnicode(
  fontName: string,
  rawStr: string,
  isHexCode = false
): string {
  const font = (fontName || '').toLowerCase();
  const wingdingsMap: Record<number, string> = {
    0xfc: '✓',
    0xfe: '☑',
    0xfb: '✗',
    0xfd: '☒',
    0xa8: '☐',
    0x6f: '☐',
    0x71: '☐',
    0xa7: '▪',
    0x6e: '■',
    0x6c: '●',
    0x9f: '•',
    0xb7: '•',
    0xd8: '➔',
    0xe0: '➔',
    0xe8: '→',
    0xdf: '←',
    0x50: '✓',
    0x51: '✗',
    0x52: '☑',
  };
  const symbolMap: Record<number, string> = {
    0x20: ' ',
    0x22: '∀',
    0x24: '∃',
    0x27: '∋',
    0x2a: '∗',
    0x2d: '−',
    0x40: '≅',
    0x41: 'Α',
    0x42: 'Β',
    0x43: 'Χ',
    0x44: 'Δ',
    0x45: 'Ε',
    0x46: 'Φ',
    0x47: 'Γ',
    0x48: 'Η',
    0x49: 'Ι',
    0x4b: 'Κ',
    0x4c: 'Λ',
    0x4d: 'Μ',
    0x4e: 'Ν',
    0x4f: 'Ο',
    0x50: 'Π',
    0x51: 'Θ',
    0x52: 'Ρ',
    0x53: 'Σ',
    0x54: 'Τ',
    0x55: 'Υ',
    0x57: 'Ω',
    0x58: 'Ξ',
    0x59: 'Ψ',
    0x5a: 'Ζ',
    0x5c: '∴',
    0x5e: '⊥',
    0x61: 'α',
    0x62: 'β',
    0x63: 'χ',
    0x64: 'δ',
    0x65: 'ε',
    0x66: 'φ',
    0x67: 'γ',
    0x68: 'η',
    0x69: 'ι',
    0x6a: 'ϕ',
    0x6b: 'κ',
    0x6c: 'λ',
    0x6d: 'μ',
    0x6e: 'ν',
    0x6f: 'ο',
    0x70: 'π',
    0x71: 'θ',
    0x72: 'ρ',
    0x73: 'σ',
    0x74: 'τ',
    0x75: 'υ',
    0x76: 'ϖ',
    0x77: 'ω',
    0x78: 'ξ',
    0x79: 'ψ',
    0x7a: 'ζ',
    0x7e: '~',
    0xa2: '′',
    0xa3: '≤',
    0xa4: '/',
    0xa5: '∞',
    0xa6: 'ƒ',
    0xab: '↔',
    0xac: '←',
    0xad: '↑',
    0xae: '→',
    0xaf: '↓',
    0xb0: '°',
    0xb1: '±',
    0xb2: '″',
    0xb3: '≥',
    0xb4: '×',
    0xb5: '∝',
    0xb6: '∂',
    0xb7: '•',
    0xb8: '÷',
    0xb9: '≠',
    0xba: '≡',
    0xbb: '≈',
    0xbc: '…',
    0xc5: '⊕',
    0xc6: '∅',
    0xc7: '∩',
    0xc8: '∪',
    0xc9: '⊃',
    0xca: '⊇',
    0xcb: '⊄',
    0xcc: '⊂',
    0xcd: '⊆',
    0xce: '∈',
    0xcf: '∉',
    0xd0: '∠',
    0xd1: '∇',
    0xd5: '∏',
    0xd6: '√',
    0xd7: '⋅',
    0xd8: '¬',
    0xd9: '∧',
    0xda: '∨',
    0xdb: '⇔',
    0xdc: '⇐',
    0xdd: '⇑',
    0xde: '⇒',
    0xdf: '⇓',
    0xe5: '∑',
    0xf2: '∫',
  };

  if (isHexCode) {
    const code = parseInt(rawStr.trim(), 16) & 0xff;
    if (font.includes('wingding') || font.includes('webding')) {
      return wingdingsMap[code] || '';
    }
    if (font.includes('symbol')) {
      return symbolMap[code] || String.fromCharCode(code);
    }
    const fullCode = parseInt(rawStr.trim(), 16);
    if (fullCode >= 0x20 && fullCode <= 0xffff) {
      if ((fullCode & 0xff00) === 0xf000) {
        return wingdingsMap[code] || symbolMap[code] || '';
      }
      return String.fromCharCode(fullCode);
    }
    return '';
  }

  let out = '';
  for (let i = 0; i < rawStr.length; i++) {
    const chCode = rawStr.charCodeAt(i);
    const lowByte = chCode & 0xff;
    if ((chCode & 0xff00) === 0xf000 || font.includes('wingding') || font.includes('webding')) {
      if (font.includes('symbol')) {
        out += symbolMap[lowByte] || '';
      } else {
        out += wingdingsMap[lowByte] || (chCode < 0xf000 ? rawStr[i] : '');
      }
    } else if (font.includes('symbol')) {
      out += symbolMap[lowByte] || rawStr[i];
    } else {
      out += rawStr[i];
    }
  }
  return out;
}

function parseVmlCssDimensionsPt(styleStr: string): {
  widthPt?: number;
  heightPt?: number;
} {
  if (!styleStr) return {};
  const parseUnitPt = (valStr: string): number | undefined => {
    const m = valStr.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(pt|in|cm|mm|px)?/i);
    if (!m) return undefined;
    const num = parseFloat(m[1]);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    const unit = (m[2] || 'pt').toLowerCase();
    if (unit === 'pt') return num;
    if (unit === 'in') return num * 72;
    if (unit === 'cm') return num * 28.3465;
    if (unit === 'mm') return num * 2.83465;
    if (unit === 'px') return num * 0.75;
    return num;
  };
  const wMatch = styleStr.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i);
  const hMatch = styleStr.match(/(?:^|;)\s*height\s*:\s*([^;]+)/i);
  return {
    widthPt: wMatch ? parseUnitPt(wMatch[1]) : undefined,
    heightPt: hMatch ? parseUnitPt(hMatch[1]) : undefined,
  };
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
  stylesXml: string,
  themeMap?: Map<string, string>
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

      const styleType = getXmlAttr(styleEl, 'type').toLowerCase();
      const nameEl = findDirectChildByLocalName(styleEl, 'name');
      const styleName = getXmlAttr(nameEl, 'val').toLowerCase();
      const basedOnEl = findDirectChildByLocalName(styleEl, 'basedOn');
      const basedOn = getXmlAttr(basedOnEl, 'val') || undefined;

      const def: DocxStyleDefinition = {
        styleId,
        styleType,
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

      // Parse table style defaults (borders + conditional row banding like band1Horz / firstRow / lastRow)
      if (styleType === 'table') {
        const tblPr = findDirectChildByLocalName(styleEl, 'tblPr');
        const tblBorders = tblPr
          ? findDirectChildByLocalName(tblPr, 'tblBorders')
          : null;
        if (tblBorders) {
          const topVal = getXmlAttr(
            findDirectChildByLocalName(tblBorders, 'top'),
            'val'
          ).toLowerCase();
          const insideHVal = getXmlAttr(
            findDirectChildByLocalName(tblBorders, 'insideH'),
            'val'
          ).toLowerCase();
          if (
            (topVal === 'none' || topVal === 'nil') &&
            (insideHVal === 'none' || insideHVal === 'nil')
          ) {
            def.tableHideAllBorders = true;
          }
        } else if (styleId.toLowerCase().includes('normal')) {
          def.tableHideAllBorders = true;
        }

        const tblStylePrEls = findAllDescendantsByLocalName(styleEl, 'tblStylePr');
        for (const tsp of tblStylePrEls) {
          const tspType = getXmlAttr(tsp, 'type');
          const tcPr = findDirectChildByLocalName(tsp, 'tcPr');
          const tspRPr = findDirectChildByLocalName(tsp, 'rPr');
          const shdEl = tcPr ? findDirectChildByLocalName(tcPr, 'shd') : null;
          const bgHex = resolveWordShdFillHex(shdEl, themeMap);
          let bandBold: boolean | undefined;
          let bandColor: string | undefined;
          if (tspRPr) {
            const bEl = findDirectChildByLocalName(tspRPr, 'b');
            if (bEl) {
              const v = getXmlAttr(bEl, 'val');
              bandBold = v !== '0' && v !== 'false';
            }
            const cEl = findDirectChildByLocalName(tspRPr, 'color');
            const cVal = getXmlAttr(cEl, 'val');
            if (cVal && /^[0-9a-fA-F]{6}$/.test(cVal)) bandColor = `#${cVal}`;
          }
          const band: DocxTableStyleBand = {
            bgColorHex: bgHex,
            bold: bandBold,
            colorHex: bandColor,
          };
          if (tspType === 'firstRow') def.tableFirstRow = band;
          else if (tspType === 'lastRow') def.tableLastRow = band;
          else if (tspType === 'band1Horz') def.tableBand1Horz = band;
          else if (tspType === 'band2Horz') def.tableBand2Horz = band;
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
        if (def.tableHideAllBorders === undefined && parent.tableHideAllBorders !== undefined) {
          def.tableHideAllBorders = parent.tableHideAllBorders;
        }
        if (!def.tableFirstRow && parent.tableFirstRow) def.tableFirstRow = parent.tableFirstRow;
        if (!def.tableLastRow && parent.tableLastRow) def.tableLastRow = parent.tableLastRow;
        if (!def.tableBand1Horz && parent.tableBand1Horz) def.tableBand1Horz = parent.tableBand1Horz;
        if (!def.tableBand2Horz && parent.tableBand2Horz) def.tableBand2Horz = parent.tableBand2Horz;
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
        findAllDescendantsByLocalName(choiceEl, 'oMath').length > 0 ||
        findAllDescendantsByLocalName(choiceEl, 'oMathPara').length > 0 ||
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

function resolveWordSchemeColorHex(
  schemeVal: string,
  lumOff?: number,
  themeMap?: Map<string, string>,
  lumMod?: number
): string | undefined {
  const key = (schemeVal || '').toLowerCase();
  const base = themeMap?.get(key);
  if (base && (lumOff !== undefined || lumMod !== undefined)) {
    const computed = applyHexTintOrShade(base, {
      lumModPct: lumMod,
      lumOffPct: lumOff,
    });
    if (computed.toLowerCase() !== '#ffffff') return computed;
  }
  // Standard Office theme palette fallback (including Accent 2 peach used in exam banners)
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
  return base || baseMap[key];
}

function extractShapeContainerStyle(
  txbxEl: Element,
  themeMap?: Map<string, string>
): {
  bgColorHex?: string;
  borderColorHex?: string;
  isRounded?: boolean;
  widthPt?: number;
  anchorPosHPt?: number;
  anchorPosVPt?: number;
} {
  let bgColorHex: string | undefined;
  let borderColorHex: string | undefined;
  let isRounded = false;
  let widthPt: number | undefined;
  let anchorPosHPt: number | undefined;
  let anchorPosVPt: number | undefined;

  let curr: Element | null = txbxEl.parentElement;
  let shapeRoot: Element | null = null;
  let anchorRoot: Element | null = null;
  while (curr) {
    const local = curr.tagName.replace(/^.*:/, '').toLowerCase();
    if (
      !shapeRoot &&
      (local === 'wsp' ||
        local === 'shape' ||
        local === 'roundrect' ||
        local === 'rect')
    ) {
      shapeRoot = curr;
      if (local === 'roundrect') isRounded = true;
    }
    if (local === 'anchor') {
      anchorRoot = curr;
      break;
    }
    if (local === 'inline' || local === 'p' || local === 'body') {
      break;
    }
    curr = curr.parentElement;
  }

  if (anchorRoot) {
    const posH = findDirectChildByLocalName(anchorRoot, 'positionH');
    const posHOff = posH ? findDirectChildByLocalName(posH, 'posOffset') : null;
    if (posHOff && posHOff.textContent) {
      const emu = Number(posHOff.textContent.trim());
      if (Number.isFinite(emu)) anchorPosHPt = emu / 12700;
    }
    const posV = findDirectChildByLocalName(anchorRoot, 'positionV');
    const posVOff = posV ? findDirectChildByLocalName(posV, 'posOffset') : null;
    if (posVOff && posVOff.textContent) {
      const emu = Number(posVOff.textContent.trim());
      if (Number.isFinite(emu)) anchorPosVPt = emu / 12700;
    }
  }

  if (!shapeRoot) return { anchorPosHPt, anchorPosVPt };

  // Check VML fillcolor attribute or style="width:...;height:..."
  const vmlDims = parseVmlCssDimensionsPt(shapeRoot.getAttribute('style') || '');
  if (vmlDims.widthPt) widthPt = vmlDims.widthPt;

  const filledAttr = (shapeRoot.getAttribute('filled') || '').toLowerCase();
  const isVmlNotFilled = filledAttr === 'f' || filledAttr === 'false';
  const rawVmlFill =
    shapeRoot.getAttribute('fillcolor') ||
    shapeRoot.getAttribute('data-vml-fillcolor') ||
    '';
  const vmlFillToken = rawVmlFill.trim().split(' ')[0];
  if (!isVmlNotFilled && vmlFillToken && /^#?[0-9a-fA-F]{6}$/.test(vmlFillToken)) {
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
          const lumModEl = scheme
            ? findDirectChildByLocalName(scheme, 'lumMod')
            : null;
          const lumOff = lumOffEl ? Number(getXmlAttr(lumOffEl, 'val') || '0') : undefined;
          const lumMod = lumModEl ? Number(getXmlAttr(lumModEl, 'val') || '100000') : undefined;
          bgColorHex = resolveWordSchemeColorHex(schemeVal, lumOff, themeMap, lumMod);
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
            bgColorHex = resolveWordSchemeColorHex(schemeVal, 60000, themeMap, 40000);
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

  return {
    bgColorHex,
    borderColorHex,
    isRounded,
    widthPt,
    anchorPosHPt,
    anchorPosVPt,
  };
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

function formatNumberingCounter(val: number, fmt: string): string {
  const lowerFmt = (fmt || 'decimal').toLowerCase();
  if (lowerFmt === 'lowerletter') {
    let n = val;
    let res = '';
    while (n > 0) {
      n--;
      res = String.fromCharCode(97 + (n % 26)) + res;
      n = Math.floor(n / 26);
    }
    return res || 'a';
  }
  if (lowerFmt === 'upperletter') {
    return formatNumberingCounter(val, 'lowerLetter').toUpperCase();
  }
  if (lowerFmt === 'lowerroman' || lowerFmt === 'upperroman') {
    const numerals: Array<[number, string]> = [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ];
    let n = Math.max(1, val);
    let out = '';
    for (const [k, sym] of numerals) {
      while (n >= k) {
        out += sym;
        n -= k;
      }
    }
    return lowerFmt === 'upperroman' ? out.toUpperCase() : out;
  }
  if (lowerFmt === 'decimalzero') {
    return val < 10 ? `0${val}` : String(val);
  }
  return String(val);
}

interface DocxNumberingLevelDef {
  numFmt: string;
  lvlText: string;
  start: number;
  lvlRestart?: number;
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

    // 0. Parse word/theme/theme1.xml for accurate theme color lookups (accent2 peach, table bands, etc.)
    let themeXml = entries.get('word/theme/theme1.xml') || '';
    if (!themeXml) {
      entries.forEach((v, k) => {
        if (!themeXml && k.toLowerCase().endsWith('theme1.xml')) themeXml = v;
      });
    }
    const themeMap = parseWordThemeColors(themeXml);

    // 1. Parse word/styles.xml (paragraph, character, AND table styles)
    const stylesMap = parseDocxStylesXml(
      entries.get('word/styles.xml') || '',
      themeMap
    );

    // 2. Parse word/_rels/document.xml.rels for embedded images & hyperlinks
    const docRelsMap = buildRelsMapFromXml(
      entries.get('word/_rels/document.xml.rels') || '',
      entries,
      parser
    );

    // 3. Parse word/numbering.xml with full multi-level numFmt, lvlText, start & lvlRestart
    const numLevelsByNumId = new Map<string, Map<number, DocxNumberingLevelDef>>();
    const numberingXml = entries.get('word/numbering.xml') || '';
    if (numberingXml) {
      const numDoc = parser.parseFromString(numberingXml, 'application/xml');
      const abstractMap = new Map<string, Map<number, DocxNumberingLevelDef>>();
      for (const absEl of findAllDescendantsByLocalName(numDoc, 'abstractNum')) {
        const absId = getXmlAttr(absEl, 'abstractNumId');
        const lvlMap = new Map<number, DocxNumberingLevelDef>();
        for (const lvlEl of findAllDescendantsByLocalName(absEl, 'lvl')) {
          const ilvl = Number(getXmlAttr(lvlEl, 'ilvl') || '0');
          const numFmtEl = findDirectChildByLocalName(lvlEl, 'numFmt');
          const lvlTextEl = findDirectChildByLocalName(lvlEl, 'lvlText');
          const startEl = findDirectChildByLocalName(lvlEl, 'start');
          const restartEl = findDirectChildByLocalName(lvlEl, 'lvlRestart');
          const fmtVal = getXmlAttr(numFmtEl, 'val') || 'bullet';
          const lvlTextVal = getXmlAttr(lvlTextEl, 'val');
          const startVal = Number(getXmlAttr(startEl, 'val') || '1');
          const restartAttr = restartEl ? getXmlAttr(restartEl, 'val') : '';
          lvlMap.set(ilvl, {
            numFmt: fmtVal,
            lvlText:
              lvlTextVal ||
              (fmtVal.toLowerCase() === 'bullet' ? '•' : `%${ilvl + 1}.`),
            start: Number.isFinite(startVal) ? startVal : 1,
            lvlRestart:
              restartAttr !== '' && Number.isFinite(Number(restartAttr))
                ? Number(restartAttr)
                : undefined,
          });
        }
        if (absId) abstractMap.set(absId, lvlMap);
      }
      for (const numEl of findAllDescendantsByLocalName(numDoc, 'num')) {
        const numId = getXmlAttr(numEl, 'numId');
        const absRef = findDirectChildByLocalName(numEl, 'abstractNumId');
        const absId = getXmlAttr(absRef, 'val');
        const baseLvlMap = abstractMap.get(absId);
        if (numId && baseLvlMap) {
          const merged = new Map<number, DocxNumberingLevelDef>();
          baseLvlMap.forEach((def, k) => merged.set(k, { ...def }));
          for (const ovEl of findAllDescendantsByLocalName(numEl, 'lvlOverride')) {
            const ovIlvl = Number(getXmlAttr(ovEl, 'ilvl') || '0');
            const startOv = findDirectChildByLocalName(ovEl, 'startOverride');
            const existing = merged.get(ovIlvl);
            if (startOv && existing) {
              const s = Number(getXmlAttr(startOv, 'val'));
              if (Number.isFinite(s)) existing.start = s;
            }
          }
          numLevelsByNumId.set(numId, merged);
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
      const postParagraphBlocks: WordContentBlock[] = [];
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
      const customTabStops: Array<{
        posPt: number;
        leader: 'underscore' | 'dot' | 'none';
      }> = [];
      let pendingNumPr: { numId: string; ilvl: number } | null = null;
      let listPrefix = '';
      let isListParagraph = false;

      if (pPr) {
        const jcEl = findDirectChildByLocalName(pPr, 'jc');
        const jcAlign = parseWordJcToAlign(getXmlAttr(jcEl, 'val'));
        if (jcAlign) align = jcAlign;

        const tabsEl = findDirectChildByLocalName(pPr, 'tabs');
        if (tabsEl) {
          for (const tEl of findAllDescendantsByLocalName(tabsEl, 'tab')) {
            const val = getXmlAttr(tEl, 'val').toLowerCase();
            if (val === 'clear') continue;
            const posTwips = Number(getXmlAttr(tEl, 'pos') || '0');
            const rawLdr = getXmlAttr(tEl, 'leader').toLowerCase();
            const leader: 'underscore' | 'dot' | 'none' =
              rawLdr === 'underscore' || rawLdr === 'heavy'
                ? 'underscore'
                : rawLdr === 'dot'
                  ? 'dot'
                  : 'none';
            if (posTwips > 0) {
              customTabStops.push({ posPt: posTwips / 20, leader });
            }
          }
          customTabStops.sort((a, b) => a.posPt - b.posPt);
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
        const resolvedShd = resolveWordShdFillHex(shdEl, themeMap);
        if (resolvedShd) {
          pBgColorHex = resolvedShd;
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
          const ilvlEl = findDirectChildByLocalName(numPrEl, 'ilvl');
          const numIdEl = findDirectChildByLocalName(numPrEl, 'numId');
          const ilvl = Number(getXmlAttr(ilvlEl, 'val') || '0');
          const numId = getXmlAttr(numIdEl, 'val') || '0';
          if (numId !== '0') {
            pendingNumPr = { numId, ilvl };
            if (indentLeftPt === 0) {
              indentLeftPt = (ilvl + 1) * 16;
            }
          }
        }
      }

      const runs: WordInlineRun[] = [];
      const htmlRunFragments: string[] = [];
      const paragraphBoxes: Array<{
        html: string;
        isCompactBadge: boolean;
        bgColorHex?: string;
        text: string;
        inlineRuns: WordInlineRun[];
        anchorPosHPt?: number;
      }> = [];
      let tabCursorIdx = 0;

      const embeddedImages: Array<{
        dataUrl: string;
        widthPt: number;
        heightPt: number;
        isInlineEquation: boolean;
      }> = [];

      // Pre-compute approximate paragraph inline text presence to classify inline equation PNGs vs full figures
      let directInlineTextLen = 0;
      for (let i = 0; i < pEl.children.length; i++) {
        const ch = pEl.children[i];
        const chLocal = ch.tagName.replace(/^.*:/, '').toLowerCase();
        if (chLocal === 'r') {
          for (const tEl of findAllDescendantsByLocalName(ch, 't')) {
            if (!hasAncestorWithLocalName(tEl, ch, 'txbxContent')) {
              directInlineTextLen += (tEl.textContent || '').trim().length;
            }
          }
        }
      }

      // Helper to parse text/font runs cleanly
      const readRunStyles = (rEl: Element) => {
        const rPr = findDirectChildByLocalName(rEl, 'rPr');
        let bold = pBold;
        let italic = pItalic;
        let underline = pUnderline;
        let strike = false;
        let colorHex = pColorHex;
        let bgColorHex: string | undefined;
        let runFontSizePt = fontSizePt;
        let vertAlign: 'superscript' | 'subscript' | undefined;
        let rFontName = '';

        if (rPr) {
          const rFontsEl = findDirectChildByLocalName(rPr, 'rFonts');
          if (rFontsEl) {
            rFontName =
              getXmlAttr(rFontsEl, 'ascii') ||
              getXmlAttr(rFontsEl, 'hAnsi') ||
              getXmlAttr(rFontsEl, 'cs') ||
              '';
          }
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
          if (!bgColorHex) {
            bgColorHex = resolveWordShdFillHex(rShdEl, themeMap);
          }

          const vaEl = findDirectChildByLocalName(rPr, 'vertAlign');
          const vaVal = getXmlAttr(vaEl, 'val').toLowerCase();
          if (vaVal === 'superscript') vertAlign = 'superscript';
          else if (vaVal === 'subscript') vertAlign = 'subscript';
        }
        return {
          bold,
          italic,
          underline,
          strike,
          colorHex,
          bgColorHex,
          runFontSizePt,
          vertAlign,
          rFontName,
        };
      };

      const processDrawingOrRunContainer = (
        rEl: Element,
        linkHref?: string
      ) => {
        // Never emit deleted tracked-change runs
        if (hasAncestorWithLocalName(rEl, pEl, 'del')) return;
        const rLocalSelf = rEl.tagName.replace(/^.*:/, '').toLowerCase();
        if (rLocalSelf === 'del') return;

        const {
          bold,
          italic,
          underline,
          strike,
          colorHex,
          bgColorHex,
          runFontSizePt,
          vertAlign,
          rFontName,
        } = readRunStyles(rEl);

        // 1. Check for embedded images (<w:drawing> / <w:pict> / <w:object> -> a:blip or v:imagedata)
        const allBlipEls = findAllDescendantsByLocalName(rEl, 'blip').filter(
          (el) => !hasAncestorWithLocalName(el, rEl, 'txbxContent')
        );
        const allImgDataEls = findAllDescendantsByLocalName(
          rEl,
          'imagedata'
        ).filter((el) => !hasAncestorWithLocalName(el, rEl, 'txbxContent'));

        const seenImageEmbedIds = new Set<string>();
        const registerRunImage = (
          embedId: string,
          sourceEl: Element,
          isVmlSource: boolean
        ) => {
          if (!embedId || seenImageEmbedIds.has(embedId)) return;
          seenImageEmbedIds.add(embedId);
          const imgDataUrl =
            activeRelsMap.get(embedId) || docRelsMap.get(embedId);
          if (!imgDataUrl || !imgDataUrl.startsWith('data:image/')) return;

          // Find dimensions specific to this drawing/pict/shape container
          let drawContainer: Element | null = sourceEl.parentElement;
          while (drawContainer && drawContainer !== rEl) {
            const lName = drawContainer.tagName
              .replace(/^.*:/, '')
              .toLowerCase();
            if (
              lName === 'inline' ||
              lName === 'anchor' ||
              lName === 'shape' ||
              lName === 'roundrect' ||
              lName === 'rect'
            ) {
              break;
            }
            drawContainer = drawContainer.parentElement;
          }
          const extentEl = drawContainer
            ? findAllDescendantsByLocalName(drawContainer, 'extent')[0]
            : findAllDescendantsByLocalName(rEl, 'extent')[0];

          let widthPt = isVmlSource ? 48 : 220;
          let heightPt = isVmlSource ? 16 : 130;
          if (extentEl) {
            const cx = Number(extentEl.getAttribute('cx') || '0');
            const cy = Number(extentEl.getAttribute('cy') || '0');
            if (cx > 0 && cy > 0) {
              widthPt = Math.min(480, Math.max(8, cx / 12700));
              heightPt = Math.min(760, Math.max(8, cy / 12700));
            }
          } else if (drawContainer) {
            // Check <v:shape style="width:...pt;height:...pt"> AND <a:ext cx=... cy=...>
            const vmlDims = parseVmlCssDimensionsPt(
              drawContainer.getAttribute('style') || ''
            );
            if (vmlDims.widthPt && vmlDims.heightPt) {
              widthPt = Math.min(480, Math.max(6, vmlDims.widthPt));
              heightPt = Math.min(760, Math.max(6, vmlDims.heightPt));
            } else {
              const aExt = findAllDescendantsByLocalName(drawContainer, 'ext')[0];
              if (aExt) {
                const cx = Number(aExt.getAttribute('cx') || '0');
                const cy = Number(aExt.getAttribute('cy') || '0');
                if (cx > 0 && cy > 0) {
                  widthPt = Math.min(480, Math.max(8, cx / 12700));
                  heightPt = Math.min(760, Math.max(8, cy / 12700));
                }
              }
            }
          }

          // Detect rotated images (90 deg or 270 deg) so horizontal strips rotated vertically are recognized as sidebar borders
          const xfrmEl = drawContainer
            ? findAllDescendantsByLocalName(drawContainer, 'xfrm')[0]
            : null;
          const rotRaw = Number(xfrmEl?.getAttribute('rot') || '0');
          const rotDeg = Math.abs(Math.round(rotRaw / 60000)) % 360;
          const isQuarterTurnRotated =
            (rotDeg >= 75 && rotDeg <= 105) || (rotDeg >= 255 && rotDeg <= 285);
          const effW = isQuarterTurnRotated ? heightPt : widthPt;
          const effH = isQuarterTurnRotated ? widthPt : heightPt;

          let anchorLeftPt: number | undefined;
          if (drawContainer?.tagName.replace(/^.*:/, '').toLowerCase() === 'anchor') {
            const posH = findDirectChildByLocalName(drawContainer, 'positionH');
            const posHOff = posH ? findDirectChildByLocalName(posH, 'posOffset') : null;
            if (posHOff?.textContent) {
              const v = Number(posHOff.textContent.trim());
              if (Number.isFinite(v)) anchorLeftPt = v / 12700;
            }
          }

          // Detect tall left-margin decorative sidebar pattern (e.g. Feza Schools left geometric strip)
          const isVerticalSidebarGraphic =
            (effW < 140 && effH > effW * 2.3 && effH > 240) ||
            (anchorLeftPt !== undefined &&
              anchorLeftPt <= 42 &&
              effW <= 85 &&
              effH >= 200);

          if (isVerticalSidebarGraphic) {
            if (!sidebarBorderImages.includes(imgDataUrl)) {
              sidebarBorderImages.push(imgDataUrl);
            }
            return;
          }

          // Detect inline equation/symbol image (small height inside a sentence or VML <w:object>)
          const isInlineEquation =
            (isVmlSource && heightPt <= 42) ||
            (heightPt <= 32 &&
              widthPt <= 260 &&
              (directInlineTextLen > 0 || runs.length > 0));

          embeddedImages.push({
            dataUrl: imgDataUrl,
            widthPt,
            heightPt,
            isInlineEquation,
          });

          if (isInlineEquation) {
            runs.push({
              text: ' ',
              inlineImageDataUrl: imgDataUrl,
              inlineImageWidthPt: widthPt,
              inlineImageHeightPt: heightPt,
              fontSizePt: runFontSizePt,
            });
            htmlRunFragments.push(
              `<img src="${imgDataUrl}" alt="Math Equation" style="width:${widthPt.toFixed(
                1
              )}pt;height:${heightPt.toFixed(
                1
              )}pt;max-width:100%;vertical-align:middle;display:inline-block;margin:0 2px;" />`
            );
          } else {
            const isLogoLike =
              widthPt >= 100 && widthPt <= 340 && heightPt <= 180;
            const imgCssStyle = isLogoLike
              ? `width:${Math.round(
                  widthPt * 1.1
                )}px;max-width:72%;max-height:130px;object-fit:contain;display:block;margin:4px auto 8px auto;`
              : `width:${Math.round(
                  widthPt * 1.15
                )}px;max-width:100%;height:auto;vertical-align:middle;margin:4px 0;`;
            htmlRunFragments.push(
              `<img src="${imgDataUrl}" alt="Embedded Word Graphic" style="${imgCssStyle}" />`
            );
          }
        };

        for (const blip of allBlipEls) {
          const embedId =
            blip.getAttribute('r:embed') ||
            blip.getAttribute('embed') ||
            blip.getAttribute('r:link') ||
            '';
          registerRunImage(embedId, blip, false);
        }
        for (const vImg of allImgDataEls) {
          const rId =
            vImg.getAttribute('r:id') ||
            vImg.getAttribute('o:relid') ||
            vImg.getAttribute('id') ||
            '';
          registerRunImage(rId, vImg, true);
        }

        // 2. Extract ALL Word Text Boxes (<w:txbxContent>) inside drawings/shapes/group-shapes
        const txbxEls = findAllDescendantsByLocalName(
          rEl,
          'txbxContent'
        ).filter((el) => !hasAncestorWithLocalName(el, rEl, 'txbxContent'));

        if (txbxEls.length > 0) {
          for (const txbx of txbxEls) {
            const shapeStyle = extractShapeContainerStyle(txbx, themeMap);
            const txbxParts: string[] = [];
            const txbxSubBlocks: WordContentBlock[] = [];
            let txbxTextLen = 0;
            let hasTableInTxbx = false;

            const processTxbxChild = (txChild: Element) => {
              const txLocal = txChild.tagName.replace(/^.*:/, '').toLowerCase();
              if (txLocal === 'p') {
                const subRes = processParagraph(txChild, true, activeRelsMap);
                if (!subRes.isEmptySpacer) {
                  txbxParts.push(subRes.html);
                  for (const sb of subRes.pBlocks) {
                    if (shapeStyle.bgColorHex && !sb.bgColorHex && sb.type !== 'image') {
                      sb.bgColorHex = shapeStyle.bgColorHex;
                      if (!sb.align) sb.align = 'center';
                    }
                    txbxSubBlocks.push(sb);
                    txbxTextLen += (sb.text || '').length;
                  }
                }
              } else if (txLocal === 'tbl') {
                const tblRes = processTable(txChild, activeRelsMap);
                if (tblRes.html) {
                  hasTableInTxbx = true;
                  txbxParts.push(tblRes.html);
                }
                if (tblRes.tableBlock) {
                  txbxSubBlocks.push(tblRes.tableBlock);
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

            // Detect inline right-column floating metadata textbox (e.g. "STUDENT: ___", "ADDITIONAL MATHEMATICS", "3 HOURS")
            const isInlineRightColumnFloatingLabel =
              !hasTableInTxbx &&
              txbxSubBlocks.length >= 1 &&
              txbxSubBlocks.length <= 4 &&
              txbxSubBlocks.every(
                (sb) => sb.type !== 'table' && sb.type !== 'image'
              ) &&
              !shapeStyle.bgColorHex &&
              !shapeStyle.borderColorHex &&
              shapeStyle.anchorPosHPt !== undefined &&
              shapeStyle.anchorPosHPt >= 180 &&
              directInlineTextLen > 0;

            if (isInlineRightColumnFloatingLabel) {
              const targetXPt = Math.min(248, Math.max(195, shapeStyle.anchorPosHPt! * 0.72));
              if (txbxSubBlocks.length === 1) {
                const labelRuns = txbxSubBlocks[0].runs || [
                  { text: txbxSubBlocks[0].text || '', fontSizePt },
                ];
                runs.push({
                  text: ' ',
                  tabStopXPt: targetXPt,
                  tabLeader: 'none',
                  fontSizePt: runFontSizePt,
                });
                for (const lr of labelRuns) {
                  runs.push(lr);
                }
                htmlRunFragments.push(
                  `<span class="word-floating-col" style="display:inline-block;margin-left:18px;font-weight:${
                    labelRuns[0]?.bold ? 700 : 400
                  };">${escapeHtmlText(txbxSubBlocks[0].text || '')}</span>`
                );
              } else {
                // Multi-line right column box: keep aligned inline pairs cleanly instead of dumping below paragraph
                const combinedRightText = txbxSubBlocks
                  .map((sb) => (sb.text || '').trim())
                  .filter(Boolean)
                  .join(' | ');
                runs.push({
                  text: ' ',
                  tabStopXPt: targetXPt,
                  tabLeader: 'none',
                  fontSizePt: runFontSizePt,
                });
                runs.push({
                  text: combinedRightText,
                  fontSizePt: runFontSizePt,
                });
                htmlRunFragments.push(
                  `<span class="word-floating-col" style="display:inline-block;margin-left:18px;">${txbxParts.join('')}</span>`
                );
              }
              continue;
            }

            postParagraphBlocks.push(...txbxSubBlocks);

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
                boxCss.push('margin:5pt 0');
              }

              paragraphBoxes.push({
                html: `<div class="word-textbox" style="${boxCss.join(
                  ';'
                )}">${txbxParts.join('')}</div>`,
                isCompactBadge,
                bgColorHex: shapeStyle.bgColorHex || (isCompactBadge ? '#FBE4D5' : undefined),
                text: txbxSubBlocks.map((b) => b.text || '').join(' ').trim(),
                inlineRuns: txbxSubBlocks.flatMap((b) => b.runs || []),
                anchorPosHPt: shapeStyle.anchorPosHPt,
              });
            }
          }
        }

        // 3. Collect text, symbol glyphs, tabs, and breaks in child order (NEVER read <w:delText> or <w:instrText>)
        let runTextBuffer = '';
        const flushRunTextBuffer = () => {
          if (!runTextBuffer) return;
          const decodedText = rFontName
            ? mapWordSymbolCharToUnicode(rFontName, runTextBuffer, false)
            : mapWordSymbolCharToUnicode('', runTextBuffer, false);
          runTextBuffer = '';
          if (!decodedText) return;

          runs.push({
            text: decodedText,
            bold,
            italic,
            underline: underline || Boolean(linkHref),
            strike,
            colorHex: colorHex || (linkHref ? '#2563EB' : undefined),
            bgColorHex,
            fontSizePt: runFontSizePt,
            vertAlign,
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

          let frag = escapeHtmlText(decodedText);
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
          const cLocal = child.tagName.replace(/^.*:/, '').toLowerCase();
          if (cLocal === 't') {
            runTextBuffer += child.textContent || '';
          } else if (cLocal === 'sym') {
            const symFont = getXmlAttr(child, 'font') || rFontName || 'Symbol';
            const symChar = getXmlAttr(child, 'char');
            if (symChar) {
              runTextBuffer += mapWordSymbolCharToUnicode(symFont, symChar, true);
            }
          } else if (cLocal === 'tab') {
            flushRunTextBuffer();
            const activeTabDef = customTabStops[tabCursorIdx];
            tabCursorIdx++;
            const isUnderlineTab =
              Boolean(underline) ||
              activeTabDef?.leader === 'underscore' ||
              activeTabDef?.leader === 'dot';
            const leaderType: 'underscore' | 'dot' | 'none' = underline
              ? 'underscore'
              : activeTabDef?.leader || 'none';
            const targetStopPt = activeTabDef?.posPt;

            if (isUnderlineTab) {
              runs.push({
                text: ' ________________ ',
                underline: true,
                fontSizePt: runFontSizePt,
                tabStopXPt: targetStopPt,
                tabLeader: leaderType === 'none' ? 'underscore' : leaderType,
              });
              htmlRunFragments.push(
                '<span class="word-tab-line" style="display:inline-block;flex:1 1 95px;min-width:85px;max-width:190px;border-bottom:1px solid #1E293B;margin:0 8px 0 4px;vertical-align:baseline;">&nbsp;</span>'
              );
            } else {
              runs.push({
                text: '    ',
                fontSizePt: runFontSizePt,
                tabStopXPt: targetStopPt,
                tabLeader: 'none',
              });
              htmlRunFragments.push(
                '<span class="word-tab" style="display:inline-block;min-width:22px;">&emsp;</span>'
              );
            }
          } else if (cLocal === 'br' || cLocal === 'cr') {
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
        if (local === 'r') {
          let rFont = '';
          const rPr = findDirectChildByLocalName(mathEl, 'rPr');
          const rFonts = rPr ? findDirectChildByLocalName(rPr, 'rFonts') : null;
          if (rFonts) {
            rFont = getXmlAttr(rFonts, 'ascii') || getXmlAttr(rFonts, 'hAnsi') || '';
          }
          let tOut = '';
          for (let i = 0; i < mathEl.children.length; i++) {
            const c = mathEl.children[i];
            const cl = c.tagName.replace(/^.*:/, '').toLowerCase();
            if (cl === 't') {
              const rawT = c.textContent || '';
              tOut += rFont
                ? mapWordSymbolCharToUnicode(rFont, rawT, false)
                : mapWordSymbolCharToUnicode('', rawT, false);
            } else if (cl === 'sym') {
              const symFont = getXmlAttr(c, 'font') || rFont || 'Symbol';
              const symChar = getXmlAttr(c, 'char');
              if (symChar) {
                tOut += mapWordSymbolCharToUnicode(symFont, symChar, true);
              }
            } else if (cl === 'r') {
              tOut += parseOfficeMathNode(c).text;
            }
          }
          if (!tOut) {
            for (const tEl of findAllDescendantsByLocalName(mathEl, 't')) {
              const rawT = tEl.textContent || '';
              tOut += rFont
                ? mapWordSymbolCharToUnicode(rFont, rawT, false)
                : mapWordSymbolCharToUnicode('', rawT, false);
            }
          }
          return { text: tOut, html: escapeHtmlText(tOut) };
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
          const fPr = findDirectChildByLocalName(mathEl, 'fPr');
          const fType = getXmlAttr(
            fPr ? findDirectChildByLocalName(fPr, 'type') : null,
            'val'
          ).toLowerCase();
          if (fType === 'nobar') {
            return {
              text: `(${num.text} ${den.text})`,
              html: `<span class="word-math-frac" style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;padding:0 3px;font-size:0.9em;"><span>${num.html}</span><span>${den.html}</span></span>`,
            };
          }
          return {
            text: `(${num.text})/(${den.text})`,
            html: `<span class="word-math-frac" style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;padding:0 3px;font-size:0.9em;line-height:1.1;"><span style="border-bottom:1px solid currentColor;padding:0 2px;">${num.html}</span><span style="padding:0 2px;">${den.html}</span></span>`,
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
            html: `${deg.html ? `<sup>${deg.html}</sup>` : ''}<span style="white-space:nowrap;">&radic;<span style="border-top:1px solid currentColor;padding:0 2px;">${body.html}</span></span>`,
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
        if (local === 'bar') {
          const barPr = findDirectChildByLocalName(mathEl, 'barPr');
          const posEl = barPr ? findDirectChildByLocalName(barPr, 'pos') : null;
          const pos = getXmlAttr(posEl, 'val').toLowerCase();
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const body = eEl
            ? parseOfficeMathChildren(eEl)
            : parseOfficeMathChildren(mathEl);
          return {
            text: body.text,
            html:
              pos === 'bot'
                ? `<span style="border-bottom:1px solid currentColor;">${body.html}</span>`
                : `<span style="border-top:1px solid currentColor;padding-top:1px;">${body.html}</span>`,
          };
        }
        if (local === 'acc') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const body = eEl
            ? parseOfficeMathChildren(eEl)
            : parseOfficeMathChildren(mathEl);
          return body;
        }
        if (local === 'func') {
          const fNameEl = findDirectChildByLocalName(mathEl, 'fName');
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const fName = fNameEl
            ? parseOfficeMathChildren(fNameEl)
            : { text: '', html: '' };
          const body = eEl
            ? parseOfficeMathChildren(eEl)
            : { text: '', html: '' };
          return {
            text: `${fName.text} ${body.text}`.trim(),
            html: `<span style="font-style:normal;">${fName.html}</span>${body.html}`,
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
            html: `<span style="font-size:1.12em;">${escapeHtmlText(symbol)}</span>${sub.html ? `<sub>${sub.html}</sub>` : ''}${sup.html ? `<sup>${sup.html}</sup>` : ''} ${body.html}`,
          };
        }
        if (local === 'd') {
          const dPr = findDirectChildByLocalName(mathEl, 'dPr');
          const begChrAttr = dPr ? findDirectChildByLocalName(dPr, 'begChr') : null;
          const endChrAttr = dPr ? findDirectChildByLocalName(dPr, 'endChr') : null;
          const sepChrAttr = dPr ? findDirectChildByLocalName(dPr, 'sepChr') : null;
          const begChr = begChrAttr ? getXmlAttr(begChrAttr, 'val') : '(';
          const endChr = endChrAttr ? getXmlAttr(endChrAttr, 'val') : ')';
          const sepChr = sepChrAttr ? getXmlAttr(sepChrAttr, 'val') || '|' : '|';

          const eChildren: Array<{ text: string; html: string }> = [];
          for (let i = 0; i < mathEl.children.length; i++) {
            const c = mathEl.children[i];
            if (c.tagName.replace(/^.*:/, '').toLowerCase() === 'e') {
              eChildren.push(parseOfficeMathChildren(c));
            }
          }
          const inner =
            eChildren.length > 0
              ? {
                  text: eChildren.map((e) => e.text).join(sepChr),
                  html: eChildren.map((e) => e.html).join(escapeHtmlText(sepChr)),
                }
              : parseOfficeMathChildren(mathEl);
          return {
            text: `${begChr}${inner.text}${endChr}`,
            html: `${escapeHtmlText(begChr)}${inner.html}${escapeHtmlText(endChr)}`,
          };
        }
        if (local === 'limlow' || local === 'limupp') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const limEl = findDirectChildByLocalName(mathEl, 'lim');
          const base = eEl ? parseOfficeMathChildren(eEl) : { text: '', html: '' };
          const lim = limEl ? parseOfficeMathChildren(limEl) : { text: '', html: '' };
          if (local === 'limlow') {
            return {
              text: lim.text ? `${base.text}_(${lim.text})` : base.text,
              html: lim.html ? `${base.html}<sub>${lim.html}</sub>` : base.html,
            };
          }
          return {
            text: lim.text ? `${base.text}^(${lim.text})` : base.text,
            html: lim.html ? `${base.html}<sup>${lim.html}</sup>` : base.html,
          };
        }
        if (local === 'spre') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          const subEl = findDirectChildByLocalName(mathEl, 'sub');
          const supEl = findDirectChildByLocalName(mathEl, 'sup');
          const base = eEl ? parseOfficeMathChildren(eEl) : { text: '', html: '' };
          const sub = subEl ? parseOfficeMathChildren(subEl) : { text: '', html: '' };
          const sup = supEl ? parseOfficeMathChildren(supEl) : { text: '', html: '' };
          return {
            text: `${sub.text ? `_(${sub.text})` : ''}${sup.text ? `^(${sup.text})` : ''}${base.text}`,
            html: `${sub.html ? `<sub>${sub.html}</sub>` : ''}${sup.html ? `<sup>${sup.html}</sup>` : ''}${base.html}`,
          };
        }
        if (local === 'box' || local === 'borderbox' || local === 'groupchr' || local === 'phant') {
          const eEl = findDirectChildByLocalName(mathEl, 'e');
          return eEl ? parseOfficeMathChildren(eEl) : parseOfficeMathChildren(mathEl);
        }
        if (local === 'eqarr' || local === 'm') {
          const rows = findAllDescendantsByLocalName(mathEl, 'mr');
          if (rows.length > 0) {
            const rParts = rows.map((r) => parseOfficeMathChildren(r));
            return {
              text: rParts.map((p) => p.text).join('; '),
              html: `<span style="display:inline-flex;flex-direction:column;vertical-align:middle;">${rParts
                .map((p) => `<span>${p.html}</span>`)
                .join('')}</span>`,
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
            cLocal === 'ssubsuppr' ||
            cLocal === 'sprepr' ||
            cLocal === 'narypr' ||
            cLocal === 'dpr' ||
            cLocal === 'mpr' ||
            cLocal === 'barpr' ||
            cLocal === 'accpr' ||
            cLocal === 'funcpr' ||
            cLocal === 'boxpr' ||
            cLocal === 'borderboxpr' ||
            cLocal === 'groupchrpr' ||
            cLocal === 'limlowpr' ||
            cLocal === 'limupppr' ||
            cLocal === 'eqarrpr' ||
            cLocal === 'argpr' ||
            cLocal === 'omathpr'
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
        if (cLocal === 'del' || cLocal === 'movefrom') {
          continue;
        }
        if (cLocal === 'r' || cLocal === 'drawing' || cLocal === 'pict') {
          processDrawingOrRunContainer(child);
        } else if (cLocal === 'hyperlink') {
          const rId = getXmlAttr(child, 'id');
          const href = rId ? activeRelsMap.get(rId) : undefined;
          for (const subR of findAllDescendantsByLocalName(child, 'r')) {
            if (
              !hasAncestorWithLocalName(subR, child, 'txbxContent') &&
              !hasAncestorWithLocalName(subR, child, 'del')
            ) {
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
              `<span class="word-math" style="font-family:'Cambria Math','Times New Roman',serif;display:inline;vertical-align:baseline;padding:0 2px;">${mathRes.html}</span>`
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
          for (let j = 0; j < child.children.length; j++) {
            const sub = child.children[j];
            const sLocal = sub.tagName.replace(/^.*:/, '').toLowerCase();
            if (sLocal === 'omathpara' || sLocal === 'omath') {
              const mathRes = parseOfficeMathNode(sub);
              if (mathRes.text.trim()) {
                runs.push({
                  text: ` ${mathRes.text.trim()} `,
                  italic: true,
                  fontSizePt,
                });
                htmlRunFragments.push(
                  `<span class="word-math" style="font-family:'Cambria Math','Times New Roman',serif;display:inline;vertical-align:baseline;padding:0 2px;">${mathRes.html}</span>`
                );
              }
            } else if (sLocal === 'r' || sLocal === 'drawing' || sLocal === 'pict') {
              processDrawingOrRunContainer(sub);
            } else if (sLocal !== 'del') {
              const innerRuns = findAllDescendantsByLocalName(sub, 'r').filter(
                (el) =>
                  !hasAncestorWithLocalName(el, sub, 'txbxContent') &&
                  !hasAncestorWithLocalName(el, sub, 'del')
              );
              if (innerRuns.length > 0) {
                for (const subR of innerRuns) {
                  processDrawingOrRunContainer(subR);
                }
              } else {
                processDrawingOrRunContainer(sub);
              }
            }
          }
        }
      }

      // Compute combined text BEFORE injecting listPrefix so empty paragraphs carrying only textboxes NEVER get a stray '*' bullet!
      const rawRunText = runs
        .map((r) => r.text)
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim();
      const hasStandaloneInlineEquationImages = runs.some(
        (r) => Boolean(r.inlineImageDataUrl)
      );

      if (pendingNumPr && (rawRunText.length > 0 || hasStandaloneInlineEquationImages)) {
        isListParagraph = true;
        const { numId, ilvl } = pendingNumPr;
        const lvlMap = numLevelsByNumId.get(numId);
        const lvlDef = lvlMap?.get(ilvl) || lvlMap?.get(0);
        const fmt = (lvlDef?.numFmt || 'bullet').toLowerCase();

        if (fmt === 'bullet') {
          listPrefix = ilvl === 0 ? '• ' : ilvl === 1 ? '◦ ' : '▪ ';
        } else if (fmt !== 'none') {
          // Reset deeper levels when a parent level advances (unless lvlRestart === 0)
          for (let subLvl = ilvl + 1; subLvl <= 8; subLvl++) {
            const subDef = lvlMap?.get(subLvl);
            if (!subDef || subDef.lvlRestart !== 0) {
              listCounters.delete(`${numId}:${subLvl}`);
            }
          }
          const counterKey = `${numId}:${ilvl}`;
          const prevCount = listCounters.get(counterKey);
          const nextCount =
            prevCount === undefined
              ? lvlDef?.start ?? 1
              : prevCount + 1;
          listCounters.set(counterKey, nextCount);

          let renderedMarker = lvlDef?.lvlText || `%${ilvl + 1}.`;
          renderedMarker = renderedMarker.replace(/%([1-9])/g, (_, digitStr) => {
            const targetIdx = Number(digitStr) - 1;
            const targetDef = lvlMap?.get(targetIdx) || lvlDef;
            const targetCount =
              targetIdx === ilvl
                ? nextCount
                : listCounters.get(`${numId}:${targetIdx}`) ??
                  targetDef?.start ??
                  1;
            return formatNumberingCounter(
              targetCount,
              targetDef?.numFmt || fmt
            );
          });
          if (!renderedMarker.endsWith(' ')) {
            renderedMarker += ' ';
          }
          listPrefix = renderedMarker;
        }

        if (listPrefix) {
          runs.unshift({
            text: listPrefix,
            bold: fmt !== 'bullet',
            colorHex: pColorHex,
            fontSizePt,
          });
          htmlRunFragments.unshift(
            `<span class="word-list-marker">${escapeHtmlText(listPrefix)}</span>`
          );
        }
      }

      const combinedText = runs
        .map((r) => r.text)
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim();

      const hasMultiTabColumns =
        customTabStops.some((t) => t.posPt >= 160) &&
        runs.some((r) => r.tabStopXPt !== undefined && r.tabStopXPt >= 160);

      const pCss: string[] = [];
      if (hasMultiTabColumns) {
        pCss.push('display:flex;align-items:baseline;flex-wrap:wrap;gap:4px');
      } else if (align) {
        pCss.push(`text-align:${align}`);
      }
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

      // Emit standalone block images (figures/logos/diagrams, NOT tiny inline equation icons)
      for (const img of embeddedImages) {
        if (!img.isInlineEquation) {
          pBlocks.push({
            type: 'image',
            imageDataUrl: img.dataUrl,
            imageWidthPt: img.widthPt,
            imageHeightPt: img.heightPt,
            align: align || 'center',
          });
        }
      }

      if (combinedText || hasStandaloneInlineEquationImages) {
        const allBold =
          pBold ||
          (runs.length > 0 &&
            runs.every((r) => (!r.text.trim() && !r.inlineImageDataUrl) || r.bold));
        const allItalic =
          pItalic ||
          (runs.length > 0 &&
            runs.every((r) => (!r.text.trim() && !r.inlineImageDataUrl) || r.italic));
        const allUnderline =
          pUnderline ||
          (runs.length > 0 &&
            runs.every((r) => (!r.text.trim() && !r.inlineImageDataUrl) || r.underline));

        pBlocks.push({
          type: headingLevel || (isListParagraph ? 'li' : 'p'),
          text: combinedText || ' ',
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
      } else if (pageBreakBefore) {
        if (postParagraphBlocks.length > 0) {
          postParagraphBlocks[0].pageBreakBefore = true;
        } else {
          pBlocks.push({
            type: 'p',
            text: '',
            pageBreakBefore: true,
          });
        }
      }

      // Flush paragraph-level textboxes/compact badge groups so multi-run pill groups combine cleanly
      if (paragraphBoxes.length > 0) {
        if (
          paragraphBoxes.length > 1 &&
          paragraphBoxes.every((b) => b.isCompactBadge)
        ) {
          const barColor =
            paragraphBoxes.find((b) => b.bgColorHex)?.bgColorHex || '#FBE4D5';
          htmlRunFragments.push(
            `<div class="word-textbox-group" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center;margin:6pt 0;background:${barColor};padding:5px 10px;border-radius:6px;">${paragraphBoxes
              .map((b) => b.html)
              .join('')}</div>`
          );
          const combinedBadgesText = paragraphBoxes
            .map((b) => b.text)
            .filter(Boolean)
            .join('    ');
          if (combinedBadgesText) {
            for (let k = postParagraphBlocks.length - 1; k >= 0; k--) {
              if (
                paragraphBoxes.some(
                  (b) => b.text === (postParagraphBlocks[k].text || '').trim()
                )
              ) {
                postParagraphBlocks.splice(k, 1);
              }
            }
            postParagraphBlocks.push({
              type: 'p',
              text: combinedBadgesText,
              bold: true,
              align: 'center',
              fontSizePt: 9.5,
              bgColorHex: barColor,
              spaceAfterPt: 4,
            });
          }
        } else {
          for (const b of paragraphBoxes) {
            if (b.isCompactBadge) {
              htmlRunFragments.push(
                `<div style="text-align:center;margin:6pt 0;">${b.html}</div>`
              );
            } else {
              htmlRunFragments.push(b.html);
            }
          }
        }
      }

      // Append textbox / anchored blocks after outer paragraph runs
      pBlocks.push(...postParagraphBlocks);

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

      return {
        html,
        pBlocks,
        isEmptySpacer: !hasRenderableContent && !pageBreakBefore,
      };
    };

    // Parse a <w:tbl> table element preserving column widths, spans, conditional banding & borders
    processTable = (
      tblEl: Element,
      activeRelsMap: Map<string, string> = docRelsMap
    ): { html: string; tableBlock: WordContentBlock | null } => {
      const tblPr = findDirectChildByLocalName(tblEl, 'tblPr');
      const tblStyleEl = tblPr ? findDirectChildByLocalName(tblPr, 'tblStyle') : null;
      const tblStyleId = getXmlAttr(tblStyleEl, 'val');
      const tblStyleDef = tblStyleId ? stylesMap.get(tblStyleId) : undefined;

      const tblLookEl = tblPr ? findDirectChildByLocalName(tblPr, 'tblLook') : null;
      const tblLookVal = tblLookEl ? parseInt(getXmlAttr(tblLookEl, 'val') || '0', 16) : 0;
      const useFirstRowBand = tblLookEl
        ? getXmlAttr(tblLookEl, 'firstRow') !== '0' &&
          (!Number.isNaN(tblLookVal) ? (tblLookVal & 0x0020) !== 0 || getXmlAttr(tblLookEl, 'firstRow') === '1' : true)
        : true;
      const useLastRowBand = tblLookEl
        ? getXmlAttr(tblLookEl, 'lastRow') === '1' || (tblLookVal & 0x0040) !== 0
        : false;
      const useHBand = tblLookEl
        ? getXmlAttr(tblLookEl, 'noHBand') !== '1' && (tblLookVal & 0x0200) === 0
        : true;

      const tblBorders = tblPr
        ? findDirectChildByLocalName(tblPr, 'tblBorders')
        : null;
      const isBdrNone = (val: string) =>
        val === 'none' || val === 'nil';
      let tableDefaultHasBorder = tblStyleDef?.tableHideAllBorders ? false : true;
      let defHideTop = !tableDefaultHasBorder;
      let defHideBottom = !tableDefaultHasBorder;
      let defHideLeft = !tableDefaultHasBorder;
      let defHideRight = !tableDefaultHasBorder;
      let defHideInsideV = !tableDefaultHasBorder;
      let defHideInsideH = !tableDefaultHasBorder;

      if (tblBorders) {
        const topVal = getXmlAttr(findDirectChildByLocalName(tblBorders, 'top'), 'val').toLowerCase();
        const botVal = getXmlAttr(findDirectChildByLocalName(tblBorders, 'bottom'), 'val').toLowerCase();
        const leftVal = getXmlAttr(findDirectChildByLocalName(tblBorders, 'left'), 'val').toLowerCase();
        const rightVal = getXmlAttr(findDirectChildByLocalName(tblBorders, 'right'), 'val').toLowerCase();
        const insideHVal = getXmlAttr(findDirectChildByLocalName(tblBorders, 'insideH'), 'val').toLowerCase();
        const insideVVal = getXmlAttr(findDirectChildByLocalName(tblBorders, 'insideV'), 'val').toLowerCase();

        if (topVal) defHideTop = isBdrNone(topVal);
        if (botVal) defHideBottom = isBdrNone(botVal);
        if (leftVal) defHideLeft = isBdrNone(leftVal);
        if (rightVal) defHideRight = isBdrNone(rightVal);
        if (insideHVal) defHideInsideH = isBdrNone(insideHVal);
        if (insideVVal) defHideInsideV = isBdrNone(insideVVal);

        if (defHideTop && defHideBottom && defHideLeft && defHideRight && defHideInsideH && defHideInsideV) {
          tableDefaultHasBorder = false;
        } else if (
          (topVal && !isBdrNone(topVal)) ||
          (botVal && !isBdrNone(botVal)) ||
          (insideHVal && !isBdrNone(insideHVal)) ||
          (insideVVal && !isBdrNone(insideVVal))
        ) {
          tableDefaultHasBorder = true;
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

      const trList: Element[] = [];
      for (let i = 0; i < tblEl.children.length; i++) {
        const c = tblEl.children[i];
        const tag = c.tagName.toLowerCase();
        if (tag === 'w:tr' || tag === 'tr') trList.push(c);
      }

      // Compute logical max column count across rows to avoid misaligned gridCols splitting a real cell
      let maxLogicalCols = 0;
      const firstRowTcWidths: number[] = [];
      trList.forEach((trEl, trIdx) => {
        const trPr = findDirectChildByLocalName(trEl, 'trPr');
        const gbEl = trPr ? findDirectChildByLocalName(trPr, 'gridBefore') : null;
        let rowCols = Number(getXmlAttr(gbEl, 'val') || '0') || 0;
        for (let i = 0; i < trEl.children.length; i++) {
          const c = trEl.children[i];
          const tag = c.tagName.toLowerCase();
          if (tag === 'w:tc' || tag === 'tc') {
            const tcPr = findDirectChildByLocalName(c, 'tcPr');
            const gsEl = tcPr ? findDirectChildByLocalName(tcPr, 'gridSpan') : null;
            const span = Math.max(1, Number(getXmlAttr(gsEl, 'val') || '1') || 1);
            rowCols += span;
            if (trIdx === 0) {
              const tcWEl = tcPr ? findDirectChildByLocalName(tcPr, 'tcW') : null;
              const tcWType = getXmlAttr(tcWEl, 'type').toLowerCase();
              const tcWVal = Number(getXmlAttr(tcWEl, 'w') || '0');
              if (tcWVal > 0 && tcWType !== 'pct') {
                const perCol = tcWVal / span;
                for (let s = 0; s < span; s++) firstRowTcWidths.push(perCol);
              }
            }
          }
        }
        if (rowCols > maxLogicalCols) maxLogicalCols = rowCols;
      });

      const effectiveGridCols =
        gridCols.length >= maxLogicalCols && gridCols.length > 0
          ? gridCols.slice(0, Math.max(maxLogicalCols, gridCols.length))
          : firstRowTcWidths.length >= maxLogicalCols && firstRowTcWidths.length > 0
            ? firstRowTcWidths
            : gridCols;

      const totalGridW = effectiveGridCols.reduce((acc, w) => acc + w, 0);
      const colWidthRatios =
        totalGridW > 0 ? effectiveGridCols.map((w) => w / totalGridW) : undefined;

      const rows: string[][] = [];
      const richCells: WordRichTableCell[][] = [];
      const trHtmls: string[] = [];
      let anyExplicitShading = false;

      trList.forEach((trEl, rIdx) => {
        const rowCells: string[] = [];
        const richRow: WordRichTableCell[] = [];
        const tdHtmls: string[] = [];
        const isLastRow = rIdx === trList.length - 1;

        const trPr = findDirectChildByLocalName(trEl, 'trPr');
        const gbEl = trPr ? findDirectChildByLocalName(trPr, 'gridBefore') : null;
        const gridBeforeCount = Math.max(0, Number(getXmlAttr(gbEl, 'val') || '0') || 0);

        const tcList: Element[] = [];
        for (let i = 0; i < trEl.children.length; i++) {
          const c = trEl.children[i];
          const tag = c.tagName.toLowerCase();
          if (tag === 'w:tc' || tag === 'tc') tcList.push(c);
        }

        let gridColPtr = 0;
        for (let gb = 0; gb < gridBeforeCount; gb++) {
          rowCells.push('');
          richRow.push({
            text: '',
            hideAllBorders: true,
            hideTopBorder: true,
            hideBottomBorder: true,
            hideLeftBorder: true,
            hideRightBorder: true,
          });
          tdHtmls.push('<td style="border:none;">&nbsp;</td>');
          gridColPtr++;
        }

        tcList.forEach((tcEl, tcIdx) => {
          const isFirstCellInRow = gridColPtr === 0 && tcIdx === 0;
          const isLastCellInRow = tcIdx === tcList.length - 1;
          const tcPr = findDirectChildByLocalName(tcEl, 'tcPr');
          let colSpan = 1;
          let bgColorHex: string | undefined;
          let vAlign = 'middle';
          let cellHasBottomLineOnly = false;
          let cellHideAllBorders = !tableDefaultHasBorder;
          let cellHideTop = rIdx === 0 ? defHideTop : defHideInsideH;
          let cellHideBottom = isLastRow ? defHideBottom : defHideInsideH;
          let cellHideLeft = isFirstCellInRow ? defHideLeft : defHideInsideV;
          let cellHideRight = isLastCellInRow ? defHideRight : defHideInsideV;
          let isVMergeContinue = false;

          if (tcPr) {
            const gsEl = findDirectChildByLocalName(tcPr, 'gridSpan');
            const gsVal = Number(getXmlAttr(gsEl, 'val') || '1');
            if (gsVal > 1) colSpan = gsVal;

            const vmEl = findDirectChildByLocalName(tcPr, 'vMerge');
            if (vmEl && !getXmlAttr(vmEl, 'val')) {
              isVMergeContinue = true;
            }

            const shdEl = findDirectChildByLocalName(tcPr, 'shd');
            bgColorHex = resolveWordShdFillHex(shdEl, themeMap);

            const vaEl = findDirectChildByLocalName(tcPr, 'vAlign');
            const vaVal = getXmlAttr(vaEl, 'val').toLowerCase();
            if (vaVal === 'top') vAlign = 'top';
            else if (vaVal === 'bottom') vAlign = 'bottom';

            const tcBorders = findDirectChildByLocalName(tcPr, 'tcBorders');
            if (tcBorders) {
              const botVal = getXmlAttr(findDirectChildByLocalName(tcBorders, 'bottom'), 'val').toLowerCase();
              const topVal = getXmlAttr(findDirectChildByLocalName(tcBorders, 'top'), 'val').toLowerCase();
              const leftVal = getXmlAttr(findDirectChildByLocalName(tcBorders, 'left'), 'val').toLowerCase();
              const rightVal = getXmlAttr(findDirectChildByLocalName(tcBorders, 'right'), 'val').toLowerCase();

              if (topVal) cellHideTop = isBdrNone(topVal);
              if (botVal) cellHideBottom = isBdrNone(botVal);
              if (leftVal) cellHideLeft = isBdrNone(leftVal);
              if (rightVal) cellHideRight = isBdrNone(rightVal);

              if (
                botVal &&
                !isBdrNone(botVal) &&
                (!topVal || isBdrNone(topVal)) &&
                (!leftVal || isBdrNone(leftVal)) &&
                (!rightVal || isBdrNone(rightVal))
              ) {
                cellHasBottomLineOnly = true;
              } else if (
                cellHideTop &&
                cellHideBottom &&
                cellHideLeft &&
                cellHideRight
              ) {
                cellHideAllBorders = true;
              } else if (
                (botVal && !isBdrNone(botVal)) ||
                (topVal && !isBdrNone(topVal)) ||
                (leftVal && !isBdrNone(leftVal)) ||
                (rightVal && !isBdrNone(rightVal))
              ) {
                cellHideAllBorders = false;
              }
            }
          }

          // Fallback to table style conditional row/band shading (firstRow, lastRow, band1Horz, band2Horz)
          let bandDef: DocxTableStyleBand | undefined;
          if (rIdx === 0 && useFirstRowBand && tblStyleDef?.tableFirstRow) {
            bandDef = tblStyleDef.tableFirstRow;
          } else if (isLastRow && useLastRowBand && tblStyleDef?.tableLastRow) {
            bandDef = tblStyleDef.tableLastRow;
          } else if (useHBand) {
            const dataIdx = useFirstRowBand ? rIdx - 1 : rIdx;
            if (dataIdx >= 0) {
              bandDef =
                dataIdx % 2 === 0
                  ? tblStyleDef?.tableBand1Horz
                  : tblStyleDef?.tableBand2Horz;
            }
          }
          if (!bgColorHex && bandDef?.bgColorHex) {
            bgColorHex = bandDef.bgColorHex;
          }
          if (bgColorHex) anyExplicitShading = true;

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
            firstBlock?.bold ??
            bandDef?.bold ??
            (rIdx === 0 && cellText.length > 0 && !firstBlock?.colorHex ? undefined : false);
          const cellColor = firstBlock?.colorHex || bandDef?.colorHex;
          const cellRuns = cellBlocks.flatMap((b, bIdx) => {
            const rList = b.runs && b.runs.length > 0 ? b.runs : [{ text: b.text || '' }];
            return bIdx > 0 ? [{ text: '\n' }, ...rList] : rList;
          });

          rowCells.push(cellText);
          richRow.push({
            text: cellText,
            align: cellAlign,
            bold: cellBold,
            italic: firstBlock?.italic,
            colorHex: cellColor,
            bgColorHex,
            colSpan,
            hideAllBorders: cellHideAllBorders,
            hideTopBorder: cellHideTop,
            hideBottomBorder: cellHideBottom,
            hideLeftBorder: cellHideLeft,
            hideRightBorder: cellHideRight,
            bottomBorderOnly: cellHasBottomLineOnly,
            vMergeContinue: isVMergeContinue,
            runs: cellRuns,
          });

          for (let s = 1; s < colSpan; s++) {
            rowCells.push('');
          }

          let cellWidthRatioSum = 0;
          if (colWidthRatios && gridColPtr < colWidthRatios.length) {
            for (
              let s = 0;
              s < colSpan && gridColPtr + s < colWidthRatios.length;
              s++
            ) {
              cellWidthRatioSum += colWidthRatios[gridColPtr + s];
            }
          }
          gridColPtr += colSpan;

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
            tdCss.push(`border-top:${cellHideTop ? 'none' : '1px solid #64748B'}`);
            tdCss.push(`border-bottom:${cellHideBottom ? 'none' : '1px solid #64748B'}`);
            tdCss.push(`border-left:${cellHideLeft ? 'none' : '1px solid #64748B'}`);
            tdCss.push(`border-right:${cellHideRight ? 'none' : '1px solid #64748B'}`);
          }

          if (bgColorHex) {
            tdCss.push(`background-color:${bgColorHex}`);
          }
          if (cellWidthRatioSum > 0) {
            tdCss.push(`width:${(cellWidthRatioSum * 100).toFixed(1)}%`);
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

      const html = `<table class="word-table" style="width:100%;border-collapse:collapse;margin:5pt 0;table-layout:fixed;">${colGroupHtml}<tbody>${trHtmls.join(
        ''
      )}</tbody></table>`;

      return {
        html,
        tableBlock: {
          type: 'table',
          rows,
          colWidthRatios,
          richCells,
          hideTableBorders: !tableDefaultHasBorder,
          hasExplicitRowShading: anyExplicitShading,
        },
      };
    };

    // Parse all header*.xml and footer*.xml files with their dedicated word/_rels/header*.xml.rels
    const extractHeaderFooterSection = (
      entryName: string,
      includeBlocks = false
    ): { html: string; sectionBlocks: WordContentBlock[] } => {
      const xmlStr = entries.get(entryName);
      if (!xmlStr) return { html: '', sectionBlocks: [] };
      try {
        const hfDoc = parser.parseFromString(xmlStr, 'application/xml');
        pruneMcAlternateContentFallbacks(hfDoc);
        const baseFile = entryName.replace(/^word\//, '');
        const hfRelsXml = entries.get(`word/_rels/${baseFile}.rels`) || '';
        const hfRelsMap = hfRelsXml
          ? buildRelsMapFromXml(hfRelsXml, entries, parser)
          : docRelsMap;

        const rootEl = hfDoc.documentElement;
        if (!rootEl) return { html: '', sectionBlocks: [] };
        const parts: string[] = [];
        const sectionBlocks: WordContentBlock[] = [];
        for (let i = 0; i < rootEl.children.length; i++) {
          const child = rootEl.children[i];
          const local = child.tagName.replace(/^.*:/, '').toLowerCase();
          if (local === 'p') {
            const res = processParagraph(child, true, hfRelsMap);
            if (!res.isEmptySpacer) {
              parts.push(res.html);
              if (includeBlocks) sectionBlocks.push(...res.pBlocks);
            }
          } else if (local === 'tbl') {
            const res = processTable(child, hfRelsMap);
            if (res.html) parts.push(res.html);
            if (includeBlocks && res.tableBlock) sectionBlocks.push(res.tableBlock);
          } else if (local === 'sdt') {
            const sdtContent = findDirectChildByLocalName(child, 'sdtContent');
            if (sdtContent) {
              for (let j = 0; j < sdtContent.children.length; j++) {
                const sub = sdtContent.children[j];
                const subLocal = sub.tagName.replace(/^.*:/, '').toLowerCase();
                if (subLocal === 'p') {
                  const res = processParagraph(sub, true, hfRelsMap);
                  if (!res.isEmptySpacer) {
                    parts.push(res.html);
                    if (includeBlocks) sectionBlocks.push(...res.pBlocks);
                  }
                } else if (subLocal === 'tbl') {
                  const res = processTable(sub, hfRelsMap);
                  if (res.html) parts.push(res.html);
                  if (includeBlocks && res.tableBlock) sectionBlocks.push(res.tableBlock);
                }
              }
            }
          }
        }
        return { html: parts.join('\n').trim(), sectionBlocks };
      } catch {
        return { html: '', sectionBlocks: [] };
      }
    };

    const headerParts: string[] = [];
    const headerImageBlocks: WordContentBlock[] = [];
    for (const hName of ['word/header1.xml', 'word/header2.xml', 'word/header3.xml']) {
      const { html: hContent, sectionBlocks } = extractHeaderFooterSection(hName, true);
      if (hContent && !headerParts.includes(hContent)) {
        headerParts.push(hContent);
      }
      for (const hb of sectionBlocks) {
        if (
          hb.type === 'image' &&
          hb.imageDataUrl &&
          !headerImageBlocks.some((x) => x.imageDataUrl === hb.imageDataUrl)
        ) {
          headerImageBlocks.push(hb);
        }
      }
    }
    const footerParts: string[] = [];
    for (const fName of ['word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml']) {
      const { html: fContent } = extractHeaderFooterSection(fName, false);
      if (fContent && !footerParts.includes(fContent)) {
        footerParts.push(fContent);
      }
    }

    const headerHtml = headerParts.join('\n');
    const footerHtml = footerParts.join('\n');
    if (headerImageBlocks.length > 0) {
      blocks.push(...headerImageBlocks);
    }

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
    let docMarginTopPt = 40;
    let docMarginBottomPt = 40;
    let docMarginLeftPt = hasLeftSidebarStrip ? 48 : 42;
    let docMarginRightPt = 40;

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
        docMarginTopPt = Math.max(24, Math.min(72, Math.round(topTwips / 20)));
        docMarginBottomPt = Math.max(24, Math.min(72, Math.round(bottomTwips / 20)));
        docMarginLeftPt = hasLeftSidebarStrip
          ? Math.max(42, Math.min(80, Math.round(leftTwips / 20) + 18))
          : Math.max(24, Math.min(72, Math.round(leftTwips / 20)));
        docMarginRightPt = Math.max(24, Math.min(72, Math.round(rightTwips / 20)));
        pagePaddingCss = `${docMarginTopPt}pt ${docMarginRightPt}pt ${docMarginBottomPt}pt ${docMarginLeftPt}pt`;
      }
    }

    // Attach document-level layout metadata (sidebar decorative border & margins) to blocks[0] for PDF Pages rendering
    if (blocks.length > 0) {
      if (hasLeftSidebarStrip) {
        blocks[0].sidebarImageDataUrl = sidebarBorderImages[0];
      }
      blocks[0].docMarginTopPt = docMarginTopPt;
      blocks[0].docMarginBottomPt = docMarginBottomPt;
      blocks[0].docMarginLeftPt = docMarginLeftPt;
      blocks[0].docMarginRightPt = docMarginRightPt;
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
        min-width: 64px !important;
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

  let isFixedPageKpf = false;
  if (entries.has('kdf_manifest.json')) {
    try {
      const kdfMeta = JSON.parse(entries.get('kdf_manifest.json') || '{}');
      if (
        kdfMeta.layoutMode === 'hybrid' ||
        kdfMeta.layoutMode === 'print-replica'
      ) {
        isFixedPageKpf = true;
      }
    } catch {
      // Ignore parse error
    }
  }

  const chapterRawList: string[] = [];
  for (let idx = 0; idx < orderedChapterPaths.length; idx++) {
    const path = orderedChapterPaths[idx];
    const rawChapter = entries.get(path) || '';
    if (!rawChapter.trim()) continue;
    if (rawChapter.includes('kpf-page-sheet')) {
      isFixedPageKpf = true;
    }
    chapterRawList.push(rawChapter);
  }

  if (!isFixedPageKpf) {
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
  }

  for (let idx = 0; idx < chapterRawList.length; idx++) {
    const chapterRaw = inlineArchiveAssets(chapterRawList[idx]);
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
    } else if (isFixedPageKpf) {
      chapterHtmlFragments.push(
        `<section data-chapter="${idx + 1}">${sanitizeHtmlForReader(
          chapterRaw
        )}</section>`
      );
    }
  }

  const plainText = wordBlocksToReadableText(allBlocks);
  const htmlPreview =
    chapterHtmlFragments.join(isFixedPageKpf ? '\n' : '\n<hr />\n') ||
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
 * Uses the real docx-preview OpenXML layout engine with pre/post DOM hooks
 * (VML roundrect normalization, WMF/EMF vector conversion, Wingdings translation,
 * SVG foreignObject box unwrapping, and responsive mobile page scaling)
 * to produce exact Word-faithful arranged HTML sheets for mobile & desktop.
 */
export async function renderDocxWithDocxPreviewToHtml(
  docxBytes: Uint8Array,
  fallbackTitle: string
): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  let host: HTMLDivElement | null = null;
  try {
    const zip = await JSZip.loadAsync(docxBytes);
    const convertedMediaMap = new Map<
      string,
      { newFileName: string; contentType: string; ext: string }
    >();

    // 1. Convert any .wmf / .emf equation or vector images to .svg / .png / .jpg / .bmp
    const mediaPaths = Object.keys(zip.files).filter((k) =>
      /\.(?:wmf|emf)$/i.test(k)
    );
    for (const oldPath of mediaPaths) {
      const entry = zip.file(oldPath);
      if (!entry) continue;
      try {
        const rawBytes = await entry.async('uint8array');
        const dataUrl = convertWmfOrEmfToDataUrl(
          rawBytes,
          oldPath.toLowerCase().endsWith('.emf')
        );
        if (!dataUrl) continue;
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx < 0) continue;
        const meta = dataUrl.slice(5, commaIdx);
        const contentType = meta.split(';')[0] || 'image/svg+xml';
        const ext = contentType.includes('png')
          ? 'png'
          : contentType.includes('jpeg')
            ? 'jpg'
            : contentType.includes('bmp')
              ? 'bmp'
              : 'svg';
        const b64 = dataUrl.slice(commaIdx + 1);
        const bin = atob(b64);
        const outBytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) outBytes[i] = bin.charCodeAt(i);

        const newPath = oldPath.replace(/\.(?:wmf|emf)$/i, `.${ext}`);
        zip.file(newPath, outBytes);
        const oldBase = oldPath.split('/').pop() || oldPath;
        const newBase = newPath.split('/').pop() || newPath;
        convertedMediaMap.set(oldBase, { newFileName: newBase, contentType, ext });
      } catch {
        // Ignore single broken metafile
      }
    }

    if (convertedMediaMap.size > 0) {
      const relFiles = Object.keys(zip.files).filter((k) =>
        k.toLowerCase().endsWith('.rels')
      );
      for (const relPath of relFiles) {
        const rf = zip.file(relPath);
        if (!rf) continue;
        let relXml = await rf.async('string');
        let changed = false;
        convertedMediaMap.forEach((info, oldBase) => {
          if (relXml.includes(oldBase)) {
            relXml = relXml.split(oldBase).join(info.newFileName);
            changed = true;
          }
        });
        if (changed) zip.file(relPath, relXml);
      }

      const ctFile = zip.file('[Content_Types].xml');
      if (ctFile) {
        let ctXml = await ctFile.async('string');
        const addedExts = new Set<string>();
        convertedMediaMap.forEach((info) => {
          if (
            !addedExts.has(info.ext) &&
            !new RegExp(`Extension=["']${info.ext}["']`, 'i').test(ctXml)
          ) {
            addedExts.add(info.ext);
            ctXml = ctXml.replace(
              '</Types>',
              `<Default Extension="${info.ext}" ContentType="${info.contentType}"/></Types>`
            );
          }
        });
        if (addedExts.size > 0) zip.file('[Content_Types].xml', ctXml);
      }
    }

    // 2. Pre-normalize XML parts for VML objects, DrawingML anchors, numbering bullets, symbols, and table borders:
    const parseCssStylePairs = (styleStr: string): Array<[string, string]> => {
      const pairs: Array<[string, string]> = [];
      if (!styleStr) return pairs;
      styleStr.split(';').forEach((part) => {
        const idx = part.indexOf(':');
        if (idx > 0) {
          const k = part.slice(0, idx).trim();
          const v = part.slice(idx + 1).trim();
          if (k && v) pairs.push([k, v]);
        }
      });
      return pairs;
    };

    const getCssProp = (styleStr: string, propName: string): string => {
      const target = propName.toLowerCase();
      for (const [k, v] of parseCssStylePairs(styleStr)) {
        if (k.toLowerCase() === target) return v;
      }
      return '';
    };

    const setOrAppendCssProps = (
      styleStr: string,
      updates: Record<string, string | null>
    ): string => {
      const pairs = parseCssStylePairs(styleStr);
      const lowerKeyToIndex = new Map<string, number>();
      pairs.forEach(([k], idx) => lowerKeyToIndex.set(k.toLowerCase(), idx));
      for (const [uk, uv] of Object.entries(updates)) {
        const lk = uk.toLowerCase();
        const existingIdx = lowerKeyToIndex.get(lk);
        if (uv === null) {
          if (existingIdx !== undefined) {
            pairs[existingIdx] = ['', ''];
          }
          continue;
        }
        if (!uv) continue;
        if (existingIdx !== undefined) {
          pairs[existingIdx] = [uk, uv];
        } else {
          lowerKeyToIndex.set(lk, pairs.length);
          pairs.push([uk, uv]);
        }
      }
      return pairs
        .filter(([k, v]) => k && v)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
    };

    const parsePtFromCssVal = (val: string | undefined | null): number => {
      if (!val) return 0;
      const clean = val.trim().toLowerCase();
      const num = parseFloat(clean);
      if (!Number.isFinite(num)) return 0;
      if (clean.endsWith('in')) return num * 72;
      if (clean.endsWith('cm')) return num * 28.3465;
      if (clean.endsWith('mm')) return num * 2.83465;
      if (clean.endsWith('px')) return num * 0.75;
      if (clean.endsWith('pc')) return num * 12;
      if (clean.endsWith('emu')) return num / 12700;
      return num; // default pt
    };

    // Strip Word VML palette index suffixes like "#fbd4b4 [3204]" -> "#fbd4b4"
    const cleanVmlColorVal = (raw: string | null | undefined): string => {
      if (!raw) return '';
      return raw
        .replace(/\s*\[[^\]]*\]/g, '')
        .trim()
        .split(/\s+/)[0] || '';
    };

    const localNameOf = (el: Element): string =>
      (el.localName || el.nodeName.split(':').pop() || '').toLowerCase();

    const findFirstDescendant = (root: Element, localTarget: string): Element | null => {
      const t = localTarget.toLowerCase();
      const all = root.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        if (localNameOf(all[i]) === t) return all[i];
      }
      return null;
    };

    const findDirectChildren = (root: Element, localTarget?: string): Element[] => {
      const t = localTarget?.toLowerCase();
      const out: Element[] = [];
      for (let i = 0; i < root.children.length; i++) {
        const ch = root.children[i];
        if (!t || localNameOf(ch) === t) out.push(ch);
      }
      return out;
    };

    const getWAttr = (el: Element, attrLocal: string): string =>
      el.getAttribute(`w:${attrLocal}`) || el.getAttribute(attrLocal) || '';

    const domParser = new DOMParser();
    const xmlSerializer = new XMLSerializer();

    // 2.0 Parse theme colors (word/theme/theme1.xml) and table style borders (word/styles.xml)
    let themeColors = new Map<string, string>();
    const themeFile = zip.file('word/theme/theme1.xml');
    if (themeFile) {
      try {
        const themeXml = await themeFile.async('string');
        themeColors = parseWordThemeColors(themeXml);
      } catch {
        // ignore theme parse error
      }
    }

    const resolveDrawingMlSchemeElement = (
      schemeEl: Element | null | undefined
    ): string | undefined => {
      if (!schemeEl) return undefined;
      const schemeVal = schemeEl.getAttribute('val') || getWAttr(schemeEl, 'val');
      if (!schemeVal) return undefined;
      const lumOffEl = findDirectChildren(schemeEl, 'lumoff')[0];
      const lumModEl = findDirectChildren(schemeEl, 'lummod')[0];
      const lumOff = lumOffEl
        ? Number(lumOffEl.getAttribute('val') || getWAttr(lumOffEl, 'val') || '0')
        : undefined;
      const lumMod = lumModEl
        ? Number(lumModEl.getAttribute('val') || getWAttr(lumModEl, 'val') || '100000')
        : undefined;
      return resolveWordSchemeColorHex(schemeVal, lumOff, themeColors, lumMod);
    };

    interface TableBorderSpec {
      val: string;
      sz: string;
      space: string;
      color: string;
    }
    const parseBorderElSpec = (bEl: Element | null | undefined): TableBorderSpec | null => {
      if (!bEl) return null;
      const val = getWAttr(bEl, 'val');
      if (!val) return null;
      return {
        val,
        sz: getWAttr(bEl, 'sz') || '4',
        space: getWAttr(bEl, 'space') || '0',
        color: getWAttr(bEl, 'color') || 'auto',
      };
    };

    const tableStyleBordersMap = new Map<
      string,
      Record<'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV', TableBorderSpec | null>
    >();

    const stylesFile = zip.file('word/styles.xml');
    if (stylesFile) {
      try {
        const stylesXmlStr = await stylesFile.async('string');
        const stylesDoc = domParser.parseFromString(stylesXmlStr, 'application/xml');
        if (stylesDoc.getElementsByTagName('parsererror').length === 0) {
          const styleNodes = Array.from(stylesDoc.getElementsByTagName('*')).filter(
            (e) => localNameOf(e) === 'style' && getWAttr(e, 'type') === 'table'
          );
          for (const stNode of styleNodes) {
            const styleId = getWAttr(stNode, 'styleId');
            if (!styleId) continue;
            const tblPr = findDirectChildren(stNode, 'tblpr')[0];
            const tblBorders = tblPr ? findDirectChildren(tblPr, 'tblborders')[0] : null;
            if (tblBorders) {
              tableStyleBordersMap.set(styleId, {
                top: parseBorderElSpec(findDirectChildren(tblBorders, 'top')[0]),
                bottom: parseBorderElSpec(
                  findDirectChildren(tblBorders, 'bottom')[0] ||
                    findDirectChildren(tblBorders, 'end')[0]
                ),
                left: parseBorderElSpec(
                  findDirectChildren(tblBorders, 'left')[0] ||
                    findDirectChildren(tblBorders, 'start')[0]
                ),
                right: parseBorderElSpec(
                  findDirectChildren(tblBorders, 'right')[0] ||
                    findDirectChildren(tblBorders, 'end')[0]
                ),
                insideH: parseBorderElSpec(findDirectChildren(tblBorders, 'insideh')[0]),
                insideV: parseBorderElSpec(findDirectChildren(tblBorders, 'insidev')[0]),
              });
            }
          }
        }
      } catch {
        // ignore styles parse error
      }
    }

    // 2.0b Normalize word/numbering.xml so bullet lists use clean Unicode bullets ('•') instead of Symbol/Wingdings PUA Tofu boxes
    const numberingFile = zip.file('word/numbering.xml');
    if (numberingFile) {
      try {
        const numXmlStr = await numberingFile.async('string');
        const numDoc = domParser.parseFromString(numXmlStr, 'application/xml');
        if (numDoc.getElementsByTagName('parsererror').length === 0) {
          let numModified = false;
          const allNumEls = Array.from(numDoc.getElementsByTagName('*'));
          for (const el of allNumEls) {
            const ln = localNameOf(el);
            if (ln === 'lvl') {
              const numFmtEl = findDirectChildren(el, 'numfmt')[0];
              const fmtVal = numFmtEl ? getWAttr(numFmtEl, 'val').toLowerCase() : '';
              const lvlTextEl = findDirectChildren(el, 'lvltext')[0];
              if (lvlTextEl) {
                const rawVal = getWAttr(lvlTextEl, 'val');
                if (fmtVal === 'bullet' || /[\uF000-\uF0FF\u2022\u25CF\u25AA\u25E6]/.test(rawVal)) {
                  let cleanBullet = '•';
                  if (rawVal && !/[\uF000-\uF0FF]/.test(rawVal) && !/%1/.test(rawVal)) {
                    const mapped = mapWordSymbolCharToUnicode('symbol', rawVal, true);
                    cleanBullet = mapped && !/[\uF000-\uF0FF]/.test(mapped) ? mapped : '•';
                  }
                  lvlTextEl.setAttribute('w:val', cleanBullet);
                  numModified = true;
                  const rPr = findDirectChildren(el, 'rpr')[0];
                  const rFonts = rPr ? findDirectChildren(rPr, 'rfonts')[0] : null;
                  if (rFonts) {
                    rFonts.setAttribute('w:ascii', 'Arial');
                    rFonts.setAttribute('w:hAnsi', 'Arial');
                    rFonts.setAttribute('w:cs', 'Arial');
                    rFonts.removeAttribute('w:hint');
                  }
                }
              }
            }
          }
          if (numModified) {
            zip.file('word/numbering.xml', xmlSerializer.serializeToString(numDoc));
          }
        }
      } catch {
        // ignore numbering normalization error
      }
    }

    // Track DrawingML <w:drawing> metadata in document order so Step 4 can position <wp:anchor> elements accurately
    interface DrawingAnchorMeta {
      isAnchor: boolean;
      behindDoc: boolean;
      wrapType: string; // 'wrapNone' | 'wrapTopAndBottom' | 'wrapSquare' | 'wrapTight' | 'wrapThrough' | 'inline'
      posHRel: string;
      posHAlign: string;
      posHOffsetPt: number;
      posVRel: string;
      posVAlign: string;
      posVOffsetPt: number;
      cxPt: number;
      cyPt: number;
    }
    const drawingMetaList: DrawingAnchorMeta[] = [];

    const xmlPartPaths = Object.keys(zip.files).filter((k) =>
      /^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(k)
    );

    for (const xmlPath of xmlPartPaths) {
      const xf = zip.file(xmlPath);
      if (!xf) continue;
      let xmlStr = await xf.async('string');
      let modified = false;
      const isMainDocument = /^word\/document\.xml$/i.test(xmlPath);

      try {
        const xmlDoc = domParser.parseFromString(xmlStr, 'application/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length === 0) {
          const vmlNs = 'urn:schemas-microsoft-com:vml';
          const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
          const allElements = Array.from(xmlDoc.getElementsByTagName('*'));

          // Collect <v:shapetype id="..."> definitions
          const shapetypeMap = new Map<
            string,
            { path: string; coordsize: string; coordorigin: string; stroked?: string; filled?: string; adj?: string }
          >();
          for (const el of allElements) {
            if (localNameOf(el) === 'shapetype') {
              const id = (el.getAttribute('id') || el.getAttribute('o:spid') || '').replace(
                /^#/,
                ''
              );
              const spt = el.getAttribute('o:spt') || '';
              let path = el.getAttribute('path') || '';
              if (!path) {
                const pEl = findFirstDescendant(el, 'path');
                if (pEl) path = pEl.getAttribute('v') || '';
              }
              const coordsize = el.getAttribute('coordsize') || '21600,21600';
              const coordorigin = el.getAttribute('coordorigin') || '0,0';
              const stroked = el.getAttribute('stroked') || undefined;
              const filled = el.getAttribute('filled') || undefined;
              const adj = el.getAttribute('adj') || undefined;
              const info = { path, coordsize, coordorigin, stroked, filled, adj };
              if (id) shapetypeMap.set(id, info);
              if (spt) shapetypeMap.set(`_x0000_t${spt}`, info);
            }
          }

          // 2.1 Convert <w:sym w:font="..." w:char="..."/> and Wingdings/Webdings/Symbol <w:r> runs into clean Unicode <w:t>
          for (const el of allElements) {
            const ln = localNameOf(el);
            if (ln === 'sym') {
              const symFont = getWAttr(el, 'font') || 'Wingdings';
              const symCharHex = getWAttr(el, 'char');
              if (symCharHex && el.parentNode) {
                const code = parseInt(symCharHex, 16);
                if (!Number.isNaN(code)) {
                  const mapped = mapWordSymbolCharToUnicode(
                    symFont,
                    String.fromCharCode(code),
                    false
                  );
                  const tNode = xmlDoc.createElementNS(wNs, 'w:t');
                  tNode.textContent = mapped || '✓';
                  el.parentNode.replaceChild(tNode, el);
                  modified = true;
                }
              }
            } else if (ln === 'r') {
              const rPr = findDirectChildren(el, 'rpr')[0];
              const rFonts = rPr ? findDirectChildren(rPr, 'rfonts')[0] : null;
              const fontCombine = rFonts
                ? `${getWAttr(rFonts, 'ascii')} ${getWAttr(rFonts, 'hAnsi')} ${getWAttr(rFonts, 'cs')}`.toLowerCase()
                : '';
              const isSymbolFont =
                fontCombine.includes('wingding') ||
                fontCombine.includes('webding') ||
                fontCombine.includes('symbol');
              const tNodes = findDirectChildren(el, 't');
              for (const tNode of tNodes) {
                const rawTxt = tNode.textContent || '';
                if (!rawTxt) continue;
                const hasPua = /[\uF000-\uF0FF]/.test(rawTxt);
                if (isSymbolFont || hasPua) {
                  const mapped = mapWordSymbolCharToUnicode(
                    isSymbolFont ? fontCombine : 'wingdings',
                    rawTxt,
                    false
                  );
                  if (mapped && mapped !== rawTxt) {
                    tNode.textContent = mapped;
                    if (rFonts) {
                      rFonts.setAttribute('w:ascii', 'Segoe UI Symbol');
                      rFonts.setAttribute('w:hAnsi', 'Segoe UI Symbol');
                      rFonts.setAttribute('w:cs', 'Segoe UI Symbol');
                    }
                    modified = true;
                  }
                }
              }
            }
          }

          // 2.2 Remove <w:numPr> from empty <w:p> paragraphs that contain no visible text
          // (In Word, an empty paragraph with <w:numPr> that only anchors a floating banner like FOR EXAMINER'S USE ONLY
          // does NOT render a list bullet; docx-preview renders a stray ':before' bullet unless <w:numPr> is stripped!)
          for (const el of allElements) {
            if (localNameOf(el) === 'p') {
              const pPr = findDirectChildren(el, 'ppr')[0];
              const numPr = pPr ? findDirectChildren(pPr, 'numpr')[0] : null;
              if (numPr) {
                // Collect text only from direct runs of this paragraph (excluding nested <v:textbox> runs)
                let directText = '';
                for (let i = 0; i < el.children.length; i++) {
                  const ch = el.children[i];
                  const chLn = localNameOf(ch);
                  if (chLn === 'r' || chLn === 'hyperlink' || chLn === 'ins' || chLn === 'smarttag') {
                    const tEls = ch.getElementsByTagName('*');
                    for (let j = 0; j < tEls.length; j++) {
                      const tEl = tEls[j];
                      if (localNameOf(tEl) === 't') {
                        // Ensure this <w:t> is not inside a <v:textbox> or <wps:txbx>
                        let anc: Element | null = tEl.parentElement;
                        let insideTxbx = false;
                        while (anc && anc !== el) {
                          const aln = localNameOf(anc);
                          if (aln === 'textbox' || aln === 'txbx' || aln === 'txbxcontent') {
                            insideTxbx = true;
                            break;
                          }
                          anc = anc.parentElement;
                        }
                        if (!insideTxbx) {
                          directText += tEl.textContent || '';
                        }
                      }
                    }
                  } else if (chLn === 'omath' || chLn === 'omathpara') {
                    directText += 'math';
                  }
                }
                if (!directText.trim()) {
                  pPr.removeChild(numPr);
                  modified = true;
                }
              }
            }
          }

          // 2.3 Materialize <w:tblBorders> (including <w:insideH>, <w:insideV>, and <w:tblStyle> borders)
          // onto each cell's <w:tcPr><w:tcBorders> because docx-preview ignores <w:insideH> and <w:insideV>!
          for (const el of allElements) {
            if (localNameOf(el) === 'tbl') {
              const tblPr = findDirectChildren(el, 'tblpr')[0];
              if (!tblPr) continue;
              const tblStyleEl = findDirectChildren(tblPr, 'tblstyle')[0];
              const styleId = tblStyleEl ? getWAttr(tblStyleEl, 'val') : '';
              const styleBorders = styleId ? tableStyleBordersMap.get(styleId) : undefined;
              const tblBorders = findDirectChildren(tblPr, 'tblborders')[0];

              const effTop =
                parseBorderElSpec(tblBorders ? findDirectChildren(tblBorders, 'top')[0] : null) ||
                styleBorders?.top ||
                null;
              const effBottom =
                parseBorderElSpec(
                  tblBorders
                    ? findDirectChildren(tblBorders, 'bottom')[0] ||
                        findDirectChildren(tblBorders, 'end')[0]
                    : null
                ) ||
                styleBorders?.bottom ||
                null;
              const effLeft =
                parseBorderElSpec(
                  tblBorders
                    ? findDirectChildren(tblBorders, 'left')[0] ||
                        findDirectChildren(tblBorders, 'start')[0]
                    : null
                ) ||
                styleBorders?.left ||
                null;
              const effRight =
                parseBorderElSpec(
                  tblBorders
                    ? findDirectChildren(tblBorders, 'right')[0] ||
                        findDirectChildren(tblBorders, 'end')[0]
                    : null
                ) ||
                styleBorders?.right ||
                null;
              const effInsideH =
                parseBorderElSpec(
                  tblBorders ? findDirectChildren(tblBorders, 'insideh')[0] : null
                ) ||
                styleBorders?.insideH ||
                null;
              const effInsideV =
                parseBorderElSpec(
                  tblBorders ? findDirectChildren(tblBorders, 'insidev')[0] : null
                ) ||
                styleBorders?.insideV ||
                null;

              if (!effTop && !effBottom && !effLeft && !effRight && !effInsideH && !effInsideV) {
                continue;
              }

              const rows = findDirectChildren(el, 'tr');
              const numRows = rows.length;
              for (let rIdx = 0; rIdx < numRows; rIdx++) {
                const tr = rows[rIdx];
                const cells = findDirectChildren(tr, 'tc');
                const numCells = cells.length;
                for (let cIdx = 0; cIdx < numCells; cIdx++) {
                  const tc = cells[cIdx];
                  let tcPr = findDirectChildren(tc, 'tcpr')[0];
                  if (!tcPr) {
                    tcPr = xmlDoc.createElementNS(wNs, 'w:tcPr');
                    tc.insertBefore(tcPr, tc.firstChild);
                  }
                  let tcBorders = findDirectChildren(tcPr, 'tcborders')[0];
                  if (!tcBorders) {
                    tcBorders = xmlDoc.createElementNS(wNs, 'w:tcBorders');
                    tcPr.appendChild(tcBorders);
                  }
                  const ensureSide = (
                    sideName: 'top' | 'left' | 'bottom' | 'right',
                    spec: TableBorderSpec | null
                  ) => {
                    if (!spec) return;
                    const existing =
                      findDirectChildren(tcBorders!, sideName)[0] ||
                      (sideName === 'left'
                        ? findDirectChildren(tcBorders!, 'start')[0]
                        : sideName === 'right'
                          ? findDirectChildren(tcBorders!, 'end')[0]
                          : null);
                    if (existing) return;
                    const bNode = xmlDoc.createElementNS(wNs, `w:${sideName}`);
                    bNode.setAttribute('w:val', spec.val);
                    bNode.setAttribute('w:sz', spec.sz);
                    bNode.setAttribute('w:space', spec.space);
                    bNode.setAttribute('w:color', spec.color);
                    tcBorders!.appendChild(bNode);
                    modified = true;
                  };

                  ensureSide('top', rIdx === 0 ? effTop : effInsideH);
                  ensureSide('bottom', rIdx === numRows - 1 ? effBottom : effInsideH);
                  ensureSide('left', cIdx === 0 ? effLeft : effInsideV);
                  ensureSide('right', cIdx === numCells - 1 ? effRight : effInsideV);
                }
              }
            }
          }

          // 2.4 Record <w:drawing> metadata in document order for main document
          if (isMainDocument) {
            for (const el of allElements) {
              if (localNameOf(el) === 'drawing') {
                // Skip drawings inside <mc:Choice> because docx-preview renders <mc:Fallback> instead!
                let anc: Element | null = el.parentElement;
                let insideChoice = false;
                while (anc) {
                  if (localNameOf(anc) === 'choice') {
                    insideChoice = true;
                    break;
                  }
                  anc = anc.parentElement;
                }
                if (insideChoice) continue;

                const anchorEl = findDirectChildren(el, 'anchor')[0];
                const inlineEl = findDirectChildren(el, 'inline')[0];
                const wpEl = anchorEl || inlineEl;
                if (!wpEl) continue;

                const isAnchor = Boolean(anchorEl);
                const behindDoc =
                  isAnchor &&
                  (wpEl.getAttribute('behindDoc') === '1' ||
                    wpEl.getAttribute('behindDoc') === 'true');
                const extentEl = findDirectChildren(wpEl, 'extent')[0];
                const cxPt = extentEl
                  ? (parseInt(extentEl.getAttribute('cx') || '0', 10) || 0) / 12700
                  : 0;
                const cyPt = extentEl
                  ? (parseInt(extentEl.getAttribute('cy') || '0', 10) || 0) / 12700
                  : 0;

                let wrapType = isAnchor ? 'wrapNone' : 'inline';
                let posHRel = 'column';
                let posHAlign = '';
                let posHOffsetPt = 0;
                let posVRel = 'paragraph';
                let posVAlign = '';
                let posVOffsetPt = 0;

                if (isAnchor) {
                  for (let i = 0; i < wpEl.children.length; i++) {
                    const ch = wpEl.children[i];
                    const chLn = localNameOf(ch);
                    if (
                      chLn === 'wrapnone' ||
                      chLn === 'wraptopandbottom' ||
                      chLn === 'wrapsquare' ||
                      chLn === 'wraptight' ||
                      chLn === 'wrapthrough'
                    ) {
                      wrapType = chLn;
                    } else if (chLn === 'positionh') {
                      posHRel = ch.getAttribute('relativeFrom') || 'column';
                      const alignEl = findDirectChildren(ch, 'align')[0];
                      const offsetEl = findDirectChildren(ch, 'posoffset')[0];
                      if (alignEl) posHAlign = (alignEl.textContent || '').trim().toLowerCase();
                      if (offsetEl) {
                        posHOffsetPt =
                          (parseInt((offsetEl.textContent || '0').trim(), 10) || 0) / 12700;
                      }
                    } else if (chLn === 'positionv') {
                      posVRel = ch.getAttribute('relativeFrom') || 'paragraph';
                      const alignEl = findDirectChildren(ch, 'align')[0];
                      const offsetEl = findDirectChildren(ch, 'posoffset')[0];
                      if (alignEl) posVAlign = (alignEl.textContent || '').trim().toLowerCase();
                      if (offsetEl) {
                        posVOffsetPt =
                          (parseInt((offsetEl.textContent || '0').trim(), 10) || 0) / 12700;
                      }
                    }
                  }
                }

                drawingMetaList.push({
                  isAnchor,
                  behindDoc,
                  wrapType,
                  posHRel,
                  posHAlign,
                  posHOffsetPt,
                  posVRel,
                  posVAlign,
                  posVOffsetPt,
                  cxPt,
                  cyPt,
                });
              }
            }
          }

          // 2a. Stamp <a:prstGeom prst="...">, adjustment <a:gd name="adj">, fill, and stroke from <mc:Choice> onto <mc:Fallback> VML shape
          for (const el of allElements) {
            if (localNameOf(el) === 'alternatecontent') {
              const choiceEl = findDirectChildren(el, 'choice')[0];
              const fallbackEl = findDirectChildren(el, 'fallback')[0];
              if (choiceEl && fallbackEl) {
                const prstEl = findFirstDescendant(choiceEl, 'prstgeom');
                const prst = prstEl?.getAttribute('prst') || '';
                const fbVml =
                  findFirstDescendant(fallbackEl, 'shape') ||
                  findFirstDescendant(fallbackEl, 'rect') ||
                  findFirstDescendant(fallbackEl, 'roundrect') ||
                  findFirstDescendant(fallbackEl, 'oval') ||
                  findFirstDescendant(fallbackEl, 'line');
                if (fbVml) {
                  const updates: Record<string, string> = {};
                  if (prst && prst !== 'rect') {
                    updates['--ep-geom'] = prst;
                  }
                  if (prstEl) {
                    const gdEls = prstEl.getElementsByTagName('*');
                    for (let i = 0; i < gdEls.length; i++) {
                      if (localNameOf(gdEls[i]) === 'gd') {
                        const fmla = gdEls[i].getAttribute('fmla') || '';
                        const m = fmla.match(/val\s+(-?\d+)/i);
                        if (m) {
                          // Convert DrawingML 0..100000 adj to 0..1000 permille
                          const permille = Math.round((parseInt(m[1], 10) / 100000) * 1000);
                          updates['--ep-adj'] = String(permille);
                          break;
                        }
                      }
                    }
                  }
                  const bodyPr = findFirstDescendant(choiceEl, 'bodypr');
                  const anchorAttr = bodyPr?.getAttribute('anchor');
                  if (anchorAttr) {
                    updates['--ep-vanchor'] = anchorAttr;
                  }

                  // Inspect <wps:spPr> and <wps:style> in <mc:Choice> so <mc:Fallback> VML matches DrawingML fill & outline
                  const spPr = findFirstDescendant(choiceEl, 'sppr');
                  const wpsStyle = findFirstDescendant(choiceEl, 'style');
                  if (spPr) {
                    const directNoFill = findDirectChildren(spPr, 'nofill')[0];
                    const directSolidFill = findDirectChildren(spPr, 'solidfill')[0];
                    if (directNoFill) {
                      fbVml.setAttribute('filled', 'f');
                      fbVml.setAttribute('fillcolor', 'none');
                      modified = true;
                    } else if (directSolidFill) {
                      const srgb = findFirstDescendant(directSolidFill, 'srgbclr');
                      const schemeClr = findFirstDescendant(directSolidFill, 'schemeclr');
                      const srgbVal = srgb?.getAttribute('val');
                      if (srgbVal) {
                        fbVml.setAttribute('fillcolor', `#${srgbVal}`);
                        modified = true;
                      } else if (schemeClr && !fbVml.getAttribute('fillcolor')) {
                        const resolvedHex = resolveDrawingMlSchemeElement(schemeClr);
                        if (resolvedHex) {
                          fbVml.setAttribute('fillcolor', resolvedHex);
                          modified = true;
                        }
                      }
                    } else if (wpsStyle && !fbVml.getAttribute('fillcolor')) {
                      const fillRef = findFirstDescendant(wpsStyle, 'fillref');
                      if (fillRef) {
                        const fillRefIdx = parseInt(fillRef.getAttribute('idx') || '0', 10);
                        if (fillRefIdx === 0) {
                          fbVml.setAttribute('filled', 'f');
                          fbVml.setAttribute('fillcolor', 'none');
                          modified = true;
                        } else {
                          const schemeClr = findFirstDescendant(fillRef, 'schemeclr');
                          const resolvedHex = resolveDrawingMlSchemeElement(schemeClr);
                          if (resolvedHex) {
                            fbVml.setAttribute('fillcolor', resolvedHex);
                            modified = true;
                          }
                        }
                      }
                    }

                    const lnEl = findDirectChildren(spPr, 'ln')[0];
                    if (lnEl) {
                      const lnNoFill = findDirectChildren(lnEl, 'nofill')[0];
                      const lnSolidFill = findDirectChildren(lnEl, 'solidfill')[0];
                      if (lnNoFill) {
                        fbVml.setAttribute('stroked', 'f');
                        modified = true;
                      } else if (lnSolidFill) {
                        const srgb = findFirstDescendant(lnSolidFill, 'srgbclr');
                        const val = srgb?.getAttribute('val');
                        if (val && !fbVml.getAttribute('strokecolor')) {
                          fbVml.setAttribute('strokecolor', `#${val}`);
                        }
                        if (fbVml.getAttribute('stroked') !== 'f') {
                          fbVml.setAttribute('stroked', 't');
                        }
                        modified = true;
                      }
                    } else if (wpsStyle) {
                      const lnRef = findFirstDescendant(wpsStyle, 'lnref');
                      if (lnRef && lnRef.getAttribute('idx') === '0' && !fbVml.getAttribute('strokecolor')) {
                        fbVml.setAttribute('stroked', 'f');
                        modified = true;
                      }
                    }
                  }

                  if (Object.keys(updates).length > 0) {
                    const curStyle = fbVml.getAttribute('style') || '';
                    fbVml.setAttribute('style', setOrAppendCssProps(curStyle, updates));
                    modified = true;
                  }
                }
              }
            }
          }

          // 2b. Unwrap any <v:group> inside <w:pict> into flat top-level VML elements in page-point coordinates
          const VML_LEAF_SHAPES = new Set([
            'shape',
            'rect',
            'roundrect',
            'oval',
            'line',
            'polyline',
            'polygon',
            'arc',
            'curve',
            'image',
          ]);

          interface GroupTransform {
            mlPt: number;
            mtPt: number;
            wPt: number;
            hPt: number;
            ox: number;
            oy: number;
            cw: number;
            ch: number;
            flipX: boolean;
            flipY: boolean;
            posHRel: string;
            posVRel: string;
            posH: string;
            zIndex: string;
          }

          const parseCoordPair = (raw: string | null | undefined, defX: number, defY: number): [number, number] => {
            if (!raw) return [defX, defY];
            const parts = raw.trim().split(/[,\s]+/);
            const x = parseFloat(parts[0] ?? '');
            const y = parseFloat(parts[1] ?? '');
            return [Number.isFinite(x) ? x : defX, Number.isFinite(y) ? y : defY];
          };

          const unwrapVmlGroupToLeaves = (
            groupEl: Element,
            parentGroup?: GroupTransform
          ): Element[] => {
            const gStyle = groupEl.getAttribute('style') || '';
            const [ox, oy] = parseCoordPair(groupEl.getAttribute('coordorigin'), 0, 0);
            const [cwRaw, chRaw] = parseCoordPair(groupEl.getAttribute('coordsize'), 1000, 1000);
            const cw = cwRaw !== 0 ? cwRaw : 1000;
            const ch = chRaw !== 0 ? chRaw : 1000;

            const flipRaw = getCssProp(gStyle, 'flip').toLowerCase();
            const ownFlipX = /\bx\b/.test(flipRaw);
            const ownFlipY = /\by\b/.test(flipRaw);

            let mlPt = 0;
            let mtPt = 0;
            let wPt = 100;
            let hPt = 100;
            let posHRel = getCssProp(gStyle, 'mso-position-horizontal-relative');
            let posVRel = getCssProp(gStyle, 'mso-position-vertical-relative');
            let posH = getCssProp(gStyle, 'mso-position-horizontal');
            let zIndex = getCssProp(gStyle, 'z-index');

            if (parentGroup) {
              const rawL = parseFloat(getCssProp(gStyle, 'left') || '0') || 0;
              const rawT = parseFloat(getCssProp(gStyle, 'top') || '0') || 0;
              const rawW = parseFloat(getCssProp(gStyle, 'width') || String(parentGroup.cw)) || parentGroup.cw;
              const rawH = parseFloat(getCssProp(gStyle, 'height') || String(parentGroup.ch)) || parentGroup.ch;

              let relX = ((rawL - parentGroup.ox) / parentGroup.cw) * parentGroup.wPt;
              let relY = ((rawT - parentGroup.oy) / parentGroup.ch) * parentGroup.hPt;
              wPt = (rawW / parentGroup.cw) * parentGroup.wPt;
              hPt = (rawH / parentGroup.ch) * parentGroup.hPt;
              if (parentGroup.flipX) relX = parentGroup.wPt - relX - wPt;
              if (parentGroup.flipY) relY = parentGroup.hPt - relY - hPt;
              mlPt = parentGroup.mlPt + relX;
              mtPt = parentGroup.mtPt + relY;
              posHRel = posHRel || parentGroup.posHRel;
              posVRel = posVRel || parentGroup.posVRel;
              posH = ''; // Sub-coordinates are now resolved relative to parentGroup
              zIndex = zIndex || parentGroup.zIndex;
            } else {
              mlPt = parsePtFromCssVal(getCssProp(gStyle, 'margin-left') || getCssProp(gStyle, 'left'));
              mtPt = parsePtFromCssVal(getCssProp(gStyle, 'margin-top') || getCssProp(gStyle, 'top'));
              wPt = Math.max(1, parsePtFromCssVal(getCssProp(gStyle, 'width')));
              hPt = Math.max(1, parsePtFromCssVal(getCssProp(gStyle, 'height')));
            }

            const ctx: GroupTransform = {
              mlPt,
              mtPt,
              wPt,
              hPt,
              ox,
              oy,
              cw,
              ch,
              flipX: parentGroup ? parentGroup.flipX !== ownFlipX : ownFlipX,
              flipY: parentGroup ? parentGroup.flipY !== ownFlipY : ownFlipY,
              posHRel,
              posVRel,
              posH,
              zIndex,
            };

            // Before unwrapping if top-level group had mso-position-horizontal:center and mlPt===0,
            // shift mlPt so centered groups stay centered on a standard ~450pt content column
            if (!parentGroup && (posH === 'center' || posH === 'right') && Math.abs(mlPt) < 2) {
              const colW = 450;
              if (wPt > 0 && wPt < colW) {
                ctx.mlPt = posH === 'center' ? (colW - wPt) / 2 : colW - wPt;
              }
            }

            const leaves: Element[] = [];
            for (let i = 0; i < groupEl.children.length; i++) {
              const chEl = groupEl.children[i];
              const chLn = localNameOf(chEl);
              if (chLn === 'group') {
                leaves.push(...unwrapVmlGroupToLeaves(chEl, ctx));
              } else if (VML_LEAF_SHAPES.has(chLn)) {
                const clone = chEl.cloneNode(true) as Element;
                let cStyle = clone.getAttribute('style') || '';
                const cFlipRaw = getCssProp(cStyle, 'flip').toLowerCase();
                let cFlipX = /\bx\b/.test(cFlipRaw) !== ctx.flipX;
                let cFlipY = /\by\b/.test(cFlipRaw) !== ctx.flipY;
                const newFlipVal =
                  cFlipX && cFlipY ? 'x y' : cFlipX ? 'x' : cFlipY ? 'y' : null;

                if (chLn === 'line') {
                  const [x1Raw, y1Raw] = parseCoordPair(clone.getAttribute('from'), ctx.ox, ctx.oy);
                  const [x2Raw, y2Raw] = parseCoordPair(clone.getAttribute('to'), ctx.ox + ctx.cw, ctx.oy + ctx.ch);
                  let rx1 = ((x1Raw - ctx.ox) / ctx.cw) * ctx.wPt;
                  let ry1 = ((y1Raw - ctx.oy) / ctx.ch) * ctx.hPt;
                  let rx2 = ((x2Raw - ctx.ox) / ctx.cw) * ctx.wPt;
                  let ry2 = ((y2Raw - ctx.oy) / ctx.ch) * ctx.hPt;
                  if (ctx.flipX) {
                    rx1 = ctx.wPt - rx1;
                    rx2 = ctx.wPt - rx2;
                  }
                  if (ctx.flipY) {
                    ry1 = ctx.hPt - ry1;
                    ry2 = ctx.hPt - ry2;
                  }
                  const x1Pt = ctx.mlPt + rx1;
                  const y1Pt = ctx.mtPt + ry1;
                  const x2Pt = ctx.mlPt + rx2;
                  const y2Pt = ctx.mtPt + ry2;
                  clone.setAttribute('from', `${x1Pt.toFixed(2)}pt,${y1Pt.toFixed(2)}pt`);
                  clone.setAttribute('to', `${x2Pt.toFixed(2)}pt,${y2Pt.toFixed(2)}pt`);
                  // Keep only own line flip (since group flip was already applied to rx/ry)
                  const ownLineFlip =
                    /\bx\b/.test(cFlipRaw) && /\by\b/.test(cFlipRaw)
                      ? 'x y'
                      : /\bx\b/.test(cFlipRaw)
                        ? 'x'
                        : /\by\b/.test(cFlipRaw)
                          ? 'y'
                          : null;
                  cStyle = setOrAppendCssProps(cStyle, {
                    position: 'absolute',
                    left: null,
                    top: null,
                    width: null,
                    height: null,
                    flip: ownLineFlip,
                    'z-index': getCssProp(cStyle, 'z-index') || ctx.zIndex || null,
                    'mso-position-horizontal-relative': ctx.posHRel || null,
                    'mso-position-vertical-relative': ctx.posVRel || null,
                  });
                  clone.setAttribute('style', cStyle);
                } else {
                  const rawL = parseFloat(getCssProp(cStyle, 'left') || '0') || 0;
                  const rawT = parseFloat(getCssProp(cStyle, 'top') || '0') || 0;
                  const rawW = parseFloat(getCssProp(cStyle, 'width') || '0') || 0;
                  const rawH = parseFloat(getCssProp(cStyle, 'height') || '0') || 0;

                  let relX = ((rawL - ctx.ox) / ctx.cw) * ctx.wPt;
                  let relY = ((rawT - ctx.oy) / ctx.ch) * ctx.hPt;
                  const cWPt = Math.max(0.5, (rawW / ctx.cw) * ctx.wPt);
                  const cHPt = Math.max(0.5, (rawH / ctx.ch) * ctx.hPt);
                  if (ctx.flipX) relX = ctx.wPt - relX - cWPt;
                  if (ctx.flipY) relY = ctx.hPt - relY - cHPt;
                  const cML = ctx.mlPt + relX;
                  const cMT = ctx.mtPt + relY;

                  cStyle = setOrAppendCssProps(cStyle, {
                    position: 'absolute',
                    left: null,
                    top: null,
                    'margin-left': `${cML.toFixed(2)}pt`,
                    'margin-top': `${cMT.toFixed(2)}pt`,
                    width: `${cWPt.toFixed(2)}pt`,
                    height: `${cHPt.toFixed(2)}pt`,
                    flip: newFlipVal,
                    'z-index': getCssProp(cStyle, 'z-index') || ctx.zIndex || null,
                    'mso-position-horizontal-relative': ctx.posHRel || null,
                    'mso-position-vertical-relative': ctx.posVRel || null,
                  });
                  clone.setAttribute('style', cStyle);
                }
                leaves.push(clone);
              }
            }
            return leaves;
          };

          // 2c. Normalize top-level VML elements inside each <w:pict>
          const normalizeTopLevelVmlElement = (el: Element) => {
            const ln = localNameOf(el);
            if (!VML_LEAF_SHAPES.has(ln)) return;

            let styleStr = el.getAttribute('style') || '';
            const typeRef = (el.getAttribute('type') || '').replace(/^#/, '');
            const stInfo = typeRef ? shapetypeMap.get(typeRef) : undefined;

            // 1. Handle <v:line from="x1,y1" to="x2,y2">
            if (ln === 'line') {
              const fromRaw = el.getAttribute('from') || '0pt,0pt';
              const toRaw = el.getAttribute('to') || '0pt,0pt';
              const [fxStr, fyStr] = fromRaw.split(/[,\s]+/);
              const [txStr, tyStr] = toRaw.split(/[,\s]+/);
              let x1 = parsePtFromCssVal(fxStr);
              let y1 = parsePtFromCssVal(fyStr);
              let x2 = parsePtFromCssVal(txStr);
              let y2 = parsePtFromCssVal(tyStr);

              const flipVal = getCssProp(styleStr, 'flip').toLowerCase();
              const minX = Math.min(x1, x2);
              const maxX = Math.max(x1, x2);
              const minY = Math.min(y1, y2);
              const maxY = Math.max(y1, y2);

              // In VML, <v:line> connects (minX, minY) -> (maxX, maxY) unless flipped by flip:x or flip:y
              let lx1 = x1 - minX;
              let ly1 = y1 - minY;
              let lx2 = x2 - minX;
              let ly2 = y2 - minY;
              if (/\bx\b/.test(flipVal)) {
                const tmp = lx1;
                lx1 = lx2;
                lx2 = tmp;
              }
              if (/\by\b/.test(flipVal)) {
                const tmp = ly1;
                ly1 = ly2;
                ly2 = tmp;
              }
              const wPt = Math.max(1, maxX - minX);
              const hPt = Math.max(1, maxY - minY);

              el.setAttribute('from', `${lx1.toFixed(2)}pt,${ly1.toFixed(2)}pt`);
              el.setAttribute('to', `${lx2.toFixed(2)}pt,${ly2.toFixed(2)}pt`);
              styleStr = setOrAppendCssProps(styleStr, {
                position: 'absolute',
                'margin-left': `${minX.toFixed(2)}pt`,
                'margin-top': `${minY.toFixed(2)}pt`,
                width: `${wPt.toFixed(2)}pt`,
                height: `${hPt.toFixed(2)}pt`,
                flip: null,
              });
            }

            // 2. Handle <v:polyline points="..."> and <v:polygon points="...">
            if (ln === 'polyline' || ln === 'polygon') {
              const pts = (el.getAttribute('points') || '').trim();
              if (pts) {
                const nums = pts.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number) || [];
                if (nums.length >= 4) {
                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                  for (let i = 0; i + 1 < nums.length; i += 2) {
                    if (nums[i] < minX) minX = nums[i];
                    if (nums[i] > maxX) maxX = nums[i];
                    if (nums[i + 1] < minY) minY = nums[i + 1];
                    if (nums[i + 1] > maxY) maxY = nums[i + 1];
                  }
                  const spanX = Math.max(1, maxX - minX);
                  const spanY = Math.max(1, maxY - minY);
                  const pathParts: string[] = [];
                  for (let i = 0; i + 1 < nums.length; i += 2) {
                    const nx = Math.round(((nums[i] - minX) / spanX) * 21600);
                    const ny = Math.round(((nums[i + 1] - minY) / spanY) * 21600);
                    pathParts.push(i === 0 ? `m${nx},${ny}` : `l${nx},${ny}`);
                  }
                  if (ln === 'polygon') pathParts.push('xe');
                  else pathParts.push('e');
                  el.setAttribute('path', pathParts.join(' '));
                  el.setAttribute('coordsize', '21600,21600');
                }
              }
            }

            // 3. Handle fill (strip Word "[3204]" palette suffix and apply VML default white #ffffff fill for filled shapes!)
            const filledAttr = (el.getAttribute('filled') || stInfo?.filled || '').toLowerCase();
            if (filledAttr === 'f' || filledAttr === 'false') {
              el.setAttribute('fillcolor', 'none');
            } else if (el.getAttribute('fillcolor')) {
              el.setAttribute('fillcolor', cleanVmlColorVal(el.getAttribute('fillcolor')));
            }
            for (let i = 0; i < el.children.length; i++) {
              const ch = el.children[i];
              const chLn = localNameOf(ch);
              if (chLn === 'fill') {
                const on = (ch.getAttribute('on') || '').toLowerCase();
                const fc = cleanVmlColorVal(ch.getAttribute('color'));
                if (on === 'f' || on === 'false') {
                  el.setAttribute('fillcolor', 'none');
                } else if (fc) {
                  ch.setAttribute('color', fc);
                  if (!el.getAttribute('fillcolor')) {
                    el.setAttribute('fillcolor', fc);
                  }
                }
              } else if (chLn === 'path') {
                const vp = ch.getAttribute('v');
                if (vp && !el.getAttribute('path')) {
                  el.setAttribute('path', vp);
                }
              } else if (chLn === 'wrap') {
                const wrapType = ch.getAttribute('type');
                if (wrapType) {
                  styleStr = setOrAppendCssProps(styleStr, { '--ep-vml-wrap': wrapType });
                }
              }
            }

            // In VML spec, shapes/textboxes are filled with opaque white (#ffffff) by default unless filled="f"
            const hasTextbox = Boolean(findDirectChildren(el, 'textbox')[0]);
            const curFillColor = cleanVmlColorVal(el.getAttribute('fillcolor'));
            if (
              !curFillColor &&
              filledAttr !== 'f' &&
              filledAttr !== 'false' &&
              (hasTextbox || ln === 'rect' || ln === 'roundrect' || /_t202\b/i.test(typeRef))
            ) {
              el.setAttribute('fillcolor', '#ffffff');
            }

            // 4. Stamp flip, rotation, adj, preset geometry, fill, and VML vector path onto CSS custom properties
            const flipCss = getCssProp(styleStr, 'flip').toLowerCase();
            const rotCss = getCssProp(styleStr, 'rotation').toLowerCase();
            const updates: Record<string, string> = {};

            const finalFillColor = cleanVmlColorVal(el.getAttribute('fillcolor'));
            if (finalFillColor) {
              updates['--ep-fill'] = finalFillColor;
            }

            if (/\bx\b/.test(flipCss)) updates['--ep-flip-x'] = '1';
            if (/\by\b/.test(flipCss)) updates['--ep-flip-y'] = '1';
            if (rotCss) {
              let deg = parseFloat(rotCss) || 0;
              if (rotCss.endsWith('fd')) deg = deg / 65536;
              if (Math.abs(deg) > 0.01) updates['--ep-rot'] = deg.toFixed(2);
            }

            const vTextAnchor = getCssProp(styleStr, 'v-text-anchor').toLowerCase();
            if (vTextAnchor === 'middle' || vTextAnchor === 'center') {
              updates['--ep-vanchor'] = 'ctr';
            } else if (vTextAnchor === 'bottom') {
              updates['--ep-vanchor'] = 'b';
            }

            let resolvedGeom = getCssProp(styleStr, '--ep-geom');
            let hasCustomVectorPath = false;

            if (ln === 'roundrect') {
              updates['border-radius'] = '6px';
              updates['--ep-geom'] = 'roundRect';
              resolvedGeom = 'roundRect';
            } else if (ln === 'shape' || ln === 'polyline' || ln === 'polygon' || ln === 'arc') {
              const vmlPath = el.getAttribute('path') || stInfo?.path || '';
              const csize = el.getAttribute('coordsize') || stInfo?.coordsize || '21600,21600';
              const corigin = el.getAttribute('coordorigin') || stInfo?.coordorigin || '0,0';
              const adjRaw = el.getAttribute('adj') || stInfo?.adj || '';

              if (adjRaw && !getCssProp(styleStr, '--ep-adj')) {
                const adjVal = parseFloat(adjRaw.split(/[,\s]+/)[0] || '');
                if (Number.isFinite(adjVal)) {
                  const [cwStr] = csize.split(/[,\s]+/);
                  const cw = parseFloat(cwStr || '21600') || 21600;
                  updates['--ep-adj'] = String(Math.round((adjVal / cw) * 1000));
                }
              }

              if (!resolvedGeom) {
                if (/_t5\b/i.test(typeRef)) resolvedGeom = 'triangle';
                else if (/_t6\b/i.test(typeRef)) resolvedGeom = 'rtTriangle';
                else if (/_t4\b/i.test(typeRef)) resolvedGeom = 'diamond';
                else if (/_t7\b/i.test(typeRef)) resolvedGeom = 'parallelogram';
                else if (/_t8\b/i.test(typeRef)) resolvedGeom = 'trapezoid';
                else if (/_t9\b/i.test(typeRef)) resolvedGeom = 'hexagon';
                else if (/_t10\b/i.test(typeRef)) resolvedGeom = 'octagon';
                else if (/_t13\b/i.test(typeRef)) resolvedGeom = 'rightArrow';
                else if (/_t20\b|_t32\b/i.test(typeRef)) resolvedGeom = 'line';
                if (resolvedGeom) updates['--ep-geom'] = resolvedGeom;
              }

              if (vmlPath && !/_t202\b/i.test(typeRef)) {
                hasCustomVectorPath = true;
                updates['--ep-vmlpath'] = encodeURIComponent(vmlPath);
                updates['--ep-csize'] = encodeURIComponent(csize);
                if (corigin && corigin !== '0,0') {
                  updates['--ep-corigin'] = encodeURIComponent(corigin);
                }
              }
            }

            // 5. Handle stroke:
            const strokedAttr = (el.getAttribute('stroked') || stInfo?.stroked || '').toLowerCase();
            const strokeColorAttr = cleanVmlColorVal(el.getAttribute('strokecolor'));
            if (strokeColorAttr) {
              el.setAttribute('strokecolor', strokeColorAttr);
            }
            const strokeWeightAttr = el.getAttribute('strokeweight');
            let strokeChild = findDirectChildren(el, 'stroke')[0];
            if (strokeChild?.getAttribute('color')) {
              strokeChild.setAttribute(
                'color',
                cleanVmlColorVal(strokeChild.getAttribute('color'))
              );
            }
            const strokeChildOn = (strokeChild?.getAttribute('on') || '').toLowerCase();
            const hasImageData = Boolean(findDirectChildren(el, 'imagedata')[0]);
            const isTextBoxShape = /_t202\b/i.test(typeRef);
            const isGeometricShape =
              ln === 'line' ||
              ln === 'polyline' ||
              ln === 'polygon' ||
              ln === 'arc' ||
              ln === 'curve' ||
              ln === 'oval' ||
              hasCustomVectorPath ||
              Boolean(resolvedGeom && resolvedGeom !== 'rect' && resolvedGeom !== 'roundRect') ||
              ((ln === 'rect' || ln === 'roundrect') && !hasTextbox && el.getAttribute('fillcolor') === 'none');
            const hasExplicitStroke =
              Boolean(strokeColorAttr) ||
              Boolean(strokeWeightAttr) ||
              strokedAttr === 't' ||
              strokedAttr === 'true' ||
              Boolean(strokeChild?.getAttribute('color')) ||
              Boolean(strokeChild?.getAttribute('weight'));

            if (
              strokedAttr === 'f' ||
              strokedAttr === 'false' ||
              strokeChildOn === 'f' ||
              strokeChildOn === 'false' ||
              (hasImageData && !hasExplicitStroke) ||
              (!isGeometricShape && !hasExplicitStroke && (isTextBoxShape || hasTextbox))
            ) {
              if (!strokeChild) {
                strokeChild = xmlDoc.createElementNS(vmlNs, 'v:stroke');
                el.appendChild(strokeChild);
              }
              strokeChild.setAttribute('color', 'none');
              updates['--ep-stroke'] = 'none';
            } else {
              if (!strokeChild) {
                strokeChild = xmlDoc.createElementNS(vmlNs, 'v:stroke');
                el.appendChild(strokeChild);
              }
              const resolvedStrokeClr =
                cleanVmlColorVal(strokeChild.getAttribute('color')) ||
                strokeColorAttr ||
                '#000000';
              strokeChild.setAttribute('color', resolvedStrokeClr);
              if (!strokeChild.getAttribute('weight')) {
                strokeChild.setAttribute('weight', strokeWeightAttr || '0.75pt');
              }
              updates['--ep-stroke'] = resolvedStrokeClr;
            }

            if (Object.keys(updates).length > 0) {
              styleStr = setOrAppendCssProps(styleStr, updates);
            }
            if (styleStr) {
              el.setAttribute('style', styleStr);
            }
          };

          const pictEls = allElements.filter((e) => localNameOf(e) === 'pict');
          for (const pictEl of pictEls) {
            // First unwrap any <v:group> children into flat top-level VML leaves
            const directChildren = Array.from(pictEl.children);
            for (const ch of directChildren) {
              if (localNameOf(ch) === 'group') {
                const unwrapped = unwrapVmlGroupToLeaves(ch);
                for (const leaf of unwrapped) {
                  pictEl.insertBefore(leaf, ch);
                }
                pictEl.removeChild(ch);
              }
            }
            // Now normalize all top-level VML elements in <w:pict>
            for (let i = 0; i < pictEl.children.length; i++) {
              normalizeTopLevelVmlElement(pictEl.children[i]);
            }
            modified = true;
          }

          if (modified) {
            xmlStr = xmlSerializer.serializeToString(xmlDoc);
          }
        }
      } catch (e) {
        console.warn('XML VML pre-normalization warning:', e);
      }

      // Map <v:roundrect>, <v:polyline>, <v:polygon>, <v:arc> -> supported docx-preview VML tags
      if (/<v:(?:roundrect|polyline|polygon|arc)\b/i.test(xmlStr)) {
        xmlStr = xmlStr
          .replace(/<v:roundrect\b/gi, '<v:rect')
          .replace(/<\/v:roundrect>/gi, '</v:rect>')
          .replace(/<v:(?:polyline|polygon|arc)\b/gi, '<v:shape')
          .replace(/<\/v:(?:polyline|polygon|arc)>/gi, '</v:shape>');
        modified = true;
      }

      if (modified) {
        zip.file(xmlPath, xmlStr);
      }
    }

    const normalizedBytes = await zip.generateAsync({ type: 'uint8array' });

    // 3. Render attached offscreen (visibility:hidden so getBBox & tab stop calculations execute accurately)
    host = document.createElement('div');
    host.style.cssText =
      'position:fixed;left:-12000px;top:0;width:900px;visibility:hidden;pointer-events:none;z-index:-1;';
    const styleHost = document.createElement('div');
    const bodyHost = document.createElement('div');
    host.appendChild(styleHost);
    host.appendChild(bodyHost);
    document.body.appendChild(host);

    await renderDocxPreviewAsync(normalizedBytes, bodyHost, styleHost, {
      inWrapper: true,
      hideWrapperOnPrint: false,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      debug: false,
      experimental: true,
      className: 'docx',
      trimXmlDeclaration: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
      renderChanges: false,
      renderComments: false,
      renderAltChunks: true,
    });

    // Wait 2 animation frames (~35ms) and immediately unwrap VML <svg><foreignObject> into .docx-vml-box
    // BEFORE docx-preview's 500ms refreshTabStops() timer fires!
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    // 4. DOM Post-Processing:
    // 4a. Translate Wingdings/Webdings/Symbol spans and PUA glyphs to crisp Unicode
    bodyHost.querySelectorAll('span').forEach((spanEl) => {
      const ff = (spanEl.style?.fontFamily || '').toLowerCase();
      const rawTxt = spanEl.textContent || '';
      const hasPua = /[\uF000-\uF0FF]/.test(rawTxt);
      if (
        ff.includes('wingding') ||
        ff.includes('webding') ||
        ff.includes('symbol') ||
        hasPua
      ) {
        if (spanEl.children.length === 0 && rawTxt) {
          const mapped = mapWordSymbolCharToUnicode(ff || 'wingdings', rawTxt, false);
          if (mapped && mapped !== rawTxt) {
            spanEl.textContent = mapped;
            spanEl.style.fontFamily =
              "'Segoe UI Symbol','DejaVu Sans','Apple Symbols',sans-serif";
          }
        }
      }
    });

    // Helper: Build an SVG overlay for geometric shapes (triangles with adj apex, right triangles, hexagons, lines, freeform VML paths)
    const buildGeomSvgOverlay = (
      geomRaw: string,
      vmlPathEncoded: string,
      csizeEncoded: string,
      coriginEncoded: string,
      adjRaw: string,
      flipX: boolean,
      flipY: boolean,
      rotDeg: number,
      fillVal: string,
      strokeVal: string,
      strokeW: string
    ): SVGSVGElement | null => {
      const geom = (geomRaw || '').trim().toLowerCase();
      const vmlPath = vmlPathEncoded ? decodeURIComponent(vmlPathEncoded) : '';
      const csize = csizeEncoded ? decodeURIComponent(csizeEncoded) : '21600,21600';
      const corigin = coriginEncoded ? decodeURIComponent(coriginEncoded) : '0,0';

      const isNonRectGeom =
        (geom &&
          geom !== 'rect' &&
          geom !== 'roundrect' &&
          geom !== 'textbox') ||
        Boolean(vmlPath);
      if (!isNonRectGeom) return null;

      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 1000 1000');
      svg.setAttribute('preserveAspectRatio', 'none');

      const transforms: string[] = [];
      if (Math.abs(rotDeg) > 0.01) transforms.push(`rotate(${rotDeg}deg)`);
      if (flipX) transforms.push('scaleX(-1)');
      if (flipY) transforms.push('scaleY(-1)');
      const transformCss =
        transforms.length > 0
          ? `transform:${transforms.join(' ')};transform-origin:50% 50%;`
          : '';

      svg.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0;${transformCss}`;

      const resolvedFill =
        fillVal && fillVal.toLowerCase() !== 'none' && fillVal.toLowerCase() !== 'transparent'
          ? fillVal
          : 'none';
      const resolvedStroke =
        strokeVal && strokeVal.toLowerCase() !== 'none' ? strokeVal : '#0F172A';
      const resolvedStrokeW = strokeW || '1.33px';

      const applyAttrs = (node: SVGElement, forceNoFill = false) => {
        node.setAttribute('fill', forceNoFill ? 'none' : resolvedFill);
        node.setAttribute(
          'stroke',
          strokeVal && strokeVal.toLowerCase() === 'none' ? 'none' : resolvedStroke
        );
        node.setAttribute('stroke-width', resolvedStrokeW);
        node.setAttribute('vector-effect', 'non-scaling-stroke');
        node.setAttribute('stroke-linejoin', 'round');
        node.setAttribute('stroke-linecap', 'round');
      };

      const adjNum = parseFloat(adjRaw);
      const apexX = Number.isFinite(adjNum) ? Math.max(0, Math.min(1000, adjNum)) : 500;
      const paraDx = Number.isFinite(adjNum) ? Math.max(0, Math.min(500, adjNum)) : 220;

      if (geom === 'line' || geom === 'straightconnector1') {
        const lineEl = document.createElementNS(svgNS, 'line');
        lineEl.setAttribute('x1', '0');
        lineEl.setAttribute('y1', '0');
        lineEl.setAttribute('x2', '1000');
        lineEl.setAttribute('y2', '1000');
        applyAttrs(lineEl, true);
        svg.appendChild(lineEl);
        return svg;
      }

      const polyMap: Record<string, string> = {
        triangle: `${apexX},10 990,990 10,990`,
        isoscelestriangle: `${apexX},10 990,990 10,990`,
        rttriangle: '10,10 990,990 10,990',
        righttriangle: '10,10 990,990 10,990',
        diamond: '500,10 990,500 500,990 10,500',
        hexagon: '250,10 750,10 990,500 750,990 250,990 10,500',
        octagon: '295,10 705,10 990,295 990,705 705,990 295,990 10,705 10,295',
        pentagon: '500,10 990,380 800,990 200,990 10,380',
        parallelogram: `${paraDx},10 990,10 ${1000 - paraDx},990 10,990`,
        trapezoid: `${paraDx},10 ${1000 - paraDx},10 990,990 10,990`,
        rightarrow: '10,260 680,260 680,40 990,500 680,960 680,740 10,740',
        leftarrow: '990,260 320,260 320,40 10,500 320,960 320,740 990,740',
        uparrow: '260,990 260,320 40,320 500,10 960,320 740,320 740,990',
        downarrow: '260,10 260,680 40,680 500,990 960,680 740,680 740,10',
      };

      // Use direct VML path when available (unless it uses @ formula references)
      if (vmlPath && !/@/.test(vmlPath)) {
        const [cwStr, chStr] = csize.split(/[,\s]+/);
        const [oxStr, oyStr] = corigin.split(/[,\s]+/);
        const cw = parseFloat(cwStr || '21600') || 21600;
        const ch = parseFloat(chStr || '21600') || 21600;
        const ox = parseFloat(oxStr || '0') || 0;
        const oy = parseFloat(oyStr || '0') || 0;

        // Exact VML path tokenizer splitting concatenated commands like 'xe' -> 'x', 'e'
        const tokens = vmlPath.match(
          /at|ar|wa|wr|qx|qy|qb|nf|ns|ae|al|[mlrcvxet]|[-+]?\d+/gi
        );
        if (tokens) {
          const out: string[] = [];
          let i = 0;
          let curX = 0;
          let curY = 0;
          let forceNoFill = false;
          const sx = (x: number) => (((x - ox) / cw) * 1000).toFixed(1);
          const sy = (y: number) => (((y - oy) / ch) * 1000).toFixed(1);
          const isNum = (idx: number) => idx < tokens.length && /^[-+]?\d+$/.test(tokens[idx]);

          while (i < tokens.length) {
            const cmd = tokens[i++].toLowerCase();
            if (cmd === 'm' && isNum(i) && isNum(i + 1)) {
              curX = parseFloat(tokens[i++]);
              curY = parseFloat(tokens[i++]);
              out.push(`M ${sx(curX)} ${sy(curY)}`);
              while (isNum(i) && isNum(i + 1)) {
                curX = parseFloat(tokens[i++]);
                curY = parseFloat(tokens[i++]);
                out.push(`L ${sx(curX)} ${sy(curY)}`);
              }
            } else if (cmd === 't' && isNum(i) && isNum(i + 1)) {
              curX += parseFloat(tokens[i++]);
              curY += parseFloat(tokens[i++]);
              out.push(`M ${sx(curX)} ${sy(curY)}`);
            } else if (cmd === 'l') {
              while (isNum(i) && isNum(i + 1)) {
                curX = parseFloat(tokens[i++]);
                curY = parseFloat(tokens[i++]);
                out.push(`L ${sx(curX)} ${sy(curY)}`);
              }
            } else if (cmd === 'r') {
              while (isNum(i) && isNum(i + 1)) {
                curX += parseFloat(tokens[i++]);
                curY += parseFloat(tokens[i++]);
                out.push(`L ${sx(curX)} ${sy(curY)}`);
              }
            } else if (cmd === 'c') {
              while (
                isNum(i) &&
                isNum(i + 1) &&
                isNum(i + 2) &&
                isNum(i + 3) &&
                isNum(i + 4) &&
                isNum(i + 5)
              ) {
                const x1 = parseFloat(tokens[i++]);
                const y1 = parseFloat(tokens[i++]);
                const x2 = parseFloat(tokens[i++]);
                const y2 = parseFloat(tokens[i++]);
                curX = parseFloat(tokens[i++]);
                curY = parseFloat(tokens[i++]);
                out.push(
                  `C ${sx(x1)} ${sy(y1)}, ${sx(x2)} ${sy(y2)}, ${sx(curX)} ${sy(curY)}`
                );
              }
            } else if (cmd === 'v') {
              while (
                isNum(i) &&
                isNum(i + 1) &&
                isNum(i + 2) &&
                isNum(i + 3) &&
                isNum(i + 4) &&
                isNum(i + 5)
              ) {
                const x1 = curX + parseFloat(tokens[i++]);
                const y1 = curY + parseFloat(tokens[i++]);
                const x2 = curX + parseFloat(tokens[i++]);
                const y2 = curY + parseFloat(tokens[i++]);
                curX += parseFloat(tokens[i++]);
                curY += parseFloat(tokens[i++]);
                out.push(
                  `C ${sx(x1)} ${sy(y1)}, ${sx(x2)} ${sy(y2)}, ${sx(curX)} ${sy(curY)}`
                );
              }
            } else if (cmd === 'at' || cmd === 'ar' || cmd === 'wa' || cmd === 'wr') {
              while (isNum(i + 7)) {
                const left = parseFloat(tokens[i++]);
                const top = parseFloat(tokens[i++]);
                const right = parseFloat(tokens[i++]);
                const bottom = parseFloat(tokens[i++]);
                const startX = parseFloat(tokens[i++]);
                const startY = parseFloat(tokens[i++]);
                const endX = parseFloat(tokens[i++]);
                const endY = parseFloat(tokens[i++]);
                const rx = Math.abs(((right - left) / 2 / cw) * 1000).toFixed(1);
                const ry = Math.abs(((bottom - top) / 2 / ch) * 1000).toFixed(1);
                const sweep = cmd === 'wa' || cmd === 'wr' ? 1 : 0;
                if (cmd === 'ar' || cmd === 'wr' || out.length === 0) {
                  out.push(`M ${sx(startX)} ${sy(startY)}`);
                } else {
                  out.push(`L ${sx(startX)} ${sy(startY)}`);
                }
                out.push(`A ${rx} ${ry} 0 0 ${sweep} ${sx(endX)} ${sy(endY)}`);
                curX = endX;
                curY = endY;
              }
            } else if (cmd === 'qx' || cmd === 'qy') {
              while (isNum(i) && isNum(i + 1)) {
                const endX = parseFloat(tokens[i++]);
                const endY = parseFloat(tokens[i++]);
                const rx = Math.abs(((endX - curX) / cw) * 1000).toFixed(1);
                const ry = Math.abs(((endY - curY) / ch) * 1000).toFixed(1);
                out.push(`A ${rx} ${ry} 0 0 1 ${sx(endX)} ${sy(endY)}`);
                curX = endX;
                curY = endY;
              }
            } else if (cmd === 'nf') {
              forceNoFill = true;
            } else if (cmd === 'x') {
              out.push('Z');
            }
          }
          if (out.length >= 2) {
            const pathEl = document.createElementNS(svgNS, 'path');
            pathEl.setAttribute('d', out.join(' '));
            applyAttrs(pathEl, forceNoFill);
            svg.appendChild(pathEl);
            return svg;
          }
        }
      }

      if (polyMap[geom]) {
        const poly = document.createElementNS(svgNS, 'polygon');
        poly.setAttribute('points', polyMap[geom]);
        applyAttrs(poly);
        svg.appendChild(poly);
        return svg;
      }

      return null;
    };

    // 4b. Unwrap VML <svg> containers holding <foreignObject> or geometric shapes into clean positioned boxes
    const svgNodes = Array.from(bodyHost.querySelectorAll('svg'));
    for (const svgEl of svgNodes) {
      if (!svgEl.parentNode || !bodyHost.contains(svgEl)) continue;

      const vmlPicWrapper = svgEl.parentElement;
      if (
        vmlPicWrapper &&
        vmlPicWrapper.tagName.toLowerCase() === 'div' &&
        !vmlPicWrapper.classList.contains('docx-wrapper')
      ) {
        vmlPicWrapper.classList.add('docx-vml-pic-wrap');
        // Prevent the <w:pict> wrapper div from forcing a block line break inside the host <p>
        vmlPicWrapper.style.display = 'inline';
      }

      const svgCss = svgEl.getAttribute('style') || '';
      const foreignObjs = Array.from(svgEl.querySelectorAll('foreignObject'));
      const geomProp = getCssProp(svgCss, '--ep-geom');
      const vmlPathProp = getCssProp(svgCss, '--ep-vmlpath');
      const csizeProp = getCssProp(svgCss, '--ep-csize');
      const coriginProp = getCssProp(svgCss, '--ep-corigin');
      const adjProp = getCssProp(svgCss, '--ep-adj');
      const flipX = getCssProp(svgCss, '--ep-flip-x') === '1';
      const flipY = getCssProp(svgCss, '--ep-flip-y') === '1';
      const rotDeg = parseFloat(getCssProp(svgCss, '--ep-rot') || '0') || 0;
      const vAnchor = getCssProp(svgCss, '--ep-vanchor');
      const epFill = cleanVmlColorVal(getCssProp(svgCss, '--ep-fill'));
      const epStroke = cleanVmlColorVal(getCssProp(svgCss, '--ep-stroke'));

      if (foreignObjs.length > 0 || geomProp || vmlPathProp) {
        const shapeEl =
          svgEl.querySelector('rect') ||
          svgEl.querySelector('ellipse') ||
          svgEl.querySelector('g');
        const fillVal = cleanVmlColorVal(shapeEl?.getAttribute('fill')) || epFill;
        const strokeVal = cleanVmlColorVal(shapeEl?.getAttribute('stroke')) || epStroke;
        const strokeW = (shapeEl?.getAttribute('stroke-width') || '1px').trim();

        const boxDiv = document.createElement('div');
        boxDiv.className = 'docx-vml-box';
        boxDiv.setAttribute('style', svgCss);
        boxDiv.style.boxSizing = 'border-box';
        boxDiv.style.display = 'flex';
        boxDiv.style.flexDirection = 'column';
        const boxHPt = parsePtFromCssVal(boxDiv.style.height);
        // Only vertically center when vAnchor is explicitly 'ctr' (so top-aligned SCHOOL: and STUDENT: share identical baselines!)
        if (vAnchor === 'ctr') {
          boxDiv.style.justifyContent = 'center';
        } else if (vAnchor === 'b') {
          boxDiv.style.justifyContent = 'flex-end';
        } else {
          boxDiv.style.justifyContent = 'flex-start';
        }

        const geomOverlay = buildGeomSvgOverlay(
          geomProp,
          vmlPathProp,
          csizeProp,
          coriginProp,
          adjProp,
          flipX,
          flipY,
          rotDeg,
          fillVal,
          strokeVal,
          strokeW
        );

        if (geomOverlay) {
          boxDiv.style.overflow = 'visible';
          boxDiv.appendChild(geomOverlay);
        } else {
          if (
            fillVal &&
            fillVal.toLowerCase() !== 'none' &&
            fillVal.toLowerCase() !== 'transparent'
          ) {
            boxDiv.style.backgroundColor = fillVal;
          }
          if (strokeVal && strokeVal.toLowerCase() !== 'none') {
            boxDiv.style.border = `${strokeW} solid ${strokeVal}`;
          }
          const transforms: string[] = [];
          if (Math.abs(rotDeg) > 0.01) transforms.push(`rotate(${rotDeg}deg)`);
          if (transforms.length > 0) {
            boxDiv.style.transform = transforms.join(' ');
          }
        }

        if (!boxDiv.style.width) {
          const wAttr = svgEl.getAttribute('width');
          if (wAttr && /^\d+(?:\.\d+)?$/.test(wAttr.trim())) {
            boxDiv.style.width = `${wAttr}px`;
          }
        }
        const origHeightCss = boxDiv.style.height;
        if (origHeightCss) {
          boxDiv.style.minHeight = origHeightCss;
        } else {
          const hAttr = svgEl.getAttribute('height');
          if (hAttr && /^\d+(?:\.\d+)?$/.test(hAttr.trim())) {
            boxDiv.style.minHeight = `${hAttr}px`;
          }
        }

        for (const fo of foreignObjs) {
          while (fo.firstChild) {
            const childNode = fo.firstChild;
            if (childNode.nodeType === 1) {
              (childNode as HTMLElement).style.position = 'relative';
              (childNode as HTMLElement).style.zIndex = '1';
            }
            boxDiv.appendChild(childNode);
          }
        }

        // Single-line VML text boxes (e.g. SCHOOL: ___, DATE: ___, SUBJECT: MATHEMAMATHMAM___, MIDTERM, INSTRUCTIONS):
        // Keep their fixed single-line height and clip overflowing template placeholder underscores so they never wrap onto a 2nd line!
        const innerParas = Array.from(boxDiv.querySelectorAll('p'));
        const boxText = (boxDiv.textContent || '').trim();
        const isSingleLineBox =
          !geomOverlay &&
          boxHPt > 0 &&
          boxHPt <= 30 &&
          innerParas.length <= 1;

        if (isSingleLineBox) {
          boxDiv.style.height = origHeightCss;
          boxDiv.style.maxHeight = origHeightCss;
          boxDiv.style.overflow = 'hidden';
          if (/__{3,}/.test(boxText)) {
            innerParas.forEach((p) => {
              p.style.whiteSpace = 'nowrap';
              p.style.overflow = 'hidden';
            });
          }
        } else {
          boxDiv.style.overflow = 'visible';
          if (!geomOverlay && foreignObjs.length > 0 && origHeightCss) {
            boxDiv.style.height = 'auto';
          }
        }

        svgEl.parentNode.replaceChild(boxDiv, svgEl);
      } else {
        svgEl.style.overflow = 'visible';
        svgEl.querySelectorAll('image').forEach((imgNode) => {
          const href = imgNode.getAttribute('href');
          if (href && !imgNode.getAttribute('xlink:href')) {
            imgNode.setAttribute('xlink:href', href);
          }
        });
      }
    }

    // Wait for docx-preview's 500ms refreshTabStops() timer to finish now that VML textboxes are unwrapped in the DOM
    await new Promise((resolve) => setTimeout(resolve, 520));
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    // Prevent refreshTabStops() from injecting excessive word-spacing inside single-line underscore form fields (e.g. DATE: ______)
    bodyHost.querySelectorAll('.docx-vml-box p').forEach((pNode) => {
      const pEl = pNode as HTMLElement;
      const txt = (pEl.textContent || '').trim();
      if (/__{3,}/.test(txt)) {
        pEl.style.whiteSpace = 'nowrap';
        pEl.style.overflow = 'hidden';
        pEl.querySelectorAll('.docx-tab-stop').forEach((ts) => {
          const tsEl = ts as HTMLElement;
          const ws = parseFloat(tsEl.style.wordSpacing || '0') || 0;
          if (ws > 28) {
            tsEl.style.wordSpacing = '12px';
          }
        });
      }
    });

    // 4b-2. Fix DrawingML <wp:anchor> elements (full-page decorative borders, centered school logos, and diagrams):
    // docx-preview renders every <w:drawing> as an inline-block/float:left div inside <p> and ignores <wp:posOffset> on wrapped anchors!
    const allMainArticleDrawings: HTMLElement[] = [];
    bodyHost
      .querySelectorAll('section.docx > article img')
      .forEach((imgNode) => {
        const wrapper = imgNode.parentElement as HTMLElement | null;
        if (
          wrapper &&
          wrapper.tagName === 'DIV' &&
          !wrapper.classList.contains('docx-vml-pic-wrap') &&
          !wrapper.classList.contains('docx-vml-box')
        ) {
          allMainArticleDrawings.push(wrapper);
        }
      });

    const pageBorderElements: HTMLElement[] = [];

    if (allMainArticleDrawings.length === drawingMetaList.length) {
      for (let idx = 0; idx < drawingMetaList.length; idx++) {
        const meta = drawingMetaList[idx];
        const drawDiv = allMainArticleDrawings[idx];
        if (!meta.isAnchor || !drawDiv) continue;

        const hostP = drawDiv.closest('p') as HTMLElement | null;
        const hostSec = drawDiv.closest('section.docx') as HTMLElement | null;
        const hostArt = drawDiv.closest('article') as HTMLElement | null;
        const artWidthPt =
          ((hostArt?.getBoundingClientRect().width || 650) * 0.75) || 487;

        const isFullHeightPageBorder =
          meta.cyPt >= 450 &&
          meta.cxPt <= 110 &&
          (meta.behindDoc ||
            meta.posHRel === 'page' ||
            meta.posVRel === 'page' ||
            meta.posHOffsetPt < 60);

        if (isFullHeightPageBorder && hostSec) {
          // Move the full-page decorative border out of the <p> flow and attach it directly to section.docx
          const borderClone = drawDiv.cloneNode(true) as HTMLElement;
          const leftPt =
            meta.posHRel === 'page'
              ? Math.max(4, meta.posHOffsetPt)
              : Math.max(4, 54 + meta.posHOffsetPt);
          const topPt =
            meta.posVRel === 'page' && meta.posVOffsetPt > 0
              ? meta.posVOffsetPt
              : 24;
          borderClone.className = 'docx-page-decorative-border';
          borderClone.style.cssText = `position:absolute !important;left:${leftPt.toFixed(1)}pt !important;top:${topPt.toFixed(1)}pt !important;width:${meta.cxPt.toFixed(1)}pt !important;height:${Math.min(790, meta.cyPt).toFixed(1)}pt !important;z-index:0 !important;pointer-events:none !important;float:none !important;margin:0 !important;`;
          pageBorderElements.push(borderClone);

          // Remove the original in-flow 780pt drawing div so it does not push Page 1 content down by 1040px!
          drawDiv.remove();
          if (
            hostP &&
            !(hostP.textContent || '').trim() &&
            !hostP.querySelector('img, svg, .docx-vml-box, table')
          ) {
            hostP.style.margin = '0';
            hostP.style.padding = '0';
            hostP.style.minHeight = '0';
            hostP.style.height = '0';
            hostP.style.lineHeight = '0';
          }
          continue;
        }

        // Non-border <wp:anchor> image (e.g., FEZA SCHOOLS logo, Pascal's triangle diagram, circuit diagram):
        drawDiv.style.float = 'none';
        const isCentered =
          meta.posHAlign === 'center' ||
          (meta.posHOffsetPt > 45 &&
            Math.abs(meta.posHOffsetPt + meta.cxPt / 2 - artWidthPt / 2) < 85);

        if (
          meta.wrapType === 'wraptopandbottom' ||
          meta.wrapType === 'wrapnone' ||
          isCentered ||
          meta.cxPt >= 120
        ) {
          drawDiv.style.display = 'block';
          drawDiv.style.position = 'relative';
          drawDiv.style.left = 'auto';
          drawDiv.style.top = 'auto';
          if (isCentered) {
            drawDiv.style.marginLeft = 'auto';
            drawDiv.style.marginRight = 'auto';
          } else if (meta.posHOffsetPt > 4) {
            drawDiv.style.marginLeft = `${meta.posHOffsetPt.toFixed(1)}pt`;
            drawDiv.style.marginRight = '0';
          }
          drawDiv.style.marginTop = '4pt';
          drawDiv.style.marginBottom = '4pt';

          // Collapse redundant empty spacer paragraphs that the author pressed Enter to create below a floating anchor image
          if (hostP) {
            let nextSib = hostP.nextElementSibling as HTMLElement | null;
            let collapsedPt = 0;
            while (
              nextSib &&
              nextSib.tagName === 'P' &&
              collapsedPt < meta.cyPt + 18 &&
              !(nextSib.textContent || '').trim() &&
              !nextSib.querySelector('img, svg, .docx-vml-box, table, math')
            ) {
              const toRemove = nextSib;
              nextSib = nextSib.nextElementSibling as HTMLElement | null;
              collapsedPt += 15;
              toRemove.remove();
            }
          }
        }
      }
    } else {
      // Fallback heuristic if count differs: still rescue any tall decorative border image (height >= 450pt, width <= 110pt)
      for (const drawDiv of allMainArticleDrawings) {
        const wPt = parsePtFromCssVal(drawDiv.style.width);
        const hPt = parsePtFromCssVal(drawDiv.style.height);
        if (hPt >= 450 && wPt > 0 && wPt <= 110) {
          const borderClone = drawDiv.cloneNode(true) as HTMLElement;
          borderClone.className = 'docx-page-decorative-border';
          borderClone.style.cssText = `position:absolute !important;left:10pt !important;top:24pt !important;width:${wPt.toFixed(1)}pt !important;height:${Math.min(790, hPt).toFixed(1)}pt !important;z-index:0 !important;pointer-events:none !important;float:none !important;margin:0 !important;`;
          pageBorderElements.push(borderClone);
          drawDiv.remove();
        }
      }
    }

    // 4c. Unify coordinate origin for all floating VML objects (<svg> shapes/lines/triangles and .docx-vml-box text boxes):
    const initialSections = Array.from(bodyHost.querySelectorAll('section.docx'));
    if (initialSections.length === 0) return null;

    for (const sec of initialSections) {
      const secEl = sec as HTMLElement;
      const secRect = secEl.getBoundingClientRect();
      const articleEl = (secEl.querySelector(':scope > article') as HTMLElement) || secEl;
      articleEl.style.position = 'relative';
      const headerEl = secEl.querySelector(':scope > header') as HTMLElement | null;
      if (headerEl) headerEl.style.position = 'relative';
      const footerEl = secEl.querySelector(':scope > footer') as HTMLElement | null;
      if (footerEl) footerEl.style.position = 'relative';
      const articleRect = articleEl.getBoundingClientRect();

      const vmlPicWraps = Array.from(
        secEl.querySelectorAll('.docx-vml-pic-wrap')
      ) as HTMLElement[];

      for (const wrapEl of vmlPicWraps) {
        const pEl = wrapEl.closest('p') as HTMLElement | null;
        if (!pEl) continue;

        const tdEl = pEl.closest('td, th') as HTMLElement | null;
        if (tdEl) {
          tdEl.style.position = 'relative';
        } else {
          pEl.style.position = '';
        }
        const tdRect = tdEl ? tdEl.getBoundingClientRect() : null;
        const containerRect = tdRect || articleRect;

        for (let i = 0; i < wrapEl.children.length; i++) {
          const vmlChild = wrapEl.children[i] as HTMLElement;
          if (!vmlChild || !vmlChild.style) continue;
          if (vmlChild.style.position !== 'absolute') continue;

          const rawStyle = vmlChild.getAttribute('style') || '';
          const posH = getCssProp(rawStyle, 'mso-position-horizontal').toLowerCase();
          const posHRel = getCssProp(rawStyle, 'mso-position-horizontal-relative').toLowerCase();
          const posVRel = getCssProp(rawStyle, 'mso-position-vertical-relative').toLowerCase();

          // Convert non-zero `left` / `top` VML coordinates into `margin-left` / `margin-top` if margins were omitted
          const rawLeftPt = parsePtFromCssVal(vmlChild.style.left);
          const curMlPt = parsePtFromCssVal(vmlChild.style.marginLeft);
          if (Math.abs(rawLeftPt) > 0.5 && Math.abs(curMlPt) < 0.5) {
            vmlChild.style.marginLeft = vmlChild.style.left;
          }
          const rawTopPt = parsePtFromCssVal(vmlChild.style.top);
          const curMtPt = parsePtFromCssVal(vmlChild.style.marginTop);
          if (Math.abs(rawTopPt) > 0.5 && Math.abs(curMtPt) < 0.5) {
            vmlChild.style.marginTop = vmlChild.style.top;
          }

          // Resolve mso-position-horizontal: center | right when margin-left is 0
          const mlPt = parsePtFromCssVal(vmlChild.style.marginLeft);
          if ((posH === 'center' || posH === 'right') && Math.abs(mlPt) < 2) {
            const refW =
              posHRel === 'page'
                ? secRect.width
                : tdRect
                  ? tdRect.width
                  : articleRect.width;
            const childW =
              vmlChild.getBoundingClientRect().width ||
              parsePtFromCssVal(vmlChild.style.width) * (4 / 3) ||
              0;
            if (childW > 0 && refW > childW) {
              const targetMlPx =
                posH === 'center'
                  ? Math.round((refW - childW) / 2)
                  : Math.round(refW - childW);
              vmlChild.style.marginLeft = `${targetMlPx}px`;
            }
          }

          // Set horizontal origin `left` (keeping `margin-left` intact!)
          if (posHRel === 'page') {
            vmlChild.style.left = `${Math.round(secRect.left - containerRect.left)}px`;
          } else if (posHRel === 'char') {
            vmlChild.style.left = 'auto';
          } else {
            // Relative to content column (<article>) or table cell (<td>) left edge
            vmlChild.style.left = '0px';
          }

          // Set vertical origin `top` (keeping `margin-top` intact!)
          if (posVRel === 'page') {
            vmlChild.style.top = `${Math.round(secRect.top - containerRect.top)}px`;
          } else if (posVRel === 'margin') {
            vmlChild.style.top = '0px';
          } else {
            // Default in Word VML ('paragraph', 'text', 'line', or omitted): keep CSS static line position (`auto`)
            vmlChild.style.top = 'auto';
          }

          // Only reserve vertical height on the anchor paragraph when the banner is anchored AT the paragraph (|mtPx| <= 20px),
          // never when a shape has a large marginTop offset to float far below a bullet list!
          const wrapType = getCssProp(rawStyle, '--ep-vml-wrap').toLowerCase();
          const childWPt =
            parsePtFromCssVal(vmlChild.style.width) ||
            vmlChild.getBoundingClientRect().width * 0.75;
          const childHPx =
            vmlChild.getBoundingClientRect().height ||
            parsePtFromCssVal(vmlChild.style.height) * (4 / 3) ||
            0;
          const mtPx = parsePtFromCssVal(vmlChild.style.marginTop) * (4 / 3);
          if (
            !tdRect &&
            posVRel !== 'page' &&
            posVRel !== 'margin' &&
            mtPx >= -4 &&
            mtPx <= 20 &&
            childHPx > 0 &&
            childHPx <= 48 &&
            (wrapType === 'topandbottom' || childWPt >= 260)
          ) {
            const neededPx = Math.ceil(Math.max(0, mtPx) + childHPx + 4);
            let availPx = pEl.getBoundingClientRect().height || 18;
            let nextSib = pEl.nextElementSibling as HTMLElement | null;
            while (
              nextSib &&
              nextSib.tagName === 'P' &&
              !(nextSib.textContent || '').trim() &&
              !nextSib.querySelector('img, svg, .docx-vml-box, table')
            ) {
              availPx += nextSib.getBoundingClientRect().height || 18;
              nextSib = nextSib.nextElementSibling as HTMLElement | null;
            }
            if (neededPx > availPx + 2) {
              const extraPx = neededPx - availPx;
              const curMinH = parseFloat(pEl.style.minHeight || '0') || 0;
              const targetMinH = Math.ceil((pEl.getBoundingClientRect().height || 18) + extraPx);
              if (targetMinH > curMinH) {
                pEl.style.minHeight = `${targetMinH}px`;
              }
            }
          }
        }
      }
    }

    // 4c-2. Live DOM A4 Page-by-Page Paginator:
    // Ensure every <section class="docx"> is a fixed A4 page canvas and split any overflowing <article> blocks
    // across discrete white A4 pages, keeping headings/stems with their following content and splitting long tables cleanly.
    const getVisualBottomOfBlock = (el: HTMLElement): number => {
      const r = el.getBoundingClientRect();
      let maxBottom = r.bottom;
      const vmlChildren = el.querySelectorAll('.docx-vml-box, svg');
      for (let i = 0; i < vmlChildren.length; i++) {
        const vr = vmlChildren[i].getBoundingClientRect();
        // Ignore full-page background decorative elements
        if (vr.height > 0 && vr.height < 550 && vr.bottom > maxBottom) {
          maxBottom = vr.bottom;
        }
      }
      return maxBottom;
    };

    const isHeadingOrKeepWithNextBlock = (el: HTMLElement): boolean => {
      if (el.tagName !== 'P' && !/^H[1-6]$/.test(el.tagName)) return false;
      if (/^H[1-6]$/.test(el.tagName)) return true;
      const txt = (el.textContent || '').trim();
      if (!txt) return false;
      if (/^(?:SECTION\s+[A-Z]|INSTRUCTIONS\b|FOR\s+EXAMINER|CORE\s+VALUES\b)/i.test(txt)) {
        return true;
      }
      if (/^Answer\s+all\s+questions/i.test(txt)) {
        return true;
      }
      // Question stem that introduces a table or diagram on the very next element
      const nextEl = el.nextElementSibling as HTMLElement | null;
      if (
        nextEl &&
        (nextEl.tagName === 'TABLE' || nextEl.querySelector('table, img')) &&
        txt.length < 180 &&
        /(?:following|table|diagram|figure|below|consider|:)\s*$/i.test(txt)
      ) {
        return true;
      }
      return false;
    };

    const wrapperEl = (bodyHost.querySelector('.docx-wrapper') as HTMLElement) || bodyHost;
    let currentSections = Array.from(
      wrapperEl.querySelectorAll(':scope > section.docx')
    ) as HTMLElement[];

    let sIdx = 0;
    let safetySplits = 0;
    while (sIdx < currentSections.length && safetySplits < 30) {
      const secEl = currentSections[sIdx];
      const articleEl = secEl.querySelector(':scope > article') as HTMLElement | null;
      if (!articleEl) {
        sIdx++;
        continue;
      }

      const pageHPt = parsePtFromCssVal(secEl.style.minHeight || secEl.style.height) || 841.9;
      const pageHPx = pageHPt * (4 / 3);
      const padBottomPt = parsePtFromCssVal(secEl.style.paddingBottom) || 36;
      const padBottomPx = Math.min(56, Math.max(20, padBottomPt * (4 / 3)));
      const footerEl = secEl.querySelector(':scope > footer') as HTMLElement | null;
      const footerHPx = footerEl ? Math.min(36, footerEl.getBoundingClientRect().height) : 0;

      const secTop = secEl.getBoundingClientRect().top;
      const maxContentBottom = secTop + pageHPx - Math.max(24, padBottomPx + footerHPx - 12);

      const blocks = Array.from(articleEl.children) as HTMLElement[];
      if (blocks.length <= 1) {
        sIdx++;
        continue;
      }

      let splitIndex = -1;
      for (let bIdx = 1; bIdx < blocks.length; bIdx++) {
        const blk = blocks[bIdx];
        const blkBottom = getVisualBottomOfBlock(blk);
        if (blkBottom > maxContentBottom + 6) {
          splitIndex = bIdx;
          break;
        }
      }

      if (splitIndex === -1) {
        sIdx++;
        continue;
      }

      // Check if the overflowing block is a multi-row TABLE that can be partially kept on this page
      const overflowBlk = blocks[splitIndex];
      if (overflowBlk.tagName === 'TABLE') {
        const tbody = overflowBlk.querySelector('tbody') || overflowBlk;
        const rows = Array.from(tbody.querySelectorAll(':scope > tr')) as HTMLElement[];
        if (rows.length >= 4) {
          let rowSplitIdx = -1;
          for (let rIdx = 1; rIdx < rows.length; rIdx++) {
            if (rows[rIdx].getBoundingClientRect().bottom > maxContentBottom + 4) {
              rowSplitIdx = rIdx;
              break;
            }
          }
          if (rowSplitIdx >= 2 && rowSplitIdx < rows.length) {
            // Split the table at rowSplitIdx, repeating the header row on the continuation table
            const contTable = overflowBlk.cloneNode(false) as HTMLElement;
            const colgroup = overflowBlk.querySelector('colgroup');
            if (colgroup) contTable.appendChild(colgroup.cloneNode(true));
            const thead = overflowBlk.querySelector('thead');
            if (thead) contTable.appendChild(thead.cloneNode(true));
            const contTbody = document.createElement('tbody');
            // Repeat first row if it looks like a header row (contains Q/NO or bold text) and there is no <thead>
            if (!thead && rows.length > 4) {
              const firstRowTxt = (rows[0].textContent || '').trim();
              if (/Q\/NO|QUESTION|MARKS|EXAMINER/i.test(firstRowTxt)) {
                contTbody.appendChild(rows[0].cloneNode(true));
              }
            }
            for (let rIdx = rowSplitIdx; rIdx < rows.length; rIdx++) {
              contTbody.appendChild(rows[rIdx]);
            }
            contTable.appendChild(contTbody);
            articleEl.insertBefore(contTable, overflowBlk.nextSibling);
            // Move contTable and everything after it to the next page
            splitIndex = splitIndex + 1;
          }
        }
      }

      // Backtrack splitIndex so headings / section titles / question stems aren't stranded at the bottom of the page
      while (splitIndex > 1 && isHeadingOrKeepWithNextBlock(blocks[splitIndex - 1])) {
        splitIndex--;
      }

      const currentBlocks = Array.from(articleEl.children) as HTMLElement[];
      if (splitIndex <= 0 || splitIndex >= currentBlocks.length) {
        sIdx++;
        continue;
      }

      // Create a new A4 <section class="docx"> page immediately after secEl
      const nextSec = secEl.cloneNode(false) as HTMLElement;
      const headerEl = secEl.querySelector(':scope > header');
      if (headerEl) nextSec.appendChild(headerEl.cloneNode(true));
      const nextArt = articleEl.cloneNode(false) as HTMLElement;
      nextArt.style.position = 'relative';
      for (let mIdx = splitIndex; mIdx < currentBlocks.length; mIdx++) {
        nextArt.appendChild(currentBlocks[mIdx]);
      }
      nextSec.appendChild(nextArt);
      if (footerEl) nextSec.appendChild(footerEl.cloneNode(true));

      secEl.parentNode?.insertBefore(nextSec, secEl.nextSibling);
      currentSections = Array.from(
        wrapperEl.querySelectorAll(':scope > section.docx')
      ) as HTMLElement[];
      safetySplits++;
      sIdx++;
    }

    // Lock each <section class="docx"> to its A4 height and attach the decorative left page border onto every page
    const finalPageSections = Array.from(
      wrapperEl.querySelectorAll(':scope > section.docx')
    ) as HTMLElement[];
    const templateBorder = pageBorderElements[0] || null;

    for (const secEl of finalPageSections) {
      const minH = secEl.style.minHeight || '841.9pt';
      secEl.style.minHeight = minH;
      secEl.style.height = minH;
      secEl.style.backgroundColor = '#FFFFFF';
      secEl.style.position = 'relative';
      secEl.style.overflow = 'hidden';
      secEl.style.boxSizing = 'border-box';

      if (templateBorder && !secEl.querySelector('.docx-page-decorative-border')) {
        secEl.insertBefore(templateBorder.cloneNode(true), secEl.firstChild);
      }
    }

    // 4d. Wrap each <section class="docx"> in a responsive scaling slot for narrow Android viewports
    for (const sec of finalPageSections) {
      const parent = sec.parentNode;
      if (!parent) continue;
      const slot = document.createElement('div');
      slot.className = 'docx-page-slot';
      const scaler = document.createElement('div');
      scaler.className = 'docx-page-scaler';
      parent.replaceChild(slot, sec);
      scaler.appendChild(sec);
      slot.appendChild(scaler);
    }

    const stylesHtml = Array.from(styleHost.querySelectorAll('style'))
      .map((s) => s.outerHTML)
      .join('\n');
    const bodyHtml = bodyHost.innerHTML;
    if (!bodyHtml.trim()) return null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlText(fallbackTitle)}</title>
  ${stylesHtml}
  <style id="elimika-docx-preview-layout">
    html, body.docx-fidelity-body {
      margin: 0;
      padding: 0;
      background: #CBD5E1;
      color: #0F172A;
      overflow-x: hidden;
    }
    .docx-wrapper {
      background: #CBD5E1 !important;
      padding: 14px 6px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 16px !important;
    }
    .docx-page-slot {
      position: relative;
      overflow: hidden;
      margin: 0 auto;
      border-radius: 2px;
    }
    .docx-page-scaler {
      transform-origin: top left;
      width: max-content;
    }
    .docx-page-scaler section.docx,
    section.docx {
      margin: 0 !important;
      background: #FFFFFF !important;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 3px rgba(15, 23, 42, 0.12) !important;
      position: relative !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .docx-page-scaler section.docx > article,
    .docx-page-scaler section.docx > header,
    .docx-page-scaler section.docx > footer {
      position: relative !important;
      z-index: 1;
    }
    .docx-page-decorative-border {
      z-index: 0 !important;
      pointer-events: none !important;
    }
    p[class*="docx-num-"]:before {
      display: inline-block;
      min-width: 14pt;
    }
    body.docx-fidelity-body svg {
      max-width: none !important;
    }
    .docx-vml-box {
      box-sizing: border-box;
      text-indent: 0pt !important;
      font-weight: normal;
      font-style: normal;
      text-align: left;
    }
    .docx-vml-box p {
      margin: 0 !important;
      min-height: 0 !important;
      text-indent: 0pt !important;
    }
    math {
      font-family: 'Cambria Math', 'STIX Two Math', 'Latin Modern Math', 'Times New Roman', serif;
      font-size: 1.03em;
    }
  </style>
</head>
<body class="docx-fidelity-body">
  ${bodyHtml}
  <script id="elimika-docx-fit-script">
    (function() {
      function fitDocxPages() {
        var vw = Math.max(240, (document.documentElement.clientWidth || window.innerWidth || 360) - 12);
        var slots = document.querySelectorAll('.docx-page-slot');
        for (var i = 0; i < slots.length; i++) {
          var slot = slots[i];
          var scaler = slot.querySelector('.docx-page-scaler');
          if (!scaler) continue;
          scaler.style.transform = 'none';
          var sec = scaler.querySelector('section.docx') || scaler.firstElementChild;
          var naturalW = (sec && sec.offsetWidth) || scaler.scrollWidth || 794;
          var naturalH = (sec && sec.offsetHeight) || scaler.scrollHeight || 1123;
          if (naturalW <= 0) naturalW = 794;
          if (naturalH <= 0) naturalH = 1123;
          var scale = vw < naturalW ? (vw / naturalW) : 1;
          if (scale < 0.995) {
            scaler.style.transform = 'scale(' + scale.toFixed(4) + ')';
            slot.style.width = Math.round(naturalW * scale) + 'px';
            slot.style.height = Math.round(naturalH * scale) + 'px';
          } else {
            scaler.style.transform = 'none';
            slot.style.width = Math.round(naturalW) + 'px';
            slot.style.height = Math.round(naturalH) + 'px';
          }
        }
      }
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(fitDocxPages).observe(document.documentElement);
      }
      window.addEventListener('resize', fitDocxPages);
      window.addEventListener('load', fitDocxPages);
      setTimeout(fitDocxPages, 30);
      setTimeout(fitDocxPages, 250);
    })();
  </script>
</body>
</html>`;
  } catch (err) {
    console.warn('docx-preview render fallback to OOXML HTML:', err);
    return null;
  } finally {
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }
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

      // 1a. High-fidelity Microsoft Word (.docx) Arranged HTML via docx-preview + Structured OOXML Blocks for PDF & Reflow
      if (zipEntries.has('word/document.xml')) {
        const [parsedDocx, docxPreviewHtml] = await Promise.all([
          Promise.resolve(parseDocxZipWithFullWordLayout(zipEntries, baseTitle)),
          renderDocxWithDocxPreviewToHtml(bytes, baseTitle),
        ]);
        if (parsedDocx && parsedDocx.blocks.length > 0) {
          return {
            blocks: parsedDocx.blocks,
            plainText: parsedDocx.plainText,
            htmlPreview: docxPreviewHtml || parsedDocx.htmlPreview,
          };
        }
        if (docxPreviewHtml) {
          const blocks = parseHtmlIntoWordBlocks(docxPreviewHtml);
          return {
            blocks,
            plainText: wordBlocksToReadableText(blocks),
            htmlPreview: docxPreviewHtml,
          };
        }
      }

      // 1b. eBooks (.epub, .kpf, .kdf) and OpenDocument (.odt)
      if (
        zipEntries.has('kdf_manifest.json') ||
        zipEntries.has('META-INF/container.xml') ||
        zipEntries.has('content.xml') ||
        lowerName.endsWith('.epub') ||
        lowerName.endsWith('.kpf') ||
        lowerName.endsWith('.kdf') ||
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

  // 3e. Non-ZIP .kdf / .kpf / .mobi / .azw3 binary or Kindle Create KDF SQLite/Ion stream parser
  if (
    lowerName.endsWith('.kdf') ||
    lowerName.endsWith('.kpf') ||
    lowerName.endsWith('.mobi') ||
    lowerName.endsWith('.azw3') ||
    lowerName.endsWith('.epub') ||
    rawStr.startsWith('SQLite format 3')
  ) {
    // 1. If the KDF/MOBI binary embeds HTML fragments directly, extract and parse them cleanly
    const htmlSnippets =
      rawStr.match(/<(?:h[1-6]|p|div|section|article|blockquote|li|tr)\b[^>]*>[\s\S]{10,4000}?<\/(?:h[1-6]|p|div|section|article|blockquote|li|tr)>/gi) ||
      [];
    if (htmlSnippets.length >= 3) {
      const combinedHtml = htmlSnippets.join('\n');
      const htmlBlocks = parseHtmlIntoWordBlocks(combinedHtml);
      if (htmlBlocks.length >= 2) {
        return {
          blocks: [{ type: 'h1', text: baseTitle, bold: true }, ...htmlBlocks],
          plainText: wordBlocksToReadableText(htmlBlocks),
          htmlPreview: wordBlocksToCleanHtml(
            [{ type: 'h1', text: baseTitle, bold: true }, ...htmlBlocks],
            baseTitle
          ),
        };
      }
    }

    // 2. Otherwise extract clean UTF-8 prose runs from the SQLite/Ion B-tree pages while stripping schema/Ion metadata
    const matches =
      rawStr.match(/[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF ,.;:'"?!()\-–—/%$&@#\n\r\t]{6,}/g) ||
      [];
    const metadataNoiseRe =
      /^(?:SQLite format|CREATE\s+TABLE|CREATE\s+INDEX|sqlite_autoindex|BOOKMOBI|TPZ|EXTH|INDX|TAGX|IDXT|FDST|kindle_|ion_|\$ion_|com\.amazon\.|yj\.|kdf_|amzn_|storyline|book_navigation|position_map|page_templates|section_list|font_styles|container_info|^[0-9a-f]{16,}$)/i;
    const filteredLines: string[] = [];
    const seenLine = new Set<string>();
    for (const rawMatch of matches) {
      const line = rawMatch.replace(/\s+/g, ' ').trim();
      if (
        line.length >= 8 &&
        /[A-Za-z\u00C0-\u024F]{3,}/.test(line) &&
        !metadataNoiseRe.test(line) &&
        !/^(?:[A-Za-z0-9_]+\.){2,}[A-Za-z0-9_]+$/.test(line) &&
        !seenLine.has(line)
      ) {
        seenLine.add(line);
        filteredLines.push(line);
      }
    }
    const cleanText =
      filteredLines.join('\n\n') ||
      `Kindle KDF / eBook document imported from "${file.name}".`;
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

const SUPERSCRIPT_DIGIT_MAP: Record<string, string> = {
  '\u2070': '0',
  '\u00B9': '1',
  '\u00B2': '2',
  '\u00B3': '3',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
  '\u207A': '+',
  '\u207B': '-',
  '\u207C': '=',
  '\u207D': '(',
  '\u207E': ')',
  '\u207F': 'n',
  '\u1D43': 'a',
  '\u1D47': 'b',
  '\u1D9C': 'c',
  '\u1D48': 'd',
  '\u1D49': 'e',
  '\u1D50': 'm',
  '\u1D56': 'p',
  '\u02E2': 's',
  '\u1D57': 't',
  '\u02E3': 'x',
  '\u02B8': 'y',
};

const SUBSCRIPT_DIGIT_MAP: Record<string, string> = {
  '\u2080': '0',
  '\u2081': '1',
  '\u2082': '2',
  '\u2083': '3',
  '\u2084': '4',
  '\u2085': '5',
  '\u2086': '6',
  '\u2087': '7',
  '\u2088': '8',
  '\u2089': '9',
  '\u208A': '+',
  '\u208B': '-',
  '\u208C': '=',
  '\u208D': '(',
  '\u208E': ')',
  '\u2090': 'a',
  '\u2091': 'e',
  '\u2092': 'o',
  '\u2093': 'x',
  '\u1D62': 'i',
  '\u2C7C': 'j',
  '\u2096': 'k',
  '\u2097': 'l',
  '\u2098': 'm',
  '\u2099': 'n',
  '\u209A': 'p',
  '\u1D63': 'r',
  '\u209B': 's',
  '\u209C': 't',
};

const BULLET_GLYPHS = new Set(['\u2022', '\u2023', '\u25E6', '\u2043', '\u2219', '\u25AA', '\u25CF']);

type StyledSegmentItem =
  | {
      kind: 'word';
      text: string;
      font: PDFFont;
      drawSize: number;
      baseSize: number;
      yShift: number;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      strike: boolean;
      colorHex?: string;
      bgColorHex?: string;
      colorRgb: { r: number; g: number; b: number };
      width: number;
    }
  | {
      kind: 'tab';
      targetXPt?: number;
      leader: 'underscore' | 'dot' | 'none';
      baseSize: number;
      colorRgb: { r: number; g: number; b: number };
    }
  | {
      kind: 'image';
      img: PDFImage;
      drawW: number;
      drawH: number;
      baseSize: number;
    }
  | {
      kind: 'newline';
      baseSize: number;
    };

type LaidOutStyledLine = {
  items: StyledSegmentItem[];
  lineWidth: number;
  maxFontSize: number;
  maxDrawHeight: number;
  hasTabStop: boolean;
};

interface CachedGlyphEntry {
  img: PDFImage;
  widthRatio: number;
  heightRatio: number;
}

/**
 * Splits a normalized text string into WinAnsi runs, bullets, superscript/subscript digits, and special Unicode symbols.
 */
function tokenizeUnicodeText(
  rawText: string
): Array<
  | { kind: 'winansi'; text: string }
  | { kind: 'bullet'; ch: string }
  | { kind: 'sup'; ch: string }
  | { kind: 'sub'; ch: string }
  | { kind: 'unicode'; ch: string }
> {
  const normalized = normalizeUnicodePunctuation(rawText);
  const tokens: Array<
    | { kind: 'winansi'; text: string }
    | { kind: 'bullet'; ch: string }
    | { kind: 'sup'; ch: string }
    | { kind: 'sub'; ch: string }
    | { kind: 'unicode'; ch: string }
  > = [];
  let winBuf = '';

  const flushWin = () => {
    if (winBuf) {
      tokens.push({ kind: 'winansi', text: winBuf });
      winBuf = '';
    }
  };

  for (const ch of normalized) {
    if (BULLET_GLYPHS.has(ch)) {
      flushWin();
      tokens.push({ kind: 'bullet', ch });
    } else if (SUPERSCRIPT_DIGIT_MAP[ch]) {
      flushWin();
      tokens.push({ kind: 'sup', ch: SUPERSCRIPT_DIGIT_MAP[ch] });
    } else if (SUBSCRIPT_DIGIT_MAP[ch]) {
      flushWin();
      tokens.push({ kind: 'sub', ch: SUBSCRIPT_DIGIT_MAP[ch] });
    } else if (isWinAnsiCodePoint(ch)) {
      winBuf += ch;
    } else {
      flushWin();
      tokens.push({ kind: 'unicode', ch });
    }
  }
  flushWin();
  return tokens;
}

const VECTOR_NATIVE_GLYPHS = new Set([
  '\u2713', '\u2714', '\u00B0', '\u00D7', '\u00F7', '\u00B1',
  '\u2264', '\u2265', '\u2260', '\u2192', '\u2190', '\u21D2', '\u21D4',
  '\u2229', '\u222A', '\u2205', '\u2227', '\u2228', '\u221A',
  '\u03B8', '\u03C0', '\u0394', '\u221E', '\u2212', '\u2261', '\u2248',
  '\u2234', '\u2208', '\u2282', '\u2286',
]);

function getFallbackUnicodeEmWidth(ch: string): number {
  switch (ch) {
    case '\u00B0': // °
      return 0.36;
    case '\u2713': // ✓
    case '\u2714':
      return 0.72;
    case '\u221A': // √
      return 0.65;
    case '\u2192': // →
    case '\u2190':
    case '\u21D2':
    case '\u21D4':
      return 0.85;
    case '\u221E': // ∞
      return 0.82;
    case '\u2229': // ∩
    case '\u222A': // ∪
    case '\u2205': // ∅
    case '\u2227': // ∧
    case '\u2228': // ∨
    case '\u2264': // ≤
    case '\u2265': // ≥
    case '\u2260': // ≠
    case '\u00B1': // ±
    case '\u00D7': // ×
    case '\u00F7': // ÷
    case '\u2248': // ≈
    case '\u2261': // ≡
    case '\u2212': // −
    case '\u2234': // ∴
    case '\u2208': // ∈
    case '\u2282': // ⊂
    case '\u2286': // ⊆
      return 0.62;
    default:
      return 0.58;
  }
}

/**
 * Draws common mathematical/exam Unicode symbols using crisp pure PDF vector paths
 * (guaranteed to work identically in headless Node and offline environments).
 */
function drawVectorUnicodeGlyph(
  page: PDFPage,
  ch: string,
  x: number,
  baselineY: number,
  size: number,
  colorRgb: { r: number; g: number; b: number },
  font: PDFFont
): boolean {
  const c = rgb(colorRgb.r, colorRgb.g, colorRgb.b);
  const strokeW = Math.max(0.65, size * 0.085);

  if (ch === '\u2713' || ch === '\u2714') {
    // Checkmark ✓
    page.drawLine({
      start: { x: x + size * 0.1, y: baselineY + size * 0.3 },
      end: { x: x + size * 0.32, y: baselineY + size * 0.05 },
      thickness: Math.max(0.9, size * 0.11),
      color: c,
    });
    page.drawLine({
      start: { x: x + size * 0.32, y: baselineY + size * 0.05 },
      end: { x: x + size * 0.72, y: baselineY + size * 0.68 },
      thickness: Math.max(0.9, size * 0.11),
      color: c,
    });
    return true;
  }
  if (ch === '\u00B0') {
    // Degree °
    page.drawCircle({
      x: x + size * 0.18,
      y: baselineY + size * 0.64,
      size: size * 0.12,
      borderWidth: Math.max(0.55, size * 0.068),
      borderColor: c,
    });
    return true;
  }
  if (ch === '\u00D7') {
    // Multiplication ×
    const cx = x + size * 0.3;
    const cy = baselineY + size * 0.32;
    const r = size * 0.19;
    page.drawLine({ start: { x: cx - r, y: cy - r }, end: { x: cx + r, y: cy + r }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: cx - r, y: cy + r }, end: { x: cx + r, y: cy - r }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u00F7') {
    // Division ÷
    const cx = x + size * 0.3;
    const cy = baselineY + size * 0.32;
    const r = size * 0.22;
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, thickness: strokeW, color: c });
    page.drawCircle({ x: cx, y: cy + size * 0.16, size: Math.max(0.7, size * 0.055), color: c });
    page.drawCircle({ x: cx, y: cy - size * 0.16, size: Math.max(0.7, size * 0.055), color: c });
    return true;
  }
  if (ch === '\u00B1') {
    // Plus-minus ±
    const cx = x + size * 0.3;
    const cy = baselineY + size * 0.38;
    const r = size * 0.19;
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx, y: cy + r }, thickness: strokeW, color: c });
    page.drawLine({
      start: { x: cx - r, y: baselineY + size * 0.08 },
      end: { x: cx + r, y: baselineY + size * 0.08 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u2264' || ch === '\u2265') {
    // ≤ / ≥
    const lx = x + size * 0.1;
    const rx = x + size * 0.52;
    const topY = baselineY + size * 0.62;
    const midY = baselineY + size * 0.4;
    const botY = baselineY + size * 0.18;
    if (ch === '\u2264') {
      page.drawLine({ start: { x: rx, y: topY }, end: { x: lx, y: midY }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: lx, y: midY }, end: { x: rx, y: botY }, thickness: strokeW, color: c });
    } else {
      page.drawLine({ start: { x: lx, y: topY }, end: { x: rx, y: midY }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: rx, y: midY }, end: { x: lx, y: botY }, thickness: strokeW, color: c });
    }
    page.drawLine({
      start: { x: lx, y: baselineY + size * 0.05 },
      end: { x: rx, y: baselineY + size * 0.05 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u2260') {
    // ≠
    const lx = x + size * 0.08;
    const rx = x + size * 0.52;
    page.drawLine({ start: { x: lx, y: baselineY + size * 0.42 }, end: { x: rx, y: baselineY + size * 0.42 }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx, y: baselineY + size * 0.22 }, end: { x: rx, y: baselineY + size * 0.22 }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx + size * 0.08, y: baselineY + size * 0.06 }, end: { x: rx - size * 0.08, y: baselineY + size * 0.62 }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u2192' || ch === '\u2190' || ch === '\u21D2') {
    // → / ← / ⇒
    const lx = x + size * 0.08;
    const rx = x + size * 0.74;
    const cy = baselineY + size * 0.32;
    if (ch === '\u21D2') {
      page.drawLine({ start: { x: lx, y: cy + size * 0.08 }, end: { x: rx - size * 0.1, y: cy + size * 0.08 }, thickness: strokeW * 0.85, color: c });
      page.drawLine({ start: { x: lx, y: cy - size * 0.08 }, end: { x: rx - size * 0.1, y: cy - size * 0.08 }, thickness: strokeW * 0.85, color: c });
      page.drawLine({ start: { x: rx - size * 0.2, y: cy + size * 0.18 }, end: { x: rx, y: cy }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: rx, y: cy }, end: { x: rx - size * 0.2, y: cy - size * 0.18 }, thickness: strokeW, color: c });
    } else if (ch === '\u2192') {
      page.drawLine({ start: { x: lx, y: cy }, end: { x: rx, y: cy }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: rx - size * 0.18, y: cy + size * 0.16 }, end: { x: rx, y: cy }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: rx, y: cy }, end: { x: rx - size * 0.18, y: cy - size * 0.16 }, thickness: strokeW, color: c });
    } else {
      page.drawLine({ start: { x: lx, y: cy }, end: { x: rx, y: cy }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: lx + size * 0.18, y: cy + size * 0.16 }, end: { x: lx, y: cy }, thickness: strokeW, color: c });
      page.drawLine({ start: { x: lx, y: cy }, end: { x: lx + size * 0.18, y: cy - size * 0.16 }, thickness: strokeW, color: c });
    }
    return true;
  }
  if (ch === '\u2229') {
    // Intersection ∩
    const lx = x + size * 0.12;
    const rx = x + size * 0.52;
    const botY = baselineY + size * 0.06;
    const archBaseY = baselineY + size * 0.42;
    const topY = baselineY + size * 0.56;
    page.drawLine({ start: { x: lx, y: botY }, end: { x: lx, y: archBaseY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: rx, y: botY }, end: { x: rx, y: archBaseY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx, y: archBaseY }, end: { x: (lx + rx) / 2, y: topY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: (lx + rx) / 2, y: topY }, end: { x: rx, y: archBaseY }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u222A') {
    // Union ∪
    const lx = x + size * 0.12;
    const rx = x + size * 0.52;
    const topY = baselineY + size * 0.56;
    const archBaseY = baselineY + size * 0.2;
    const botY = baselineY + size * 0.06;
    page.drawLine({ start: { x: lx, y: topY }, end: { x: lx, y: archBaseY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: rx, y: topY }, end: { x: rx, y: archBaseY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx, y: archBaseY }, end: { x: (lx + rx) / 2, y: botY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: (lx + rx) / 2, y: botY }, end: { x: rx, y: archBaseY }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u2205') {
    // Empty set ∅
    const cx = x + size * 0.31;
    const cy = baselineY + size * 0.34;
    const r = size * 0.21;
    page.drawCircle({ x: cx, y: cy, size: r, borderWidth: strokeW, borderColor: c });
    page.drawLine({
      start: { x: cx - r * 1.1, y: cy - r * 1.15 },
      end: { x: cx + r * 1.1, y: cy + r * 1.15 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u2227') {
    // Logic AND ∧
    page.drawLine({
      start: { x: x + size * 0.1, y: baselineY + size * 0.06 },
      end: { x: x + size * 0.31, y: baselineY + size * 0.58 },
      thickness: strokeW,
      color: c,
    });
    page.drawLine({
      start: { x: x + size * 0.31, y: baselineY + size * 0.58 },
      end: { x: x + size * 0.52, y: baselineY + size * 0.06 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u2228') {
    // Logic OR ∨
    page.drawLine({
      start: { x: x + size * 0.1, y: baselineY + size * 0.58 },
      end: { x: x + size * 0.31, y: baselineY + size * 0.06 },
      thickness: strokeW,
      color: c,
    });
    page.drawLine({
      start: { x: x + size * 0.31, y: baselineY + size * 0.06 },
      end: { x: x + size * 0.52, y: baselineY + size * 0.58 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u221A') {
    // Radical √
    page.drawLine({
      start: { x: x + size * 0.06, y: baselineY + size * 0.3 },
      end: { x: x + size * 0.16, y: baselineY + size * 0.36 },
      thickness: strokeW * 0.9,
      color: c,
    });
    page.drawLine({
      start: { x: x + size * 0.16, y: baselineY + size * 0.36 },
      end: { x: x + size * 0.28, y: baselineY + size * 0.02 },
      thickness: strokeW,
      color: c,
    });
    page.drawLine({
      start: { x: x + size * 0.28, y: baselineY + size * 0.02 },
      end: { x: x + size * 0.56, y: baselineY + size * 0.72 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u03B8') {
    // Greek theta θ
    const cx = x + size * 0.29;
    const cy = baselineY + size * 0.36;
    page.drawEllipse({
      x: cx,
      y: cy,
      xScale: size * 0.19,
      yScale: size * 0.31,
      borderWidth: strokeW * 0.9,
      borderColor: c,
    });
    page.drawLine({
      start: { x: cx - size * 0.18, y: cy },
      end: { x: cx + size * 0.18, y: cy },
      thickness: strokeW * 0.85,
      color: c,
    });
    return true;
  }
  if (ch === '\u03C0') {
    // Greek pi π
    const topY = baselineY + size * 0.48;
    const botY = baselineY + size * 0.04;
    page.drawLine({ start: { x: x + size * 0.06, y: topY }, end: { x: x + size * 0.54, y: topY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: x + size * 0.18, y: topY }, end: { x: x + size * 0.16, y: botY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: x + size * 0.42, y: topY }, end: { x: x + size * 0.42, y: botY }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u0394') {
    // Greek Delta Δ
    const lx = x + size * 0.07;
    const rx = x + size * 0.53;
    const botY = baselineY + size * 0.04;
    const topY = baselineY + size * 0.66;
    page.drawLine({ start: { x: lx, y: botY }, end: { x: rx, y: botY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx, y: botY }, end: { x: (lx + rx) / 2, y: topY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: (lx + rx) / 2, y: topY }, end: { x: rx, y: botY }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u221E') {
    // Infinity ∞
    page.drawCircle({
      x: x + size * 0.22,
      y: baselineY + size * 0.32,
      size: size * 0.15,
      borderWidth: strokeW * 0.9,
      borderColor: c,
    });
    page.drawCircle({
      x: x + size * 0.52,
      y: baselineY + size * 0.32,
      size: size * 0.15,
      borderWidth: strokeW * 0.9,
      borderColor: c,
    });
    return true;
  }

  if (ch === '\u2212') {
    // Minus −
    page.drawLine({
      start: { x: x + size * 0.08, y: baselineY + size * 0.32 },
      end: { x: x + size * 0.52, y: baselineY + size * 0.32 },
      thickness: strokeW,
      color: c,
    });
    return true;
  }
  if (ch === '\u2261') {
    // Identical ≡
    const lx = x + size * 0.08;
    const rx = x + size * 0.52;
    page.drawLine({ start: { x: lx, y: baselineY + size * 0.48 }, end: { x: rx, y: baselineY + size * 0.48 }, thickness: strokeW * 0.9, color: c });
    page.drawLine({ start: { x: lx, y: baselineY + size * 0.32 }, end: { x: rx, y: baselineY + size * 0.32 }, thickness: strokeW * 0.9, color: c });
    page.drawLine({ start: { x: lx, y: baselineY + size * 0.16 }, end: { x: rx, y: baselineY + size * 0.16 }, thickness: strokeW * 0.9, color: c });
    return true;
  }
  if (ch === '\u2248') {
    // Approx ≈
    const lx = x + size * 0.08;
    const rx = x + size * 0.54;
    const mx = (lx + rx) / 2;
    for (const yOff of [0.42, 0.24]) {
      const y = baselineY + size * yOff;
      page.drawLine({ start: { x: lx, y: y - size * 0.04 }, end: { x: mx, y: y + size * 0.05 }, thickness: strokeW * 0.85, color: c });
      page.drawLine({ start: { x: mx, y: y + size * 0.05 }, end: { x: rx, y: y - size * 0.04 }, thickness: strokeW * 0.85, color: c });
    }
    return true;
  }
  if (ch === '\u2234') {
    // Therefore ∴
    const rDot = Math.max(0.75, size * 0.06);
    page.drawCircle({ x: x + size * 0.31, y: baselineY + size * 0.48, size: rDot, color: c });
    page.drawCircle({ x: x + size * 0.16, y: baselineY + size * 0.16, size: rDot, color: c });
    page.drawCircle({ x: x + size * 0.46, y: baselineY + size * 0.16, size: rDot, color: c });
    return true;
  }
  if (ch === '\u21D4') {
    // Biconditional ⇔
    const lx = x + size * 0.08;
    const rx = x + size * 0.74;
    const cy = baselineY + size * 0.32;
    page.drawLine({ start: { x: lx + size * 0.1, y: cy + size * 0.08 }, end: { x: rx - size * 0.1, y: cy + size * 0.08 }, thickness: strokeW * 0.85, color: c });
    page.drawLine({ start: { x: lx + size * 0.1, y: cy - size * 0.08 }, end: { x: rx - size * 0.1, y: cy - size * 0.08 }, thickness: strokeW * 0.85, color: c });
    page.drawLine({ start: { x: lx + size * 0.18, y: cy + size * 0.18 }, end: { x: lx, y: cy }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx, y: cy }, end: { x: lx + size * 0.18, y: cy - size * 0.18 }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: rx - size * 0.18, y: cy + size * 0.18 }, end: { x: rx, y: cy }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: rx, y: cy }, end: { x: rx - size * 0.18, y: cy - size * 0.18 }, thickness: strokeW, color: c });
    return true;
  }
  if (ch === '\u2208' || ch === '\u2282' || ch === '\u2286') {
    // Element of ∈ / Subset ⊂ / Subseteq ⊆
    const lx = x + size * 0.12;
    const rx = x + size * 0.52;
    const cy = baselineY + size * 0.35;
    const topY = baselineY + size * 0.55;
    const botY = baselineY + size * 0.15;
    page.drawLine({ start: { x: rx, y: topY }, end: { x: lx + size * 0.12, y: topY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx + size * 0.12, y: topY }, end: { x: lx, y: cy }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx, y: cy }, end: { x: lx + size * 0.12, y: botY }, thickness: strokeW, color: c });
    page.drawLine({ start: { x: lx + size * 0.12, y: botY }, end: { x: rx, y: botY }, thickness: strokeW, color: c });
    if (ch === '\u2208') {
      page.drawLine({ start: { x: lx, y: cy }, end: { x: rx, y: cy }, thickness: strokeW, color: c });
    } else if (ch === '\u2286') {
      page.drawLine({ start: { x: lx, y: baselineY + size * 0.04 }, end: { x: rx, y: baselineY + size * 0.04 }, thickness: strokeW, color: c });
    }
    return true;
  }

  // Fallback for other uncommon symbols
  const safe = sanitizeWinAnsiText(ch);
  if (safe) {
    page.drawText(safe, {
      x,
      y: baselineY,
      size,
      font,
      color: c,
    });
  }
  return false;
}

/**
 * Generates a high-resolution, multi-page PDF document from structured Word blocks,
 * preserving Microsoft Word alignments (center/right/justify/left), indents, tabs with leaders,
 * superscripts/subscripts, Unicode math/logic/checkmark symbols, inline equations,
 * colors, background shading, merged table columns, and embedded graphics/sidebars.
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

  const pickFont = (bold?: boolean, italic?: boolean): PDFFont => {
    if (bold && italic) return fontBoldItalic;
    if (bold) return fontBold;
    if (italic) return fontItalic;
    return fontRegular;
  };

  // Pre-cache all embedded PNG/JPG/SVG images referenced across blocks & inline runs
  const imageCache = new Map<
    string,
    { img: PDFImage; natW: number; natH: number }
  >();
  const ensureEmbeddedImage = async (
    dataUrl: string
  ): Promise<{ img: PDFImage; natW: number; natH: number } | null> => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
    const cached = imageCache.get(dataUrl);
    if (cached) return cached;

    try {
      const isPng = dataUrl.startsWith('data:image/png');
      const isJpg =
        dataUrl.startsWith('data:image/jpeg') ||
        dataUrl.startsWith('data:image/jpg');
      if (isPng || isJpg) {
        const base64 = dataUrl.split(',')[1];
        if (!base64) return null;
        const binStr = atob(base64);
        const imgBytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          imgBytes[i] = binStr.charCodeAt(i);
        }
        const img = isPng
          ? await pdfDoc.embedPng(imgBytes)
          : await pdfDoc.embedJpg(imgBytes);
        const entry = { img, natW: img.width, natH: img.height };
        imageCache.set(dataUrl, entry);
        return entry;
      }

      // In browser, rasterize SVG/WebP/GIF images via canvas so graphics are preserved
      if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
        const pngDataUrl = await new Promise<string | null>((resolve) => {
          const imgEl = new Image();
          imgEl.onload = () => {
            try {
              const w = Math.max(16, imgEl.naturalWidth || 200);
              const h = Math.max(16, imgEl.naturalHeight || 120);
              const scale = Math.min(3, Math.max(1, 600 / Math.max(w, h)));
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(w * scale);
              canvas.height = Math.round(h * scale);
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                resolve(null);
                return;
              }
              ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/png'));
            } catch {
              resolve(null);
            }
          };
          imgEl.onerror = () => resolve(null);
          imgEl.src = dataUrl;
        });
        if (pngDataUrl && pngDataUrl.startsWith('data:image/png')) {
          const b64 = pngDataUrl.split(',')[1];
          const binStr = atob(b64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
          }
          const img = await pdfDoc.embedPng(bytes);
          const entry = { img, natW: img.width, natH: img.height };
          imageCache.set(dataUrl, entry);
          return entry;
        }
      }
    } catch {
      // Ignore corrupt image bytes
    }
    return null;
  };

  // Pre-warm canvas-rendered PNG glyphs only for non-vector Unicode characters (with ink/tofu verification)
  const unicodeGlyphCache = new Map<string, CachedGlyphEntry>();
  const ensureUnicodeGlyph = async (
    ch: string,
    bold: boolean,
    italic: boolean,
    colorHex: string,
    colorRgb: { r: number; g: number; b: number }
  ) => {
    if (typeof document === 'undefined' || VECTOR_NATIVE_GLYPHS.has(ch)) return;
    const key = `${ch}|${bold ? 'B' : ''}|${italic ? 'I' : ''}|${colorHex}`;
    if (unicodeGlyphCache.has(key)) return;

    try {
      const renderPx = 48;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(renderPx * 1.45);
      canvas.height = Math.round(renderPx * 1.35);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const fontStyle = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${renderPx}px 'Segoe UI Symbol', 'Cambria Math', 'DejaVu Sans', 'Noto Sans Math', 'Apple Symbols', sans-serif`;
      ctx.font = fontStyle;
      const metrics = ctx.measureText(ch);
      const glyphW = Math.max(renderPx * 0.32, metrics.width);
      const r255 = Math.round(colorRgb.r * 255);
      const g255 = Math.round(colorRgb.g * 255);
      const b255 = Math.round(colorRgb.b * 255);

      const baselinePx = Math.round(renderPx * 1.02);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = fontStyle;
      ctx.fillStyle = `rgb(${r255},${g255},${b255})`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('\uFFFF', 2, baselinePx);
      const tofuData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = fontStyle;
      ctx.fillStyle = `rgb(${r255},${g255},${b255})`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(ch, 2, baselinePx);

      const glyphData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let inkPixels = 0;
      let differsFromTofu = false;
      for (let i = 3; i < glyphData.length; i += 4) {
        if (glyphData[i] > 16) inkPixels++;
        if (Math.abs(glyphData[i] - tofuData[i]) > 24) differsFromTofu = true;
      }
      if (inkPixels < 6 || !differsFromTofu) return;

      const pngUrl = canvas.toDataURL('image/png');
      const b64 = pngUrl.split(',')[1];
      if (!b64) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const img = await pdfDoc.embedPng(bytes);
      unicodeGlyphCache.set(key, {
        img,
        widthRatio: glyphW / renderPx,
        heightRatio: canvas.height / renderPx,
      });
    } catch {
      // Fallback to vector glyph drawing cleanly
    }
  };

  // Preload images & Unicode glyphs across all blocks before synchronous layout
  const prewarmJobs: Promise<unknown>[] = [];
  const collectTextForGlyphPrewarm = (
    text: string,
    bold: boolean,
    italic: boolean,
    colorHex?: string
  ) => {
    const resolvedHex = colorHex || '#1A1A24';
    const cRgb = parseHexToRgb(resolvedHex, { r: 0.1, g: 0.1, b: 0.14 });
    for (const tok of tokenizeUnicodeText(text)) {
      if (tok.kind === 'unicode' && !VECTOR_NATIVE_GLYPHS.has(tok.ch)) {
        prewarmJobs.push(
          ensureUnicodeGlyph(tok.ch, bold, italic, resolvedHex, cRgb)
        );
      }
    }
  };

  for (const b of blocks) {
    if (b.sidebarImageDataUrl) {
      prewarmJobs.push(ensureEmbeddedImage(b.sidebarImageDataUrl));
    }
    if (b.imageDataUrl) {
      prewarmJobs.push(ensureEmbeddedImage(b.imageDataUrl));
    }
    if (b.runs) {
      for (const r of b.runs) {
        if (r.inlineImageDataUrl) {
          prewarmJobs.push(ensureEmbeddedImage(r.inlineImageDataUrl));
        }
        if (r.text) {
          collectTextForGlyphPrewarm(
            r.text,
            Boolean(r.bold ?? b.bold),
            Boolean(r.italic ?? b.italic),
            r.colorHex || b.colorHex
          );
        }
      }
    } else if (b.text) {
      collectTextForGlyphPrewarm(
        b.text,
        Boolean(b.bold || b.type === 'h1' || b.type === 'h2' || b.type === 'h3'),
        Boolean(b.italic),
        b.colorHex
      );
    }
    if (b.richCells) {
      for (const row of b.richCells) {
        for (const cell of row) {
          if (cell.runs && cell.runs.length > 0) {
            for (const cr of cell.runs) {
              if (cr.inlineImageDataUrl) {
                prewarmJobs.push(ensureEmbeddedImage(cr.inlineImageDataUrl));
              }
              if (cr.text) {
                collectTextForGlyphPrewarm(
                  cr.text,
                  Boolean(cr.bold ?? cell.bold),
                  Boolean(cr.italic ?? cell.italic),
                  cr.colorHex || cell.colorHex
                );
              }
            }
          } else if (cell.text) {
            collectTextForGlyphPrewarm(
              cell.text,
              Boolean(cell.bold),
              Boolean(cell.italic),
              cell.colorHex
            );
          }
        }
      }
    } else if (b.rows) {
      for (const row of b.rows) {
        for (const cellText of row) {
          if (cellText) {
            collectTextForGlyphPrewarm(cellText, false, false);
          }
        }
      }
    }
  }
  await Promise.all(prewarmJobs);

  // Width calculation & drawing helpers supporting mixed WinAnsi + vector bullets + Unicode glyphs
  const measureStringWidth = (
    text: string,
    font: PDFFont,
    size: number,
    bold: boolean,
    italic: boolean,
    colorHex?: string
  ): number => {
    const resolvedHex = colorHex || '#1A1A24';
    let total = 0;
    for (const tok of tokenizeUnicodeText(text)) {
      if (tok.kind === 'winansi') {
        total += font.widthOfTextAtSize(tok.text, size);
      } else if (tok.kind === 'bullet') {
        total += size * 0.56;
      } else if (tok.kind === 'sup' || tok.kind === 'sub') {
        total += font.widthOfTextAtSize(tok.ch, size * 0.66);
      } else {
        const key = `${tok.ch}|${bold ? 'B' : ''}|${italic ? 'I' : ''}|${resolvedHex}`;
        const cached = unicodeGlyphCache.get(key);
        total += cached
          ? cached.widthRatio * size
          : getFallbackUnicodeEmWidth(tok.ch) * size;
      }
    }
    return total;
  };

  const drawStringWithUnicode = (
    page: PDFPage,
    text: string,
    startX: number,
    baselineY: number,
    font: PDFFont,
    size: number,
    bold: boolean,
    italic: boolean,
    colorHex: string | undefined,
    colorRgb: { r: number; g: number; b: number }
  ): number => {
    const resolvedHex = colorHex || '#1A1A24';
    const pdfColor = rgb(colorRgb.r, colorRgb.g, colorRgb.b);
    let curX = startX;

    for (const tok of tokenizeUnicodeText(text)) {
      if (tok.kind === 'winansi') {
        page.drawText(tok.text, {
          x: curX,
          y: baselineY,
          size,
          font,
          color: pdfColor,
        });
        curX += font.widthOfTextAtSize(tok.text, size);
      } else if (tok.kind === 'bullet') {
        const cx = curX + size * 0.24;
        const cy = baselineY + size * 0.32;
        if (tok.ch === '\u25E6') {
          page.drawCircle({
            x: cx,
            y: cy,
            size: size * 0.14,
            borderWidth: Math.max(0.6, size * 0.07),
            borderColor: pdfColor,
          });
        } else if (tok.ch === '\u25AA') {
          const side = size * 0.28;
          page.drawRectangle({
            x: cx - side / 2,
            y: cy - side / 2,
            width: side,
            height: side,
            color: pdfColor,
          });
        } else {
          page.drawCircle({
            x: cx,
            y: cy,
            size: size * 0.145,
            color: pdfColor,
          });
        }
        curX += size * 0.56;
      } else if (tok.kind === 'sup' || tok.kind === 'sub') {
        const subSize = size * 0.66;
        const yOff = tok.kind === 'sup' ? size * 0.35 : -size * 0.16;
        page.drawText(tok.ch, {
          x: curX,
          y: baselineY + yOff,
          size: subSize,
          font,
          color: pdfColor,
        });
        curX += font.widthOfTextAtSize(tok.ch, subSize);
      } else {
        const key = `${tok.ch}|${bold ? 'B' : ''}|${italic ? 'I' : ''}|${resolvedHex}`;
        const cached = !VECTOR_NATIVE_GLYPHS.has(tok.ch)
          ? unicodeGlyphCache.get(key)
          : undefined;
        if (cached) {
          const drawH = size * cached.heightRatio;
          const drawW = drawH * (cached.img.width / Math.max(1, cached.img.height));
          // baselinePx inside canvas was renderPx * 1.02 from top => (heightRatio - 1.02) from bottom
          const bottomOffsetFromBaseline = (cached.heightRatio - 1.02) * size;
          page.drawImage(cached.img, {
            x: curX - (2 / 48) * size,
            y: baselineY - bottomOffsetFromBaseline,
            width: drawW,
            height: drawH,
          });
          curX += cached.widthRatio * size;
        } else {
          drawVectorUnicodeGlyph(
            page,
            tok.ch,
            curX,
            baselineY,
            size,
            colorRgb,
            font
          );
          curX += getFallbackUnicodeEmWidth(tok.ch) * size;
        }
      }
    }

    return curX - startX;
  };

  /**
   * Wraps rich inline Word runs into laid-out PDF lines preserving inline formatting,
   * tab stops with leaders, line breaks, and inline equation images.
   */
  const layoutRunsToLines = (
    runsInput: WordInlineRun[],
    maxWidth: number,
    fallbackFontSize: number,
    defaultBold: boolean,
    defaultItalic: boolean,
    defaultUnderline: boolean,
    defaultColorHex: string | undefined,
    defaultColorRgb: { r: number; g: number; b: number }
  ): LaidOutStyledLine[] => {
    const tokens: StyledSegmentItem[] = [];

    for (const run of runsInput) {
      const baseSize =
        run.fontSizePt && run.fontSizePt >= 6.5
          ? Math.min(32, run.fontSizePt)
          : fallbackFontSize;
      const isBold = Boolean(run.bold ?? defaultBold);
      const isItalic = Boolean(run.italic ?? defaultItalic);
      const isUnderline = Boolean(run.underline ?? defaultUnderline);
      const isStrike = Boolean(run.strike);
      const colorHex = run.colorHex || defaultColorHex;
      const colorRgb = parseHexToRgb(colorHex, defaultColorRgb);

      // 1. Inline equation image run
      if (run.inlineImageDataUrl) {
        const cachedImg = imageCache.get(run.inlineImageDataUrl);
        if (cachedImg) {
          const targetH = Math.min(
            Math.max(18, baseSize * 1.8),
            Math.max(8, run.inlineImageHeightPt || baseSize * 1.15)
          );
          const ratio =
            (run.inlineImageWidthPt || cachedImg.natW) /
            Math.max(1, run.inlineImageHeightPt || cachedImg.natH);
          const targetW = Math.min(maxWidth * 0.85, Math.max(6, targetH * ratio));
          tokens.push({
            kind: 'image',
            img: cachedImg.img,
            drawW: targetW,
            drawH: targetH,
            baseSize,
          });
          continue;
        }
      }

      // 2. Explicit tab stop or leader tab run
      if (run.tabStopXPt !== undefined || (run.tabLeader && run.tabLeader !== 'none')) {
        tokens.push({
          kind: 'tab',
          targetXPt: run.tabStopXPt,
          leader: run.tabLeader || 'none',
          baseSize,
          colorRgb,
        });
        continue;
      }

      const rawText = run.text || '';
      if (!rawText) continue;

      const font = pickFont(isBold, isItalic);
      const drawSize = run.vertAlign ? baseSize * 0.68 : baseSize;
      const yShift =
        run.vertAlign === 'superscript'
          ? baseSize * 0.35
          : run.vertAlign === 'subscript'
            ? -baseSize * 0.16
            : 0;

      const nlParts = rawText.split('\n');
      for (let pIdx = 0; pIdx < nlParts.length; pIdx++) {
        if (pIdx > 0) {
          tokens.push({ kind: 'newline', baseSize });
        }
        const segment = nlParts[pIdx];
        if (!segment) continue;

        // Split keeping trailing whitespace attached so word gaps don't collapse across runs
        const chunks = segment.match(/\S+\s*|\s+/g) || [segment];
        for (const chunk of chunks) {
          const w = measureStringWidth(
            chunk,
            font,
            drawSize,
            isBold,
            isItalic,
            colorHex
          );
          tokens.push({
            kind: 'word',
            text: chunk,
            font,
            drawSize,
            baseSize,
            yShift,
            bold: isBold,
            italic: isItalic,
            underline: isUnderline,
            strike: isStrike,
            colorHex,
            bgColorHex: run.bgColorHex,
            colorRgb,
            width: w,
          });
        }
      }
    }

    const lines: LaidOutStyledLine[] = [];
    let curItems: StyledSegmentItem[] = [];
    let curX = 0;
    let curMaxFont = fallbackFontSize;
    let curMaxHeight = fallbackFontSize;
    let curHasTab = false;

    const pushCurrentLine = () => {
      // Trim pure trailing whitespace on wrapped lines so right/center alignment stays exact
      while (curItems.length > 0) {
        const last = curItems[curItems.length - 1];
        if (last.kind === 'word' && !last.text.trim()) {
          curX -= last.width;
          curItems.pop();
        } else {
          break;
        }
      }
      lines.push({
        items: curItems,
        lineWidth: Math.max(0, curX),
        maxFontSize: curMaxFont,
        maxDrawHeight: curMaxHeight,
        hasTabStop: curHasTab,
      });
      curItems = [];
      curX = 0;
      curMaxFont = fallbackFontSize;
      curMaxHeight = fallbackFontSize;
      curHasTab = false;
    };

    for (const tok of tokens) {
      if (tok.kind === 'newline') {
        pushCurrentLine();
        continue;
      }

      if (tok.kind === 'tab') {
        const defaultLeaderSpan = Math.min(115, Math.max(36, (maxWidth - curX) * 0.42));
        const nextX =
          tok.targetXPt !== undefined
            ? Math.min(maxWidth - 4, Math.max(curX + 12, tok.targetXPt))
            : Math.min(
                maxWidth - 4,
                curX + (tok.leader !== 'none' ? defaultLeaderSpan : 22)
              );

        if (nextX <= curX + 4 && curX > maxWidth * 0.72) {
          pushCurrentLine();
          const freshX = tok.targetXPt !== undefined ? Math.min(maxWidth - 4, tok.targetXPt) : 0;
          curItems.push(tok);
          curX = freshX;
        } else {
          curItems.push(tok);
          curX = nextX;
        }
        curHasTab = true;
        curMaxFont = Math.max(curMaxFont, tok.baseSize);
        curMaxHeight = Math.max(curMaxHeight, tok.baseSize);
        continue;
      }

      if (tok.kind === 'image') {
        if (curItems.length > 0 && curX + tok.drawW > maxWidth + 2) {
          pushCurrentLine();
        }
        curItems.push(tok);
        curX += tok.drawW + 2;
        curMaxFont = Math.max(curMaxFont, tok.baseSize);
        curMaxHeight = Math.max(curMaxHeight, tok.drawH + 2);
        continue;
      }

      // Word token
      const isPureSpace = !tok.text.trim();
      if (curItems.length === 0 && isPureSpace) {
        // Keep indent spaces only if explicit small tab spaces aren't at start of wrapped line
        continue;
      }

      const trimmedText = tok.text.trimEnd();
      const trimmedW =
        trimmedText.length === tok.text.length
          ? tok.width
          : measureStringWidth(
              trimmedText,
              tok.font,
              tok.drawSize,
              tok.bold,
              tok.italic,
              tok.colorHex
            );

      if (curItems.length > 0 && curX + trimmedW > maxWidth + 1.5 && !isPureSpace) {
        pushCurrentLine();
      }

      curItems.push(tok);
      curX += tok.width;
      curMaxFont = Math.max(curMaxFont, tok.baseSize);
      curMaxHeight = Math.max(curMaxHeight, tok.baseSize);
    }

    if (curItems.length > 0 || lines.length === 0) {
      pushCurrentLine();
    }

    return lines;
  };

  /**
   * Draws a pre-wrapped LaidOutStyledLine horizontally from `drawStartX` with `baselineY`.
   */
  const drawStyledLine = (
    page: PDFPage,
    line: LaidOutStyledLine,
    drawStartX: number,
    baselineY: number,
    availLineWidth: number
  ) => {
    let curX = drawStartX;
    const lineLeftRef = drawStartX;

    for (const item of line.items) {
      if (item.kind === 'newline') continue;

      if (item.kind === 'tab') {
        const curRelX = curX - lineLeftRef;
        const defaultLeaderSpan = Math.min(
          115,
          Math.max(36, (availLineWidth - curRelX) * 0.42)
        );
        const targetRelX =
          item.targetXPt !== undefined
            ? Math.min(availLineWidth - 4, Math.max(curRelX + 12, item.targetXPt))
            : Math.min(
                availLineWidth - 4,
                curRelX + (item.leader !== 'none' ? defaultLeaderSpan : 22)
              );
        const targetAbsX = lineLeftRef + targetRelX;

        if (item.leader === 'underscore' && targetAbsX > curX + 4) {
          page.drawLine({
            start: { x: curX + 2, y: baselineY - 1.2 },
            end: { x: targetAbsX - 4, y: baselineY - 1.2 },
            thickness: 0.65,
            color: rgb(item.colorRgb.r, item.colorRgb.g, item.colorRgb.b),
          });
        } else if (item.leader === 'dot' && targetAbsX > curX + 6) {
          const leaderColor = rgb(
            item.colorRgb.r,
            item.colorRgb.g,
            item.colorRgb.b
          );
          for (let dx = curX + 3; dx < targetAbsX - 4; dx += 4.5) {
            page.drawCircle({
              x: dx,
              y: baselineY + 0.4,
              size: 0.65,
              color: leaderColor,
            });
          }
        }
        curX = Math.max(curX + 6, targetAbsX);
        continue;
      }

      if (item.kind === 'image') {
        const imgY = baselineY + (item.baseSize * 0.32 - item.drawH / 2);
        page.drawImage(item.img, {
          x: curX,
          y: imgY,
          width: item.drawW,
          height: item.drawH,
        });
        curX += item.drawW + 2;
        continue;
      }

      if (item.bgColorHex) {
        const bg = parseHexToRgb(item.bgColorHex, { r: 0.98, g: 0.95, b: 0.72 });
        page.drawRectangle({
          x: curX - 0.5,
          y: baselineY - 2,
          width: item.width + 1,
          height: item.drawSize * 1.15,
          color: rgb(bg.r, bg.g, bg.b),
        });
      }

      const drawnW = drawStringWithUnicode(
        page,
        item.text,
        curX,
        baselineY + item.yShift,
        item.font,
        item.drawSize,
        item.bold,
        item.italic,
        item.colorHex,
        item.colorRgb
      );

      if (item.underline && item.text.length > 0 && item.text !== '\n') {
        page.drawLine({
          start: { x: curX, y: baselineY - 1.4 },
          end: { x: curX + drawnW, y: baselineY - 1.4 },
          thickness: 0.65,
          color: rgb(item.colorRgb.r, item.colorRgb.g, item.colorRgb.b),
        });
      }
      if (item.strike && item.text.trim()) {
        page.drawLine({
          start: { x: curX, y: baselineY + item.drawSize * 0.3 },
          end: { x: curX + drawnW, y: baselineY + item.drawSize * 0.3 },
          thickness: 0.65,
          color: rgb(item.colorRgb.r, item.colorRgb.g, item.colorRgb.b),
        });
      }

      curX += drawnW;
    }
  };

  const pageDimensions: [number, number] =
    options.pageSize === 'Letter'
      ? [612, 792]
      : options.pageSize === 'Legal'
        ? [612, 1008]
        : [595.28, 841.89]; // A4

  const [pageW, pageH] = pageDimensions;
  const firstBlock = blocks[0];
  const sidebarEntry = firstBlock?.sidebarImageDataUrl
    ? imageCache.get(firstBlock.sidebarImageDataUrl)
    : undefined;

  const marginLeft =
    firstBlock?.docMarginLeftPt !== undefined
      ? Math.max(28, Math.min(72, firstBlock.docMarginLeftPt))
      : sidebarEntry
        ? 46
        : 48;
  const marginRight =
    firstBlock?.docMarginRightPt !== undefined
      ? Math.max(24, Math.min(72, firstBlock.docMarginRightPt))
      : 42;
  const marginTop =
    firstBlock?.docMarginTopPt !== undefined
      ? Math.max(24, Math.min(46, firstBlock.docMarginTopPt))
      : 46;
  const marginBottom =
    firstBlock?.docMarginBottomPt !== undefined
      ? Math.max(26, Math.min(44, firstBlock.docMarginBottomPt))
      : 44;

  const contentWidth = pageW - marginLeft - marginRight;

  let currentPage = pdfDoc.addPage([pageW, pageH]);
  let cursorY = pageH - marginTop;

  // Draw optional decorative left-margin sidebar border strip cleanly on Page 1
  if (sidebarEntry) {
    const { img, natW, natH } = sidebarEntry;
    const stripW = 24;
    const availStripH = pageH - 20;
    const singleH = (availStripH * natW) / Math.max(1, natW) > 0
      ? (stripW * natH) / Math.max(1, natW)
      : availStripH;

    if (natH / Math.max(1, natW) >= 6) {
      // Single tall graphic covering full page height
      const scaledW = Math.min(30, Math.max(18, (natW * availStripH) / Math.max(1, natH)));
      currentPage.drawImage(img, {
        x: 8,
        y: 10,
        width: scaledW,
        height: availStripH,
      });
    } else {
      // Tile vertically downwards inside left margin
      const tileH = Math.max(24, Math.min(availStripH, singleH));
      let tileTopY = pageH - 10;
      let guard = 0;
      while (tileTopY > 12 && guard < 40) {
        const drawH = Math.min(tileH, tileTopY - 10);
        currentPage.drawImage(img, {
          x: 8,
          y: tileTopY - drawH,
          width: stripW,
          height: drawH,
        });
        tileTopY -= drawH;
        guard++;
      }
    }
  }

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
      const embedded =
        imageCache.get(block.imageDataUrl) ||
        (await ensureEmbeddedImage(block.imageDataUrl));
      if (embedded) {
        const targetW = block.imageWidthPt || embedded.natW;
        const targetH = block.imageHeightPt || embedded.natH;
        const maxImgW = contentWidth * 0.92;
        const isCompactLogo =
          firstBlock?.docMarginLeftPt !== undefined && targetH <= 180;
        const maxImgH =
          (pageH - marginTop - marginBottom) * (isCompactLogo ? 0.16 : 0.42);
        const scale = Math.min(
          1,
          maxImgW / Math.max(1, targetW),
          maxImgH / Math.max(1, targetH)
        );
        const drawW = targetW * scale;
        const drawH = targetH * scale;

        ensureVerticalSpace(drawH + 6);
        let imgX = marginLeft;
        if (block.align === 'center') {
          imgX = marginLeft + (contentWidth - drawW) / 2;
        } else if (block.align === 'right') {
          imgX = marginLeft + contentWidth - drawW;
        }

        currentPage.drawImage(embedded.img, {
          x: imgX,
          y: cursorY - drawH,
          width: drawW,
          height: drawH,
        });
        cursorY -= drawH + 5;
      }
      continue;
    }

    if (block.type === 'table' && block.rows && block.rows.length > 0) {
      const colCount = Math.max(...block.rows.map((r) => r.length), 1);
      const rawColWidths: number[] =
        block.colWidthRatios && block.colWidthRatios.length === colCount
          ? block.colWidthRatios.map((r) => Math.max(20, r * contentWidth))
          : Array.from({ length: colCount }, () => contentWidth / colCount);
      const rawTotalW = rawColWidths.reduce((s, w) => s + w, 0) || contentWidth;
      const colWidths: number[] = rawColWidths.map(
        (w) => (w / rawTotalW) * contentWidth
      );

      const isDenseTable = block.rows.length >= 8;
      const cellFontSize = isDenseTable
        ? 8.2
        : Math.max(8.5, Math.min(10, options.baseFontSize - 1.5));
      const cellPadX = isDenseTable ? 4 : 5;
      const cellPadY = isDenseTable ? 1.8 : 3.6;
      const lineSpacingMult = isDenseTable ? 1.12 : 1.2;

      for (let rIdx = 0; rIdx < block.rows.length; rIdx++) {
        const row = block.rows[rIdx];
        const richRow = block.richCells?.[rIdx];
        const isHeader = rIdx === 0;
        const hasRichMeta = Boolean(richRow && richRow.length > 0);

        interface PreparedCellDraw {
          colStartX: number;
          colWidth: number;
          cellMeta?: WordRichTableCell;
          lines: LaidOutStyledLine[];
          cellAlign: 'left' | 'center' | 'right' | 'justify';
        }

        const preparedCells: PreparedCellDraw[] = [];
        let curCellX = marginLeft;
        let gridColPtr = 0;

        if (hasRichMeta && richRow) {
          for (let tcIdx = 0; tcIdx < richRow.length; tcIdx++) {
            const cellMeta = richRow[tcIdx];
            const span = Math.max(
              1,
              Math.min(colCount - gridColPtr, cellMeta.colSpan || 1)
            );
            let spanWidth = 0;
            for (
              let s = 0;
              s < span && gridColPtr + s < colWidths.length;
              s++
            ) {
              spanWidth += colWidths[gridColPtr + s];
            }
            if (spanWidth <= 0) {
              spanWidth = Math.max(24, contentWidth / Math.max(1, richRow.length));
            }
            gridColPtr += span;

            const defBold = cellMeta.bold ?? (!block.hasExplicitRowShading && isHeader);
            const defItalic = Boolean(cellMeta.italic);
            const defColorRgb = parseHexToRgb(cellMeta.colorHex, {
              r: 0.08,
              g: 0.09,
              b: 0.13,
            });
            const cellRuns =
              cellMeta.runs && cellMeta.runs.length > 0
                ? cellMeta.runs
                : [
                    {
                      text: cellMeta.text || '',
                      bold: defBold,
                      italic: defItalic,
                      colorHex: cellMeta.colorHex,
                      fontSizePt: cellFontSize,
                    },
                  ];

            const innerW = Math.max(14, spanWidth - cellPadX * 2);
            const lines = layoutRunsToLines(
              cellRuns.map((cr) => ({
                ...cr,
                fontSizePt: cr.fontSizePt ? Math.min(cr.fontSizePt, cellFontSize + 0.5) : cellFontSize,
              })),
              innerW,
              cellFontSize,
              defBold,
              defItalic,
              false,
              cellMeta.colorHex,
              defColorRgb
            );

            preparedCells.push({
              colStartX: curCellX,
              colWidth: spanWidth,
              cellMeta,
              lines,
              cellAlign: cellMeta.align || 'left',
            });
            curCellX += spanWidth;
          }
        } else {
          for (let cIdx = 0; cIdx < colCount; cIdx++) {
            const cWidth = colWidths[cIdx];
            const defColorRgb = { r: 0.08, g: 0.09, b: 0.13 };
            const innerW = Math.max(14, cWidth - cellPadX * 2);
            const lines = layoutRunsToLines(
              [
                {
                  text: row[cIdx] || '',
                  bold: isHeader,
                  fontSizePt: cellFontSize,
                },
              ],
              innerW,
              cellFontSize,
              isHeader,
              false,
              false,
              undefined,
              defColorRgb
            );
            preparedCells.push({
              colStartX: curCellX,
              colWidth: cWidth,
              lines,
              cellAlign: 'left',
            });
            curCellX += cWidth;
          }
        }

        const lineHeight = cellFontSize * lineSpacingMult;
        const maxLines = Math.max(...preparedCells.map((c) => c.lines.length), 1);
        const rowHeight = maxLines * lineHeight + cellPadY * 2;

        ensureVerticalSpace(rowHeight + 3);

        for (const pCell of preparedCells) {
          const cellY = cursorY - rowHeight;
          const cellMeta = pCell.cellMeta;
          // Respect explicit DOCX cell shading; only apply fallback light header fill when no richCells metadata exists
          const cellBg = cellMeta?.bgColorHex
            ? parseHexToRgb(cellMeta.bgColorHex, { r: 0.96, g: 0.97, b: 0.98 })
            : !block.richCells && isHeader
              ? { r: 0.95, g: 0.96, b: 0.98 }
              : undefined;

          if (cellBg) {
            currentPage.drawRectangle({
              x: pCell.colStartX,
              y: cellY,
              width: pCell.colWidth,
              height: rowHeight,
              color: rgb(cellBg.r, cellBg.g, cellBg.b),
            });
          }

          const hideAll = cellMeta?.hideAllBorders ?? block.hideTableBorders;
          const bottomOnly = cellMeta?.bottomBorderOnly;
          const borderRgb = rgb(0.45, 0.49, 0.56);

          if (bottomOnly) {
            currentPage.drawLine({
              start: { x: pCell.colStartX, y: cellY },
              end: { x: pCell.colStartX + pCell.colWidth, y: cellY },
              thickness: 0.7,
              color: rgb(0.2, 0.24, 0.3),
            });
          } else if (!hideAll) {
            // Draw top, bottom, left, right selectively based on DOCX tblBorders + tcBorders + vMerge
            if (!cellMeta?.hideTopBorder && !cellMeta?.vMergeContinue) {
              currentPage.drawLine({
                start: { x: pCell.colStartX, y: cellY + rowHeight },
                end: { x: pCell.colStartX + pCell.colWidth, y: cellY + rowHeight },
                thickness: 0.55,
                color: borderRgb,
              });
            }
            if (!cellMeta?.hideBottomBorder) {
              currentPage.drawLine({
                start: { x: pCell.colStartX, y: cellY },
                end: { x: pCell.colStartX + pCell.colWidth, y: cellY },
                thickness: 0.55,
                color: borderRgb,
              });
            }
            if (!cellMeta?.hideLeftBorder) {
              currentPage.drawLine({
                start: { x: pCell.colStartX, y: cellY },
                end: { x: pCell.colStartX, y: cellY + rowHeight },
                thickness: 0.55,
                color: borderRgb,
              });
            }
            if (!cellMeta?.hideRightBorder) {
              currentPage.drawLine({
                start: { x: pCell.colStartX + pCell.colWidth, y: cellY },
                end: { x: pCell.colStartX + pCell.colWidth, y: cellY + rowHeight },
                thickness: 0.55,
                color: borderRgb,
              });
            }
          }

          const innerW = Math.max(14, pCell.colWidth - cellPadX * 2);
          pCell.lines.forEach((line, lIdx) => {
            if (line.items.length === 0) return;
            let tx = pCell.colStartX + cellPadX;
            if (!line.hasTabStop) {
              if (pCell.cellAlign === 'center') {
                tx = pCell.colStartX + Math.max(cellPadX, (pCell.colWidth - line.lineWidth) / 2);
              } else if (pCell.cellAlign === 'right') {
                tx =
                  pCell.colStartX +
                  Math.max(cellPadX, pCell.colWidth - cellPadX - line.lineWidth);
              }
            }
            const baselineY =
              cursorY -
              cellPadY -
              cellFontSize * 0.85 -
              lIdx * lineHeight;
            drawStyledLine(currentPage, line, tx, baselineY, innerW);
          });
        }

        cursorY -= rowHeight;
      }
      cursorY -= isDenseTable ? 6 : 9;
      continue;
    }

    const rawText = block.text || '';
    const hasRunContent =
      Boolean(block.runs && block.runs.some((r) => r.text || r.inlineImageDataUrl));
    if (!rawText.trim() && !hasRunContent) continue;

    if (block.spaceBeforePt && block.spaceBeforePt > 0) {
      cursorY -= Math.min(20, block.spaceBeforePt);
    } else if (
      block.type === 'h1' ||
      block.type === 'h2' ||
      block.type === 'h3'
    ) {
      cursorY -= 5;
    }

    const defaultSize =
      firstBlock?.docMarginLeftPt !== undefined
        ? Math.min(10.5, options.baseFontSize)
        : options.baseFontSize;

    const fontSize =
      block.fontSizePt && block.fontSizePt >= 7
        ? Math.min(32, block.fontSizePt)
        : block.type === 'h1'
          ? defaultSize + 6
          : block.type === 'h2'
            ? defaultSize + 3
            : block.type === 'h3'
              ? defaultSize + 1.5
              : defaultSize;

    const defaultBold = Boolean(
      block.type === 'h1' ||
        block.type === 'h2' ||
        block.type === 'h3' ||
        block.bold
    );
    const defaultItalic = Boolean(block.italic);
    const defaultUnderline = Boolean(block.underline);

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

    const defaultColor =
      block.type === 'h1' || block.type === 'h2'
        ? { r: 0.08, g: 0.1, b: 0.18 }
        : { r: 0.1, g: 0.1, b: 0.14 };
    const fg = parseHexToRgb(block.colorHex, defaultColor);

    const effectiveRuns: WordInlineRun[] =
      block.runs && block.runs.length > 0
        ? block.runs
        : [
            {
              text: rawText,
              bold: defaultBold,
              italic: defaultItalic,
              underline: defaultUnderline,
              colorHex: block.colorHex,
              fontSizePt: fontSize,
            },
          ];

    const firstLineShift =
      block.firstLineIndentPt !== undefined
        ? Math.max(-indentLeft, Math.min(48, block.firstLineIndentPt))
        : 0;

    const effectiveLineSpacing =
      firstBlock?.docMarginLeftPt !== undefined
        ? Math.min(options.lineSpacing, 1.18)
        : options.lineSpacing;

    const lines = layoutRunsToLines(
      effectiveRuns,
      availWidth,
      fontSize,
      defaultBold,
      defaultItalic,
      defaultUnderline,
      block.colorHex,
      fg
    );

    if (block.bgColorHex && lines.length > 0) {
      const bg = parseHexToRgb(block.bgColorHex, {
        r: 0.96,
        g: 0.96,
        b: 0.98,
      });
      const bannerLineH = Math.max(
        lines[0].maxDrawHeight * effectiveLineSpacing,
        lines[0].maxFontSize * effectiveLineSpacing
      );
      const totalBannerH = bannerLineH * lines.length + 4;
      ensureVerticalSpace(totalBannerH);
      currentPage.drawRectangle({
        x: marginLeft + indentLeft - 3,
        y: cursorY - totalBannerH + 1,
        width: availWidth + 6,
        height: totalBannerH,
        color: rgb(bg.r, bg.g, bg.b),
      });
      cursorY -= 2;
    }

    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx];
      const stepHeight = Math.max(
        line.maxFontSize * effectiveLineSpacing,
        line.maxDrawHeight + 3
      );
      ensureVerticalSpace(stepHeight);

      if (line.items.length > 0) {
        const lineShift = lIdx === 0 ? firstLineShift : 0;
        let drawX = marginLeft + indentLeft + lineShift;
        if (!line.hasTabStop) {
          if (block.align === 'center') {
            drawX =
              marginLeft +
              indentLeft +
              Math.max(0, (availWidth - line.lineWidth) / 2);
          } else if (block.align === 'right') {
            drawX =
              marginLeft +
              indentLeft +
              Math.max(0, availWidth - line.lineWidth);
          }
        }

        const baselineY =
          cursorY -
          Math.max(line.maxFontSize * 0.85, line.maxDrawHeight * 0.72);
        drawStyledLine(currentPage, line, drawX, baselineY, availWidth);
      }

      cursorY -= stepHeight;
    }

    if (block.bgColorHex && lines.length > 0) {
      cursorY -= 2;
    }

    if (block.bottomBorderColor) {
      const bdr = parseHexToRgb(block.bottomBorderColor, {
        r: 0.75,
        g: 0.78,
        b: 0.84,
      });
      currentPage.drawLine({
        start: { x: marginLeft + indentLeft, y: cursorY + 2 },
        end: { x: marginLeft + indentLeft + availWidth, y: cursorY + 2 },
        thickness: 0.9,
        color: rgb(bdr.r, bdr.g, bdr.b),
      });
      cursorY -= 4;
    }

    const afterSpace =
      block.spaceAfterPt !== undefined
        ? Math.min(10, Math.max(0, block.spaceAfterPt))
        : block.type === 'li'
          ? 1.6
          : fontSize * 0.26;
    cursorY -= afterSpace;
  }

  const pages = pdfDoc.getPages();
  if (options.addPageNumbers) {
    pages.forEach((p, idx) => {
      const label = `Page ${idx + 1} of ${pages.length}`;
      const lw = fontRegular.widthOfTextAtSize(label, 9);
      p.drawText(label, {
        x: (pageW - lw) / 2,
        y: 18,
        size: 9,
        font: fontRegular,
        color: rgb(0.42, 0.39, 0.48),
      });
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return { pdfBytes, pageCount: pages.length };
}


