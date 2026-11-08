import { openDB, IDBPDatabase } from 'idb';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  StoredDocument,
  DocumentFolder,
  AppPreferences,
  DocumentCategory,
} from '../types/document';

const DB_NAME = 'scanpro_studio_db';
const DB_VERSION = 1;
const DOCS_STORE = 'documents';
const FOLDERS_STORE = 'folders';
const PREFS_KEY = 'scanpro_preferences_v1';

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'light',
  defaultPageSize: 'A4',
  defaultScanFilter: 'magic',
  defaultOcrLang: 'eng',
  autoDetectEdges: true,
  showWatermarkByDefault: false,
};

/**
 * Abstract Storage Repository interface designed so Supabase or another
 * cloud backend can be plugged in alongside IndexedDB.
 */
export interface IDocumentRepository {
  getAllDocuments(): Promise<StoredDocument[]>;
  getDocumentById(id: string): Promise<StoredDocument | undefined>;
  saveDocument(doc: StoredDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  clearAllDocuments(): Promise<void>;
  getFolders(): Promise<DocumentFolder[]>;
  saveFolder(folder: DocumentFolder): Promise<void>;
  deleteFolder(id: string): Promise<void>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DOCS_STORE)) {
          const store = db.createObjectStore(DOCS_STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('category', 'category');
          store.createIndex('folderId', 'folderId');
        }
        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export const storageService: IDocumentRepository = {
  async getAllDocuments(): Promise<StoredDocument[]> {
    const db = await getDb();
    const docs: StoredDocument[] = await db.getAll(DOCS_STORE);
    return docs.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  async getDocumentById(id: string): Promise<StoredDocument | undefined> {
    const db = await getDb();
    return db.get(DOCS_STORE, id);
  },

  async saveDocument(doc: StoredDocument): Promise<void> {
    const db = await getDb();
    await db.put(DOCS_STORE, doc);
  },

  async deleteDocument(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(DOCS_STORE, id);
  },

  async clearAllDocuments(): Promise<void> {
    const db = await getDb();
    await db.clear(DOCS_STORE);
  },

  async getFolders(): Promise<DocumentFolder[]> {
    const db = await getDb();
    const folders: DocumentFolder[] = await db.getAll(FOLDERS_STORE);
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveFolder(folder: DocumentFolder): Promise<void> {
    const db = await getDb();
    await db.put(FOLDERS_STORE, folder);
  },

  async deleteFolder(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(FOLDERS_STORE, id);
  },
};

export function loadPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: AppPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error('Failed to save preferences:', err);
  }
}

/**
 * Generates realistic, multi-page sample PDF documents using pdf-lib on first launch
 * so the user can immediately test Viewing, Editing, Merging, Splitting, Compressing, and OCR.
 */
export async function seedInitialDocumentsIfEmpty(): Promise<StoredDocument[]> {
  const existing = await storageService.getAllDocuments();
  if (existing.length > 0) {
    return existing;
  }

  const folders: DocumentFolder[] = [
    {
      id: 'folder-finance',
      name: 'Finance & Tax 2026',
      createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
      color: '#4A1D5E',
    },
    {
      id: 'folder-legal',
      name: 'Client Agreements',
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      color: '#0D9488',
    },
    {
      id: 'folder-scans',
      name: 'Field Receipts',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      color: '#D97706',
    },
  ];

  for (const folder of folders) {
    await storageService.saveFolder(folder);
  }

  // Sample 1: Service Agreement Contract (3 Pages)
  const contractPdf = await createSamplePdfDocument({
    title: 'Master Software & Advisory Agreement',
    subtitle: 'Document Ref: SPA-2026-089 · Prepared for Meridian Logistics Ltd.',
    pages: [
      [
        '1. SCOPE OF PROFESSIONAL SERVICES',
        'This Master Software & Advisory Agreement ("Agreement") is entered into as of November 6, 2026',
        'between ScanPro Enterprise Studio ("Provider") and Meridian Logistics Ltd. ("Client").',
        '',
        'Provider agrees to deliver local-first document digitization, optical character recognition (OCR),',
        'and cryptographic PDF archiving workflows across Client regional offices in Nairobi, Dar es Salaam,',
        'and London.',
        '',
        '2. DELIVERABLES & MILESTONES',
        '• Phase I: Deployment of browser-native camera scanning stations with automatic perspective warp.',
        '• Phase II: Bilingual OCR indexing supporting English and Swahili commercial invoices.',
        '• Phase III: Zero-trust local IndexedDB storage with optional encrypted cloud synchronization.',
      ],
      [
        '3. COMPENSATION & PAYMENT SCHEDULE',
        'Client shall remit fees in accordance with the following milestone schedule:',
        '',
        '• Initial Architecture & Setup Fee: $14,500.00 USD (Due upon execution)',
        '• Quarterly Enterprise Workstation License: $4,200.00 USD per quarter',
        '• Annual Maintenance & Security Audit: Included in base subscription',
        '',
        'All invoices are payable within thirty (30) calendar days of receipt via electronic wire transfer.',
        '',
        '4. DATA PRIVACY & LOCAL PROCESSING GUARANTEE',
        'All scanned contracts, financial disclosures, and employee records are processed strictly within',
        'the client browser sandbox unless explicitly exported by an authorized administrator.',
      ],
      [
        '5. TERM, TERMINATION & SIGNATURES',
        'This Agreement shall commence on the Effective Date and continue for an initial term of twenty-four',
        '(24) months. Either party may terminate with sixty (60) days written notice.',
        '',
        'IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.',
        '',
        '____________________________________          ____________________________________',
        'Authorized Representative (Client)            Authorized Representative (Provider)',
        'Name: Elena Rostova, VP Operations            Name: Marcus Vance, Principal Architect',
        'Date: November 6, 2026                        Date: November 6, 2026',
      ],
    ],
  });

  // Sample 2: Expense & Equipment Receipt Scan (1 Page)
  const receiptPdf = await createSamplePdfDocument({
    title: 'COMMERCIAL TAX INVOICE & RECEIPT',
    subtitle: 'Apex Optical & Imaging Hardware · Invoice #INV-90421',
    pages: [
      [
        'BILL TO: Studio Operations Department',
        'DATE: November 4, 2026 · CURRENCY: USD',
        '--------------------------------------------------------------------------------',
        'QTY   DESCRIPTION                                       UNIT PRICE      AMOUNT',
        '--------------------------------------------------------------------------------',
        '02    High-Speed Overhead Document Camera 4K             $380.00        $760.00',
        '04    Portable LED Diffused Illumination Mat             $95.00         $380.00',
        '01    Color Calibration Reference Target Card            $65.00          $65.00',
        '--------------------------------------------------------------------------------',
        'SUBTOTAL:                                                             $1,205.00',
        'VAT / SALES TAX (16%):                                                  $192.80',
        'TOTAL AMOUNT PAID:                                                    $1,397.80',
        '--------------------------------------------------------------------------------',
        'Payment Status: PAID IN FULL via Corporate Visa ending in 4829.',
        'Swahili Note: Risiti hii ni halali kwa kumbukumbu za kodi na ukaguzi wa hesabu.',
      ],
    ],
  });

  // Sample 3: Q4 Executive Field Inspection Report (2 Pages)
  const reportPdf = await createSamplePdfDocument({
    title: 'Q4 East Africa Port Logistics Audit Report',
    subtitle: 'Confidential Field Inspection · Prepared Nov 2026',
    pages: [
      [
        'EXECUTIVE SUMMARY',
        'During October 2026, our field inspection team digitized 1,420 customs waybills and',
        'container manifest forms using ScanPro mobile camera capture with perspective correction.',
        '',
        'KEY PERFORMANCE FINDINGS:',
        '• Average document capture-to-PDF time decreased from 4.2 minutes to 18 seconds.',
        '• Automatic corner detection succeeded on 96.4% of handheld smartphone captures.',
        '• Bilingual OCR (English + Swahili) accurately indexed 98.1% of printed manifest headers.',
      ],
      [
        'RECOMMENDED ACTION ITEMS FOR Q1 2027',
        '1. Standardize all customs declarations on A4 Black & White high-contrast filter to reduce',
        '   average PDF file size below 240 KB per multi-page packet.',
        '2. Apply standardized page numbering and "CONFIDENTIAL" watermarks prior to external',
        '   regulatory submission.',
        '3. Utilize the Merge PDF and Split PDF tools to bundle daily manifest batches by vessel ID.',
      ],
    ],
  });

  const sampleDocs: StoredDocument[] = [
    {
      id: 'doc-sample-contract',
      name: 'Master_Software_Advisory_Agreement.pdf',
      category: 'Contracts' as DocumentCategory,
      folderId: 'folder-legal',
      starred: true,
      sizeBytes: contractPdf.byteLength,
      pageCount: 3,
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      lastOpenedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      pdfData: contractPdf,
    },
    {
      id: 'doc-sample-receipt',
      name: 'Apex_Hardware_Tax_Receipt_INV90421.pdf',
      category: 'Receipts' as DocumentCategory,
      folderId: 'folder-scans',
      starred: false,
      sizeBytes: receiptPdf.byteLength,
      pageCount: 1,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      lastOpenedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      pdfData: receiptPdf,
    },
    {
      id: 'doc-sample-report',
      name: 'Q4_Port_Logistics_Audit_Report.pdf',
      category: 'Reports' as DocumentCategory,
      folderId: 'folder-finance',
      starred: true,
      sizeBytes: reportPdf.byteLength,
      pageCount: 2,
      createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 20).toISOString(),
      lastOpenedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      pdfData: reportPdf,
    },
  ];

  for (const doc of sampleDocs) {
    await storageService.saveDocument(doc);
  }

  return sampleDocs;
}

