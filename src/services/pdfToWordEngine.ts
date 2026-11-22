import * as pdfjsLib from 'pdfjs-dist';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  Math as DocxMath,
  MathComponent,
  MathCurlyBrackets,
  MathFraction,
  MathIntegral,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type FileChild,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import { MathMatrix } from 'docx/math';

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function (fn: (...args: unknown[]) => unknown, ...args: unknown[]) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}
if (typeof (Uint8Array.prototype as unknown as { toHex?: unknown }).toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function (this: Uint8Array): string {
      let hex = '';
      for (let i = 0; i < this.length; i++) hex += this[i].toString(16).padStart(2, '0');
      return hex;
    },
    configurable: true,
    writable: true,
  });
}
if (typeof (Map.prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    configurable: true,
    writable: true,
  });
}

export type PdfToWordMode = 'editable' | 'hybrid' | 'visual';

export interface PdfWordSpan {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  fontSizePt: number;
  fontFamily: string;
  originalFontName: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  strike?: boolean;
  colorHex: string;
  highlightHex?: string;
  script?: 'normal' | 'sup' | 'sub';
}

export interface PdfWordTableCell {
  text: string;
  spans?: PdfWordSpan[];
  align: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'center' | 'bottom';
  bold?: boolean;
  italic?: boolean;
  colorHex?: string;
  bgColorHex?: string;
  borderColorHex?: string;
  colSpan?: number;
  rowSpan?: number;
}

export interface PdfWordTable {
  rows: PdfWordTableCell[][];
  colWidthPcts: number[];
  rowHeightsPt?: number[];
  borderColorHex: string;
  hasExplicitGridRules: boolean;
  yTopPt: number;
  yBottomPt: number;
  continuesFromPrevPage?: boolean;
}

export interface PdfWordDiagramRegion {
  id: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  kind: 'diagram' | 'photo' | 'chart' | 'formula-fallback';
  caption?: string;
  imageDataUrl?: string;
}

export interface PdfWordEquationEntry {
  rawText: string;
  ommlSupported: boolean;
  hasFallbackImage: boolean;
  fallbackImageDataUrl?: string;
  yPt: number;
}

export interface PdfWordBlock {
  kind:
    | 'heading'
    | 'paragraph'
    | 'list-item'
    | 'equation'
    | 'header'
    | 'footer';
  headingLevel?: 1 | 2 | 3;
  listMarker?: string;
  isOrderedList?: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  indentLeftPt: number;
  spaceAfterPt?: number;
  bgColorHex?: string;
  bottomBorderHex?: string;
  yTopPt: number;
  yBottomPt: number;
  spans: PdfWordSpan[];
  text: string;
  columnIndex?: 0 | 1; // 0 = left col, 1 = right col when inside multi-column band
  equationInfo?: PdfWordEquationEntry;
}

export interface PdfWordFontSubstitution {
  pdfFontName: string;
  wordFontFamily: string;
  bold: boolean;
  italic: boolean;
  pageNumbers: number[];
}

export interface WordPageQualityMetric {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  orientation: 'portrait' | 'landscape';
  wordCount: number;
  tableCount: number;
  borderedTableCount: number;
  borderlessTableCount: number;
  ommlEquationCount: number;
  visualFallbackEquationCount: number;
  diagramCount: number;
  embeddedImageCount: number;
  colorCount: number;
  multiColumnDetected: boolean;
  isScannedPage: boolean;
  ocrApplied: boolean;
  fidelityScore: number;
  warnings: string[];
}

export interface WordConversionQualityReport {
  mode: PdfToWordMode;
  totalSourcePages: number;
  totalWordSections: number;
  pageCountMatched: boolean;
  totalWordsExtracted: number;
  totalTablesReconstructed: number;
  borderedTables: number;
  borderlessTables: number;
  multiPageTablesMerged: number;
  totalOmmlEquations: number;
  totalFallbackEquationImages: number;
  totalDiagramsPreserved: number;
  totalColorsPreserved: number;
  uniqueColorsHex: string[];
  multiColumnPages: number;
  scannedPagesDetected: number;
  ocrPagesProcessed: number;
  overallFidelityScore: number;
  fontSubstitutions: PdfWordFontSubstitution[];
  pages: WordPageQualityMetric[];
  warnings: string[];
  generatedAt: string;
}

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
  // Extended rich Word-conversion metadata
  widthPt?: number;
  heightPt?: number;
  orientation?: 'portrait' | 'landscape';
  marginTopPt?: number;
  marginBottomPt?: number;
  marginLeftPt?: number;
  marginRightPt?: number;
  pageBackgroundColorHex?: string;
  multiColumnDetected?: boolean;
  gutterXPt?: number;
  isScannedPage?: boolean;
  ocrApplied?: boolean;
  embeddedImageCount?: number;
  vectorGraphicCount?: number;
  uniqueColorsHex?: string[];
  headerTexts?: string[];
  footerTexts?: string[];
  styledBlocks?: PdfWordBlock[];
  richTables?: PdfWordTable[];
  diagramRegions?: PdfWordDiagramRegion[];
  equations?: PdfWordEquationEntry[];
  fontSubstitutions?: PdfWordFontSubstitution[];
}

export interface PdfToWordExtractionOptions {
  shouldCancel?: () => boolean;
  onProgress?: (current: number, total: number, stage?: string) => void;
  captureSnapshots?: boolean;
}

// ---------- COLOR & FONT HELPERS ----------

function componentToHex(val: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(val)));
  return clamped.toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`.toLowerCase();
}

function toDocxHex(hex?: string, fallback = '1F1B24'): string {
  if (!hex) return fallback;
  const clean = hex.replace('#', '').trim().toUpperCase();
  if (/^[0-9A-F]{6}$/.test(clean)) return clean;
  if (/^[0-9A-F]{3}$/.test(clean)) {
    return `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
  }
  return fallback;
}

function normalizePdfColorArgs(args: unknown): string | null {
  if (!args) return null;
  if (typeof args === 'string' && args.startsWith('#')) {
    return args.slice(0, 7).toLowerCase();
  }
  const arr = Array.isArray(args) ? args : [];
  if (arr.length === 1 && typeof arr[0] === 'string' && arr[0].startsWith('#')) {
    return arr[0].slice(0, 7).toLowerCase();
  }
  const nums = arr.filter((v): v is number => typeof v === 'number');
  if (nums.length === 1) {
    const g = nums[0] <= 1 ? nums[0] * 255 : nums[0];
    return rgbToHex(g, g, g);
  }
  if (nums.length >= 3 && nums.length < 4) {
    const scale = nums[0] <= 1 && nums[1] <= 1 && nums[2] <= 1 ? 255 : 1;
    return rgbToHex(nums[0] * scale, nums[1] * scale, nums[2] * scale);
  }
  if (nums.length >= 4) {
    const [c0, m0, y0, k0] = nums;
    const div = c0 > 1 || m0 > 1 || y0 > 1 || k0 > 1 ? 255 : 1;
    const c = c0 / div;
    const m = m0 / div;
    const y = y0 / div;
    const k = k0 / div;
    return rgbToHex(
      255 * (1 - c) * (1 - k),
      255 * (1 - m) * (1 - k),
      255 * (1 - y) * (1 - k)
    );
  }
  return null;
}

function applyAffinePoint(
  m: number[],
  x: number,
  y: number
): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
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

function mapPdfFontToWordFont(
  pdfFontName: string,
  fallbackCssFamily: string,
  metaBold: boolean,
  metaItalic: boolean
): {
  wordFontFamily: string;
  bold: boolean;
  italic: boolean;
} {
  const lower = `${pdfFontName} ${fallbackCssFamily}`.toLowerCase();
  const bold =
    metaBold ||
    /bold|black|heavy|semibold|demi|medi|-bd\b|\b(?:700|800|900)\b/.test(lower);
  const italic =
    metaItalic || /italic|oblique|slant|-it\b|-obl\b/.test(lower);

  if (/cambria\s*math|cmr|cmsy|cmmi|cmex|stix|asana|latin\s*modern\s*math/.test(lower)) {
    return { wordFontFamily: 'Cambria Math', bold, italic };
  }
  if (/courier|consolas|mono|menlo|monaco|code|typewriter|nimbus\s*mono|dejavu\s*sans\s*mono/.test(lower)) {
    return { wordFontFamily: 'Consolas', bold, italic };
  }
  if (/times|georgia|garamond|palatino|cambria|serif|nimbus\s*roman|century/.test(lower)) {
    return {
      wordFontFamily: /georgia/.test(lower)
        ? 'Georgia'
        : /cambria/.test(lower)
          ? 'Cambria'
          : 'Times New Roman',
      bold,
      italic,
    };
  }
  if (/calibri/.test(lower)) {
    return { wordFontFamily: 'Calibri', bold, italic };
  }
  if (/arial|helvetica|nimbus\s*sans/.test(lower)) {
    return { wordFontFamily: 'Arial', bold, italic };
  }
  return { wordFontFamily: 'Calibri', bold, italic };
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

// ---------- GRAPHICS & DIAGRAM BOUNDING-BOX EXTRACTION ----------

interface PdfRawGraphics {
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
  vectorBoxes: Array<{
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
    kind: 'diagram' | 'chart';
  }>;
  imageBoxes: Array<{
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
  }>;
  embeddedImageCount: number;
  vectorGraphicCount: number;
  uniqueColorsHex: string[];
}

async function extractPdfPageGraphics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  viewportTransform: number[],
  widthPt: number,
  heightPt: number
): Promise<PdfRawGraphics> {
  const filledRects: PdfRawGraphics['filledRects'] = [];
  const horizontalRules: PdfRawGraphics['horizontalRules'] = [];
  const verticalRules: PdfRawGraphics['verticalRules'] = [];
  const strokedRects: PdfRawGraphics['strokedRects'] = [];
  const textDrawEvents: PdfRawGraphics['textDrawEvents'] = [];
  const vectorBoxes: PdfRawGraphics['vectorBoxes'] = [];
  const imageBoxes: PdfRawGraphics['imageBoxes'] = [];
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
    let pendingPts: Array<[number, number]> = [];
    let pendingHasCurve = false;
    let pendingRects: Array<[number, number, number, number]> = [];

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
          let hasDiagonal = false;
          let segmentCount = 0;
          let lastX: number | null = null;
          let lastY: number | null = null;

          if (pathData && typeof pathData.length === 'number') {
            let pIdx = 0;
            while (pIdx < pathData.length) {
              const segOp = pathData[pIdx++];
              if (segOp === 0) {
                lastX = Number(pathData[pIdx++]);
                lastY = Number(pathData[pIdx++]);
                segmentCount++;
              } else if (segOp === 1) {
                const nx = Number(pathData[pIdx++]);
                const ny = Number(pathData[pIdx++]);
                if (lastX !== null && lastY !== null) {
                  if (Math.abs(nx - lastX) > 2 && Math.abs(ny - lastY) > 2) {
                    hasDiagonal = true;
                  }
                }
                lastX = nx;
                lastY = ny;
                segmentCount++;
              } else if (segOp === 2) {
                hasCurve = true;
                lastX = Number(pathData[pIdx + 4]);
                lastY = Number(pathData[pIdx + 5]);
                pIdx += 6;
                segmentCount++;
              } else if (segOp === 3) {
                hasCurve = true;
                lastX = Number(pathData[pIdx + 2]);
                lastY = Number(pathData[pIdx + 3]);
                pIdx += 4;
                segmentCount++;
              } else if (segOp === 4) {
                // closePath
              } else {
                break;
              }
            }
          }

          if (bbox && typeof bbox[0] === 'number') {
            const [p1x, p1y] = applyAffinePoint(st.ctm, Number(bbox[0]), Number(bbox[1]));
            const [p2x, p2y] = applyAffinePoint(st.ctm, Number(bbox[2]), Number(bbox[3]));
            const rx = Math.min(p1x, p2x);
            const ry = Math.min(p1y, p2y);
            const rw = Math.abs(p2x - p1x);
            const rh = Math.abs(p2y - p1y);

            if (hasCurve || hasDiagonal || segmentCount > 5) {
              vectorGraphicCount++;
              if (rw >= 18 && rh >= 16 && !(rw >= widthPt * 0.88 && rh >= heightPt * 0.88)) {
                vectorBoxes.push({
                  xPt: rx,
                  yPt: ry,
                  widthPt: rw,
                  heightPt: rh,
                  kind: hasCurve ? 'diagram' : 'chart',
                });
              }
            } else {
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
        }
      } else if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
        pendingRects.push([
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3]),
        ]);
      } else if ((fn === OPS.moveTo || fn === OPS.lineTo) && Array.isArray(args) && args.length >= 2) {
        pendingPts.push([Number(args[0]), Number(args[1])]);
      } else if (fn === OPS.curveTo || fn === OPS.curveTo2 || fn === OPS.curveTo3) {
        pendingHasCurve = true;
        if (Array.isArray(args) && args.length >= 2) {
          for (let k = 0; k + 1 < args.length; k += 2) {
            pendingPts.push([Number(args[k]), Number(args[k + 1])]);
          }
        }
        vectorGraphicCount++;
      } else if (isFillOp(fn) || isStrokeOp(fn)) {
        const doFill = isFillOp(fn);
        const doStroke = isStrokeOp(fn);
        for (const [x, y, w, h] of pendingRects) {
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
        if (pendingPts.length >= 2) {
          const transformed = pendingPts.map(([px, py]) => applyAffinePoint(st.ctm, px, py));
          const xs = transformed.map((p) => p[0]);
          const ys = transformed.map((p) => p[1]);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const rw = maxX - minX;
          const rh = maxY - minY;
          if (pendingHasCurve || (rw >= 16 && rh >= 14)) {
            vectorGraphicCount++;
            if (!(rw >= widthPt * 0.88 && rh >= heightPt * 0.88)) {
              vectorBoxes.push({
                xPt: minX,
                yPt: minY,
                widthPt: rw,
                heightPt: rh,
                kind: pendingHasCurve ? 'diagram' : 'chart',
              });
            }
          } else {
            recordPaintRect(
              minX,
              minY,
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
        pendingPts = [];
        pendingRects = [];
        pendingHasCurve = false;
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
          // PDF images occupy unit square (0,0)-(1,1) transformed by CTM
          const [p1x, p1y] = applyAffinePoint(st.ctm, 0, 0);
          const [p2x, p2y] = applyAffinePoint(st.ctm, 1, 1);
          const ix = Math.max(0, Math.min(p1x, p2x));
          const iy = Math.max(0, Math.min(p1y, p2y));
          const iw = Math.min(widthPt - ix, Math.abs(p2x - p1x));
          const ih = Math.min(heightPt - iy, Math.abs(p2y - p1y));
          if (iw >= 14 && ih >= 14) {
            imageBoxes.push({
              xPt: ix,
              yPt: iy,
              widthPt: iw,
              heightPt: ih,
            });
          }
        }
      }
    }
  } catch {
    // Non-fatal fallback if operatorList fails
  }

  return {
    pageBackgroundColorHex,
    filledRects,
    horizontalRules,
    verticalRules,
    strokedRects,
    textDrawEvents,
    vectorBoxes,
    imageBoxes,
    embeddedImageCount,
    vectorGraphicCount,
    uniqueColorsHex: Array.from(uniqueColors),
  };
}

