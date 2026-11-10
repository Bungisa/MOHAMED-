export type ActiveView =
  | 'dashboard'
  | 'scanner'
  | 'editor'
  | 'tools'
  | 'documents'
  | 'settings'
  | 'help';

export type ToolId =
  | 'scan-to-pdf'
  | 'edit-pdf'
  | 'merge-pdf'
  | 'split-pdf'
  | 'compress-pdf'
  | 'img-to-pdf'
  | 'pdf-to-img'
  | 'word-to-pdf'
  | 'pdf-to-word'
  | 'rotate-pdf'
  | 'organize-pdf'
  | 'ocr-pdf'
  | 'security-pdf';

export type DocumentCategory =
  | 'Scans'
  | 'Contracts'
  | 'Receipts'
  | 'Forms'
  | 'Reports'
  | 'Other';

export type AnnotationType =
  | 'text'
  | 'image'
  | 'draw'
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'comment'
  | 'whiteout';

export interface NativeTextBlock {
  id: string;
  pageNumber: number;
  text: string;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
  fontSize: number;
}

export interface AnnotationElement {
  id: string;
  pageNumber: number; // 1-indexed
  type: AnnotationType;
  x: number; // normalized 0..1 relative to page width
  y: number; // normalized 0..1 relative to page height
  width: number; // normalized 0..1
  height: number; // normalized 0..1
  endX?: number; // for line/arrow normalized 0..1
  endY?: number; // for line/arrow normalized 0..1
  points?: { x: number; y: number }[]; // for freehand 'draw' tool (normalized 0..1)
  text?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  backgroundColor?: string;
  color: string;
  fillColor?: string;
  strokeWidth?: number;
  opacity?: number;
  imageDataUrl?: string;
  author?: string;
  createdAt?: string;
  replacesNativeTextId?: string;
  origRect?: { x: number; y: number; width: number; height: number };
  origBgDataUrl?: string;
  isBackgroundRestorePatch?: boolean;
}

export interface StoredDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  folderId?: string | null;
  starred: boolean;
  sizeBytes: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  pdfData: Uint8Array;
  basePdfData?: Uint8Array; // Clean base PDF before overlay baking so saved annotations/pictures can be removed later
  thumbnailDataUrl?: string;
  annotations?: AnnotationElement[];
  appliedFilter?: ScanFilterType;
  appliedBrightness?: number;
  appliedContrast?: number;
  watermarkText?: string;
  addPageNumbers?: boolean;
  ocrText?: string;
  isProtected?: boolean;
  protectionHint?: string;
}

export interface DocumentFolder {
  id: string;
  name: string;
  createdAt: string;
  color: string;
}

export interface Point2D {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
}

export type ScanFilterType =
  | 'original'
  | 'ocv-black'
  | 'vivid-light'
  | 'magic'
  | 'grayscale'
  | 'bw'
  | 'shadow-clean';

export interface ScanPage {
  id: string;
  originalDataUrl: string;
  croppedDataUrl: string;
  processedDataUrl: string;
  corners: [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL
  filter: ScanFilterType;
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  rotation: number; // 0, 90, 180, 270
  width: number;
  height: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppPreferences {
  theme: ThemeMode;
  defaultPageSize: 'A4' | 'Letter' | 'Fit';
  defaultScanFilter: ScanFilterType;
  defaultOcrLang: 'eng' | 'swa' | 'eng+swa';
  autoDetectEdges: boolean;
  showWatermarkByDefault: boolean;
}