async function createSamplePdfDocument(config: {
  title: string;
  subtitle: string;
  pages: string[][];
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  config.pages.forEach((lines, pageIndex) => {
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();

    // Top Midnight Plum header accent bar
    page.drawRectangle({
      x: 48,
      y: height - 68,
      width: width - 96,
      height: 3,
      color: rgb(0.29, 0.11, 0.37),
    });

    page.drawText(config.title, {
      x: 48,
      y: height - 96,
      size: 17,
      font: fontBold,
      color: rgb(0.08, 0.06, 0.11),
    });

    page.drawText(config.subtitle, {
      x: 48,
      y: height - 116,
      size: 10,
      font: fontRegular,
      color: rgb(0.42, 0.39, 0.48),
    });

    let currentY = height - 158;
    for (const line of lines) {
      const isHeading =
        line === line.toUpperCase() && line.length > 3 && !line.startsWith('---');
      page.drawText(line, {
        x: 48,
        y: currentY,
        size: isHeading ? 11.5 : 10.5,
        font: isHeading ? fontBold : fontRegular,
        color: isHeading ? rgb(0.29, 0.11, 0.37) : rgb(0.15, 0.13, 0.18),
      });
      currentY -= isHeading ? 24 : 18;
    }

    // Footer
    page.drawText(
      `ScanPro Studio Verified Archive  ·  Page ${pageIndex + 1} of ${config.pages.length}`,
      {
        x: 48,
        y: 40,
        size: 9,
        font: fontRegular,
        color: rgb(0.5, 0.48, 0.55),
      }
    );
  });

  return pdfDoc.save({ useObjectStreams: false });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