// ---------- MATH / EQUATION & OMML RECONSTRUCTION ----------

const GREEK_AND_MATH_SYMBOLS_RE =
  /[√∑∫∏π±×÷≤≥≠≈∞αβγδΔθλμσω∂∇∠△⇌→↔∧∨∈∉⊂⊆∪∩∀∃°²³⁰¹⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/;

export function isMathOrEquationLine(text: string): boolean {
  const clean = text.trim();
  if (!clean || clean.length > 180) return false;
  if (clean.split(/\s+/).length > 22) return false;

  // Reject normal prose lines ending with period unless formula-dense
  if (
    /[a-z]{4,}\s+[a-z]{4,}\s+[a-z]{4,}/.test(clean) &&
    !GREEK_AND_MATH_SYMBOLS_RE.test(clean) &&
    !/[=^]|√|\bsqrt\b|\bfrac\b/i.test(clean)
  ) {
    return false;
  }

  if (GREEK_AND_MATH_SYMBOLS_RE.test(clean)) return true;

  // Chemical equations / formulas like 2H2 + O2 -> 2H2O, CH4, H2SO4
  if (/\b(?:H2O|CO2|H2SO4|NaCl|CH4|NH3|CaCO3)\b|\b[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*/.test(clean) && /[+\-=→⇌]/.test(clean)) {
    return true;
  }

  // Algebraic formulas, quadratic equations, fractions, calculus
  if (
    /(?:^|\s)[a-zA-Z]\s*\^\s*[\d{a-zA-Z-]/.test(clean) ||
    /(?:sqrt|sin|cos|tan|log|ln|lim)\s*\(/i.test(clean) ||
    /[=<>≤≥≠]\s*[+-]?\s*(?:\d|[a-zA-Z(√∫∑])/.test(clean) &&
      /[+\-*/^√()=]/.test(clean) &&
      !/^(?:NAME|DATE|CLASS|SCHOOL|PAGE|SECTION|MARKS|TOTAL)\b/i.test(clean)
  ) {
    return true;
  }

  return false;
}

function replaceUnicodeScriptChars(str: string): string {
  const supMap: Record<string, string> = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', 'ⁿ': 'n', 'ⁱ': 'i',
  };
  const subMap: Record<string, string> = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', 'ᵢ': 'i', 'ⱼ': 'j', 'ₙ': 'n',
  };

  let out = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (supMap[ch]) {
      let group = '';
      while (i < str.length && supMap[str[i]]) {
        group += supMap[str[i]];
        i++;
      }
      out += group.length > 1 ? `^{${group}}` : `^${group}`;
      continue;
    }
    if (subMap[ch]) {
      let group = '';
      while (i < str.length && subMap[str[i]]) {
        group += subMap[str[i]];
        i++;
      }
      out += group.length > 1 ? `_{${group}}` : `_${group}`;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function findMatchingParen(s: string, openIdx: number, openChar = '(', closeChar = ')'): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === openChar) depth++;
    else if (s[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Recursive parser converting cleaned algebraic, calculus, matrix, root, fraction,
 * exponent, subscript, and chemical strings into native Microsoft Word OOXML (`MathComponent[]`).
 */
function parseExprToOmmlComponents(rawInput: string): MathComponent[] {
  const normalized = replaceUnicodeScriptChars(rawInput)
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√([a-zA-Z0-9]+)/g, 'sqrt($1)')
    .replace(/\bfrac\s*\{/g, '\\frac{')
    .replace(/\\{2,}/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [new MathRun('')];

  // Check for explicit matrix notation like [[1,2],[3,4]] or | a b ; c d |
  if (/^\[\[[^\]]+\](?:,\s*\[[^\]]+\])+\]$/.test(normalized)) {
    try {
      const inner = normalized.slice(1, -1);
      const rowMatches = inner.match(/\[[^\]]+\]/g);
      if (rowMatches && rowMatches.length >= 2) {
        const rows = rowMatches.map((rStr) =>
          rStr
            .slice(1, -1)
            .split(/[,;]+/)
            .map((cell) => parseExprToOmmlComponents(cell.trim()))
        );
        return [
          new MathMatrix({
            brackets: 'square',
            rows,
          }) as unknown as MathComponent,
        ];
      }
    } catch {
      // Fallback to linear parse
    }
  }

  // Split top-level relational operators (=, <=, >=, !=, approx, ->) so equations stay structured
  const topRelOps = ['<=>', '=>', '->', '⇌', '≤', '≥', '≠', '≈', '<=', '>=', '!=', '='];
  for (const op of topRelOps) {
    let depth = 0;
    for (let i = 1; i < normalized.length - op.length; i++) {
      const c = normalized[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
      else if (depth === 0 && normalized.slice(i, i + op.length) === op) {
        const lhs = normalized.slice(0, i).trim();
        const rhs = normalized.slice(i + op.length).trim();
        if (lhs && rhs) {
          return [
            ...parseExprToOmmlComponents(lhs),
            new MathRun(` ${op} `),
            ...parseExprToOmmlComponents(rhs),
          ];
        }
      }
    }
  }

  // Top-level stacked fraction splitting when a top-level `/` separates clear compound numerator / denominator
  // e.g. (-b ± sqrt(b^2 - 4ac)) / (2a) or dy/dx or (x+1)/(x-1)
  {
    let depth = 0;
    const slashPositions: number[] = [];
    for (let i = 0; i < normalized.length; i++) {
      const c = normalized[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
      else if (depth === 0 && c === '/') {
        slashPositions.push(i);
      }
    }
    if (slashPositions.length === 1 && !/[∫∑]/.test(normalized)) {
      const sIdx = slashPositions[0];
      const left = normalized.slice(0, sIdx).trim();
      const right = normalized.slice(sIdx + 1).trim();
      // Only treat as whole-expression stacked fraction if top-level `+`/`-`/`±` are NOT unparenthesized outside
      const hasUnwrappedAddSub = (str: string) => {
        let d = 0;
        for (let k = 1; k < str.length; k++) {
          const ch = str[k];
          if (ch === '(' || ch === '[' || ch === '{') d++;
          else if (ch === ')' || ch === ']' || ch === '}') d = Math.max(0, d - 1);
          else if (d === 0 && (ch === '+' || ch === '-' || ch === '±')) return true;
        }
        return false;
      };
      if (
        left &&
        right &&
        !hasUnwrappedAddSub(left) &&
        !hasUnwrappedAddSub(right) &&
        !/^(?:km|m|cm|mm)\/(?:s|h|hr|min)$/i.test(normalized)
      ) {
        const cleanLeft =
          left.startsWith('(') && left.endsWith(')') && findMatchingParen(left, 0) === left.length - 1
            ? left.slice(1, -1)
            : left;
        const cleanRight =
          right.startsWith('(') && right.endsWith(')') && findMatchingParen(right, 0) === right.length - 1
            ? right.slice(1, -1)
            : right;
        return [
          new MathFraction({
            numerator: parseExprToOmmlComponents(cleanLeft),
            denominator: parseExprToOmmlComponents(cleanRight),
          }),
        ];
      }
    }
  }

  // Sequential token-by-token scan handling \frac{}, sqrt(), ∫, ∑, (), [], scripts ^ _ and inline a/b
  const out: MathComponent[] = [];
  let i = 0;

  const attachScripts = (baseNode: MathComponent): MathComponent => {
    let subPart: MathComponent[] | undefined;
    let supPart: MathComponent[] | undefined;

    while (i < normalized.length) {
      while (normalized[i] === ' ') i++;
      if (normalized[i] === '_' && !subPart) {
        i++;
        if (normalized[i] === '{') {
          const endB = findMatchingParen(normalized, i, '{', '}');
          if (endB !== -1) {
            subPart = parseExprToOmmlComponents(normalized.slice(i + 1, endB));
            i = endB + 1;
            continue;
          }
        } else if (normalized[i] === '(') {
          const endP = findMatchingParen(normalized, i, '(', ')');
          if (endP !== -1) {
            subPart = parseExprToOmmlComponents(normalized.slice(i + 1, endP));
            i = endP + 1;
            continue;
          }
        }
        const m = normalized.slice(i).match(/^[a-zA-Z0-9+-]+/);
        if (m) {
          subPart = [new MathRun(m[0])];
          i += m[0].length;
          continue;
        }
      } else if (normalized[i] === '^' && !supPart) {
        i++;
        if (normalized[i] === '{') {
          const endB = findMatchingParen(normalized, i, '{', '}');
          if (endB !== -1) {
            supPart = parseExprToOmmlComponents(normalized.slice(i + 1, endB));
            i = endB + 1;
            continue;
          }
        } else if (normalized[i] === '(') {
          const endP = findMatchingParen(normalized, i, '(', ')');
          if (endP !== -1) {
            supPart = parseExprToOmmlComponents(normalized.slice(i + 1, endP));
            i = endP + 1;
            continue;
          }
        }
        const m = normalized.slice(i).match(/^[+-]?[a-zA-Z0-9]+/);
        if (m) {
          supPart = [new MathRun(m[0])];
          i += m[0].length;
          continue;
        }
      }
      break;
    }

    if (subPart && supPart) {
      return new MathSubSuperScript({
        children: [baseNode],
        subScript: subPart,
        superScript: supPart,
      });
    }
    if (supPart) {
      return new MathSuperScript({
        children: [baseNode],
        superScript: supPart,
      });
    }
    if (subPart) {
      return new MathSubScript({
        children: [baseNode],
        subScript: subPart,
      });
    }
    return baseNode;
  };

  while (i < normalized.length) {
    // 1. \frac{num}{den}
    if (normalized.startsWith('\\frac{', i)) {
      const nStart = i + 5;
      const nEnd = findMatchingParen(normalized, nStart, '{', '}');
      if (nEnd !== -1 && normalized[nEnd + 1] === '{') {
        const dEnd = findMatchingParen(normalized, nEnd + 1, '{', '}');
        if (dEnd !== -1) {
          const numStr = normalized.slice(nStart + 1, nEnd);
          const denStr = normalized.slice(nEnd + 2, dEnd);
          i = dEnd + 1;
          out.push(
            attachScripts(
              new MathFraction({
                numerator: parseExprToOmmlComponents(numStr),
                denominator: parseExprToOmmlComponents(denStr),
              })
            )
          );
          continue;
        }
      }
    }

    // 2. sqrt(...)
    if (/^sqrt\s*\(/i.test(normalized.slice(i))) {
      const openIdx = normalized.indexOf('(', i);
      const closeIdx = findMatchingParen(normalized, openIdx, '(', ')');
      if (closeIdx !== -1) {
        const inside = normalized.slice(openIdx + 1, closeIdx);
        i = closeIdx + 1;
        out.push(
          attachScripts(
            new MathRadical({
              children: parseExprToOmmlComponents(inside),
            })
          )
        );
        continue;
      }
    }

    // 3. Definite or indefinite Integral ∫_a^b expr
    if (normalized[i] === '∫' || normalized.startsWith('\\int', i)) {
      i += normalized[i] === '∫' ? 1 : 4;
      let subBounds: MathComponent[] | undefined;
      let supBounds: MathComponent[] | undefined;
      for (let pass = 0; pass < 2; pass++) {
        while (normalized[i] === ' ') i++;
        if (normalized[i] === '_' && !subBounds) {
          i++;
          if (normalized[i] === '{') {
            const e = findMatchingParen(normalized, i, '{', '}');
            if (e !== -1) {
              subBounds = parseExprToOmmlComponents(normalized.slice(i + 1, e));
              i = e + 1;
              continue;
            }
          }
          const m = normalized.slice(i).match(/^[+-]?[a-zA-Z0-9π∞]+/);
          if (m) {
            subBounds = [new MathRun(m[0])];
            i += m[0].length;
          }
        } else if (normalized[i] === '^' && !supBounds) {
          i++;
          if (normalized[i] === '{') {
            const e = findMatchingParen(normalized, i, '{', '}');
            if (e !== -1) {
              supBounds = parseExprToOmmlComponents(normalized.slice(i + 1, e));
              i = e + 1;
              continue;
            }
          }
          const m = normalized.slice(i).match(/^[+-]?[a-zA-Z0-9π∞]+/);
          if (m) {
            supBounds = [new MathRun(m[0])];
            i += m[0].length;
          }
        }
      }
      const restBody = normalized.slice(i).trim();
      i = normalized.length;
      out.push(
        new MathIntegral({
          children: restBody ? parseExprToOmmlComponents(restBody) : [new MathRun('')],
          subScript: subBounds,
          superScript: supBounds,
        })
      );
      continue;
    }

    // 4. Summation ∑_{i=1}^n expr
    if (normalized[i] === '∑' || normalized.startsWith('\\sum', i)) {
      i += normalized[i] === '∑' ? 1 : 4;
      let subBounds: MathComponent[] | undefined;
      let supBounds: MathComponent[] | undefined;
      for (let pass = 0; pass < 2; pass++) {
        while (normalized[i] === ' ') i++;
        if (normalized[i] === '_' && !subBounds) {
          i++;
          if (normalized[i] === '{') {
            const e = findMatchingParen(normalized, i, '{', '}');
            if (e !== -1) {
              subBounds = parseExprToOmmlComponents(normalized.slice(i + 1, e));
              i = e + 1;
              continue;
            }
          }
          const m = normalized.slice(i).match(/^[a-zA-Z0-9=]+/);
          if (m) {
            subBounds = [new MathRun(m[0])];
            i += m[0].length;
          }
        } else if (normalized[i] === '^' && !supBounds) {
          i++;
          if (normalized[i] === '{') {
            const e = findMatchingParen(normalized, i, '{', '}');
            if (e !== -1) {
              supBounds = parseExprToOmmlComponents(normalized.slice(i + 1, e));
              i = e + 1;
              continue;
            }
          }
          const m = normalized.slice(i).match(/^[a-zA-Z0-9∞]+/);
          if (m) {
            supBounds = [new MathRun(m[0])];
            i += m[0].length;
          }
        }
      }
      const restBody = normalized.slice(i).trim();
      i = normalized.length;
      out.push(
        new MathSum({
          children: restBody ? parseExprToOmmlComponents(restBody) : [new MathRun('')],
          subScript: subBounds,
          superScript: supBounds,
        })
      );
      continue;
    }

    // 5. Brackets (...), [...], {...} followed by optional script/slash
    if (normalized[i] === '(' || normalized[i] === '[' || normalized[i] === '{') {
      const openC = normalized[i];
      const closeC = openC === '(' ? ')' : openC === '[' ? ']' : '}';
      const closeIdx = findMatchingParen(normalized, i, openC, closeC);
      if (closeIdx !== -1) {
        const inner = normalized.slice(i + 1, closeIdx);
        i = closeIdx + 1;
        const innerNodes = parseExprToOmmlComponents(inner);
        const bracketNode =
          openC === '('
            ? new MathRoundBrackets({ children: innerNodes })
            : openC === '['
              ? new MathSquareBrackets({ children: innerNodes })
              : new MathCurlyBrackets({ children: innerNodes });

        // Check immediate stacked fraction after parenthesis e.g. (a+b)/(c+d)
        while (normalized[i] === ' ') i++;
        if (normalized[i] === '/' && normalized[i + 1]) {
          i++;
          while (normalized[i] === ' ') i++;
          let denNode: MathComponent[];
          if (normalized[i] === '(') {
            const dClose = findMatchingParen(normalized, i, '(', ')');
            if (dClose !== -1) {
              denNode = parseExprToOmmlComponents(normalized.slice(i + 1, dClose));
              i = dClose + 1;
            } else {
              denNode = [new MathRun(normalized.slice(i))];
              i = normalized.length;
            }
          } else {
            const dm = normalized.slice(i).match(/^[a-zA-Z0-9π]+/);
            if (dm) {
              denNode = parseExprToOmmlComponents(dm[0]);
              i += dm[0].length;
            } else {
              denNode = [new MathRun('1')];
            }
          }
          out.push(
            attachScripts(
              new MathFraction({
                numerator: innerNodes,
                denominator: denNode,
              })
            )
          );
          continue;
        }

        out.push(attachScripts(bracketNode));
        continue;
      }
    }

    // 6. Simple inline fraction token a/b (e.g., 3/4, dy/dx, 1/2)
    const inlineFrac = normalized.slice(i).match(/^([a-zA-Z0-9π]+)\s*\/\s*([a-zA-Z0-9π]+)/);
    if (inlineFrac) {
      i += inlineFrac[0].length;
      out.push(
        attachScripts(
          new MathFraction({
            numerator: parseExprToOmmlComponents(inlineFrac[1]),
            denominator: parseExprToOmmlComponents(inlineFrac[2]),
          })
        )
      );
      continue;
    }

    // 7. Chemical formula token e.g. H2O, CO2, H2SO4, NH3, CaCl2 -> emit native OMML subscripts
    const chemMatch = normalized
      .slice(i)
      .match(/^([A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*|[A-Z][a-z]?[A-Z][a-z]?\d+)/);
    if (chemMatch && /\d/.test(chemMatch[0])) {
      const chemToken = chemMatch[0];
      i += chemToken.length;
      const parts = chemToken.match(/([A-Z][a-z]?)(\d*)/g) || [];
      for (const p of parts) {
        const pm = p.match(/^([A-Z][a-z]?)(\d+)?$/);
        if (pm) {
          if (pm[2]) {
            out.push(
              new MathSubScript({
                children: [new MathRun(pm[1])],
                subScript: [new MathRun(pm[2])],
              })
            );
          } else {
            out.push(new MathRun(pm[1]));
          }
        }
      }
      continue;
    }

    // 8. Identifier / number atom potentially followed by ^ or _
    const atomMatch = normalized.slice(i).match(/^[a-zA-Z0-9πθαβγΔλμσω°]+/);
    if (atomMatch) {
      const atom = atomMatch[0];
      i += atom.length;
      // Check if directly followed by _ or ^ without spaces (or with spaces)
      const nextNonSpaceIdx = (() => {
        let j = i;
        while (j < normalized.length && normalized[j] === ' ') j++;
        return j;
      })();
      if (normalized[nextNonSpaceIdx] === '^' || normalized[nextNonSpaceIdx] === '_') {
        // If atom is multi-char like "2x" before "^2", split coefficient "2" from variable "x"
        const varSplit = atom.match(/^(\d+(?:\.\d+)?)([a-zA-ZπθαβγΔλμσω]+)$/);
        if (varSplit) {
          out.push(new MathRun(varSplit[1]));
          out.push(attachScripts(new MathRun(varSplit[2])));
        } else {
          out.push(attachScripts(new MathRun(atom)));
        }
      } else {
        out.push(new MathRun(atom));
      }
      continue;
    }

    // 9. Operators / punctuation / whitespace
    const sepMatch = normalized.slice(i).match(/^[^a-zA-Z0-9√∫∑([{^_\\/]+/);
    if (sepMatch) {
      out.push(new MathRun(sepMatch[0]));
      i += sepMatch[0].length;
      continue;
    }

    out.push(new MathRun(normalized[i]));
    i++;
  }

  return out.length > 0 ? out : [new MathRun(normalized)];
}

export function buildOmmlParagraph(
  equationText: string,
  align: 'left' | 'center' | 'right' = 'center',
  spaceAfterPt = 10
): { paragraph: Paragraph; ommlSuccess: boolean } {
  try {
    const components = parseExprToOmmlComponents(equationText);
    const alignment =
      align === 'left'
        ? AlignmentType.START
        : align === 'right'
          ? AlignmentType.END
          : AlignmentType.CENTER;

    const paragraph = new Paragraph({
      alignment,
      spacing: { before: 80, after: Math.max(80, Math.round(spaceAfterPt * 20)) },
      children: [
        new DocxMath({
          children: components,
        }),
      ],
    });
    return { paragraph, ommlSuccess: true };
  } catch {
    return {
      paragraph: new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 140 },
        children: [
          new TextRun({
            text: equationText,
            font: 'Cambria Math',
            size: 23,
            italics: true,
            color: '1E3A8A',
          }),
        ],
      }),
      ommlSuccess: false,
    };
  }
}

// ---------- TABLE RECOGNITION (BORDERED, BORDERLESS & MERGED CELLS) ----------

function detectWordTablesFromSpans(
  spans: PdfWordSpan[],
  graphics: PdfRawGraphics,
  pageWidthPt: number
): {
  richTables: PdfWordTable[];
  consumedSpanIndices: Set<number>;
} {
  const richTables: PdfWordTable[] = [];
  const consumedSpanIndices = new Set<number>();

  // Phase A: Explicit Grid-Rule Table Detection (Bordered Tables + Cell Merging + Colors + Borders)
  const significantHRules = graphics.horizontalRules.filter(
    (r) => Math.abs(r.x2 - r.x1) >= Math.max(36, pageWidthPt * 0.2)
  );
  const significantVRules = graphics.verticalRules.filter(
    (r) => Math.abs(r.y2 - r.y1) >= 20
  );

  if (significantHRules.length >= 3 && significantVRules.length >= 2) {
    const vSorted = [...significantVRules].sort((a, b) => a.y1 - b.y1);
    const yGroups: Array<{
      minY: number;
      maxY: number;
      minX: number;
      maxX: number;
      rules: typeof vSorted;
    }> = [];
    for (const vr of vSorted) {
      const grp = yGroups.find((g) => vr.y1 <= g.maxY + 8 && vr.y2 >= g.minY - 8);
      if (grp) {
        grp.minY = Math.min(grp.minY, vr.y1);
        grp.maxY = Math.max(grp.maxY, vr.y2);
        grp.minX = Math.min(grp.minX, vr.x);
        grp.maxX = Math.max(grp.maxX, vr.x);
        grp.rules.push(vr);
      } else {
        yGroups.push({
          minY: vr.y1,
          maxY: vr.y2,
          minX: vr.x,
          maxX: vr.x,
          rules: [vr],
        });
      }
    }

    for (const grp of yGroups) {
      const colEdges = clusterAxisCoordinates(
        grp.rules.map((r) => r.x),
        4
      );
      const localHRules = significantHRules.filter(
        (hr) =>
          hr.y >= grp.minY - 6 &&
          hr.y <= grp.maxY + 6 &&
          hr.x2 >= grp.minX - 6 &&
          hr.x1 <= grp.maxX + 6
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
          Math.max(
            4,
            Number((((colEdges[c + 1] - colEdges[c]) / tableWidth) * 100).toFixed(1))
          )
        );
        const rowHeightsPt = Array.from({ length: numRows }, (_, r) =>
          Math.max(16, Math.round(rowEdges[r + 1] - rowEdges[r]))
        );

        const borderHex =
          grp.rules[0]?.colorHex || localHRules[0]?.colorHex || '#cbd5e1';

        // Helper to test whether an internal divider exists between (row r, col c) and (row r, col c+1)
        const hasVerticalDivider = (rIdx: number, edgeX: number): boolean => {
          const midY = (rowEdges[rIdx] + rowEdges[rIdx + 1]) / 2;
          return grp.rules.some(
            (vr) =>
              Math.abs(vr.x - edgeX) <= 5 &&
              vr.y1 <= midY + 2 &&
              vr.y2 >= midY - 2
          );
        };

        const rows: PdfWordTableCell[][] = [];
        for (let r = 0; r < numRows; r++) {
          const ry1 = rowEdges[r];
          const ry2 = rowEdges[r + 1];
          const rowCells: PdfWordTableCell[] = [];

          let c = 0;
          while (c < numCols) {
            let spanCols = 1;
            // Detect horizontal merge if internal vertical line between col c and c+1 is absent
            while (
              c + spanCols < numCols &&
              !hasVerticalDivider(r, colEdges[c + spanCols])
            ) {
              spanCols++;
            }

            const cx1 = colEdges[c];
            const cx2 = colEdges[c + spanCols];
            const cellWidth = Math.max(4, cx2 - cx1);

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

            const cellSpans: PdfWordSpan[] = [];
            spans.forEach((sp, sIdx) => {
              if (consumedSpanIndices.has(sIdx)) return;
              const scx = sp.xPt + Math.min(sp.widthPt, 20) * 0.4;
              const scy = sp.yPt + sp.heightPt * 0.5;
              if (
                scx >= cx1 - 2 &&
                scx <= cx2 + 2 &&
                scy >= ry1 - 2 &&
                scy <= ry2 + 2
              ) {
                cellSpans.push(sp);
                consumedSpanIndices.add(sIdx);
              }
            });

            cellSpans.sort((a, b) =>
              Math.abs(a.yPt - b.yPt) > 3 ? a.yPt - b.yPt : a.xPt - b.xPt
            );

            const cellText = cellSpans
              .map((s) => s.text)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            const firstSpan = cellSpans[0];
            let align: 'left' | 'center' | 'right' = 'left';
            if (firstSpan && cellWidth > 20) {
              const relLeft = firstSpan.xPt - cx1;
              const relCenter =
                firstSpan.xPt + firstSpan.widthPt / 2 - (cx1 + cellWidth / 2);
              const relRight = cx2 - (firstSpan.xPt + firstSpan.widthPt);
              if (
                Math.abs(relCenter) <= cellWidth * 0.14 &&
                relLeft > 6 &&
                relRight > 6
              ) {
                align = 'center';
              } else if (
                relRight >= 2 &&
                relRight < relLeft * 0.45 &&
                firstSpan.widthPt < cellWidth * 0.7
              ) {
                align = 'right';
              }
            }

            rowCells.push({
              text: cellText,
              spans: cellSpans,
              align,
              verticalAlign: 'center',
              bold:
                cellSpans.some((s) => s.bold) || (r === 0 && Boolean(cellText)),
              italic:
                cellSpans.length > 0 && cellSpans.every((s) => s.italic),
              colorHex: firstSpan?.colorHex,
              bgColorHex: bgMatch?.colorHex,
              borderColorHex: borderHex,
              colSpan: spanCols > 1 ? spanCols : undefined,
            });
            c += spanCols;
          }

          if (rowCells.some((cell) => cell.text.length > 0 || cell.bgColorHex)) {
            rows.push(rowCells);
          }
        }

        if (rows.length >= 2) {
          richTables.push({
            rows,
            colWidthPcts,
            rowHeightsPt: rowHeightsPt.slice(0, rows.length),
            borderColorHex: borderHex,
            hasExplicitGridRules: true,
            yTopPt: rowEdges[0],
            yBottomPt: rowEdges[rowEdges.length - 1],
          });
        }
      }
    }
  }

  // Phase B: Borderless (Spatial Alignment) Tables for unconsumed spans
  const remainingIndexed = spans
    .map((sp, idx) => ({ sp, idx }))
    .filter(({ idx }) => !consumedSpanIndices.has(idx));

  const rowGroups: Array<Array<{ sp: PdfWordSpan; idx: number }>> = [];
  for (const item of remainingIndexed) {
    const last = rowGroups[rowGroups.length - 1];
    if (last && Math.abs(last[0].sp.yPt - item.sp.yPt) <= 4.5) {
      last.push(item);
    } else {
      rowGroups.push([item]);
    }
  }

  interface CandidateTabularRow {
    yPt: number;
    maxY: number;
    cells: Array<{
      text: string;
      minX: number;
      maxX: number;
      spans: PdfWordSpan[];
      indices: number[];
    }>;
  }
  let currentSpatialBlock: CandidateTabularRow[] = [];

  const flushSpatialBlock = () => {
    if (currentSpatialBlock.length >= 3) {
      const colCounts = currentSpatialBlock.map((r) => r.cells.length);
      const targetCols = Math.max(...colCounts);
      const allCells = currentSpatialBlock.flatMap((r) => r.cells);
      const avgCellWords =
        allCells.reduce((acc, c) => acc + c.text.split(/\s+/).length, 0) /
        Math.max(1, allCells.length);

      // Avoid misclassifying 2-column newspaper prose as a table: require >=3 cols OR concise tabular cells
      if (targetCols >= 3 || (targetCols === 2 && avgCellWords <= 4.5)) {
        const minX = Math.min(...allCells.map((c) => c.minX));
        const maxX = Math.max(...allCells.map((c) => c.maxX));
        const spanW = Math.max(50, maxX - minX);
        const colAnchors = clusterAxisCoordinates(
          allCells.map((c) => c.minX),
          14
        ).slice(0, targetCols);

        const colCount = Math.max(2, colAnchors.length);
        const colWidthPcts = Array.from({ length: colCount }, (_, c) => {
          const nextX = colAnchors[c + 1] ?? maxX;
          return Math.max(8, Math.round(((nextX - colAnchors[c]) / spanW) * 100));
        });

        const rows: PdfWordTableCell[][] = currentSpatialBlock.map((row, rIdx) => {
          const mappedCells: PdfWordTableCell[] = Array.from(
            { length: colCount },
            () => ({ text: '', align: 'left' as const, verticalAlign: 'center' as const })
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
            const prev = mappedCells[bestCol];
            mappedCells[bestCol] = {
              text: prev.text ? `${prev.text} ${c.text}` : c.text,
              spans: [...(prev.spans || []), ...c.spans],
              align: /^\d+(?:[.,]\d+)?%?$/.test(c.text) ? 'right' : 'left',
              verticalAlign: 'center',
              bold: c.spans.some((s) => s.bold) || rIdx === 0,
              italic: c.spans.every((s) => s.italic),
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
          yTopPt: Math.min(...currentSpatialBlock.map((r) => r.yPt)),
          yBottomPt: Math.max(...currentSpatialBlock.map((r) => r.maxY)),
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
      const minY = Math.min(...sorted.map((s) => s.sp.yPt));
      const maxY = Math.max(...sorted.map((s) => s.sp.yPt + s.sp.heightPt));
      currentSpatialBlock.push({ yPt: minY, maxY, cells });
    } else {
      flushSpatialBlock();
    }
  }
  flushSpatialBlock();

  return { richTables, consumedSpanIndices };
}

// ---------- PROSE, HEADING, LIST, EQUATION & MULTI-COLUMN RECONSTRUCTION ----------

function reconstructWordBlocksFromSpans(
  spans: PdfWordSpan[],
  consumedSpanIndices: Set<number>,
  pageWidthPt: number,
  pageHeightPt: number
): {
  styledBlocks: PdfWordBlock[];
  multiColumnDetected: boolean;
  gutterXPt?: number;
} {
  const remaining = spans.filter((_, idx) => !consumedSpanIndices.has(idx));
  if (remaining.length === 0) {
    return { styledBlocks: [], multiColumnDetected: false };
  }

  const sorted = [...remaining].sort((a, b) =>
    Math.abs(a.yPt - b.yPt) > 4 ? a.yPt - b.yPt : a.xPt - b.xPt
  );
  const rows: PdfWordSpan[][] = [];
  for (const sp of sorted) {
    const last = rows[rows.length - 1];
    if (
      last &&
      Math.abs(last[0].yPt - sp.yPt) <= Math.max(4, last[0].fontSizePt * 0.42)
    ) {
      last.push(sp);
    } else {
      rows.push([sp]);
    }
  }

  // Multi-column gutter detection
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
    const hasLeft = row.some(
      (s) => s.xPt < gutterX - 8 && s.xPt + s.widthPt <= gutterX + 14
    );
    const hasRight = row.some((s) => s.xPt >= gutterX - 2);
    if (hasLeft && hasRight) {
      twoColumnRowCount++;
    }
  }
  const multiColumnDetected = twoColumnRowCount >= 4 && rows.length >= 5;

  const buildSequentialBlocks = (
    orderedSpans: PdfWordSpan[],
    colIdx?: 0 | 1
  ): PdfWordBlock[] => {
    if (orderedSpans.length === 0) return [];
    const sSorted = [...orderedSpans].sort((a, b) =>
      Math.abs(a.yPt - b.yPt) > 4 ? a.yPt - b.yPt : a.xPt - b.xPt
    );
    const lineClusters: PdfWordSpan[][] = [];
    for (const sp of sSorted) {
      const last = lineClusters[lineClusters.length - 1];
      if (
        last &&
        Math.abs(last[0].yPt - sp.yPt) <= Math.max(4.5, last[0].fontSizePt * 0.45)
      ) {
        last.push(sp);
      } else {
        lineClusters.push([sp]);
      }
    }

    // Detect inline superscript / subscript offsets
    for (const line of lineClusters) {
      line.sort((a, b) => a.xPt - b.xPt);
      if (line.length >= 2) {
        const medianSize =
          [...line].sort((a, b) => a.fontSizePt - b.fontSizePt)[
            Math.floor(line.length / 2)
          ].fontSizePt || 11;
        const baseMidY =
          line.reduce((acc, s) => acc + s.yPt + s.fontSizePt * 0.5, 0) /
          line.length;
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

    const blocks: PdfWordBlock[] = [];
    let currentParaLines: PdfWordSpan[][] = [];

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
      const yTopPt = Math.min(...flatSpans.map((s) => s.yPt));
      const yBottomPt = Math.max(...flatSpans.map((s) => s.yPt + s.heightPt));
      const avgFontSize =
        flatSpans.reduce((acc, s) => acc + s.fontSizePt, 0) /
        Math.max(1, flatSpans.length);
      const isAllBold = flatSpans.every((s) => s.bold);
      const lineMinX = Math.min(...firstLine.map((s) => s.xPt));
      const lineMaxX = Math.max(...firstLine.map((s) => s.xPt + s.widthPt));
      const lineCenter = (lineMinX + lineMaxX) / 2;

      const effectiveColW = colIdx === undefined ? pageWidthPt : pageWidthPt * 0.45;
      const colOriginX = colIdx === 1 ? gutterX : 0;

      let align: PdfWordBlock['align'] = 'left';
      if (
        currentParaLines.length === 1 &&
        colIdx === undefined &&
        Math.abs(lineCenter - pageWidthPt / 2) <= pageWidthPt * 0.08 &&
        lineMaxX - lineMinX < pageWidthPt * 0.76
      ) {
        align = 'center';
      } else if (
        currentParaLines.length === 1 &&
        lineMinX - colOriginX > effectiveColW * 0.45 &&
        colOriginX + effectiveColW - lineMaxX < 65
      ) {
        align = 'right';
      } else if (currentParaLines.length >= 2) {
        align = 'justify';
      }

      let kind: PdfWordBlock['kind'] = 'paragraph';
      let headingLevel: 1 | 2 | 3 | undefined;
      let listMarker: string | undefined;
      let isOrderedList: boolean | undefined;

      const bulletMatch = fullText.match(/^([•\u2022\u25AA\u25CF*-])\s+(.+)$/);
      const numListMatch = fullText.match(/^((?:\d+|[a-zA-Z]|[ivxIVX]+)[.)])\s+(.+)$/);

      if (
        yTopPt < pageHeightPt * 0.055 &&
        currentParaLines.length === 1 &&
        fullText.length < 75 &&
        colIdx === undefined
      ) {
        kind = 'header';
      } else if (
        yTopPt > pageHeightPt * 0.91 &&
        currentParaLines.length === 1 &&
        fullText.length < 75 &&
        colIdx === undefined
      ) {
        kind = 'footer';
      } else if (isMathOrEquationLine(fullText)) {
        kind = 'equation';
      } else if (
        (avgFontSize >= medianBodyFont * 1.32 ||
          (isAllBold && avgFontSize >= medianBodyFont * 1.08 && fullText.length <= 95)) &&
        currentParaLines.length <= 2
      ) {
        kind = 'heading';
        headingLevel =
          avgFontSize >= medianBodyFont * 1.48
            ? 1
            : avgFontSize >= medianBodyFont * 1.22
              ? 2
              : 3;
      } else if (bulletMatch) {
        kind = 'list-item';
        listMarker = '•';
        isOrderedList = false;
      } else if (numListMatch && numListMatch[1].length <= 5) {
        kind = 'list-item';
        listMarker = numListMatch[1];
        isOrderedList = true;
      }

      const bgColorHex = flatSpans.find((s) => s.highlightHex)?.highlightHex;

      blocks.push({
        kind,
        headingLevel,
        listMarker,
        isOrderedList,
        align,
        indentLeftPt: Math.max(0, Math.round(lineMinX - minLeftMargin)),
        bgColorHex,
        yTopPt,
        yBottomPt,
        spans: flatSpans,
        text: fullText,
        columnIndex: colIdx,
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
      const fontChange =
        Math.abs(line[0].fontSizePt - prevLine[0].fontSizePt) >= 1.8;
      const lineJoined = line.map((s) => s.text).join(' ');
      const startsListOrHeading =
        /^(?:\u2022|\*|-|\d+\.|[A-Z]\)|Section\s+[A-Z0-9])/i.test(line[0].text);
      const prevIsHeadingOrEq =
        prevLine[0].fontSizePt >= medianBodyFont * 1.25 ||
        prevLine.every((s) => s.bold) ||
        isMathOrEquationLine(prevLine.map((s) => s.text).join(' '));

      if (
        vGap > prevLine[0].fontSizePt * 0.72 ||
        fontChange ||
        startsListOrHeading ||
        prevIsHeadingOrEq ||
        isMathOrEquationLine(lineJoined)
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
      styledBlocks: buildSequentialBlocks(remaining),
      multiColumnDetected: false,
    };
  }

  // Split full-width header/title, 2-column body band, and footer cleanly
  const topFullWidth: PdfWordSpan[] = [];
  const leftCol: PdfWordSpan[] = [];
  const rightCol: PdfWordSpan[] = [];
  const bottomFullWidth: PdfWordSpan[] = [];

  for (const row of rows) {
    const rowY = row[0].yPt;
    const minX = Math.min(...row.map((s) => s.xPt));
    const maxX = Math.max(...row.map((s) => s.xPt + s.widthPt));
    const hasLeft = row.some(
      (s) => s.xPt < gutterX - 8 && s.xPt + s.widthPt <= gutterX + 14
    );
    const hasRight = row.some((s) => s.xPt >= gutterX - 2);
    const spansAcrossMid = row.some(
      (s) => s.xPt < gutterX - 20 && s.xPt + s.widthPt > gutterX + 24
    );

    if (
      spansAcrossMid ||
      (!hasRight && rowY < pageHeightPt * 0.18 && maxX > gutterX * 0.9)
    ) {
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

  const styledBlocks: PdfWordBlock[] = [
    ...buildSequentialBlocks(topFullWidth),
    ...buildSequentialBlocks(leftCol, 0),
    ...buildSequentialBlocks(rightCol, 1),
    ...buildSequentialBlocks(bottomFullWidth),
  ];

  return { styledBlocks, multiColumnDetected: true, gutterXPt: gutterX };
}

// ---------- DIAGRAM & GRAPHIC REGION CLUSTERING + CANVAS CROPPING ----------

function buildDiagramRegionsFromGraphics(
  graphics: PdfRawGraphics,
  tables: PdfWordTable[],
  pageWidthPt: number,
  pageHeightPt: number
): PdfWordDiagramRegion[] {
  const insideAnyTable = (rx: number, ry: number, rw: number, rh: number) => {
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    return tables.some(
      (tbl) => cy >= tbl.yTopPt - 10 && cy <= tbl.yBottomPt + 10 && rw <= pageWidthPt * 0.95
    );
  };

  interface RawRegionBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    kind: 'diagram' | 'photo' | 'chart';
  }

  const rawBoxes: RawRegionBox[] = [];
  for (const vb of graphics.vectorBoxes) {
    if (
      vb.widthPt >= 18 &&
      vb.heightPt >= 16 &&
      !insideAnyTable(vb.xPt, vb.yPt, vb.widthPt, vb.heightPt)
    ) {
      rawBoxes.push({
        x1: Math.max(0, vb.xPt),
        y1: Math.max(0, vb.yPt),
        x2: Math.min(pageWidthPt, vb.xPt + vb.widthPt),
        y2: Math.min(pageHeightPt, vb.yPt + vb.heightPt),
        kind: vb.kind,
      });
    }
  }

  for (const ib of graphics.imageBoxes) {
    if (
      ib.widthPt >= 20 &&
      ib.heightPt >= 20 &&
      !(ib.widthPt >= pageWidthPt * 0.94 && ib.heightPt >= pageHeightPt * 0.94)
    ) {
      rawBoxes.push({
        x1: Math.max(0, ib.xPt),
        y1: Math.max(0, ib.yPt),
        x2: Math.min(pageWidthPt, ib.xPt + ib.widthPt),
        y2: Math.min(pageHeightPt, ib.yPt + ib.heightPt),
        kind: 'photo',
      });
    }
  }

  // Merge nearby/overlapping graphic regions into coherent diagram frames
  const merged: RawRegionBox[] = [];
  for (const box of rawBoxes.sort((a, b) => a.y1 - b.y1)) {
    const pad = 16;
    const existing = merged.find(
      (m) =>
        box.x1 <= m.x2 + pad &&
        box.x2 >= m.x1 - pad &&
        box.y1 <= m.y2 + pad &&
        box.y2 >= m.y1 - pad
    );
    if (existing) {
      existing.x1 = Math.min(existing.x1, box.x1);
      existing.y1 = Math.min(existing.y1, box.y1);
      existing.x2 = Math.max(existing.x2, box.x2);
      existing.y2 = Math.max(existing.y2, box.y2);
      if (box.kind === 'photo' && existing.kind !== 'photo') {
        existing.kind = 'photo';
      }
    } else {
      merged.push({ ...box });
    }
  }

  return merged
    .filter((m) => m.x2 - m.x1 >= 24 && m.y2 - m.y1 >= 22)
    .map((m, idx) => ({
      id: `diagram-${idx + 1}`,
      xPt: Math.max(0, Math.round(m.x1 - 6)),
      yPt: Math.max(0, Math.round(m.y1 - 6)),
      widthPt: Math.min(pageWidthPt, Math.round(m.x2 - m.x1 + 12)),
      heightPt: Math.min(pageHeightPt, Math.round(m.y2 - m.y1 + 12)),
      kind: m.kind,
    }));
}

// ---------- PDF TO WORD PAGE EXTRACTION ENGINE ----------

export async function extractPdfPagesForWord(
  pdfBytes: Uint8Array,
  onProgress?: (current: number, total: number, stage?: string) => void,
  options?: PdfToWordExtractionOptions
): Promise<PdfPageWordContent[]> {
  if (!pdfBytes || pdfBytes.byteLength < 8) {
    throw new Error('Empty or invalid PDF buffer provided.');
  }

  const results: PdfPageWordContent[] = [];
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const captureSnapshots = options?.captureSnapshots !== false;

  try {
    for (let pNum = 1; pNum <= totalPages; pNum++) {
      if (options?.shouldCancel?.()) {
        throw new Error('PDF to Word conversion was cancelled.');
      }

      const stageMsg = `Analyzing layout, tables, equations & graphics on page ${pNum} of ${totalPages}...`;
      onProgress?.(pNum, totalPages, stageMsg);
      options?.onProgress?.(pNum, totalPages, stageMsg);

      const page = await pdf.getPage(pNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const widthPt = Math.max(
        72,
        Math.round((baseViewport.width || 595.28) * 100) / 100
      );
      const heightPt = Math.max(
        72,
        Math.round((baseViewport.height || 841.89) * 100) / 100
      );
      const orientation: 'portrait' | 'landscape' =
        widthPt > heightPt ? 'landscape' : 'portrait';

      // 1. Extract operator-list graphics (RGB/CMYK colors, rules, tables, vector artwork & image bounding boxes)
      const graphics = await extractPdfPageGraphics(
        page,
        baseViewport.transform,
        widthPt,
        heightPt
      );

      // 2. Extract positioned spans with real font mapping, bold/italic/underline, colors, highlights
      const textContent = await page.getTextContent();
      const stylesMap =
        (textContent.styles as Record<
          string,
          { fontFamily?: string; ascent?: number; descent?: number }
        >) || {};
      const pageFontSubMap = new Map<string, PdfWordFontSubstitution>();
      const styledSpans: PdfWordSpan[] = [];
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
        const fontMap = mapPdfFontToWordFont(
          resolvedPdfFontName,
          styleEntry.fontFamily || 'sans-serif',
          metaBold,
          metaItalic
        );

        const fKey = `${resolvedPdfFontName}|${fontMap.wordFontFamily}|${fontMap.bold}|${fontMap.italic}`;
        if (!pageFontSubMap.has(fKey)) {
          pageFontSubMap.set(fKey, {
            pdfFontName: resolvedPdfFontName,
            wordFontFamily: fontMap.wordFontFamily,
            bold: fontMap.bold,
            italic: fontMap.italic,
            pageNumbers: [pNum],
          });
        }

        // Match exact fill color from operator list textDrawEvents
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

        // Match highlight / shaded banner fill behind span
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

        // Match underline horizontal rule
        const hasUnderline = graphics.horizontalRules.some(
          (hr) =>
            hr.y >= baselineY - 1.5 &&
            hr.y <= baselineY + 4.5 &&
            hr.x1 <= xPt + wPt * 0.35 &&
            hr.x2 >= xPt + wPt * 0.65
        );

        styledSpans.push({
          text: item.str.trim(),
          xPt: Math.round(xPt * 100) / 100,
          yPt: Math.round(yPt * 100) / 100,
          widthPt: Math.round(wPt * 100) / 100,
          heightPt: Math.round(fontSizePt * 1.15 * 100) / 100,
          fontSizePt: Math.round(fontSizePt * 10) / 10,
          fontFamily: fontMap.wordFontFamily,
          originalFontName: resolvedPdfFontName,
          bold: fontMap.bold,
          italic: fontMap.italic,
          underline: hasUnderline || undefined,
          colorHex: matchedColorHex,
          highlightHex,
        });
      }

      // 3. Reconstruct tables (bordered + borderless + merged cells) & non-table blocks (prose, lists, equations, columns)
      const { richTables, consumedSpanIndices } = detectWordTablesFromSpans(
        styledSpans,
        graphics,
        widthPt
      );
      const { styledBlocks, multiColumnDetected, gutterXPt } =
        reconstructWordBlocksFromSpans(
          styledSpans,
          consumedSpanIndices,
          widthPt,
          heightPt
        );

      // Compute clean page margins from observed content bounds
      const allXs = styledSpans.map((s) => s.xPt);
      const allMaxXs = styledSpans.map((s) => s.xPt + s.widthPt);
      const allYs = styledSpans.map((s) => s.yPt);
      const allMaxYs = styledSpans.map((s) => s.yPt + s.heightPt);

      const marginLeftPt = allXs.length
        ? Math.max(28, Math.min(96, Math.round(Math.min(...allXs))))
        : 54;
      const marginRightPt = allMaxXs.length
        ? Math.max(28, Math.min(96, Math.round(widthPt - Math.max(...allMaxXs))))
        : 54;
      const marginTopPt = allYs.length
        ? Math.max(28, Math.min(86, Math.round(Math.min(...allYs))))
        : 54;
      const marginBottomPt = allMaxYs.length
        ? Math.max(28, Math.min(86, Math.round(heightPt - Math.max(...allMaxYs))))
        : 54;

      // 4. Identify diagrams/drawings/photos & crop high-res images from canvas (in browser DOM)
      const diagramRegions = buildDiagramRegionsFromGraphics(
        graphics,
        richTables,
        widthPt,
        heightPt
      );

      let imageDataUrl: string | undefined;
      let renderW = Math.round(widthPt * 1.5);
      let renderH = Math.round(heightPt * 1.5);

      if (captureSnapshots && typeof document !== 'undefined') {
        try {
          const hiScale =
            totalPages > 50 ? 1.35 : totalPages > 18 ? 1.6 : 1.85;
          const viewport = page.getViewport({ scale: hiScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          renderW = canvas.width;
          renderH = canvas.height;
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

            // Crop crisp isolated diagram/photo figures directly from the rendered page canvas
            for (const reg of diagramRegions) {
              try {
                const sx = Math.max(0, Math.floor(reg.xPt * hiScale));
                const sy = Math.max(0, Math.floor(reg.yPt * hiScale));
                const sw = Math.max(
                  8,
                  Math.min(canvas.width - sx, Math.ceil(reg.widthPt * hiScale))
                );
                const sh = Math.max(
                  8,
                  Math.min(canvas.height - sy, Math.ceil(reg.heightPt * hiScale))
                );
                if (sw >= 12 && sh >= 12) {
                  const cropCanvas = document.createElement('canvas');
                  cropCanvas.width = sw;
                  cropCanvas.height = sh;
                  const cropCtx = cropCanvas.getContext('2d');
                  if (cropCtx) {
                    cropCtx.fillStyle = graphics.pageBackgroundColorHex || '#FFFFFF';
                    cropCtx.fillRect(0, 0, sw, sh);
                    cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                    reg.imageDataUrl = cropCanvas.toDataURL('image/png');
                    cropCanvas.width = 1;
                    cropCanvas.height = 1;
                  }
                }
              } catch {
                // Skip individual crop failure safely
              }
            }

            canvas.width = 1;
            canvas.height = 1;
          }
        } catch {
          // Non-fatal in headless Node environments
        }
      }

      // 5. Evaluate equations for OMML vs visual fallback
      const equations: PdfWordEquationEntry[] = [];
      for (const blk of styledBlocks) {
        if (blk.kind !== 'equation') continue;
        // Detect fragmented/broken 2D glyph soup (e.g., excessive isolated slashes or unmatched braces)
        const hasGarbled2D =
          /(?:\?\?\?|[\uFFFD])/.test(blk.text) ||
          (blk.spans.length >= 6 &&
            blk.spans.every((s) => s.text.length === 1) &&
            new Set(blk.spans.map((s) => Math.round(s.yPt / 6))).size >= 3);

        let fallbackDataUrl: string | undefined;
        if (hasGarbled2D && typeof document !== 'undefined' && imageDataUrl) {
          // Record that complex stacked formula needs visual crop fallback if ambiguous
          const eqW = Math.max(
            40,
            Math.max(...blk.spans.map((s) => s.xPt + s.widthPt)) -
              Math.min(...blk.spans.map((s) => s.xPt)) +
              12
          );
          const eqH = Math.max(20, blk.yBottomPt - blk.yTopPt + 10);
          diagramRegions.push({
            id: `eq-fallback-${equations.length + 1}`,
            xPt: Math.max(0, Math.min(...blk.spans.map((s) => s.xPt)) - 6),
            yPt: Math.max(0, blk.yTopPt - 5),
            widthPt: eqW,
            heightPt: eqH,
            kind: 'formula-fallback',
            caption: blk.text,
          });
          fallbackDataUrl = imageDataUrl;
        }

        const entry: PdfWordEquationEntry = {
          rawText: blk.text,
          ommlSupported: !hasGarbled2D,
          hasFallbackImage: Boolean(fallbackDataUrl),
          fallbackImageDataUrl: fallbackDataUrl,
          yPt: blk.yTopPt,
        };
        blk.equationInfo = entry;
        equations.push(entry);
      }

      const headerTexts = styledBlocks
        .filter((b) => b.kind === 'header')
        .map((b) => b.text);
      const footerTexts = styledBlocks
        .filter((b) => b.kind === 'footer')
        .map((b) => b.text);

      // Build backward-compatible simplified `paragraphs` array for editable textarea preview & legacy consumers
      const paragraphs: PdfPageWordContent['paragraphs'] = styledBlocks
        .filter((b) => b.kind !== 'header' && b.kind !== 'footer')
        .map((b) => ({
          text: b.text,
          isHeading: b.kind === 'heading',
          fontSize: b.spans[0]?.fontSizePt || 11.5,
        }));

      const nativeCharCount = styledSpans.reduce((acc, s) => acc + s.text.length, 0);
      const isScannedPage = nativeCharCount < 15;
      const firstHeading = styledBlocks.find((b) => b.kind === 'heading')?.text;

      results.push({
        pageNumber: pNum,
        title: firstHeading || `Page ${pNum}`,
        paragraphs,
        imageDataUrl,
        width: renderW,
        height: renderH,
        widthPt,
        heightPt,
        orientation,
        marginTopPt,
        marginBottomPt,
        marginLeftPt,
        marginRightPt,
        pageBackgroundColorHex: graphics.pageBackgroundColorHex,
        multiColumnDetected,
        gutterXPt,
        isScannedPage,
        ocrApplied: false,
        embeddedImageCount: graphics.embeddedImageCount,
        vectorGraphicCount: graphics.vectorGraphicCount,
        uniqueColorsHex: Array.from(pageColorSet),
        headerTexts,
        footerTexts,
        styledBlocks,
        richTables,
        diagramRegions,
        equations,
        fontSubstitutions: Array.from(pageFontSubMap.values()),
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return results;
}

// ---------- NATIVE WORD (.DOCX) TABLE, BLOCK, IMAGE & MULTI-SECTION BUILDER ----------

function decodeDataUrlBytes(dataUrl: string): {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
} {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const base64 = parts[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const type: 'png' | 'jpg' = /image\/png/i.test(header) ? 'png' : 'jpg';
  return { bytes, type };
}

function buildDocxTableFromRichTable(
  tbl: PdfWordTable,
  contentWidthTwips: number
): Table {
  const colPcts =
    tbl.colWidthPcts.length > 0
      ? tbl.colWidthPcts
      : Array.from(
          { length: Math.max(1, tbl.rows[0]?.length || 1) },
          () => 100 / Math.max(1, tbl.rows[0]?.length || 1)
        );
  const pctSum = colPcts.reduce((s, v) => s + v, 0) || 100;
  const columnWidthsTwips = colPcts.map((pct) =>
    Math.max(480, Math.round((pct / pctSum) * contentWidthTwips))
  );

  const bHex = toDocxHex(tbl.borderColorHex, 'CBD5E1');
  const borderStyle = tbl.hasExplicitGridRules
    ? BorderStyle.SINGLE
    : BorderStyle.NONE;
  const subtleBottomStyle = tbl.hasExplicitGridRules
    ? BorderStyle.SINGLE
    : BorderStyle.DOTTED;

  const docxRows = tbl.rows.map((row, rIdx) => {
    let colCursor = 0;
    const cells = row.map((cell) => {
      const span = Math.max(1, cell.colSpan || 1);
      let cellWTwips = 0;
      for (let k = 0; k < span; k++) {
        cellWTwips += columnWidthsTwips[Math.min(colCursor + k, columnWidthsTwips.length - 1)] || 1200;
      }
      colCursor += span;

      const alignment =
        cell.align === 'center'
          ? AlignmentType.CENTER
          : cell.align === 'right'
            ? AlignmentType.END
            : AlignmentType.START;

      const cellParagraphChildren: ParagraphChild[] =
        cell.spans && cell.spans.length > 0
          ? cell.spans.map(
              (sp, spIdx) =>
                new TextRun({
                  text: (spIdx > 0 ? ' ' : '') + sp.text,
                  bold: sp.bold || cell.bold,
                  italics: sp.italic || cell.italic,
                  underline: sp.underline
                    ? { type: UnderlineType.SINGLE }
                    : undefined,
                  font: sp.fontFamily || 'Calibri',
                  size: Math.max(16, Math.round((sp.fontSizePt || 10) * 2)),
                  color: toDocxHex(sp.colorHex || cell.colorHex, '1F1B24'),
                  superScript: sp.script === 'sup' ? true : undefined,
                  subScript: sp.script === 'sub' ? true : undefined,
                })
            )
          : [
              new TextRun({
                text: cell.text || '',
                bold: cell.bold || rIdx === 0,
                italics: cell.italic,
                size: 20,
                color: toDocxHex(cell.colorHex, '1F1B24'),
              }),
            ];

      return new TableCell({
        width: { size: cellWTwips, type: WidthType.DXA },
        columnSpan: span > 1 ? span : undefined,
        rowSpan: cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined,
        verticalAlign:
          cell.verticalAlign === 'top'
            ? VerticalAlign.TOP
            : cell.verticalAlign === 'bottom'
              ? VerticalAlign.BOTTOM
              : VerticalAlign.CENTER,
        shading: cell.bgColorHex
          ? {
              fill: toDocxHex(cell.bgColorHex),
              type: ShadingType.CLEAR,
            }
          : rIdx === 0 && !tbl.hasExplicitGridRules
            ? {
                fill: 'F1F5F9',
                type: ShadingType.CLEAR,
              }
            : undefined,
        margins: { top: 80, bottom: 80, left: 110, right: 110 },
        borders: {
          top: {
            style: borderStyle,
            size: tbl.hasExplicitGridRules ? 6 : 0,
            color: bHex,
          },
          bottom: {
            style: subtleBottomStyle,
            size: tbl.hasExplicitGridRules ? 6 : 4,
            color: bHex,
          },
          left: {
            style: borderStyle,
            size: tbl.hasExplicitGridRules ? 6 : 0,
            color: bHex,
          },
          right: {
            style: borderStyle,
            size: tbl.hasExplicitGridRules ? 6 : 0,
            color: bHex,
          },
        },
        children: [
          new Paragraph({
            alignment,
            spacing: { before: 20, after: 20 },
            children: cellParagraphChildren,
          }),
        ],
      });
    });

    const rowHeightPt = tbl.rowHeightsPt?.[rIdx];
    return new TableRow({
      tableHeader: rIdx === 0,
      cantSplit: true,
      height:
        rowHeightPt && rowHeightPt >= 14
          ? { value: Math.round(rowHeightPt * 20), rule: HeightRule.ATLEAST }
          : undefined,
      children: cells,
    });
  });

  return new Table({
    width: { size: contentWidthTwips, type: WidthType.DXA },
    columnWidths: columnWidthsTwips,
    alignment: AlignmentType.CENTER,
    rows: docxRows,
  });
}

function buildDocxParagraphFromStyledBlock(block: PdfWordBlock): Paragraph {
  const alignment =
    block.align === 'center'
      ? AlignmentType.CENTER
      : block.align === 'right'
        ? AlignmentType.END
        : block.align === 'justify'
          ? AlignmentType.BOTH
          : AlignmentType.START;

  const heading =
    block.kind === 'heading'
      ? block.headingLevel === 1
        ? HeadingLevel.HEADING_1
        : block.headingLevel === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3
      : undefined;

  const indentTwips =
    block.indentLeftPt > 4 ? Math.min(2880, Math.round(block.indentLeftPt * 20)) : 0;

  // Check for bullet list formatting
  const isBullet = block.kind === 'list-item' && !block.isOrderedList;

  const runs: TextRun[] =
    block.spans.length > 0
      ? block.spans.map((sp, sIdx) => {
          let runText = sp.text;
          // Avoid duplicate bullet glyph when Word native bullet property is applied
          if (isBullet && sIdx === 0) {
            runText = runText.replace(/^[•\u2022\u25AA\u25CF*-]\s*/, '');
          }
          return new TextRun({
            text: (sIdx > 0 ? ' ' : '') + runText,
            bold: sp.bold || block.kind === 'heading',
            italics: sp.italic,
            underline: sp.underline ? { type: UnderlineType.SINGLE } : undefined,
            strike: sp.strike,
            font: sp.fontFamily || 'Calibri',
            size: Math.max(16, Math.min(72, Math.round(sp.fontSizePt * 2))),
            color: toDocxHex(sp.colorHex, '1F1B24'),
            shading: sp.highlightHex
              ? { fill: toDocxHex(sp.highlightHex), type: ShadingType.CLEAR }
              : undefined,
            superScript: sp.script === 'sup' ? true : undefined,
            subScript: sp.script === 'sub' ? true : undefined,
          });
        })
      : [
          new TextRun({
            text: isBullet
              ? block.text.replace(/^[•\u2022\u25AA\u25CF*-]\s*/, '')
              : block.text,
            bold: block.kind === 'heading',
            size: block.kind === 'heading' ? 28 : 22,
            color: '1F1B24',
          }),
        ];

  return new Paragraph({
    heading,
    alignment,
    bullet: isBullet ? { level: 0 } : undefined,
    indent: !isBullet && indentTwips > 0 ? { left: indentTwips } : undefined,
    shading: block.bgColorHex
      ? { fill: toDocxHex(block.bgColorHex), type: ShadingType.CLEAR }
      : undefined,
    spacing: {
      before: block.kind === 'heading' ? 180 : 40,
      after: block.kind === 'heading' ? 110 : 140,
      line: 276,
    },
    children: runs,
  });
}

function buildHeaderFooter(
  texts: string[] | undefined,
  includeDynamicPageNumber: boolean,
  isFooter: boolean
): Header | Footer | undefined {
  const cleaned = (texts || [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (cleaned.length === 0 && !includeDynamicPageNumber) return undefined;

  const combined = cleaned.join('  •  ');
  const hasPageWord = /\bpage\s*\d+|\b\d+\s*(?:\/|of)\s*\d+\b/i.test(combined);

  const runs: ParagraphChild[] = [];
  if (combined && !(isFooter && hasPageWord)) {
    runs.push(
      new TextRun({
        text: combined + (isFooter && includeDynamicPageNumber ? '   |   ' : ''),
        size: 18,
        color: '6E667D',
      })
    );
  }
  if (isFooter && (includeDynamicPageNumber || hasPageWord)) {
    runs.push(
      new TextRun({
        children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
        size: 18,
        color: '6E667D',
      })
    );
  }

  if (runs.length === 0) return undefined;

  const para = new Paragraph({
    alignment: isFooter ? AlignmentType.CENTER : AlignmentType.END,
    children: runs,
  });

  return isFooter
    ? new Footer({ children: [para] })
    : new Header({ children: [para] });
}

/**
 * Merges a multi-page table that is cleanly split across the boundary between Page N (bottom)
 * and Page N+1 (top) with identical column count into a single continuous editable Word table.
 */
function mergeMultiPageTablesAcrossPages(pages: PdfPageWordContent[]): {
  normalizedPages: PdfPageWordContent[];
  mergedCount: number;
} {
  let mergedCount = 0;
  const cloned: PdfPageWordContent[] = pages.map((p) => ({
    ...p,
    richTables: p.richTables ? p.richTables.map((t) => ({ ...t, rows: [...t.rows] })) : [],
    styledBlocks: p.styledBlocks ? [...p.styledBlocks] : [],
  }));

  for (let i = 0; i < cloned.length - 1; i++) {
    const cur = cloned[i];
    const next = cloned[i + 1];
    if (
      !cur.richTables?.length ||
      !next.richTables?.length ||
      cur.multiColumnDetected ||
      next.multiColumnDetected
    ) {
      continue;
    }
    const lastTbl = cur.richTables[cur.richTables.length - 1];
    const firstTbl = next.richTables[0];
    const curH = cur.heightPt || 842;
    const nextH = next.heightPt || 842;

    const curBodyBlocks = (cur.styledBlocks || []).filter(
      (b) => b.kind !== 'header' && b.kind !== 'footer'
    );
    const nextBodyBlocks = (next.styledBlocks || []).filter(
      (b) => b.kind !== 'header' && b.kind !== 'footer'
    );

    const noBlocksAfterLastTbl = !curBodyBlocks.some(
      (b) => b.yTopPt > lastTbl.yBottomPt + 6
    );
    const noBlocksBeforeFirstTbl = !nextBodyBlocks.some(
      (b) => b.yBottomPt < firstTbl.yTopPt - 6
    );

    const sameCols =
      lastTbl.colWidthPcts.length > 0 &&
      lastTbl.colWidthPcts.length === firstTbl.colWidthPcts.length &&
      lastTbl.colWidthPcts.every(
        (w, idx) => Math.abs(w - firstTbl.colWidthPcts[idx]) <= 12
      );

    if (
      noBlocksAfterLastTbl &&
      noBlocksBeforeFirstTbl &&
      sameCols &&
      lastTbl.yBottomPt >= curH * 0.65 &&
      firstTbl.yTopPt <= nextH * 0.28
    ) {
      // Skip duplicate header row if Page N+1 repeated Page N's first row verbatim
      const lastFirstRowText = lastTbl.rows[0]?.map((c) => c.text.trim()).join('|');
      const nextFirstRowText = firstTbl.rows[0]?.map((c) => c.text.trim()).join('|');
      const rowsToAppend =
        lastFirstRowText && lastFirstRowText === nextFirstRowText
          ? firstTbl.rows.slice(1)
          : firstTbl.rows;

      lastTbl.rows.push(...rowsToAppend);
      lastTbl.rowHeightsPt = [
        ...(lastTbl.rowHeightsPt || []),
        ...(firstTbl.rowHeightsPt?.slice(
          lastFirstRowText === nextFirstRowText ? 1 : 0
        ) || []),
      ];
      firstTbl.continuesFromPrevPage = true;
      next.richTables.shift();
      mergedCount++;
    }
  }

  return { normalizedPages: cloned, mergedCount };
}

/**
 * Builds a professional Microsoft Word `.docx` document (`Uint8Array`) preserving
 * true Word tables, native OMML equations, diagram/photo crops, multi-column sections,
 * page size & orientation, headers/footers, fonts, colors, highlights, lists, and scanned OCR.
 */
export async function buildDocxFromPdfPages(
  pages: PdfPageWordContent[],
  mode: PdfToWordMode,
  documentTitle: string
): Promise<Uint8Array> {
  if (!pages || pages.length === 0) {
    const emptyDoc = new Document({
      title: documentTitle || 'Converted Document',
      creator: 'ElimikaPDF',
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: documentTitle || 'Converted Document',
                  bold: true,
                  size: 28,
                }),
              ],
            }),
          ],
        },
      ],
    });
    const blob = await Packer.toBlob(emptyDoc);
    return new Uint8Array(await blob.arrayBuffer());
  }

  const { normalizedPages } = mergeMultiPageTablesAcrossPages(pages);

  // Build ordered Word children per page, then group compatible consecutive pages into Word sections
  // so landscape vs portrait pages, custom page dimensions, and 2-column layouts get exact Word section settings.
  interface SectionBucket {
    widthTwips: number;
    heightTwips: number;
    orientation: (typeof PageOrientation)[keyof typeof PageOrientation];
    marginTop: number;
    marginBottom: number;
    marginLeft: number;
    marginRight: number;
    columnCount: 1 | 2;
    headerTexts?: string[];
    footerTexts?: string[];
    children: FileChild[];
  }

  const buckets: SectionBucket[] = [];

  for (let pIdx = 0; pIdx < normalizedPages.length; pIdx++) {
    const page = normalizedPages[pIdx];
    const wPt = page.widthPt || 595.28;
    const hPt = page.heightPt || 841.89;
    const orientation =
      page.orientation === 'landscape' || wPt > hPt
        ? PageOrientation.LANDSCAPE
        : PageOrientation.PORTRAIT;
    const widthTwips = Math.max(2880, Math.round(wPt * 20));
    const heightTwips = Math.max(2880, Math.round(hPt * 20));
    const mTop = Math.round((mode === 'visual' ? 18 : page.marginTopPt || 50) * 20);
    const mBottom = Math.round((mode === 'visual' ? 18 : page.marginBottomPt || 50) * 20);
    const mLeft = Math.round((mode === 'visual' ? 18 : page.marginLeftPt || 54) * 20);
    const mRight = Math.round((mode === 'visual' ? 18 : page.marginRightPt || 54) * 20);
    const contentWidthTwips = Math.max(2880, widthTwips - mLeft - mRight);

    const hasRichData =
      (page.styledBlocks && page.styledBlocks.length > 0) ||
      (page.richTables && page.richTables.length > 0) ||
      (page.diagramRegions && page.diagramRegions.length > 0);

    const hasEditableText =
      (page.styledBlocks || []).some(
        (b) => b.kind !== 'header' && b.kind !== 'footer' && b.text.trim().length > 0
      ) || page.paragraphs.some((p) => p.text.trim().length > 0);

    const columnCount: 1 | 2 =
      mode !== 'visual' && page.multiColumnDetected ? 2 : 1;

    // Group consecutive pages into same Word section ONLY if mode != 'visual' and geometry/columns match
    const lastBucket = buckets[buckets.length - 1];
    const canShareSection =
      mode !== 'visual' &&
      lastBucket &&
      lastBucket.orientation === orientation &&
      Math.abs(lastBucket.widthTwips - widthTwips) <= 80 &&
      Math.abs(lastBucket.heightTwips - heightTwips) <= 80 &&
      lastBucket.columnCount === columnCount;

    let targetBucket: SectionBucket;
    if (canShareSection && lastBucket) {
      lastBucket.children.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
      targetBucket = lastBucket;
    } else {
      targetBucket = {
        widthTwips,
        heightTwips,
        orientation,
        marginTop: mTop,
        marginBottom: mBottom,
        marginLeft: mLeft,
        marginRight: mRight,
        columnCount,
        headerTexts: page.headerTexts,
        footerTexts: page.footerTexts,
        children: [],
      };
      buckets.push(targetBucket);
    }

    const pageChildren: FileChild[] = [];

    if (mode === 'visual') {
      if (page.imageDataUrl) {
        try {
          const { bytes, type } = decodeDataUrlBytes(page.imageDataUrl);
          const maxImgW = Math.round((wPt - 36) * 0.96);
          const srcW = page.width || maxImgW;
          const srcH = page.height || Math.round(hPt);
          const targetW = Math.min(maxImgW, 640);
          const targetH = Math.round((srcH / srcW) * targetW);
          pageChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  data: bytes,
                  transformation: { width: targetW, height: targetH },
                  type,
                }),
              ],
            })
          );
        } catch {
          // Fallback to editable text if image decode fails
        }
      }
      if (pageChildren.length === 0 && hasEditableText) {
        for (const para of page.paragraphs) {
          pageChildren.push(new Paragraph({ text: para.text }));
        }
      }
      targetBucket.children.push(...pageChildren);
      continue;
    }

    // Mode is 'hybrid' (Balanced default) or 'editable'
    if (hasRichData) {
      type FlowElement =
        | { yPt: number; kind: 'block'; block: PdfWordBlock }
        | { yPt: number; kind: 'table'; table: PdfWordTable }
        | { yPt: number; kind: 'diagram'; diagram: PdfWordDiagramRegion };

      const flow: FlowElement[] = [];

      for (const blk of page.styledBlocks || []) {
        if (blk.kind === 'header' || blk.kind === 'footer') continue;
        flow.push({ yPt: blk.yTopPt, kind: 'block', block: blk });
      }
      for (const tbl of page.richTables || []) {
        flow.push({ yPt: tbl.yTopPt, kind: 'table', table: tbl });
      }
      for (const diag of page.diagramRegions || []) {
        if (diag.kind === 'formula-fallback' && !diag.imageDataUrl) continue;
        flow.push({ yPt: diag.yPt, kind: 'diagram', diagram: diag });
      }

      // Preserve 2-column order if columns exist (left col top->bottom before right col top->bottom), otherwise strict top->bottom
      flow.sort((a, b) => {
        const aCol = a.kind === 'block' ? a.block.columnIndex ?? -1 : -1;
        const bCol = b.kind === 'block' ? b.block.columnIndex ?? -1 : -1;
        if (aCol !== -1 && bCol !== -1 && aCol !== bCol) {
          return aCol - bCol;
        }
        return a.yPt - b.yPt;
      });

      const effectiveTableWidth =
        columnCount === 2 ? Math.round(contentWidthTwips * 0.92) : contentWidthTwips;

      for (const item of flow) {
        if (item.kind === 'table') {
          pageChildren.push(buildDocxTableFromRichTable(item.table, effectiveTableWidth));
          pageChildren.push(new Paragraph({ spacing: { before: 40, after: 80 }, text: '' }));
        } else if (item.kind === 'diagram') {
          if (item.diagram.imageDataUrl) {
            try {
              const { bytes, type } = decodeDataUrlBytes(item.diagram.imageDataUrl);
              const targetW = Math.max(
                48,
                Math.min(460, Math.round(item.diagram.widthPt * 0.92))
              );
              const targetH = Math.max(
                32,
                Math.round(
                  (item.diagram.heightPt / Math.max(1, item.diagram.widthPt)) * targetW
                )
              );
              pageChildren.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 80, after: 100 },
                  children: [
                    new ImageRun({
                      data: bytes,
                      transformation: { width: targetW, height: targetH },
                      type,
                    }),
                  ],
                })
              );
            } catch {
              // Skip unreadable image bytes
            }
          } else {
            // Headless non-DOM placeholder note when no canvas crop was available
            pageChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60, after: 80 },
                shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                children: [
                  new TextRun({
                    text: `[${item.diagram.kind === 'photo' ? 'Figure / Image' : 'Diagram / Drawing'}: ${Math.round(item.diagram.widthPt)}×${Math.round(item.diagram.heightPt)}pt]`,
                    italics: true,
                    size: 19,
                    color: '475569',
                  }),
                ],
              })
            );
          }
        } else {
          const blk = item.block;
          if (blk.kind === 'equation') {
            if (blk.equationInfo && !blk.equationInfo.ommlSupported && blk.equationInfo.fallbackImageDataUrl) {
              try {
                const { bytes, type } = decodeDataUrlBytes(blk.equationInfo.fallbackImageDataUrl);
                pageChildren.push(
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 60, after: 100 },
                    children: [
                      new ImageRun({
                        data: bytes,
                        transformation: { width: 320, height: 64 },
                        type,
                      }),
                    ],
                  })
                );
                continue;
              } catch {
                // Fall through to OMML
              }
            }
            const ommlRes = buildOmmlParagraph(
              blk.text,
              blk.align === 'justify' ? 'center' : blk.align
            );
            pageChildren.push(ommlRes.paragraph);
          } else {
            pageChildren.push(buildDocxParagraphFromStyledBlock(blk));
          }
        }
      }
    } else if (hasEditableText) {
      // Support user-edited textarea paragraphs cleanly when styledBlocks weren't present (e.g. OCR edited pages)
      for (const para of page.paragraphs) {
        const clean = para.text.trim();
        if (!clean) continue;
        if (isMathOrEquationLine(clean)) {
          pageChildren.push(buildOmmlParagraph(clean, 'center').paragraph);
        } else if (para.isHeading) {
          pageChildren.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 160, after: 100 },
              children: [
                new TextRun({
                  text: clean,
                  bold: true,
                  size: Math.max(26, Math.round((para.fontSize || 14) * 2)),
                  color: '14101B',
                }),
              ],
            })
          );
        } else {
          pageChildren.push(
            new Paragraph({
              spacing: { after: 140, line: 276 },
              children: [
                new TextRun({
                  text: clean,
                  font: 'Calibri',
                  size: 22,
                  color: '1F1B24',
                }),
              ],
            })
          );
        }
      }
    }

    // In Balanced ('hybrid') mode: include full visual page reference snapshot ONLY when page is scanned,
    // OCR-only, or contains complex vector/embedded visuals not completely captured via individual crops.
    const uncroppedGraphicsExist =
      ((page.vectorGraphicCount || 0) > 0 || (page.embeddedImageCount || 0) > 0) &&
      (!page.diagramRegions || page.diagramRegions.every((d) => !d.imageDataUrl));

    if (
      page.imageDataUrl &&
      (page.isScannedPage ||
        !hasEditableText ||
        (mode === 'hybrid' && uncroppedGraphicsExist))
    ) {
      try {
        const { bytes, type } = decodeDataUrlBytes(page.imageDataUrl);
        const srcW = page.width || 600;
        const srcH = page.height || 840;
        const targetW = 500;
        const targetH = Math.round((srcH / srcW) * targetW);
        pageChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 140, after: 140 },
            children: [
              new ImageRun({
                data: bytes,
                transformation: { width: targetW, height: targetH },
                type,
              }),
            ],
          })
        );
      } catch {
        // Non-fatal snapshot failure
      }
    }

    targetBucket.children.push(...pageChildren);
  }

  const sections: ISectionOptions[] = buckets.map((b, bIdx) => {
    const hdr = buildHeaderFooter(b.headerTexts, false, false);
    const ftr = buildHeaderFooter(
      b.footerTexts,
      mode !== 'visual' && normalizedPages.length > 1,
      true
    );

    return {
      headers: hdr ? { default: hdr } : undefined,
      footers: ftr ? { default: ftr } : undefined,
      properties: {
        type: bIdx === 0 ? undefined : SectionType.NEXT_PAGE,
        page: {
          size: {
            width: b.widthTwips,
            height: b.heightTwips,
            orientation: b.orientation,
          },
          margin: {
            top: b.marginTop,
            bottom: b.marginBottom,
            left: b.marginLeft,
            right: b.marginRight,
          },
        },
        column:
          b.columnCount === 2
            ? { count: 2, space: 480, equalWidth: true }
            : undefined,
      },
      children:
        b.children.length > 0
          ? b.children
          : [new Paragraph({ text: documentTitle || 'Page' })],
    };
  });

  const doc = new Document({
    title: documentTitle || 'Converted Document',
    creator: 'ElimikaPDF',
    sections,
  });

  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- CONVERSION QUALITY REPORT & SIDE-BY-SIDE VISUAL PREVIEW ----------

export function buildPdfToWordQualityReport(
  pages: PdfPageWordContent[],
  mode: PdfToWordMode
): WordConversionQualityReport {
  const { mergedCount } = mergeMultiPageTablesAcrossPages(pages);
  const uniqueColors = new Set<string>();
  const fontSubMap = new Map<string, PdfWordFontSubstitution>();
  const pageMetrics: WordPageQualityMetric[] = [];
  const docWarnings: string[] = [];

  let totalWords = 0;
  let totalTables = 0;
  let borderedTables = 0;
  let borderlessTables = 0;
  let totalOmml = 0;
  let totalFallbackEq = 0;
  let totalDiagrams = 0;
  let multiColumnPages = 0;
  let scannedPagesDetected = 0;
  let ocrPagesProcessed = 0;

  let prevSectionKey = '';
  let sectionCount = 0;

  for (const p of pages) {
    (p.uniqueColorsHex || []).forEach((c) => uniqueColors.add(c));
    (p.fontSubstitutions || []).forEach((fs) => {
      const k = `${fs.pdfFontName}|${fs.wordFontFamily}|${fs.bold}|${fs.italic}`;
      const existing = fontSubMap.get(k);
      if (existing) {
        if (!existing.pageNumbers.includes(p.pageNumber)) {
          existing.pageNumbers.push(p.pageNumber);
        }
      } else {
        fontSubMap.set(k, { ...fs, pageNumbers: [...fs.pageNumbers] });
      }
    });

    const secKey = `${p.orientation || 'portrait'}|${Math.round((p.widthPt || 595) / 5)}|${p.multiColumnDetected ? 2 : 1}`;
    if (secKey !== prevSectionKey || mode === 'visual') {
      sectionCount++;
      prevSectionKey = secKey;
    }

    const words = p.paragraphs
      .map((pr) => pr.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length;
    const pTables = p.richTables || [];
    const pBordered = pTables.filter((t) => t.hasExplicitGridRules).length;
    const pBorderless = pTables.length - pBordered;
    const pOmml = (p.equations || []).filter((e) => e.ommlSupported).length;
    const pFallbackEq = (p.equations || []).filter((e) => !e.ommlSupported).length;
    const pDiagrams = (p.diagramRegions || []).filter(
      (d) => d.kind !== 'formula-fallback'
    ).length;

    const pWarnings: string[] = [];
    if (p.isScannedPage && !p.ocrApplied) {
      pWarnings.push('Scanned image page — preserved visually (run Auto-OCR for editable text).');
    }
    if (pFallbackEq > 0) {
      pWarnings.push(
        `${pFallbackEq} complex equation(s) preserved with visual fallback alongside notation.`
      );
    }
    if ((p.vectorGraphicCount || 0) > 0 && pDiagrams === 0 && mode === 'editable') {
      pWarnings.push('Vector graphics detected — use Balanced mode to ensure diagram retention.');
    }

    let score = 98;
    if (p.isScannedPage && !p.ocrApplied) score -= 12;
    if (pFallbackEq > 0) score -= Math.min(8, pFallbackEq * 2);

    totalWords += words;
    totalTables += pTables.length;
    borderedTables += pBordered;
    borderlessTables += pBorderless;
    totalOmml += pOmml;
    totalFallbackEq += pFallbackEq;
    totalDiagrams += pDiagrams;
    if (p.multiColumnDetected) multiColumnPages++;
    if (p.isScannedPage) scannedPagesDetected++;
    if (p.ocrApplied) ocrPagesProcessed++;

    pageMetrics.push({
      pageNumber: p.pageNumber,
      widthPt: p.widthPt || 595,
      heightPt: p.heightPt || 842,
      orientation: p.orientation || 'portrait',
      wordCount: words,
      tableCount: pTables.length,
      borderedTableCount: pBordered,
      borderlessTableCount: pBorderless,
      ommlEquationCount: pOmml,
      visualFallbackEquationCount: pFallbackEq,
      diagramCount: pDiagrams,
      embeddedImageCount: p.embeddedImageCount || 0,
      colorCount: p.uniqueColorsHex?.length || 0,
      multiColumnDetected: Boolean(p.multiColumnDetected),
      isScannedPage: Boolean(p.isScannedPage),
      ocrApplied: Boolean(p.ocrApplied),
      fidelityScore: Math.max(70, Math.min(100, score)),
      warnings: pWarnings,
    });
  }

  if (scannedPagesDetected > 0 && ocrPagesProcessed === 0) {
    docWarnings.push(
      `${scannedPagesDetected} scanned page(s) embedded visually; enable Auto-OCR to extract editable text.`
    );
  }
  if (totalFallbackEq > 0) {
    docWarnings.push(
      `${totalFallbackEq} complex 2D mathematical formula(s) flagged for visual preservation.`
    );
  }

  const avgFidelity = pageMetrics.length
    ? Math.round(
        pageMetrics.reduce((s, p) => s + p.fidelityScore, 0) / pageMetrics.length
      )
    : 100;

  return {
    mode,
    totalSourcePages: pages.length,
    totalWordSections: Math.max(1, sectionCount),
    pageCountMatched: pages.length > 0,
    totalWordsExtracted: totalWords,
    totalTablesReconstructed: totalTables,
    borderedTables,
    borderlessTables,
    multiPageTablesMerged: mergedCount,
    totalOmmlEquations: totalOmml,
    totalFallbackEquationImages: totalFallbackEq,
    totalDiagramsPreserved: totalDiagrams,
    totalColorsPreserved: uniqueColors.size,
    uniqueColorsHex: Array.from(uniqueColors),
    multiColumnPages,
    scannedPagesDetected,
    ocrPagesProcessed,
    overallFidelityScore: avgFidelity,
    fontSubstitutions: Array.from(fontSubMap.values()),
    pages: pageMetrics,
    warnings: docWarnings,
    generatedAt: new Date().toISOString(),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates an accurate visual HTML representation of the converted Word page
 * (headings, colored spans, shaded/bordered tables, equations, and cropped diagrams)
 * for side-by-side comparison against the original PDF page image.
 */
export function buildWordPagePreviewHtml(
  page: PdfPageWordContent,
  mode: PdfToWordMode
): string {
  if (mode === 'visual' && page.imageDataUrl) {
    return `<div style="text-align:center;"><img src="${page.imageDataUrl}" style="max-width:100%;height:auto;border-radius:4px;" /></div>`;
  }

  const parts: string[] = [];
  if (page.headerTexts?.length) {
    parts.push(
      `<div style="font-size:10px;color:#6E667D;text-align:right;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:8px;">${escapeHtml(page.headerTexts.join(' • '))}</div>`
    );
  }

  const tables = page.richTables || [];
  const blocks = (page.styledBlocks || []).filter(
    (b) => b.kind !== 'header' && b.kind !== 'footer'
  );
  const diagrams = (page.diagramRegions || []).filter(
    (d) => d.kind !== 'formula-fallback'
  );

  type PreviewItem =
    | { y: number; kind: 'block'; b: PdfWordBlock }
    | { y: number; kind: 'table'; t: PdfWordTable }
    | { y: number; kind: 'diag'; d: PdfWordDiagramRegion };

  const flow: PreviewItem[] = [
    ...blocks.map((b) => ({ y: b.yTopPt, kind: 'block' as const, b })),
    ...tables.map((t) => ({ y: t.yTopPt, kind: 'table' as const, t })),
    ...diagrams.map((d) => ({ y: d.yPt, kind: 'diag' as const, d })),
  ].sort((a, b) => a.y - b.y);

  for (const item of flow) {
    if (item.kind === 'table') {
      const bColor = item.t.hasExplicitGridRules ? item.t.borderColorHex || '#94a3b8' : '#e2e8f0';
      const rowsHtml = item.t.rows
        .map((r, rIdx) => {
          const cellsHtml = r
            .map((c) => {
              const tag = rIdx === 0 ? 'th' : 'td';
              const bg = c.bgColorHex || (rIdx === 0 && !item.t.hasExplicitGridRules ? '#f1f5f9' : 'transparent');
              const colspanAttr = c.colSpan && c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '';
              return `<${tag}${colspanAttr} style="border:${item.t.hasExplicitGridRules ? `1px solid ${bColor}` : `1px dashed ${bColor}`};padding:4px 6px;text-align:${c.align};background:${bg};color:${c.colorHex || '#1e293b'};font-weight:${c.bold ? '700' : '400'};font-size:11px;">${escapeHtml(c.text)}</${tag}>`;
            })
            .join('');
          return `<tr>${cellsHtml}</tr>`;
        })
        .join('');
      parts.push(
        `<table style="width:100%;border-collapse:collapse;margin:8px 0;">${rowsHtml}</table>`
      );
    } else if (item.kind === 'diag') {
      if (item.d.imageDataUrl) {
        parts.push(
          `<div style="text-align:center;margin:8px 0;"><img src="${item.d.imageDataUrl}" style="max-width:88%;height:auto;border:1px solid #e2e8f0;border-radius:4px;" /></div>`
        );
      } else {
        parts.push(
          `<div style="text-align:center;padding:8px;margin:8px 0;background:#f8fafc;border:1px dashed #cbd5e1;font-size:11px;color:#475569;">[${escapeHtml(item.d.kind)}]</div>`
        );
      }
    } else {
      const b = item.b;
      if (b.kind === 'equation') {
        parts.push(
          `<div style="text-align:center;margin:8px 0;padding:4px 8px;background:#eff6ff;border-radius:4px;font-family:'Cambria Math',serif;font-style:italic;color:#1e3a8a;font-size:12px;">∑ OMML: ${escapeHtml(b.text)}</div>`
        );
      } else {
        const spansHtml = b.spans.length
          ? b.spans
              .map((s) => {
                const tag = s.script === 'sup' ? 'sup' : s.script === 'sub' ? 'sub' : 'span';
                return `<${tag} style="color:${s.colorHex};background:${s.highlightHex || 'transparent'};font-weight:${s.bold ? '700' : '400'};font-style:${s.italic ? 'italic' : 'normal'};font-size:${Math.max(9, Math.min(18, Math.round(s.fontSizePt)))}px;">${escapeHtml(s.text)}</${tag}>`;
              })
              .join(' ')
          : escapeHtml(b.text);
        const tag = b.kind === 'heading' ? `h${b.headingLevel || 2}` : 'p';
        parts.push(
          `<${tag} style="margin:4px 0;text-align:${b.align};padding-left:${Math.round(b.indentLeftPt * 0.6)}px;">${spansHtml}</${tag}>`
        );
      }
    }
  }

  if (flow.length === 0 && page.paragraphs.length > 0) {
    for (const p of page.paragraphs) {
      parts.push(`<p style="margin:4px 0;font-size:11.5px;">${escapeHtml(p.text)}</p>`);
    }
  }

  if (page.footerTexts?.length) {
    parts.push(
      `<div style="font-size:10px;color:#6E667D;text-align:center;border-top:1px solid #e5e7eb;padding-top:4px;margin-top:8px;">${escapeHtml(page.footerTexts.join(' • '))}</div>`
    );
  }

  return `<div style="background:${page.pageBackgroundColorHex || '#ffffff'};padding:12px;border-radius:6px;line-height:1.45;">${parts.join('')}</div>`;
}
