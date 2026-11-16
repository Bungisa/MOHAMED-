import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  Upload,
  FileSpreadsheet,
  Presentation,
  PenTool,
  Stamp,
  RotateCw,
  RotateCcw,
  Code2,
  Unlock,
  Archive,
  Wrench,
  Hash,
  GitCompare,
  EyeOff,
  Crop,
  FormInput,
  FileText,
  Languages,
  FileCode,
  Workflow,
  Plus,
  Trash2,
  Check,
  Copy,
  Sparkles,
  ArrowDown,
  Play,
} from 'lucide-react';
import { StoredDocument, ToolId } from '../types/document';
import {
  renderPdfPage,
  downloadBytesAsFile,
  extractAllPdfText,
  organizePdfPages,
  compressPdfDocument,
  removeWatermarksFromPdf,
} from '../services/pdfService';
import {
  plainTextToWordBlocks,
  generatePdfFromWordBlocks,
  parseHtmlIntoWordBlocks,
  sanitizeHtmlForReader,
  wordBlocksToCleanHtml,
} from '../services/wordConversionService';
import {
  addPageNumbersToPdf,
  PageNumberOptions,
  stampWatermarkOntoPdf,
  StampWatermarkOptions,
  signPdfDocument,
  cropPdfDocument,
  redactPdfDocument,
  RedactBoxSpec,
  repairPdfDocument,
  convertPdfToPdfA,
  unlockPdfDocument,
  buildFillablePdfForm,
  PdfFormFieldSpec,
  extractPdfToExcelRows,
  buildCsvBytesFromRows,
  buildExcelXmlBytesFromRows,
  convertSpreadsheetRowsToPdf,
  extractPdfToSlides,
  SlideDeckItem,
  buildPresentationPdfFromSlides,
  buildPowerPointHtmlBytes,
  convertPdfToMarkdownText,
  summarizePdfDocument,
  PdfSummaryResult,
  translateDocumentTextLocal,
  compareTwoPdfDocuments,
  PdfDiffLine,
  extractPdfToKindleChapters,
  buildKindleKpfPackageBytes,
  KindleKpfChapter,
  parseUploadedSpreadsheetFile,
  parseUploadedPresentationFile,
  convertAnyUploadedFileToPdfAndHtml,
  SUPPORTED_DOCUMENT_ACCEPT,
} from '../services/advancedPdfToolsService';
import { formatBytes } from '../services/storageService';

interface ExtendedPdfToolsWorkspacesProps {
  activeTool: ToolId;
  selectedDoc: StoredDocument | null;
  documents: StoredDocument[];
  isBusy: boolean;
  setIsBusy: (busy: boolean) => void;
  setFeedback: (msg: string | null) => void;
  onSaveNewDocument: (doc: StoredDocument) => Promise<void>;
  onUpdateDocument: (doc: StoredDocument) => Promise<void>;
  onOpenInEditor?: (doc: StoredDocument) => void;
  onSelectTool: (tool: ToolId) => void;
  onUploadPdfFiles?: (files: FileList | File[]) => Promise<void>;
  externalUploadedFile?: File | null;
}

export const ExtendedPdfToolsWorkspaces: React.FC<
  ExtendedPdfToolsWorkspacesProps
> = ({
  activeTool,
  selectedDoc,
  documents,
  isBusy,
  setIsBusy,
  setFeedback,
  onSaveNewDocument,
  onUpdateDocument,
  onOpenInEditor,
  onUploadPdfFiles,
  externalUploadedFile,
}) => {
  // Shared single-page preview URL for visual tools (Sign, Watermark, Crop, Redact, Forms, Page Numbers)
  const [previewPageNum, setPreviewPageNum] = useState(1);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');

  useEffect(() => {
    setPreviewPageNum(1);
  }, [selectedDoc?.id, activeTool]);

  useEffect(() => {
    let cancelled = false;
    const visualTools: ToolId[] = [
      'page-numbers-pdf',
      'watermark-pdf',
      'sign-pdf',
      'crop-pdf',
      'redact-pdf',
      'pdf-forms',
      'rotate-pdf',
    ];
    if (!selectedDoc || !visualTools.includes(activeTool)) return;

    const safePage = Math.max(
      1,
      Math.min(selectedDoc.pageCount || 1, previewPageNum)
    );
    (async () => {
      try {
        const rendered = await renderPdfPage(
          selectedDoc.pdfData,
          safePage,
          1.35,
          'image/jpeg',
          0.9
        );
        if (!cancelled) {
          setPreviewDataUrl(rendered.dataUrl);
        }
      } catch {
        // ignore preview error
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDoc, activeTool, previewPageNum]);

  // ==========================================================================
  // 1. PAGE NUMBERS STATE
  // ==========================================================================
  const [pageNumOpts, setPageNumOpts] = useState<PageNumberOptions>({
    position: 'bottom-center',
    format: 'page-of-total',
    startNumber: 1,
    fromPage: 1,
    toPage: selectedDoc?.pageCount || 1,
    fontSize: 11,
    fontFamily: 'helvetica',
    marginPt: 24,
    colorHex: '#14101B',
  });

  useEffect(() => {
    if (selectedDoc) {
      setPageNumOpts((prev) => ({
        ...prev,
        fromPage: 1,
        toPage: selectedDoc.pageCount,
      }));
    }
  }, [selectedDoc?.id]);

  const handleApplyPageNumbers = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const updatedBytes = await addPageNumbersToPdf(
        selectedDoc.pdfData,
        pageNumOpts
      );
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Numbered.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-pagenum-${Date.now()}`,
        name: outName,
        pdfData: updatedBytes,
        sizeBytes: updatedBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(updatedBytes, outName);
      setFeedback(
        `Added page numbers (${pageNumOpts.position}) to "${outName}" and downloaded.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 2. STAMP WATERMARK STATE
  // ==========================================================================
  const [stampOpts, setStampOpts] = useState<StampWatermarkOptions>({
    text: 'CONFIDENTIAL',
    position: 'diagonal',
    opacity: 0.22,
    fontSize: 44,
    colorHex: '#4A1D5E',
    rotationDeg: 38,
  });

  const handleApplyStampWatermark = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const stampedBytes = await stampWatermarkOntoPdf(
        selectedDoc.pdfData,
        stampOpts
      );
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Watermarked.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-wm-${Date.now()}`,
        name: outName,
        pdfData: stampedBytes,
        sizeBytes: stampedBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(stampedBytes, outName);
      setFeedback(
        `Stamped watermark "${stampOpts.text}" onto all ${selectedDoc.pageCount} page(s) and downloaded "${outName}".`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 3. SIGN PDF STATE (Interactive Signature Pad + Typed + Upload)
  // ==========================================================================
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [isDrawingSig, setIsDrawingSig] = useState(false);
  const [typedSigName, setTypedSigName] = useState('Mohamed Shabani');
  const [signerTitle, setSignerTitle] = useState('Authorized Signatory');
  const [sigIncludeDate, setSigIncludeDate] = useState(true);
  const [sigColor, setSigColor] = useState('#003FE8');
  const [sigPageScope, setSigPageScope] = useState<
    'last' | 'first' | 'all' | 'custom'
  >('last');
  const [sigPosition, setSigPosition] = useState<
    'bottom-right' | 'bottom-left' | 'bottom-center' | 'middle-right'
  >('bottom-right');
  const [uploadedSigDataUrl, setUploadedSigDataUrl] = useState<string>('');

  const clearSigCanvas = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleSigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = sigColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height
    );
    setIsDrawingSig(true);
  };

  const handleSigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height
    );
    ctx.stroke();
  };

  const handleApplySignatureToPdf = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      let signatureDataUrl: string | undefined;
      if (sigMode === 'draw' && sigCanvasRef.current) {
        signatureDataUrl = sigCanvasRef.current.toDataURL('image/png');
      } else if (sigMode === 'upload' && uploadedSigDataUrl) {
        signatureDataUrl = uploadedSigDataUrl;
      }

      const signedBytes = await signPdfDocument(selectedDoc.pdfData, {
        signatureDataUrl,
        typedName: typedSigName,
        signerTitle,
        includeDate: sigIncludeDate,
        colorHex: sigColor,
        pageScope: sigPageScope,
        customPageNumber: previewPageNum,
        position: sigPosition,
      });

      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Signed.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-signed-${Date.now()}`,
        name: outName,
        pdfData: signedBytes,
        sizeBytes: signedBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(signedBytes, outName);
      setFeedback(
        `Applied electronic signature to "${outName}" and downloaded!`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 4. CROP PDF STATE
  // ==========================================================================
  const [cropTop, setCropTop] = useState(6);
  const [cropBottom, setCropBottom] = useState(6);
  const [cropLeft, setCropLeft] = useState(5);
  const [cropRight, setCropRight] = useState(5);
  const [cropScope, setCropScope] = useState<'all' | 'current'>('all');

  const handleApplyCropPdf = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const croppedBytes = await cropPdfDocument(selectedDoc.pdfData, {
        topPct: cropTop,
        bottomPct: cropBottom,
        leftPct: cropLeft,
        rightPct: cropRight,
        scope: cropScope,
        currentPage: previewPageNum,
      });
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Cropped.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-crop-${Date.now()}`,
        name: outName,
        pdfData: croppedBytes,
        sizeBytes: croppedBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(croppedBytes, outName);
      setFeedback(`Cropped margins on "${outName}" and downloaded.`);
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 5. REDACT PDF STATE
  // ==========================================================================
  const [redactBoxes, setRedactBoxes] = useState<RedactBoxSpec[]>([]);
  const [redactTermsInput, setRedactTermsInput] = useState('');
  const [redactEmails, setRedactEmails] = useState(true);
  const [redactPhones, setRedactPhones] = useState(true);
  const [redactFillColor, setRedactFillColor] = useState<'#000000' | '#FFFFFF'>(
    '#000000'
  );

  const handleAddRedactBoxOnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    setRedactBoxes((prev) => [
      ...prev,
      {
        id: `red-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        pageNumber: previewPageNum,
        x: Math.max(0.02, Math.min(0.7, cx - 0.12)),
        y: Math.max(0.02, Math.min(0.92, cy - 0.02)),
        width: 0.28,
        height: 0.045,
      },
    ]);
  };

  const handleApplyRedaction = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const terms = redactTermsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const { pdfBytes, redactedCount } = await redactPdfDocument(
        selectedDoc.pdfData,
        {
          boxes: redactBoxes,
          searchTerms: terms,
          redactEmails,
          redactPhones,
          fillColor: redactFillColor,
        }
      );
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Redacted.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-redact-${Date.now()}`,
        name: outName,
        pdfData: pdfBytes,
        sizeBytes: pdfBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(pdfBytes, outName);
      setFeedback(
        `Permanently redacted ${redactedCount} sensitive item(s)/area(s) across "${outName}" and downloaded.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 6. PDF FORMS STATE
  // ==========================================================================
  const [formFields, setFormFields] = useState<PdfFormFieldSpec[]>([
    {
      id: 'fld-1',
      name: 'Full_Name',
      label: 'Full Name:',
      type: 'text',
      pageNumber: 1,
      x: 0.12,
      y: 0.18,
      width: 0.42,
      height: 0.036,
      defaultValue: '',
    },
    {
      id: 'fld-2',
      name: 'Approved_Check',
      label: 'Approved',
      type: 'checkbox',
      pageNumber: 1,
      x: 0.12,
      y: 0.26,
      width: 0.03,
      height: 0.03,
      checked: true,
    },
  ]);
  const [flattenFieldsOnExport, setFlattenFieldsOnExport] = useState(false);

  const handleBuildFormPdf = async () => {
    if (!selectedDoc) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const formPdfBytes = await buildFillablePdfForm(
        selectedDoc.pdfData,
        formFields,
        flattenFieldsOnExport
      );
      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Fillable_Form.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-form-${Date.now()}`,
        name: outName,
        pdfData: formPdfBytes,
        sizeBytes: formPdfBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(formPdfBytes, outName);
      setFeedback(
        `Created interactive PDF Form with ${formFields.length} field(s) ("${outName}") and downloaded!`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 7. PDF TO EXCEL & EXCEL TO PDF STATE
  // ==========================================================================
  const [excelRows, setExcelRows] = useState<string[][]>([]);
  const [excelSheetOrientation, setExcelSheetOrientation] = useState<
    'landscape' | 'portrait'
  >('landscape');

  useEffect(() => {
    if (activeTool === 'pdf-to-excel' && selectedDoc) {
      let cancelled = false;
      setIsBusy(true);
      extractPdfToExcelRows(selectedDoc.pdfData)
        .then((rows) => {
          if (!cancelled) setExcelRows(rows);
        })
        .finally(() => {
          if (!cancelled) setIsBusy(false);
        });
      return () => {
        cancelled = true;
      };
    } else if (activeTool === 'excel-to-pdf' && excelRows.length === 0) {
      setExcelRows([
        ['Item #', 'Candidate / Description', 'Category', 'Score / Amount'],
        ['01', 'Chemistry Paper 1 Assessment', 'Science', '88.5'],
        ['02', 'Biology Laboratory Practical', 'Science', '92.0'],
        ['03', 'Mathematics Annual Exam', 'Core', '95.0'],
        ['04', 'Physics Mechanics Module', 'Science', '84.0'],
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedDoc?.id]);

  const importSpreadsheetFileAndConvert = async (file: File) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const parsed = await parseUploadedSpreadsheetFile(file);
      if (parsed.length > 0) {
        setExcelRows(parsed);
        const baseName =
          file.name.replace(/\.(xlsx?|csv|tsv|txt)$/i, '') ||
          'Spreadsheet_Report';
        const { pdfBytes, pageCount } = await convertSpreadsheetRowsToPdf(
          parsed,
          baseName,
          excelSheetOrientation
        );
        const outName = `${baseName}.pdf`;
        const newDoc: StoredDocument = {
          id: `doc-xls2pdf-${Date.now()}`,
          name: outName,
          category: 'Reports',
          starred: false,
          sizeBytes: pdfBytes.byteLength,
          pageCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
          pdfData: pdfBytes,
        };
        await onSaveNewDocument(newDoc);
        setFeedback(
          `Loaded ${parsed.length} rows from "${file.name}" and converted into "${outName}" (${pageCount}p). Click 'Convert Excel to PDF & Download' to download.`
        );
      }
    } catch {
      setFeedback(`Could not parse spreadsheet "${file.name}".`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadSpreadsheetFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await importSpreadsheetFileAndConvert(file);
  };

  // ==========================================================================
  // 8. PDF TO POWERPOINT & POWERPOINT TO PDF STATE
  // ==========================================================================
  const [slidesList, setSlidesList] = useState<SlideDeckItem[]>([]);

  useEffect(() => {
    if (activeTool === 'pdf-to-ppt' && selectedDoc) {
      let cancelled = false;
      setIsBusy(true);
      extractPdfToSlides(selectedDoc.pdfData, selectedDoc.name)
        .then((slides) => {
          if (!cancelled) setSlidesList(slides);
        })
        .finally(() => {
          if (!cancelled) setIsBusy(false);
        });
      return () => {
        cancelled = true;
      };
    } else if (activeTool === 'ppt-to-pdf' && slidesList.length === 0) {
      setSlidesList([
        {
          slideNumber: 1,
          title: 'Executive Presentation Overview',
          bullets: [
            'Widescreen 16:9 presentation deck generated by ElimikaPDF',
            'Clean typography, structured bullet points, and high-contrast slide headers',
            'Ready for instant projection, sharing, or printing',
          ],
        },
        {
          slideNumber: 2,
          title: 'Key Milestones & Deliverables',
          bullets: [
            'Phase 1: Document digitization & high-DPI OCR indexing',
            'Phase 2: Automated watermark cleaning & archival PDF/A compliance',
            'Phase 3: Cloud synchronization with Google Drive & Dropbox',
          ],
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedDoc?.id]);

  // ==========================================================================
  // 9. HTML TO PDF STATE
  // ==========================================================================
  const [htmlFileName, setHtmlFileName] = useState<string>('Webpage_Converted');
  const [htmlSourceInput, setHtmlSourceInput] = useState<string>(
    `<!DOCTYPE html>
<html>
<head>
  <title>ElimikaPDF Webpage &amp; Invoice Report</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #14101B; padding: 20px; line-height: 1.5; }
    h1 { color: #4A1D5E; margin-bottom: 8px; }
    h2 { color: #2563EB; margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #CBD5E1; padding: 8px 10px; text-align: left; }
    th { background: #F1F5F9; }
  </style>
</head>
<body>
  <h1>ElimikaPDF Webpage &amp; Invoice Report</h1>
  <p>Upload any .HTML file or paste webpage markup here to convert its rendered headings, paragraphs, lists, and tables into a clean multi-page A4 PDF document.</p>
  <h2>Key Highlights</h2>
  <ul>
    <li>Strips CSS stylesheets and JavaScript code so raw code is never printed</li>
    <li>Preserves headings, paragraphs, bulleted lists, and bordered tables</li>
    <li>Live visual webpage preview alongside instant A4 PDF export</li>
  </ul>
  <table>
    <tr><th>Item</th><th>Description</th><th>Status</th></tr>
    <tr><td>01</td><td>DOM HTML &amp; Table Structure Parser</td><td>Active</td></tr>
    <tr><td>02</td><td>Multi-Page A4 Vector PDF Generator</td><td>Verified</td></tr>
  </table>
</body>
</html>`
  );
  const [convertedHtmlPdfResult, setConvertedHtmlPdfResult] = useState<{
    bytes: Uint8Array;
    name: string;
    pageCount: number;
    doc: StoredDocument;
  } | null>(null);

  const handleUploadPptOrOutlineFile = async (file: File) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const parsedSlides = await parseUploadedPresentationFile(file);
      if (parsedSlides.length > 0) {
        setSlidesList(parsedSlides);
        const base =
          file.name.replace(/\.[^.]+$/, '') || 'Presentation_Slides';
        const { pdfBytes, pageCount } = await buildPresentationPdfFromSlides(
          parsedSlides,
          base
        );
        const outName = `${base}_Widescreen_Deck.pdf`;
        const newDoc: StoredDocument = {
          id: `doc-ppt-${Date.now()}`,
          name: outName,
          category: 'Reports',
          starred: false,
          sizeBytes: pdfBytes.byteLength,
          pageCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
          pdfData: pdfBytes,
        };
        await onSaveNewDocument(newDoc);
        setFeedback(
          `Imported ${parsedSlides.length} slide(s) from "${file.name}" and built "${outName}" (${pageCount}p).`
        );
      }
    } catch {
      setFeedback(`Loaded "${file.name}" into Slide Deck Builder.`);
    } finally {
      setIsBusy(false);
    }
  };

  const buildPdfFromHtmlMarkup = async (
    rawHtml: string,
    baseFileName: string,
    triggerDownload: boolean
  ) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const hasHtmlTags = /<[a-zA-Z!][\s\S]*?>/.test(rawHtml);
      const parsedBlocks = hasHtmlTags
        ? parseHtmlIntoWordBlocks(rawHtml)
        : plainTextToWordBlocks(rawHtml || 'HTML Document');

      const finalBlocks =
        parsedBlocks.length > 0
          ? parsedBlocks
          : plainTextToWordBlocks('HTML Document');

      const { pdfBytes, pageCount } = await generatePdfFromWordBlocks(
        finalBlocks,
        {
          pageSize: 'A4',
          fontFamily: 'helvetica',
          baseFontSize: 11.5,
          lineSpacing: 1.4,
          addPageNumbers: true,
        }
      );
      const cleanBase =
        baseFileName.replace(/\.(html?|xhtml|txt|md)$/i, '').trim() ||
        `Webpage_Converted_${new Date().toISOString().slice(0, 10)}`;
      const outName = `${cleanBase}.pdf`;
      const newDoc: StoredDocument = {
        id: `doc-html2pdf-${Date.now()}`,
        name: outName,
        category: 'Reports',
        starred: false,
        sizeBytes: pdfBytes.byteLength,
        pageCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: pdfBytes,
      };
      await onSaveNewDocument(newDoc);
      setConvertedHtmlPdfResult({
        bytes: pdfBytes,
        name: outName,
        pageCount,
        doc: newDoc,
      });
      if (triggerDownload) {
        downloadBytesAsFile(pdfBytes, outName);
        setFeedback(
          `Converted HTML into "${outName}" (${pageCount} ${
            pageCount === 1 ? 'page' : 'pages'
          }, ${formatBytes(pdfBytes.byteLength)}) and downloaded!`
        );
      } else {
        setFeedback(
          `Converted "${baseFileName}" into "${outName}" (${pageCount} ${
            pageCount === 1 ? 'page' : 'pages'
          }, ${formatBytes(pdfBytes.byteLength)}). Click 'Download PDF' below or 'Convert HTML to PDF & Download'.`
        );
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadHtmlFile = async (file: File) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const converted = await convertAnyUploadedFileToPdfAndHtml(file);
      const base =
        file.name.replace(/\.[^.]+$/, '') || 'Document_Converted';
      setHtmlFileName(base);
      setHtmlSourceInput(converted.rawHtmlContent);
      setHtmlReaderFormatBadge(converted.sourceFormat.toUpperCase());

      const newDoc: StoredDocument = {
        id: `doc-html-${Date.now()}`,
        name: converted.outputPdfName,
        category: 'Reports',
        starred: false,
        sizeBytes: converted.pdfBytes.byteLength,
        pageCount: converted.pageCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        pdfData: converted.pdfBytes,
        ocrText: converted.extractedText,
        sourceFormat: converted.sourceFormat,
        rawHtmlContent: converted.rawHtmlContent,
      };
      await onSaveNewDocument(newDoc);
      setConvertedHtmlPdfResult({
        bytes: converted.pdfBytes,
        name: converted.outputPdfName,
        pageCount: converted.pageCount,
        doc: newDoc,
      });
      setFeedback(
        `Loaded "${file.name}" (${converted.sourceFormat.toUpperCase()}) into Reader & converted to "${converted.outputPdfName}" (${converted.pageCount} ${
          converted.pageCount === 1 ? 'page' : 'pages'
        }, ${formatBytes(converted.pdfBytes.byteLength)}).`
      );
    } catch {
      const text = await file.text();
      if (text.trim()) {
        const base = file.name.replace(/\.[^.]+$/, '');
        setHtmlFileName(base || 'Webpage_Converted');
        setHtmlSourceInput(text);
        await buildPdfFromHtmlMarkup(text, file.name, false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  // HTML & eBook Reader state
  const [htmlReaderViewMode, setHtmlReaderViewMode] = useState<
    'reflow' | 'webpage' | 'source'
  >('reflow');
  const [htmlReaderTheme, setHtmlReaderTheme] = useState<
    'paper' | 'sepia' | 'dusk' | 'night'
  >('paper');
  const [htmlReaderFontFamily, setHtmlReaderFontFamily] = useState<
    'serif' | 'sans' | 'mono'
  >('serif');
  const [htmlReaderFontSize, setHtmlReaderFontSize] = useState<number>(16);
  const [htmlReaderLineHeight, setHtmlReaderLineHeight] =
    useState<number>(1.75);
  const [htmlReaderSearchQuery, setHtmlReaderSearchQuery] =
    useState<string>('');
  const [htmlReaderFormatBadge, setHtmlReaderFormatBadge] =
    useState<string>('HTML');
  const [htmlReaderSpeaking, setHtmlReaderSpeaking] = useState<boolean>(false);
  const readerContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeTool !== 'html-reader' || !selectedDoc) return;
    const base = selectedDoc.name.replace(/\.pdf$/i, '');
    setHtmlFileName(base);
    setHtmlReaderFormatBadge(
      (selectedDoc.sourceFormat || 'html').toUpperCase()
    );
    if (selectedDoc.rawHtmlContent && selectedDoc.rawHtmlContent.trim()) {
      setHtmlSourceInput(selectedDoc.rawHtmlContent);
    } else if (selectedDoc.ocrText && selectedDoc.ocrText.trim()) {
      const blocks = plainTextToWordBlocks(selectedDoc.ocrText);
      setHtmlSourceInput(wordBlocksToCleanHtml(blocks, base));
    } else {
      extractAllPdfText(selectedDoc.pdfData)
        .then((pages) => {
          const joined = pages
            .map((p) => `# Page ${p.pageNumber}\n${p.text}`)
            .join('\n\n');
          const blocks = plainTextToWordBlocks(joined || base);
          setHtmlSourceInput(wordBlocksToCleanHtml(blocks, base));
        })
        .catch(() => {
          // keep default
        });
    }
  }, [activeTool, selectedDoc?.id]);

  const toggleHtmlReaderReadAloud = (plainTextToRead: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (htmlReaderSpeaking) {
      window.speechSynthesis.cancel();
      setHtmlReaderSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      plainTextToRead.slice(0, 12000)
    );
    utterance.rate = 1.0;
    utterance.onend = () => setHtmlReaderSpeaking(false);
    utterance.onerror = () => setHtmlReaderSpeaking(false);
    setHtmlReaderSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!externalUploadedFile) return;
    if (activeTool === 'excel-to-pdf') {
      importSpreadsheetFileAndConvert(externalUploadedFile);
    } else if (activeTool === 'ppt-to-pdf') {
      handleUploadPptOrOutlineFile(externalUploadedFile);
    } else if (
      activeTool === 'html-to-pdf' ||
      activeTool === 'html-reader'
    ) {
      handleUploadHtmlFile(externalUploadedFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalUploadedFile]);

  const handleConvertHtmlToPdf = async () => {
    await buildPdfFromHtmlMarkup(htmlSourceInput, htmlFileName, true);
  };

  // ==========================================================================
  // 10. REPAIR PDF, PDF/A, UNLOCK PDF STATE
  // ==========================================================================
  const [repairDiagnostics, setRepairDiagnostics] = useState<string[]>([]);
  const [pdfAConformance, setPdfAConformance] = useState<
    'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b'
  >('PDF/A-1b');

  // ==========================================================================
  // 11. COMPARE PDF STATE
  // ==========================================================================
  const [compareDocBId, setCompareDocBId] = useState<string>(
    documents[1]?.id || documents[0]?.id || ''
  );
  const [compareResult, setCompareResult] = useState<{
    similarityPct: number;
    addedCount: number;
    removedCount: number;
    diffLines: PdfDiffLine[];
  } | null>(null);

  const handleRunComparePdfs = async () => {
    if (!selectedDoc) return;
    const docB =
      documents.find((d) => d.id === compareDocBId) || documents[0] || null;
    if (!docB) return;
    setIsBusy(true);
    try {
      const res = await compareTwoPdfDocuments(
        selectedDoc.pdfData,
        docB.pdfData
      );
      setCompareResult(res);
      setFeedback(
        `Compared "${selectedDoc.name}" vs "${docB.name}" — ${res.similarityPct}% similarity (${res.addedCount} additions, ${res.removedCount} removals).`
      );
    } finally {
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // 12. SUMMARIZE PDF, TRANSLATE PDF & MARKDOWN STATE
  // ==========================================================================
  const [summaryResult, setSummaryResult] = useState<PdfSummaryResult | null>(
    null
  );
  const [markdownOutput, setMarkdownOutput] = useState<string>('');
  const [translateTargetLang, setTranslateTargetLang] = useState<
    'sw' | 'en' | 'fr' | 'es'
  >('sw');
  const [translateSourceText, setTranslateSourceText] = useState<string>('');
  const [translatedText, setTranslatedText] = useState<string>('');
  const [copiedTextFlag, setCopiedTextFlag] = useState(false);

  useEffect(() => {
    if (!selectedDoc) return;
    if (activeTool === 'summarize-pdf') {
      setIsBusy(true);
      summarizePdfDocument(selectedDoc.pdfData)
        .then((res) => setSummaryResult(res))
        .finally(() => setIsBusy(false));
    } else if (activeTool === 'pdf-to-markdown') {
      setIsBusy(true);
      convertPdfToMarkdownText(selectedDoc.pdfData, selectedDoc.name)
        .then((md) => setMarkdownOutput(md))
        .finally(() => setIsBusy(false));
    } else if (activeTool === 'translate-pdf') {
      setIsBusy(true);
      extractAllPdfText(selectedDoc.pdfData)
        .then((pages) => {
          const joined = pages
            .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
            .join('\n\n');
          setTranslateSourceText(joined);
          setTranslatedText(
            translateDocumentTextLocal(joined, translateTargetLang)
          );
        })
        .finally(() => setIsBusy(false));
    } else if (activeTool === 'pdf-to-kpf') {
      setIsBusy(true);
      const defaultTitle = selectedDoc.name.replace(/\.pdf$/i, '');
      setKpfBookTitle(defaultTitle);
      extractPdfToKindleChapters(selectedDoc.pdfData, selectedDoc.name)
        .then((chaps) => {
          setKpfChapters(chaps);
          setActiveKpfChapterIdx(0);
        })
        .finally(() => setIsBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedDoc?.id]);

  // ==========================================================================
  // 12B. PDF TO KPF (AMAZON KINDLE PACKAGE FORMAT .KPF / KDP STUDIO) STATE
  // ==========================================================================
  const [kpfChapters, setKpfChapters] = useState<KindleKpfChapter[]>([]);
  const [activeKpfChapterIdx, setActiveKpfChapterIdx] = useState(0);
  const [kpfBookTitle, setKpfBookTitle] = useState('Kindle Edition Book');
  const [kpfBookAuthor, setKpfBookAuthor] = useState('Author / KDP Publisher');
  const [kpfBookLang, setKpfBookLang] = useState('en');
  const [kpfLayoutMode, setKpfLayoutMode] = useState<
    'reflowable' | 'print-replica'
  >('reflowable');
  const [kpfFontScale, setKpfFontScale] = useState(105);
  const [kpfReaderTheme, setKpfReaderTheme] = useState<
    'paper' | 'sepia' | 'night'
  >('sepia');

  // ==========================================================================
  // 13. CUSTOM MULTI-STEP WORKFLOW BUILDER STATE
  // ==========================================================================
  const [workflowName, setWorkflowName] = useState(
    'Exam & Scan Clean + Number + Compress Pipeline'
  );
  const [workflowSteps, setWorkflowSteps] = useState<
    Array<
      | 'remove-watermark'
      | 'page-numbers-pdf'
      | 'compress-pdf'
      | 'pdf-to-pdfa'
      | 'watermark-pdf'
    >
  >(['remove-watermark', 'page-numbers-pdf', 'compress-pdf']);
  const [workflowStepStatus, setWorkflowStepStatus] = useState<string | null>(
    null
  );

  const handleRunCustomWorkflow = async () => {
    if (!selectedDoc || workflowSteps.length === 0) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      let currentBytes = selectedDoc.pdfData;
      for (let i = 0; i < workflowSteps.length; i++) {
        const step = workflowSteps[i];
        setWorkflowStepStatus(
          `Running Step ${i + 1} of ${workflowSteps.length}: ${step}...`
        );
        if (step === 'remove-watermark') {
          currentBytes = await removeWatermarksFromPdf(currentBytes, {
            preserveColor: true,
            strength: 5,
            contrastBoost: 32,
          });
        } else if (step === 'page-numbers-pdf') {
          currentBytes = await addPageNumbersToPdf(currentBytes, {
            position: 'bottom-center',
            format: 'page-of-total',
            startNumber: 1,
            fromPage: 1,
            toPage: selectedDoc.pageCount,
            fontSize: 10.5,
            fontFamily: 'helvetica',
            marginPt: 22,
            colorHex: '#14101B',
          });
        } else if (step === 'compress-pdf') {
          currentBytes = await compressPdfDocument(currentBytes, 'medium');
        } else if (step === 'pdf-to-pdfa') {
          currentBytes = await convertPdfToPdfA(
            currentBytes,
            selectedDoc.name,
            'PDF/A-1b'
          );
        } else if (step === 'watermark-pdf') {
          currentBytes = await stampWatermarkOntoPdf(currentBytes, {
            text: 'VERIFIED COPY',
            position: 'diagonal',
            opacity: 0.16,
            fontSize: 40,
            colorHex: '#4A1D5E',
            rotationDeg: 35,
          });
        }
      }

      const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Workflow.pdf`;
      const newDoc: StoredDocument = {
        ...selectedDoc,
        id: `doc-wf-${Date.now()}`,
        name: outName,
        pdfData: currentBytes,
        sizeBytes: currentBytes.byteLength,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNewDocument(newDoc);
      downloadBytesAsFile(currentBytes, outName);
      setFeedback(
        `Completed ${workflowSteps.length}-step workflow "${workflowName}" and downloaded "${outName}" (${formatBytes(currentBytes.byteLength)})!`
      );
    } finally {
      setWorkflowStepStatus(null);
      setIsBusy(false);
    }
  };

  // ==========================================================================
  // RENDER ACTIVE EXTENDED WORKSPACE
  // ==========================================================================

  const extendedSingleDocTools: ToolId[] = [
    'page-numbers-pdf',
    'watermark-pdf',
    'sign-pdf',
    'crop-pdf',
    'redact-pdf',
    'pdf-forms',
    'rotate-pdf',
    'pdf-to-excel',
    'pdf-to-ppt',
    'unlock-pdf',
    'pdf-to-pdfa',
    'repair-pdf',
    'compare-pdf',
    'pdf-to-markdown',
    'summarize-pdf',
    'translate-pdf',
    'workflow-pdf',
    'pdf-to-kpf',
  ];

  if (extendedSingleDocTools.includes(activeTool) && !selectedDoc) {
    return (
      <div className="p-8 rounded-2xl border-2 border-dashed border-[#4A1D5E]/40 dark:border-[#9D5CE5]/40 bg-[#FAF9FB] dark:bg-[#0D0A12] text-center space-y-3">
        <Upload className="w-8 h-8 text-[#4A1D5E] dark:text-[#D5B3FF] mx-auto" />
        <h3 className="text-sm font-bold text-[#14101B] dark:text-[#F4F1F8]">
          Upload a PDF Document to Begin
        </h3>
        <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] max-w-md mx-auto">
          Select a PDF file from your device to open it in this tool workspace.
        </p>
        {onUploadPdfFiles && (
          <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] text-xs font-bold cursor-pointer shadow-xs">
            <Upload className="w-4 h-4" />
            <span>Select PDF File</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={async (e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const files = Array.from(e.target.files);
                  e.target.value = '';
                  await onUploadPdfFiles(files);
                }
              }}
            />
          </label>
        )}
      </div>
    );
  }

  // 1. PAGE NUMBERS WORKSPACE
  if (activeTool === 'page-numbers-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Hash className="w-4 h-4 text-[#E5322D]" />
              <span>Add Page Numbers to PDF</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Choose position, numbering style, font size, and page range for{' '}
              <strong>{selectedDoc.name}</strong> ({selectedDoc.pageCount} pages).
            </p>
          </div>
          <button
            type="button"
            onClick={handleApplyPageNumbers}
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-[#E5322D] hover:bg-[#C8231E] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>
              {isBusy ? 'Numbering Pages...' : 'Add Page Numbers & Download'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
            <div>
              <label className="block text-xs font-bold mb-2">
                Page Number Position
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'top-left', label: 'Top Left' },
                    { id: 'top-center', label: 'Top Center' },
                    { id: 'top-right', label: 'Top Right' },
                    { id: 'bottom-left', label: 'Bottom Left' },
                    { id: 'bottom-center', label: 'Bottom Center' },
                    { id: 'bottom-right', label: 'Bottom Right' },
                  ] as const
                ).map((pos) => (
                  <button
                    key={pos.id}
                    type="button"
                    onClick={() =>
                      setPageNumOpts((p) => ({ ...p, position: pos.id }))
                    }
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                      pageNumOpts.position === pos.id
                        ? 'bg-[#4A1D5E] dark:bg-[#9D5CE5] text-white dark:text-[#0D0A12] border-[#4A1D5E]'
                        : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33]'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Format Style
                </label>
                <select
                  value={pageNumOpts.format}
                  onChange={(e) =>
                    setPageNumOpts((p) => ({
                      ...p,
                      format: e.target.value as PageNumberOptions['format'],
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                >
                  <option value="page-of-total">
                    Page 1 of {selectedDoc.pageCount}
                  </option>
                  <option value="slash">1 / {selectedDoc.pageCount}</option>
                  <option value="number-only">1, 2, 3...</option>
                  <option value="dashed">— 1 —</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  First Number
                </label>
                <input
                  type="number"
                  min={1}
                  value={pageNumOpts.startNumber}
                  onChange={(e) =>
                    setPageNumOpts((p) => ({
                      ...p,
                      startNumber: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  From Page
                </label>
                <input
                  type="number"
                  min={1}
                  max={selectedDoc.pageCount}
                  value={pageNumOpts.fromPage}
                  onChange={(e) =>
                    setPageNumOpts((p) => ({
                      ...p,
                      fromPage: Number(e.target.value) || 1,
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">To Page</label>
                <input
                  type="number"
                  min={1}
                  max={selectedDoc.pageCount}
                  value={pageNumOpts.toPage}
                  onChange={(e) =>
                    setPageNumOpts((p) => ({
                      ...p,
                      toPage: Number(e.target.value) || selectedDoc.pageCount,
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Font Size ({pageNumOpts.fontSize}pt)
                </label>
                <input
                  type="number"
                  min={8}
                  max={24}
                  value={pageNumOpts.fontSize}
                  onChange={(e) =>
                    setPageNumOpts((p) => ({
                      ...p,
                      fontSize: Number(e.target.value) || 11,
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#181322] p-4 flex flex-col items-center justify-center relative min-h-[340px]">
            {previewDataUrl ? (
              <div className="relative inline-block">
                <img
                  src={previewDataUrl}
                  alt="Page preview"
                  className="max-h-[380px] w-auto rounded shadow-lg"
                />
                <div
                  className={`absolute px-2 py-0.5 rounded bg-black/75 text-white text-[11px] font-mono font-bold ${
                    pageNumOpts.position.startsWith('top')
                      ? 'top-3'
                      : 'bottom-3'
                  } ${
                    pageNumOpts.position.endsWith('left')
                      ? 'left-3'
                      : pageNumOpts.position.endsWith('right')
                        ? 'right-3'
                        : 'left-1/2 -translate-x-1/2'
                  }`}
                >
                  {pageNumOpts.format === 'page-of-total'
                    ? `Page ${pageNumOpts.startNumber} of ${selectedDoc.pageCount}`
                    : pageNumOpts.format === 'slash'
                      ? `${pageNumOpts.startNumber} / ${selectedDoc.pageCount}`
                      : pageNumOpts.format === 'dashed'
                        ? `— ${pageNumOpts.startNumber} —`
                        : `${pageNumOpts.startNumber}`}
                </div>
              </div>
            ) : (
              <span className="text-xs text-white/70">Loading preview...</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. STAMP WATERMARK WORKSPACE
  if (activeTool === 'watermark-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Stamp className="w-4 h-4 text-[#9333EA]" />
              <span>Stamp Text or Image Watermark Over PDF</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Add a custom diagonal, header/footer, or tiled watermark across all pages of{' '}
              <strong>{selectedDoc.name}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleApplyStampWatermark}
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>
              {isBusy ? 'Stamping PDF...' : 'Add Watermark & Download'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
            <div>
              <label className="block text-xs font-bold mb-1">
                Watermark Text
              </label>
              <input
                type="text"
                value={stampOpts.text}
                onChange={(e) =>
                  setStampOpts((p) => ({ ...p, text: e.target.value }))
                }
                placeholder="CONFIDENTIAL / DRAFT / DO NOT COPY"
                className="w-full px-3.5 py-2 text-sm font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Placement Style
                </label>
                <select
                  value={stampOpts.position}
                  onChange={(e) =>
                    setStampOpts((p) => ({
                      ...p,
                      position: e.target
                        .value as StampWatermarkOptions['position'],
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                >
                  <option value="diagonal">Diagonal Across Center</option>
                  <option value="tile">Tiled Repeated Grid</option>
                  <option value="center">Horizontal Center</option>
                  <option value="top-center">Top Header</option>
                  <option value="bottom-center">Bottom Footer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Watermark Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={stampOpts.colorHex}
                    onChange={(e) =>
                      setStampOpts((p) => ({ ...p, colorHex: e.target.value }))
                    }
                    className="w-10 h-9 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="text-xs font-mono">{stampOpts.colorHex}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Transparency ({Math.round(stampOpts.opacity * 100)}%)
                </label>
                <input
                  type="range"
                  min={0.05}
                  max={0.85}
                  step={0.05}
                  value={stampOpts.opacity}
                  onChange={(e) =>
                    setStampOpts((p) => ({
                      ...p,
                      opacity: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-[#4A1D5E]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Font Size ({stampOpts.fontSize}pt)
                </label>
                <input
                  type="range"
                  min={16}
                  max={84}
                  step={2}
                  value={stampOpts.fontSize}
                  onChange={(e) =>
                    setStampOpts((p) => ({
                      ...p,
                      fontSize: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-[#4A1D5E]"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#181322] p-4 flex items-center justify-center min-h-[340px]">
            {previewDataUrl && (
              <div className="relative inline-block overflow-hidden rounded shadow-lg">
                <img
                  src={previewDataUrl}
                  alt="Watermark preview"
                  className="max-h-[380px] w-auto block"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span
                    style={{
                      color: stampOpts.colorHex,
                      opacity: stampOpts.opacity,
                      fontSize: `${Math.max(14, Math.round(stampOpts.fontSize * 0.55))}px`,
                      transform:
                        stampOpts.position === 'diagonal' ||
                        stampOpts.position === 'tile'
                          ? `rotate(-${stampOpts.rotationDeg}deg)`
                          : 'none',
                    }}
                    className="font-extrabold tracking-wider uppercase select-none text-center px-2"
                  >
                    {stampOpts.text}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. SIGN PDF WORKSPACE
  if (activeTool === 'sign-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <PenTool className="w-4 h-4 text-[#003FE8]" />
              <span>Sign PDF — Electronic Signature Studio</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Draw your signature, type a calligraphic signature, or upload a signature stamp and apply it to{' '}
              <strong>{selectedDoc.name}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleApplySignatureToPdf}
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-[#003FE8] hover:bg-[#0033BA] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <PenTool className="w-4 h-4" />
            <span>{isBusy ? 'Signing PDF...' : 'Sign PDF & Download'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
            <div className="flex items-center gap-2">
              {(['draw', 'type', 'upload'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSigMode(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize border cursor-pointer ${
                    sigMode === m
                      ? 'bg-[#003FE8] text-white border-[#003FE8]'
                      : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33]'
                  }`}
                >
                  {m === 'draw'
                    ? 'Draw Signature'
                    : m === 'type'
                      ? 'Type Signature'
                      : 'Upload Image'}
                </button>
              ))}
            </div>

            {sigMode === 'draw' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">
                    Draw your signature in the pad below:
                  </span>
                  <button
                    type="button"
                    onClick={clearSigCanvas}
                    className="text-[#DC2626] font-semibold hover:underline cursor-pointer"
                  >
                    Clear Pad
                  </button>
                </div>
                <canvas
                  ref={sigCanvasRef}
                  width={420}
                  height={140}
                  onPointerDown={handleSigPointerDown}
                  onPointerMove={handleSigPointerMove}
                  onPointerUp={() => setIsDrawingSig(false)}
                  onPointerLeave={() => setIsDrawingSig(false)}
                  style={{ touchAction: 'none' }}
                  className="w-full h-36 bg-white rounded-xl border-2 border-dashed border-[#003FE8]/50 cursor-crosshair"
                />
              </div>
            )}

            {sigMode === 'type' && (
              <div>
                <label className="block text-xs font-bold mb-1">
                  Typed Signature Name
                </label>
                <input
                  type="text"
                  value={typedSigName}
                  onChange={(e) => setTypedSigName(e.target.value)}
                  className="w-full px-4 py-3 text-lg italic font-serif font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
            )}

            {sigMode === 'upload' && (
              <div>
                <label className="px-4 py-3 rounded-xl border-2 border-dashed border-[#003FE8]/50 bg-white dark:bg-[#16111F] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4 text-[#003FE8]" />
                  <span>Upload Signature PNG / JPG</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const r = new FileReader();
                      r.onload = () =>
                        setUploadedSigDataUrl(String(r.result || ''));
                      r.readAsDataURL(f);
                    }}
                  />
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Signer Name
                </label>
                <input
                  type="text"
                  value={typedSigName}
                  onChange={(e) => setTypedSigName(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Role / Title
                </label>
                <input
                  type="text"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Target Pages
                </label>
                <select
                  value={sigPageScope}
                  onChange={(e) =>
                    setSigPageScope(
                      e.target.value as
                        | 'last'
                        | 'first'
                        | 'all'
                        | 'custom'
                    )
                  }
                  className="w-full px-2.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                >
                  <option value="last">Last Page</option>
                  <option value="first">First Page</option>
                  <option value="all">All Pages</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Position</label>
                <select
                  value={sigPosition}
                  onChange={(e) =>
                    setSigPosition(
                      e.target.value as
                        | 'bottom-right'
                        | 'bottom-left'
                        | 'bottom-center'
                        | 'middle-right'
                    )
                  }
                  className="w-full px-2.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-center">Bottom Center</option>
                  <option value="middle-right">Middle Right</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Ink Color</label>
                <div className="flex items-center gap-1.5 pt-1">
                  {['#003FE8', '#14101B', '#4A1D5E', '#15803D'].map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setSigColor(hex)}
                      style={{ backgroundColor: hex }}
                      className={`w-6 h-6 rounded-full cursor-pointer ${
                        sigColor === hex ? 'ring-2 ring-offset-2 ring-[#003FE8]' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={sigIncludeDate}
                onChange={(e) => setSigIncludeDate(e.target.checked)}
                className="accent-[#003FE8]"
              />
              <span>Include automatic date stamp below signature</span>
            </label>
          </div>

          <div className="rounded-2xl bg-[#181322] p-4 flex items-center justify-center min-h-[340px]">
            {previewDataUrl && (
              <div className="relative inline-block">
                <img
                  src={previewDataUrl}
                  alt="Sign preview"
                  className="max-h-[380px] w-auto rounded shadow-lg"
                />
                <div
                  className={`absolute bottom-4 ${
                    sigPosition === 'bottom-left'
                      ? 'left-4'
                      : sigPosition === 'bottom-center'
                        ? 'left-1/2 -translate-x-1/2'
                        : 'right-4'
                  } px-3 py-1.5 rounded bg-white/95 border border-[#003FE8] shadow-md text-left`}
                >
                  <p
                    style={{ color: sigColor }}
                    className="text-sm font-serif italic font-bold"
                  >
                    {typedSigName || 'Signature'}
                  </p>
                  <p className="text-[9px] text-neutral-600 border-t border-neutral-300 pt-0.5">
                    {signerTitle} {sigIncludeDate ? `· ${new Date().toISOString().slice(0, 10)}` : ''}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4. ROTATE PDF WORKSPACE
  if (activeTool === 'rotate-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-[#7C3AED]" />
              <span>Rotate PDF Pages</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Rotate all pages of <strong>{selectedDoc.name}</strong> 90° clockwise, 90° counter-clockwise, or 180°.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: 'Rotate Left 90°', deg: 270, icon: RotateCcw },
              { label: 'Rotate Right 90°', deg: 90, icon: RotateCw },
              { label: 'Flip 180°', deg: 180, icon: RotateCw },
            ].map((btn) => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.label}
                  type="button"
                  disabled={isBusy}
                  onClick={async () => {
                    setIsBusy(true);
                    try {
                      const specs = Array.from(
                        { length: selectedDoc.pageCount },
                        (_, i) => ({
                          sourcePageNumber: i + 1,
                          addRotationDeg: btn.deg,
                        })
                      );
                      const rotatedBytes = await organizePdfPages(
                        selectedDoc.pdfData,
                        specs
                      );
                      const updated: StoredDocument = {
                        ...selectedDoc,
                        pdfData: rotatedBytes,
                        sizeBytes: rotatedBytes.byteLength,
                        updatedAt: new Date().toISOString(),
                      };
                      await onUpdateDocument(updated);
                      downloadBytesAsFile(rotatedBytes, selectedDoc.name);
                      setFeedback(
                        `${btn.label} applied to all ${selectedDoc.pageCount} pages and downloaded.`
                      );
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Icon className="w-4 h-4" />
                  <span>{btn.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-[#181322] p-6 flex items-center justify-center min-h-[320px]">
          {previewDataUrl && (
            <img
              src={previewDataUrl}
              alt="Rotate preview"
              className="max-h-[360px] w-auto rounded shadow-lg"
            />
          )}
        </div>
      </div>
    );
  }

  // 5. CROP PDF WORKSPACE
  if (activeTool === 'crop-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Crop className="w-4 h-4 text-[#9333EA]" />
              <span>Crop PDF Margins &amp; Content Area</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Adjust top, bottom, left, and right crop margins for{' '}
              <strong>{selectedDoc.name}</strong> and apply to one or all pages.
            </p>
          </div>
          <button
            type="button"
            onClick={handleApplyCropPdf}
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <Crop className="w-4 h-4" />
            <span>{isBusy ? 'Cropping PDF...' : 'Crop PDF & Download'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
            <div className="flex items-center gap-2">
              {[
                { label: 'Remove Header/Footer (8%)', t: 8, b: 8, l: 2, r: 2 },
                { label: 'Tight Margins (5%)', t: 5, b: 5, l: 5, r: 5 },
                { label: 'Wide Crop (12%)', t: 12, b: 12, l: 10, r: 10 },
                { label: 'Reset (0%)', t: 0, b: 0, l: 0, r: 0 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setCropTop(p.t);
                    setCropBottom(p.b);
                    setCropLeft(p.l);
                    setCropRight(p.r);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-semibold cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Top Margin Crop ({cropTop}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={cropTop}
                  onChange={(e) => setCropTop(Number(e.target.value))}
                  className="w-full accent-[#4A1D5E]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Bottom Margin Crop ({cropBottom}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={cropBottom}
                  onChange={(e) => setCropBottom(Number(e.target.value))}
                  className="w-full accent-[#4A1D5E]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Left Margin Crop ({cropLeft}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={cropLeft}
                  onChange={(e) => setCropLeft(Number(e.target.value))}
                  className="w-full accent-[#4A1D5E]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  Right Margin Crop ({cropRight}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={cropRight}
                  onChange={(e) => setCropRight(Number(e.target.value))}
                  className="w-full accent-[#4A1D5E]"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <span className="text-xs font-bold">Apply To:</span>
              <button
                type="button"
                onClick={() => setCropScope('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  cropScope === 'all'
                    ? 'bg-[#4A1D5E] text-white'
                    : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC]'
                }`}
              >
                All {selectedDoc.pageCount} Pages
              </button>
              <button
                type="button"
                onClick={() => setCropScope('current')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  cropScope === 'current'
                    ? 'bg-[#4A1D5E] text-white'
                    : 'bg-white dark:bg-[#16111F] border border-[#E4DFEC]'
                }`}
              >
                Current Page Only
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-[#181322] p-4 flex items-center justify-center min-h-[340px]">
            {previewDataUrl && (
              <div className="relative inline-block overflow-hidden rounded shadow-lg">
                <img
                  src={previewDataUrl}
                  alt="Crop preview"
                  className="max-h-[380px] w-auto block"
                />
                <div
                  style={{
                    top: `${cropTop}%`,
                    bottom: `${cropBottom}%`,
                    left: `${cropLeft}%`,
                    right: `${cropRight}%`,
                  }}
                  className="absolute border-2 border-dashed border-[#0088FF] bg-[#0088FF]/10 pointer-events-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 6. REDACT PDF WORKSPACE
  if (activeTool === 'redact-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-[#0284C7]" />
              <span>Redact PDF — Permanently Sanitize Sensitive Data</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Click anywhere on the page preview to place a redaction bar, or enter words/names to automatically redact across all pages.
            </p>
          </div>
          <button
            type="button"
            onClick={handleApplyRedaction}
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <EyeOff className="w-4 h-4" />
            <span>
              {isBusy
                ? 'Burning Redactions...'
                : 'Apply Permanent Redaction & Download'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
            <div>
              <label className="block text-xs font-bold mb-1">
                Words, Names, or IDs to Redact Automatically (Comma-separated)
              </label>
              <input
                type="text"
                value={redactTermsInput}
                onChange={(e) => setRedactTermsInput(e.target.value)}
                placeholder="e.g. Candidate Number, elimika.online, Account #"
                className="w-full px-3.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={redactEmails}
                  onChange={(e) => setRedactEmails(e.target.checked)}
                  className="accent-[#DC2626]"
                />
                <span>Auto-Redact Email Addresses</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={redactPhones}
                  onChange={(e) => setRedactPhones(e.target.checked)}
                  className="accent-[#DC2626]"
                />
                <span>Auto-Redact Phone Numbers</span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold">Redaction Bar Style:</span>
              <button
                type="button"
                onClick={() => setRedactFillColor('#000000')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  redactFillColor === '#000000'
                    ? 'bg-black text-white'
                    : 'bg-white border border-neutral-300 text-black'
                }`}
              >
                Solid Blackout (#000000)
              </button>
              <button
                type="button"
                onClick={() => setRedactFillColor('#FFFFFF')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  redactFillColor === '#FFFFFF'
                    ? 'bg-[#003FE8] text-white'
                    : 'bg-white border border-neutral-300 text-black'
                }`}
              >
                Clean Whiteout (#FFFFFF)
              </button>
            </div>

            {redactBoxes.length > 0 && (
              <div className="flex items-center justify-between pt-2 border-t border-[#E4DFEC] dark:border-[#261F33]">
                <span className="text-xs font-bold">
                  {redactBoxes.length} manual redaction box(es) placed
                </span>
                <button
                  type="button"
                  onClick={() => setRedactBoxes([])}
                  className="text-xs font-bold text-[#DC2626] hover:underline cursor-pointer"
                >
                  Clear All Boxes
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-[#181322] p-4 flex flex-col items-center justify-center min-h-[360px]">
            <p className="text-[11px] text-white/80 mb-2">
              Click anywhere on Page {previewPageNum} below to stamp a redaction bar:
            </p>
            {previewDataUrl && (
              <div
                onClick={handleAddRedactBoxOnClick}
                className="relative inline-block cursor-crosshair overflow-hidden rounded shadow-lg"
              >
                <img
                  src={previewDataUrl}
                  alt="Redact preview"
                  className="max-h-[380px] w-auto block pointer-events-none"
                />
                {redactBoxes
                  .filter((b) => b.pageNumber === previewPageNum)
                  .map((box) => (
                    <div
                      key={box.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRedactBoxes((prev) =>
                          prev.filter((item) => item.id !== box.id)
                        );
                      }}
                      title="Click to remove this redaction box"
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                        backgroundColor: redactFillColor,
                      }}
                      className="absolute border border-red-500 cursor-pointer"
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 7. PDF FORMS WORKSPACE
  if (activeTool === 'pdf-forms' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <FormInput className="w-4 h-4 text-[#9333EA]" />
              <span>PDF Forms — Interactive Fillable AcroForm Builder</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Add interactive fillable Text Fields, Checkboxes, and Dropdown lists to{' '}
              <strong>{selectedDoc.name}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleBuildFormPdf}
            disabled={isBusy}
            className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>
              {isBusy ? 'Building Form...' : 'Generate Fillable PDF & Download'}
            </span>
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setFormFields((prev) => [
                  ...prev,
                  {
                    id: `fld-${Date.now()}`,
                    name: `Field_${prev.length + 1}`,
                    label: `Text Field ${prev.length + 1}:`,
                    type: 'text',
                    pageNumber: 1,
                    x: 0.12,
                    y: Math.min(0.85, 0.18 + prev.length * 0.08),
                    width: 0.42,
                    height: 0.036,
                    defaultValue: '',
                  },
                ])
              }
              className="px-3.5 py-2 rounded-xl bg-[#4A1D5E] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Text Field</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFormFields((prev) => [
                  ...prev,
                  {
                    id: `fld-${Date.now()}`,
                    name: `Check_${prev.length + 1}`,
                    label: `Option ${prev.length + 1}`,
                    type: 'checkbox',
                    pageNumber: 1,
                    x: 0.12,
                    y: Math.min(0.85, 0.18 + prev.length * 0.08),
                    width: 0.03,
                    height: 0.03,
                    checked: false,
                  },
                ])
              }
              className="px-3.5 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Checkbox</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFormFields((prev) => [
                  ...prev,
                  {
                    id: `fld-${Date.now()}`,
                    name: `Dropdown_${prev.length + 1}`,
                    label: `Select Choice:`,
                    type: 'dropdown',
                    pageNumber: 1,
                    x: 0.12,
                    y: Math.min(0.85, 0.18 + prev.length * 0.08),
                    width: 0.36,
                    height: 0.036,
                    options: ['Approved', 'Pending Review', 'Requires Revision'],
                  },
                ])
              }
              className="px-3.5 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Dropdown Field</span>
            </button>

            <label className="flex items-center gap-2 text-xs font-semibold ml-auto cursor-pointer">
              <input
                type="checkbox"
                checked={flattenFieldsOnExport}
                onChange={(e) => setFlattenFieldsOnExport(e.target.checked)}
                className="accent-[#4A1D5E]"
              />
              <span>Flatten form fields into static text on export</span>
            </label>
          </div>

          <div className="space-y-2">
            {formFields.map((f, idx) => (
              <div
                key={f.id}
                className="p-3 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] grid grid-cols-1 sm:grid-cols-4 gap-3 items-center"
              >
                <div>
                  <span className="text-[10px] font-bold uppercase text-[#6E667D]">
                    {f.type} Field #{idx + 1}
                  </span>
                  <input
                    type="text"
                    value={f.label}
                    onChange={(e) =>
                      setFormFields((prev) =>
                        prev.map((item) =>
                          item.id === f.id
                            ? { ...item, label: e.target.value }
                            : item
                        )
                      )
                    }
                    className="w-full mt-0.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-[#6E667D]">
                    Default / Value
                  </span>
                  <input
                    type="text"
                    value={f.defaultValue || ''}
                    placeholder={
                      f.type === 'checkbox' ? 'Checked state' : 'Default value...'
                    }
                    onChange={(e) =>
                      setFormFields((prev) =>
                        prev.map((item) =>
                          item.id === f.id
                            ? { ...item, defaultValue: e.target.value }
                            : item
                        )
                      )
                    }
                    className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#6E667D]">
                      X Pos (%)
                    </span>
                    <input
                      type="number"
                      min={2}
                      max={85}
                      value={Math.round(f.x * 100)}
                      onChange={(e) =>
                        setFormFields((prev) =>
                          prev.map((item) =>
                            item.id === f.id
                              ? { ...item, x: Number(e.target.value) / 100 }
                              : item
                          )
                        )
                      }
                      className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#6E667D]">
                      Y Pos (%)
                    </span>
                    <input
                      type="number"
                      min={5}
                      max={90}
                      value={Math.round(f.y * 100)}
                      onChange={(e) =>
                        setFormFields((prev) =>
                          prev.map((item) =>
                            item.id === f.id
                              ? { ...item, y: Number(e.target.value) / 100 }
                              : item
                          )
                        )
                      }
                      className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setFormFields((prev) =>
                        prev.filter((item) => item.id !== f.id)
                      )
                    }
                    className="p-2 rounded-lg text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 8. PDF TO EXCEL & EXCEL TO PDF WORKSPACES
  if (activeTool === 'pdf-to-excel' || activeTool === 'excel-to-pdf') {
    const isPdfToExcel = activeTool === 'pdf-to-excel';
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#15803D]" />
              <span>
                {isPdfToExcel
                  ? 'PDF to Excel — Extract Tables to .XLS & .CSV'
                  : 'Excel to PDF — Convert Spreadsheets (.XLS / .CSV) to PDF'}
              </span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              {isPdfToExcel
                ? `Extracted structured rows and columns from "${selectedDoc?.name || 'PDF'}". Edit any cell below before downloading.`
                : 'Upload a .CSV / .TSV / .XLS spreadsheet or edit the table grid below to generate a formatted tabular PDF.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isPdfToExcel && (
              <>
                <label className="px-3.5 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#15803D]" />
                  <span>Upload .CSV / .XLS</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.xls,.xlsx"
                    className="hidden"
                    onChange={handleUploadSpreadsheetFile}
                  />
                </label>
                <select
                  value={excelSheetOrientation}
                  onChange={(e) =>
                    setExcelSheetOrientation(
                      e.target.value as 'landscape' | 'portrait'
                    )
                  }
                  className="px-3 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-xs font-bold"
                >
                  <option value="landscape">Landscape Table PDF</option>
                  <option value="portrait">Portrait Table PDF</option>
                </select>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={async () => {
                    setIsBusy(true);
                    try {
                      const { pdfBytes, pageCount } =
                        await convertSpreadsheetRowsToPdf(
                          excelRows,
                          'Spreadsheet Report',
                          excelSheetOrientation
                        );
                      const outName = `Excel_Table_${new Date().toISOString().slice(0, 10)}.pdf`;
                      const newDoc: StoredDocument = {
                        id: `doc-xls2pdf-${Date.now()}`,
                        name: outName,
                        category: 'Reports',
                        starred: false,
                        sizeBytes: pdfBytes.byteLength,
                        pageCount,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        lastOpenedAt: new Date().toISOString(),
                        pdfData: pdfBytes,
                      };
                      await onSaveNewDocument(newDoc);
                      downloadBytesAsFile(pdfBytes, outName);
                      setFeedback(
                        `Converted spreadsheet (${excelRows.length} rows) into "${outName}" and downloaded!`
                      );
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Convert Excel to PDF &amp; Download</span>
                </button>
              </>
            )}

            {isPdfToExcel && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const base = (selectedDoc?.name || 'Table').replace(
                      /\.pdf$/i,
                      ''
                    );
                    const xlsBytes = buildExcelXmlBytesFromRows(
                      excelRows,
                      base
                    );
                    downloadBytesAsFile(
                      xlsBytes,
                      `${base}.xls`,
                      'application/vnd.ms-excel'
                    );
                    setFeedback(
                      `Downloaded Excel Workbook "${base}.xls" (${excelRows.length} rows).`
                    );
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Excel (.XLS)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const base = (selectedDoc?.name || 'Table').replace(
                      /\.pdf$/i,
                      ''
                    );
                    const csvBytes = buildCsvBytesFromRows(excelRows);
                    downloadBytesAsFile(csvBytes, `${base}.csv`, 'text/csv');
                    setFeedback(
                      `Downloaded CSV Spreadsheet "${base}.csv" (${excelRows.length} rows).`
                    );
                  }}
                  className="px-4 py-2.5 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .CSV</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Editable Spreadsheet Preview Table */}
        <div className="overflow-x-auto border border-[#E4DFEC] dark:border-[#261F33] rounded-xl max-h-[420px]">
          <table className="w-full text-left border-collapse text-xs">
            <tbody>
              {excelRows.slice(0, 60).map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className={
                    rIdx === 0
                      ? 'bg-[#15803D]/15 font-bold'
                      : 'border-t border-[#E4DFEC] dark:border-[#261F33]'
                  }
                >
                  <td className="px-2.5 py-1.5 font-mono text-[10px] text-[#6E667D] bg-[#FAF9FB] dark:bg-[#0D0A12] border-r border-[#E4DFEC] dark:border-[#261F33] w-10 text-center">
                    {rIdx + 1}
                  </td>
                  {Array.from(
                    { length: Math.max(4, row.length) },
                    (_, cIdx) => (
                      <td
                        key={cIdx}
                        className="p-0 border-r border-[#E4DFEC] dark:border-[#261F33]"
                      >
                        <input
                          type="text"
                          value={row[cIdx] ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setExcelRows((prev) =>
                              prev.map((r, i) => {
                                if (i !== rIdx) return r;
                                const copy = [...r];
                                copy[cIdx] = val;
                                return copy;
                              })
                            );
                          }}
                          className="w-full px-2.5 py-1.5 bg-transparent focus:outline-none focus:bg-[#15803D]/5 text-xs"
                        />
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => setExcelRows((prev) => [...prev, ['', '', '', '']])}
          className="px-3.5 py-1.5 rounded-lg border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Row</span>
        </button>
      </div>
    );
  }

  // 9. PDF TO POWERPOINT & POWERPOINT TO PDF WORKSPACES
  if (activeTool === 'pdf-to-ppt' || activeTool === 'ppt-to-pdf') {
    const isPdfToPpt = activeTool === 'pdf-to-ppt';
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Presentation className="w-4 h-4 text-[#EA580C]" />
              <span>
                {isPdfToPpt
                  ? 'PDF to PowerPoint — Convert PDF Pages to Widescreen Slides'
                  : 'PowerPoint to PDF — Convert Slideshow to Widescreen PDF Deck'}
              </span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              {isPdfToPpt
                ? `Extracted ${slidesList.length} presentation slide(s) from "${selectedDoc?.name || 'PDF'}".`
                : 'Customize slide titles and bullet points below or add slides to build a 16:9 widescreen presentation PDF.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isPdfToPpt && (
              <label className="px-3.5 py-2 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#EA580C]" />
                <span>Upload Presentation / Outline (.PPTX, .PPT, .TXT, .PDF)</span>
                <input
                  type="file"
                  accept=".pptx,.ppt,.pdf,.txt,.md,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf,text/plain"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      e.target.value = '';
                      await handleUploadPptOrOutlineFile(f);
                    }
                  }}
                />
              </label>
            )}
            {isPdfToPpt && (
              <button
                type="button"
                onClick={() => {
                  const base = (selectedDoc?.name || 'Presentation').replace(
                    /\.pdf$/i,
                    ''
                  );
                  const pptBytes = buildPowerPointHtmlBytes(slidesList, base);
                  downloadBytesAsFile(
                    pptBytes,
                    `${base}_Slides.ppt`,
                    'application/vnd.ms-powerpoint'
                  );
                  setFeedback(
                    `Downloaded PowerPoint presentation "${base}_Slides.ppt" (${slidesList.length} slides).`
                  );
                }}
                className="px-4 py-2.5 rounded-xl bg-[#EA580C] hover:bg-[#C2410C] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download PowerPoint (.PPT)</span>
              </button>
            )}

            <button
              type="button"
              disabled={isBusy || slidesList.length === 0}
              onClick={async () => {
                setIsBusy(true);
                try {
                  const base = (selectedDoc?.name || 'Presentation').replace(
                    /\.pdf$/i,
                    ''
                  );
                  const { pdfBytes, pageCount } =
                    await buildPresentationPdfFromSlides(slidesList, base);
                  const outName = `${base}_Widescreen_Deck.pdf`;
                  const newDoc: StoredDocument = {
                    id: `doc-ppt-${Date.now()}`,
                    name: outName,
                    category: 'Reports',
                    starred: false,
                    sizeBytes: pdfBytes.byteLength,
                    pageCount,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    lastOpenedAt: new Date().toISOString(),
                    pdfData: pdfBytes,
                  };
                  await onSaveNewDocument(newDoc);
                  downloadBytesAsFile(pdfBytes, outName);
                  setFeedback(
                    `Generated 16:9 Widescreen Presentation PDF "${outName}" (${pageCount} slides) and downloaded!`
                  );
                } finally {
                  setIsBusy(false);
                }
              }}
              className="px-4 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export 16:9 Presentation PDF</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {slidesList.map((slide, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] overflow-hidden bg-white dark:bg-[#16111F] shadow-2xs"
            >
              <div className="bg-[#4A1D5E] text-white px-4 py-2.5 flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={slide.title}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSlidesList((prev) =>
                      prev.map((s, i) => (i === idx ? { ...s, title: val } : s))
                    );
                  }}
                  className="bg-transparent font-bold text-xs text-white w-full focus:outline-none"
                />
                <span className="text-[10px] font-mono opacity-80 shrink-0">
                  Slide {idx + 1}
                </span>
              </div>
              <div className="p-4 flex gap-3 items-start">
                <textarea
                  rows={4}
                  value={slide.bullets.join('\n')}
                  onChange={(e) => {
                    const lines = e.target.value.split('\n');
                    setSlidesList((prev) =>
                      prev.map((s, i) =>
                        i === idx ? { ...s, bullets: lines } : s
                      )
                    );
                  }}
                  className="flex-1 text-xs p-2 rounded-lg bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
                />
                {slide.imageDataUrl && (
                  <img
                    src={slide.imageDataUrl}
                    alt={`Slide ${idx + 1}`}
                    className="w-24 h-auto rounded border border-[#E4DFEC] shrink-0"
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setSlidesList((prev) => [
              ...prev,
              {
                slideNumber: prev.length + 1,
                title: `Slide ${prev.length + 1} Title`,
                bullets: ['Key takeaway point 1', 'Supporting detail 2'],
              },
            ])
          }
          className="px-4 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Slide</span>
        </button>
      </div>
    );
  }

  // 10. HTML TO PDF WORKSPACE
  if (activeTool === 'html-to-pdf') {
    const previewBlocks = parseHtmlIntoWordBlocks(htmlSourceInput);
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Code2 className="w-4 h-4 text-[#D97706]" />
              <span>HTML to PDF — Convert Webpage HTML or Markup to PDF</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Upload an <code>.html</code> / <code>.htm</code> file or paste HTML markup below. Automatically strips <code>&lt;style&gt;</code> &amp; <code>&lt;script&gt;</code> code and renders clean headings, paragraphs, lists, and tables into an A4 PDF.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3.5 py-2 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-[#D97706]" />
              <span>Upload .HTML / .HTM File</span>
              <input
                type="file"
                accept=".html,.htm,.xhtml,.txt,.md,text/html,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    e.target.value = '';
                    await handleUploadHtmlFile(f);
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleConvertHtmlToPdf}
              disabled={isBusy}
              className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>
                {isBusy ? 'Converting...' : 'Convert HTML to PDF & Download'}
              </span>
            </button>
          </div>
        </div>

        {/* Ready-to-Download Converted HTML PDF Banner */}
        {convertedHtmlPdfResult && (
          <div className="p-4 rounded-xl bg-[#15803D]/10 border-2 border-[#15803D]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#15803D] dark:text-[#4ADE80]">
                ✓ HTML Converted to PDF Ready: {convertedHtmlPdfResult.name}
              </p>
              <p className="text-[11px] text-[#6E667D] dark:text-[#A39BB5] font-mono mt-0.5">
                {convertedHtmlPdfResult.pageCount}{' '}
                {convertedHtmlPdfResult.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                {formatBytes(convertedHtmlPdfResult.bytes.byteLength)} ·{' '}
                {previewBlocks.length} structured content blocks extracted
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadBytesAsFile(
                    convertedHtmlPdfResult.bytes,
                    convertedHtmlPdfResult.name
                  )
                }
                className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF</span>
              </button>
              {onOpenInEditor && (
                <button
                  type="button"
                  onClick={() => onOpenInEditor(convertedHtmlPdfResult.doc)}
                  className="px-3.5 py-2 rounded-lg bg-[#4A1D5E] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Open in PDF Editor</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: Live Rendered Webpage Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Rendered Webpage Preview ({previewBlocks.length} blocks extracted for PDF)
              </span>
              <span className="text-[11px] font-semibold text-[#15803D]">
                ✓ CSS/JS Code Stripped from PDF Output
              </span>
            </div>
            <div className="rounded-xl border border-[#E4DFEC] dark:border-[#261F33] bg-white overflow-hidden h-[300px] shadow-2xs">
              <iframe
                title="HTML to PDF Rendered Preview"
                sandbox=""
                srcDoc={htmlSourceInput}
                className="w-full h-full border-0 bg-white"
              />
            </div>
          </div>

          {/* Right: HTML Source Markup Editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#6E667D] dark:text-[#A39BB5]">
                HTML Source Input (Editable)
              </label>
              <span className="text-[11px] font-mono text-[#6E667D]">
                {htmlFileName}.pdf
              </span>
            </div>
            <textarea
              rows={12}
              value={htmlSourceInput}
              onChange={(e) => setHtmlSourceInput(e.target.value)}
              className="w-full h-[300px] p-3.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] font-mono text-xs leading-relaxed"
            />
          </div>
        </div>
      </div>
    );
  }

  // 11. UNLOCK PDF WORKSPACE
  if (activeTool === 'unlock-pdf' && selectedDoc) {
    return (
      <div className="space-y-5 max-w-xl">
        <div className="border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
            <Unlock className="w-4 h-4 text-[#0284C7]" />
            <span>Unlock PDF — Remove Password &amp; Restrictions</span>
          </h2>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-1">
            Strip Local Vault passphrase locks and re-serialize an unrestricted, unlocked PDF copy of{' '}
            <strong>{selectedDoc.name}</strong>.
          </p>
        </div>

        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            setIsBusy(true);
            try {
              const unlocked = await unlockPdfDocument(selectedDoc.pdfData);
              const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Unlocked.pdf`;
              const updated: StoredDocument = {
                ...selectedDoc,
                pdfData: unlocked,
                sizeBytes: unlocked.byteLength,
                isProtected: false,
                protectionHint: undefined,
                updatedAt: new Date().toISOString(),
              };
              await onUpdateDocument(updated);
              downloadBytesAsFile(unlocked, outName);
              setFeedback(
                `Unlocked "${selectedDoc.name}" and downloaded unrestricted PDF "${outName}".`
              );
            } finally {
              setIsBusy(false);
            }
          }}
          className="px-5 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <Unlock className="w-4 h-4" />
          <span>{isBusy ? 'Unlocking...' : 'Unlock PDF & Download'}</span>
        </button>
      </div>
    );
  }

  // 12. PDF TO PDF/A WORKSPACE
  if (activeTool === 'pdf-to-pdfa' && selectedDoc) {
    return (
      <div className="space-y-5 max-w-xl">
        <div className="border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
            <Archive className="w-4 h-4 text-[#0284C7]" />
            <span>PDF to PDF/A — ISO Standardized Long-Term Archiving</span>
          </h2>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-1">
            Embed ISO 19005 XMP archival metadata and self-contained catalog headers into{' '}
            <strong>{selectedDoc.name}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setPdfAConformance(level)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                pdfAConformance === level
                  ? 'bg-[#4A1D5E] text-white border-[#4A1D5E]'
                  : 'bg-[#FAF9FB] dark:bg-[#0D0A12] border-[#E4DFEC] dark:border-[#261F33]'
              }`}
            >
              {level} (ISO 19005)
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            setIsBusy(true);
            try {
              const pdfaBytes = await convertPdfToPdfA(
                selectedDoc.pdfData,
                selectedDoc.name,
                pdfAConformance
              );
              const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_PDFA.pdf`;
              const newDoc: StoredDocument = {
                ...selectedDoc,
                id: `doc-pdfa-${Date.now()}`,
                name: outName,
                pdfData: pdfaBytes,
                sizeBytes: pdfaBytes.byteLength,
                updatedAt: new Date().toISOString(),
              };
              await onSaveNewDocument(newDoc);
              downloadBytesAsFile(pdfaBytes, outName);
              setFeedback(
                `Converted "${selectedDoc.name}" to archival ${pdfAConformance} ("${outName}") and downloaded!`
              );
            } finally {
              setIsBusy(false);
            }
          }}
          className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <Archive className="w-4 h-4" />
          <span>Convert to {pdfAConformance} &amp; Download</span>
        </button>
      </div>
    );
  }

  // 13. REPAIR PDF WORKSPACE
  if (activeTool === 'repair-pdf' && selectedDoc) {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[#15803D]" />
            <span>Repair PDF — Recover &amp; Rebuild Corrupted PDF Streams</span>
          </h2>
          <p className="text-xs text-[#6E667D] dark:text-[#A39BB5] mt-1">
            Inspect cross-reference tables, rebuild damaged object streams, and recover all readable pages from{' '}
            <strong>{selectedDoc.name}</strong>.
          </p>
        </div>

        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            setIsBusy(true);
            try {
              const { pdfBytes, recoveredPages, diagnostics } =
                await repairPdfDocument(selectedDoc.pdfData);
              setRepairDiagnostics(diagnostics);
              const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_Repaired.pdf`;
              const updated: StoredDocument = {
                ...selectedDoc,
                pdfData: pdfBytes,
                sizeBytes: pdfBytes.byteLength,
                pageCount: recoveredPages,
                updatedAt: new Date().toISOString(),
              };
              await onUpdateDocument(updated);
              downloadBytesAsFile(pdfBytes, outName);
              setFeedback(
                `Repaired "${selectedDoc.name}" (${recoveredPages} pages verified) and downloaded "${outName}".`
              );
            } finally {
              setIsBusy(false);
            }
          }}
          className="px-5 py-2.5 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <Wrench className="w-4 h-4" />
          <span>
            {isBusy ? 'Repairing PDF...' : 'Repair PDF Structure & Download'}
          </span>
        </button>

        {repairDiagnostics.length > 0 && (
          <div className="p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-1.5 font-mono text-xs">
            {repairDiagnostics.map((line, i) => (
              <p key={i} className="text-[#15803D] dark:text-[#4ADE80]">
                ✓ {line}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 14. COMPARE PDF WORKSPACE
  if (activeTool === 'compare-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-[#0284C7]" />
              <span>Compare PDF — Side-by-Side Document Diff</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Compare <strong>{selectedDoc.name}</strong> (Document A) against another PDF (Document B) to spot text additions and removals.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={compareDocBId}
              onChange={(e) => setCompareDocBId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-xs font-bold"
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  Compare with: {d.name} ({d.pageCount}p)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRunComparePdfs}
              disabled={isBusy}
              className="px-5 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <GitCompare className="w-4 h-4" />
              <span>Run Comparison</span>
            </button>
          </div>
        </div>

        {compareResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <span>
                Similarity: <strong>{compareResult.similarityPct}%</strong>
              </span>
              <span className="text-[#15803D]">
                + {compareResult.addedCount} Added Lines
              </span>
              <span className="text-[#DC2626]">
                − {compareResult.removedCount} Removed Lines
              </span>
            </div>

            <div className="p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] max-h-96 overflow-y-auto space-y-1 font-mono text-xs">
              {compareResult.diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`px-2 py-1 rounded ${
                    line.type === 'added'
                      ? 'bg-[#15803D]/15 text-[#15803D] dark:text-[#4ADE80]'
                      : line.type === 'removed'
                        ? 'bg-[#DC2626]/15 text-[#DC2626] dark:text-[#F87171] line-through'
                        : 'text-[#6E667D]'
                  }`}
                >
                  {line.type === 'added'
                    ? '+ '
                    : line.type === 'removed'
                      ? '- '
                      : '  '}
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 15. SUMMARIZE PDF WORKSPACE
  if (activeTool === 'summarize-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#7C3AED]" />
              <span>PDF Summarizer — Executive Summary &amp; Key Takeaways</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Instant extractive summary, reading metrics, and page-by-page highlights for{' '}
              <strong>{selectedDoc.name}</strong>.
            </p>
          </div>

          {summaryResult && (
            <button
              type="button"
              onClick={async () => {
                const reportText = `# EXECUTIVE SUMMARY: ${selectedDoc.name}\n\n${summaryResult.executiveSummary}\n\n## Key Takeaways\n${summaryResult.keyPoints.map((k) => `* ${k}`).join('\n')}\n\n## Page Highlights\n${summaryResult.pageHighlights.map((p) => `* Page ${p.pageNumber}: ${p.highlight}`).join('\n')}`;
                const blocks = plainTextToWordBlocks(reportText);
                const { pdfBytes } = await generatePdfFromWordBlocks(blocks, {
                  pageSize: 'A4',
                  fontFamily: 'helvetica',
                  baseFontSize: 11,
                  lineSpacing: 1.4,
                  addPageNumbers: true,
                });
                downloadBytesAsFile(
                  pdfBytes,
                  `${selectedDoc.name.replace(/\.pdf$/i, '')}_Summary.pdf`
                );
              }}
              className="px-4 py-2.5 rounded-xl bg-[#4A1D5E] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Summary PDF</span>
            </button>
          )}
        </div>

        {summaryResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-xs text-[#6E667D] font-mono">
              <span>{summaryResult.wordCount} words</span>
              <span>·</span>
              <span>{summaryResult.sentenceCount} sentences</span>
              <span>·</span>
              <span>~{summaryResult.readingTimeMinutes} min read</span>
            </div>

            <div className="p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A1D5E] dark:text-[#D5B3FF]">
                Executive Summary
              </h3>
              <p className="text-xs leading-relaxed">
                {summaryResult.executiveSummary}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A1D5E] dark:text-[#D5B3FF]">
                Key Points
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-xs">
                {summaryResult.keyPoints.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 16. TRANSLATE PDF WORKSPACE
  if (activeTool === 'translate-pdf' && selectedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Languages className="w-4 h-4 text-[#7C3AED]" />
              <span>Translate PDF — Multi-Language Document Translator</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Translate headings, instructions, and content of{' '}
              <strong>{selectedDoc.name}</strong> and export as a new PDF.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={translateTargetLang}
              onChange={(e) => {
                const nextLang = e.target.value as 'sw' | 'en' | 'fr' | 'es';
                setTranslateTargetLang(nextLang);
                setTranslatedText(
                  translateDocumentTextLocal(translateSourceText, nextLang)
                );
              }}
              className="px-3 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] bg-white dark:bg-[#16111F] text-xs font-bold"
            >
              <option value="sw">Target: Swahili / Kiswahili</option>
              <option value="en">Target: English</option>
              <option value="fr">Target: French (Français)</option>
              <option value="es">Target: Spanish (Español)</option>
            </select>

            <button
              type="button"
              onClick={async () => {
                setIsBusy(true);
                try {
                  const blocks = plainTextToWordBlocks(
                    translatedText || 'Translated Document'
                  );
                  const { pdfBytes, pageCount } =
                    await generatePdfFromWordBlocks(blocks, {
                      pageSize: 'A4',
                      fontFamily: 'helvetica',
                      baseFontSize: 11,
                      lineSpacing: 1.4,
                      addPageNumbers: true,
                    });
                  const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}_${translateTargetLang.toUpperCase()}.pdf`;
                  const newDoc: StoredDocument = {
                    id: `doc-trans-${Date.now()}`,
                    name: outName,
                    category: selectedDoc.category,
                    starred: false,
                    sizeBytes: pdfBytes.byteLength,
                    pageCount,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    lastOpenedAt: new Date().toISOString(),
                    pdfData: pdfBytes,
                  };
                  await onSaveNewDocument(newDoc);
                  downloadBytesAsFile(pdfBytes, outName);
                  setFeedback(
                    `Exported translated PDF "${outName}" (${pageCount} pages) and downloaded!`
                  );
                } finally {
                  setIsBusy(false);
                }
              }}
              className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Translated PDF</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#6E667D]">
              Original Extracted Document Text
            </label>
            <textarea
              rows={11}
              value={translateSourceText}
              onChange={(e) => {
                setTranslateSourceText(e.target.value);
                setTranslatedText(
                  translateDocumentTextLocal(
                    e.target.value,
                    translateTargetLang
                  )
                );
              }}
              className="w-full p-3.5 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] text-xs leading-relaxed"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#4A1D5E] dark:text-[#D5B3FF]">
              Translated Output (Editable before PDF Export)
            </label>
            <textarea
              rows={11}
              value={translatedText}
              onChange={(e) => setTranslatedText(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-white dark:bg-[#16111F] border-2 border-[#4A1D5E]/40 text-xs leading-relaxed"
            />
          </div>
        </div>
      </div>
    );
  }

  // 17. PDF TO MARKDOWN WORKSPACE
  if (activeTool === 'pdf-to-markdown' && selectedDoc) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <FileCode className="w-4 h-4 text-[#7C3AED]" />
              <span>PDF to Markdown (.MD) Converter</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Convert <strong>{selectedDoc.name}</strong> into clean Markdown with headings, lists, and sections preserved.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(markdownOutput);
                setCopiedTextFlag(true);
                setTimeout(() => setCopiedTextFlag(false), 2000);
              }}
              className="px-4 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {copiedTextFlag ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#15803D]" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                const outName = `${selectedDoc.name.replace(/\.pdf$/i, '')}.md`;
                downloadBytesAsFile(
                  new TextEncoder().encode(markdownOutput),
                  outName,
                  'text/markdown'
                );
              }}
              className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download .MD File</span>
            </button>
          </div>
        </div>

        <textarea
          rows={12}
          value={markdownOutput}
          onChange={(e) => setMarkdownOutput(e.target.value)}
          className="w-full p-4 rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] font-mono text-xs leading-relaxed"
        />
      </div>
    );
  }

  // 18. CREATE A WORKFLOW (MULTI-STEP PIPELINE BUILDER)
  if (activeTool === 'workflow-pdf' && selectedDoc) {
    const availableSteps: Array<{
      id:
        | 'remove-watermark'
        | 'page-numbers-pdf'
        | 'compress-pdf'
        | 'pdf-to-pdfa'
        | 'watermark-pdf';
      label: string;
    }> = [
      {
        id: 'remove-watermark',
        label: 'Smart Watermark Remover (Preserve Colors & Bold Text)',
      },
      {
        id: 'page-numbers-pdf',
        label: 'Add Bottom-Center Page Numbers (Page 1 of N)',
      },
      { id: 'compress-pdf', label: 'Optimize & Compress PDF Size' },
      { id: 'pdf-to-pdfa', label: 'Convert to ISO PDF/A-1b Archival Format' },
      { id: 'watermark-pdf', label: 'Stamp "VERIFIED COPY" Watermark' },
    ];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <Workflow className="w-4 h-4 text-[#E5322D]" />
              <span>Create a Workflow — Multi-Step PDF Automation Pipeline</span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Chain multiple PDF tools together and execute them sequentially on{' '}
              <strong>{selectedDoc.name}</strong> in a single click.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRunCustomWorkflow}
            disabled={isBusy || workflowSteps.length === 0}
            className="px-5 py-2.5 rounded-xl bg-[#E5322D] hover:bg-[#C8231E] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {isBusy
                ? workflowStepStatus || 'Running Workflow...'
                : `Run ${workflowSteps.length}-Step Workflow & Download`}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="block text-xs font-bold">Workflow Name</label>
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="w-full px-3.5 py-2 text-xs font-bold rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
            />

            <p className="text-xs font-bold pt-2">
              Add a Tool Step to Pipeline:
            </p>
            <div className="space-y-1.5">
              {availableSteps.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setWorkflowSteps((prev) => [...prev, st.id])}
                  className="w-full p-2.5 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] hover:border-[#4A1D5E] text-left text-xs font-semibold flex items-center justify-between cursor-pointer"
                >
                  <span>+ {st.label}</span>
                  <Plus className="w-3.5 h-3.5 text-[#4A1D5E]" />
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E667D]">
              Active Pipeline Sequence ({workflowSteps.length} Steps)
            </h3>
            {workflowSteps.map((stepId, idx) => {
              const info = availableSteps.find((s) => s.id === stepId);
              return (
                <React.Fragment key={`${stepId}-${idx}`}>
                  <div className="p-3 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#4A1D5E] text-white text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold">
                        {info?.label || stepId}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setWorkflowSteps((prev) =>
                          prev.filter((_, i) => i !== idx)
                        )
                      }
                      className="text-[#DC2626] p-1 hover:bg-[#DC2626]/10 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {idx < workflowSteps.length - 1 && (
                    <div className="flex justify-center">
                      <ArrowDown className="w-4 h-4 text-[#6E667D]" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Fallback if Edit PDF or Read PDF was selected inside Tools Hub
  if (
    (activeTool === 'edit-pdf' || activeTool === 'read-pdf') &&
    selectedDoc &&
    onOpenInEditor
  ) {
    return (
      <div className="py-8 text-center space-y-3">
        <FileText className="w-10 h-10 text-[#4A1D5E] mx-auto" />
        <h3 className="text-base font-bold">
          Open {selectedDoc.name} in Full-Screen PDF Editor
        </h3>
        <button
          type="button"
          onClick={() => onOpenInEditor(selectedDoc)}
          className="px-5 py-2.5 rounded-xl bg-[#4A1D5E] text-white text-xs font-bold cursor-pointer"
        >
          Launch Full-Screen PDF Editor
        </button>
      </div>
    );
  }

  // 19. PDF TO KPF (AMAZON KINDLE PACKAGE FORMAT .KPF / KDP STUDIO)
  if (activeTool === 'pdf-to-kpf' && selectedDoc) {
    const activeChapter =
      kpfChapters[activeKpfChapterIdx] || kpfChapters[0] || null;
    const baseOutName = (
      kpfBookTitle.trim() || selectedDoc.name.replace(/\.pdf$/i, '')
    ).replace(/[^a-zA-Z0-9_-]+/g, '_');

    const handleDownloadKindlePackage = (ext: 'kpf' | 'epub') => {
      if (kpfChapters.length === 0) return;
      setIsBusy(true);
      try {
        const pkgBytes = buildKindleKpfPackageBytes(kpfChapters, {
          title: kpfBookTitle,
          author: kpfBookAuthor,
          language: kpfBookLang,
          layoutMode: kpfLayoutMode,
          fontScalePct: kpfFontScale,
        });
        const outFile = `${baseOutName}.${ext}`;
        const mime =
          ext === 'kpf'
            ? 'application/vnd.amazon.ebook'
            : 'application/epub+zip';
        downloadBytesAsFile(pkgBytes, outFile, mime);
        setFeedback(
          `Built Amazon Kindle ${ext.toUpperCase()} package "${outFile}" (${kpfChapters.length} chapters, ${
            kpfLayoutMode === 'reflowable'
              ? 'Reflowable KDP Layout'
              : 'Print Replica Fixed Layout'
          }, ${formatBytes(pkgBytes.byteLength)}) and downloaded!`
        );
      } finally {
        setIsBusy(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8] flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#E47911] text-white text-[11px] font-extrabold tracking-wider">
                KPF
              </span>
              <span>
                PDF to KPF — Amazon Kindle Create &amp; KDP Publishing Studio
              </span>
            </h2>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Convert <strong>{selectedDoc.name}</strong> into an Amazon Kindle
              Package Format (<strong>.KPF</strong>) with Reflowable chapters or
              Print Replica pages ready for Kindle Direct Publishing (KDP).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleDownloadKindlePackage('epub')}
              disabled={isBusy || kpfChapters.length === 0}
              className="px-4 py-2.5 rounded-xl border border-[#E47911]/50 bg-[#FFF8F1] dark:bg-[#241911] text-[#C25E00] dark:text-[#FDBA74] hover:bg-[#FFEDD5] text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export KDP .EPUB</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadKindlePackage('kpf')}
              disabled={isBusy || kpfChapters.length === 0}
              className="px-5 py-2.5 rounded-xl bg-[#E47911] hover:bg-[#C8680B] text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>
                {isBusy
                  ? 'Packaging Kindle .KPF...'
                  : 'Convert & Download .KPF'}
              </span>
            </button>
          </div>
        </div>

        {/* KDP Book Metadata & Layout Mode Controls */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] rounded-2xl p-4">
          <div>
            <label className="block text-[11px] font-bold text-[#6E667D] dark:text-[#A39BB5] mb-1">
              Kindle Book Title
            </label>
            <input
              type="text"
              value={kpfBookTitle}
              onChange={(e) => setKpfBookTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#6E667D] dark:text-[#A39BB5] mb-1">
              Author / Publisher
            </label>
            <input
              type="text"
              value={kpfBookAuthor}
              onChange={(e) => setKpfBookAuthor(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#6E667D] dark:text-[#A39BB5] mb-1">
              Kindle KPF Format Mode
            </label>
            <select
              value={kpfLayoutMode}
              onChange={(e) =>
                setKpfLayoutMode(
                  e.target.value as 'reflowable' | 'print-replica'
                )
              }
              className="w-full px-3 py-2 text-xs font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
            >
              <option value="reflowable">
                Reflowable Kindle eBook (Text &amp; Chapters)
              </option>
              <option value="print-replica">
                Print Replica Fixed-Layout (Textbooks &amp; Exams)
              </option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#6E667D] dark:text-[#A39BB5] mb-1">
              Language &amp; Font Scale ({kpfFontScale}%)
            </label>
            <div className="flex items-center gap-2">
              <select
                value={kpfBookLang}
                onChange={(e) => setKpfBookLang(e.target.value)}
                className="px-2.5 py-2 text-xs font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
              >
                <option value="en">EN</option>
                <option value="sw">SW</option>
                <option value="fr">FR</option>
                <option value="es">ES</option>
              </select>
              <input
                type="range"
                min={85}
                max={135}
                step={5}
                value={kpfFontScale}
                onChange={(e) => setKpfFontScale(Number(e.target.value))}
                className="w-full accent-[#E47911]"
              />
            </div>
          </div>
        </div>

        {/* Chapter Navigator + Editor + Live Kindle Paperwhite Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Table of Contents / Chapters */}
          <div className="lg:col-span-3 rounded-2xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] p-3.5 space-y-2.5 max-h-[430px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6E667D]">
                KPF Chapters ({kpfChapters.length})
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#E47911]/15 text-[#C25E00] dark:text-[#FDBA74]">
                TOC Ready
              </span>
            </div>
            {kpfChapters.map((ch, idx) => (
              <button
                key={ch.chapterNumber}
                type="button"
                onClick={() => setActiveKpfChapterIdx(idx)}
                className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all cursor-pointer ${
                  idx === activeKpfChapterIdx
                    ? 'bg-[#FFF8F1] dark:bg-[#241911] border-[#E47911] text-[#14101B] dark:text-[#F4F1F8] font-bold shadow-2xs'
                    : 'bg-white dark:bg-[#16111F] border-[#E4DFEC] dark:border-[#261F33] text-[#6E667D] dark:text-[#A39BB5]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{ch.title}</span>
                  <span className="text-[10px] opacity-75 shrink-0">
                    p.{ch.pageNumber}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Middle Column: Editable Chapter Heading & Reflowable Text */}
          <div className="lg:col-span-5 rounded-2xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#14101B] dark:text-[#F4F1F8]">
                Edit Kindle Chapter #{activeKpfChapterIdx + 1}
              </span>
              <span className="text-[11px] text-[#6E667D]">
                Source Page {activeChapter?.pageNumber || 1}
              </span>
            </div>
            {activeChapter && (
              <>
                <div>
                  <label className="block text-[11px] font-bold text-[#6E667D] mb-1">
                    Chapter Heading (Included in Kindle TOC)
                  </label>
                  <input
                    type="text"
                    value={activeChapter.title}
                    onChange={(e) => {
                      const val = e.target.value;
                      setKpfChapters((prev) =>
                        prev.map((item, i) =>
                          i === activeKpfChapterIdx
                            ? { ...item, title: val }
                            : item
                        )
                      );
                    }}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#6E667D] mb-1">
                    Chapter Paragraphs (One paragraph per line)
                  </label>
                  <textarea
                    rows={10}
                    value={activeChapter.paragraphs.join('\n\n')}
                    onChange={(e) => {
                      const paras = e.target.value
                        .split(/\n+/)
                        .map((l) => l.trim())
                        .filter(Boolean);
                      setKpfChapters((prev) =>
                        prev.map((item, i) =>
                          i === activeKpfChapterIdx
                            ? {
                                ...item,
                                paragraphs:
                                  paras.length > 0 ? paras : ['(Empty page)'],
                              }
                            : item
                        )
                      );
                    }}
                    className="w-full p-3 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-xs leading-relaxed font-serif"
                  />
                </div>
              </>
            )}
          </div>

          {/* Right Column: Live Kindle Paperwhite e-Reader Simulator */}
          <div className="lg:col-span-4 rounded-2xl bg-[#1D1B22] p-4 flex flex-col justify-between border border-[#2E2A36]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-white/90 tracking-wide uppercase">
                Kindle Previewer ({kpfLayoutMode})
              </span>
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'paper', label: 'Paper' },
                    { id: 'sepia', label: 'Sepia' },
                    { id: 'night', label: 'Night' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setKpfReaderTheme(t.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      kpfReaderTheme === t.id
                        ? 'bg-[#E47911] text-white'
                        : 'bg-white/10 text-white/70'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`rounded-xl p-4 h-[310px] overflow-y-auto shadow-inner transition-colors ${
                kpfReaderTheme === 'sepia'
                  ? 'bg-[#F6EFE2] text-[#2B2218]'
                  : kpfReaderTheme === 'night'
                    ? 'bg-[#121316] text-[#E4E2E8]'
                    : 'bg-white text-[#14101B]'
              }`}
            >
              {activeChapter ? (
                <div className="space-y-2.5 font-serif">
                  <div className="text-[10px] uppercase tracking-widest opacity-60 text-center pb-1 border-b border-current/15">
                    {kpfBookTitle}
                  </div>
                  <h4 className="text-sm font-bold leading-snug">
                    {activeChapter.title}
                  </h4>
                  {kpfLayoutMode === 'print-replica' &&
                    activeChapter.imageDataUrl && (
                      <img
                        src={activeChapter.imageDataUrl}
                        alt={activeChapter.title}
                        className="w-full h-auto rounded border border-black/10 my-2"
                      />
                    )}
                  {activeChapter.paragraphs.map((para, pIdx) => (
                    <p
                      key={pIdx}
                      style={{ fontSize: `${Math.round(12 * (kpfFontScale / 100))}px` }}
                      className="leading-relaxed text-justify"
                    >
                      {para}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs opacity-70">
                  Extracting chapters for Kindle preview...
                </p>
              )}
            </div>

            <div className="flex items-center justify-between text-[10px] text-white/60 pt-2.5">
              <span>{kpfBookAuthor}</span>
              <span>
                Location {activeKpfChapterIdx * 18 + 1} · Chapter{' '}
                {activeKpfChapterIdx + 1} of {Math.max(1, kpfChapters.length)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 20. HTML & EBOOK READER WORKSPACE (.HTML, .HTM, .XHTML, .EPUB, .KPF, .MOBI, .FB2, .DOCX, .ODT, .MD)
  if (activeTool === 'html-reader') {
    const readerBlocks = parseHtmlIntoWordBlocks(htmlSourceInput);
    const readerHeadings = readerBlocks
      .map((blk, bIdx) => ({ blk, bIdx }))
      .filter(
        ({ blk }) =>
          (blk.type === 'h1' || blk.type === 'h2' || blk.type === 'h3') &&
          Boolean(blk.text?.trim())
      );
    const filteredBlocks = htmlReaderSearchQuery.trim()
      ? readerBlocks.filter((b) => {
          const q = htmlReaderSearchQuery.trim().toLowerCase();
          if (b.text && b.text.toLowerCase().includes(q)) return true;
          if (
            b.rows &&
            b.rows.some((r) => r.some((c) => c.toLowerCase().includes(q)))
          )
            return true;
          return false;
        })
      : readerBlocks;

    const totalWordCount = readerBlocks
      .map((b) =>
        b.rows ? b.rows.map((r) => r.join(' ')).join(' ') : b.text || ''
      )
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length;
    const estReadMin = Math.max(1, Math.round(totalWordCount / 200));

    const themeClasses =
      htmlReaderTheme === 'sepia'
        ? 'bg-[#F6EFE2] text-[#2B2218] border-[#DFD2BA]'
        : htmlReaderTheme === 'dusk'
          ? 'bg-[#1E2430] text-[#E2E8F0] border-[#334155]'
          : htmlReaderTheme === 'night'
            ? 'bg-[#111318] text-[#E4E2E8] border-[#262936]'
            : 'bg-white text-[#14101B] border-[#E4DFEC]';

    const fontClass =
      htmlReaderFontFamily === 'serif'
        ? 'font-serif'
        : htmlReaderFontFamily === 'mono'
          ? 'font-mono'
          : 'font-sans';

    const fullHtmlDocument = /<html\b/i.test(htmlSourceInput)
      ? htmlSourceInput
      : `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlFileName}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #14101B; max-width: 820px; margin: 0 auto; padding: 28px; line-height: 1.65; }
    h1, h2, h3 { color: #2D123B; margin-top: 1.3em; margin-bottom: 0.45em; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #CBD5E1; padding: 8px 10px; text-align: left; }
    th { background: #F1F5F9; font-weight: 700; }
    blockquote { border-left: 4px solid #4A1D5E; margin: 12px 0; padding-left: 14px; color: #4B4458; font-style: italic; }
    pre, code { background: #F8FAFC; border-radius: 6px; padding: 2px 6px; font-family: monospace; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
  </style>
</head>
<body>
${sanitizeHtmlForReader(htmlSourceInput, htmlFileName)}
</body>
</html>`;

    return (
      <div className="space-y-5">
        {/* Header & Primary Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4DFEC] dark:border-[#261F33] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-[#0D9488] text-white text-[11px] font-extrabold tracking-wider">
                {htmlReaderFormatBadge || 'HTML'} READER
              </span>
              <h2 className="text-base font-bold text-[#14101B] dark:text-[#F4F1F8]">
                HTML, Webpage &amp; eBook Reader (.HTML, .EPUB, .KPF, .DOCX, .ODT)
              </h2>
            </div>
            <p className="text-xs text-[#6E667D] dark:text-[#A39BB5]">
              Open and read <code>.html</code>, <code>.htm</code>,{' '}
              <code>.xhtml</code>, <code>.epub</code>, <code>.kpf</code>,{' '}
              <code>.mobi</code>, <code>.fb2</code>, <code>.docx</code>,{' '}
              <code>.odt</code>, <code>.md</code>, or <code>.json</code> files
              with customizable typography, chapters, Read Aloud TTS, and 1-click
              PDF export.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3.5 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs">
              <Upload className="w-3.5 h-3.5" />
              <span>Open .HTML / .EPUB / .KPF / File</span>
              <input
                type="file"
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    e.target.value = '';
                    await handleUploadHtmlFile(f);
                  }
                }}
              />
            </label>

            <button
              type="button"
              onClick={handleConvertHtmlToPdf}
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-[#4A1D5E] hover:bg-[#3B174B] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isBusy ? 'Converting...' : 'Export as PDF'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const cleanName = `${htmlFileName.replace(/\.(html?|pdf)$/i, '') || 'Document'}.html`;
                downloadBytesAsFile(
                  new TextEncoder().encode(fullHtmlDocument),
                  cleanName,
                  'text/html'
                );
                setFeedback(`Downloaded HTML document "${cleanName}".`);
              }}
              className="px-3.5 py-2 rounded-xl border border-[#E4DFEC] dark:border-[#261F33] hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5 text-[#0D9488]" />
              <span>Save .HTML</span>
            </button>
          </div>
        </div>

        {/* Reader Toolbar: View Switcher + Theme + Font Size + Font Family + Search + Read Aloud */}
        <div className="p-3.5 rounded-2xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] flex flex-wrap items-center justify-between gap-3">
          {/* 3-Mode View Switcher */}
          <div className="inline-flex items-center p-1 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]">
            {(
              [
                { id: 'reflow', label: 'Reflowable Reader' },
                { id: 'webpage', label: 'Webpage View' },
                { id: 'source', label: 'HTML Code Editor' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setHtmlReaderViewMode(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  htmlReaderViewMode === tab.id
                    ? 'bg-[#0D9488] text-white'
                    : 'text-[#6E667D] dark:text-[#A39BB5] hover:text-[#14101B] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Theme + Font Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Theme Pills */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]">
              {(
                [
                  { id: 'paper', label: 'Paper', dot: 'bg-white border-gray-300' },
                  { id: 'sepia', label: 'Sepia', dot: 'bg-[#F6EFE2] border-amber-300' },
                  { id: 'dusk', label: 'Dusk', dot: 'bg-[#1E2430] border-slate-600' },
                  { id: 'night', label: 'Night', dot: 'bg-[#111318] border-gray-700' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setHtmlReaderTheme(t.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${
                    htmlReaderTheme === t.id
                      ? 'bg-[#4A1D5E] text-white dark:bg-[#9D5CE5] dark:text-[#0D0A12]'
                      : 'text-[#6E667D] dark:text-[#A39BB5]'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full border ${t.dot}`} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Font Family */}
            <div className="inline-flex items-center p-1 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]">
              {(
                [
                  { id: 'serif', label: 'Serif' },
                  { id: 'sans', label: 'Sans' },
                  { id: 'mono', label: 'Mono' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setHtmlReaderFontFamily(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    htmlReaderFontFamily === f.id
                      ? 'bg-[#14101B] text-white dark:bg-white dark:text-[#0D0A12]'
                      : 'text-[#6E667D] dark:text-[#A39BB5]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Font Size A- / A+ */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33]">
              <button
                type="button"
                onClick={() =>
                  setHtmlReaderFontSize((s) => Math.max(12, s - 1))
                }
                className="px-2.5 py-1 rounded-lg text-xs font-extrabold hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                title="Decrease Font Size"
              >
                A-
              </button>
              <span className="px-1.5 text-[11px] font-mono font-bold text-[#6E667D]">
                {htmlReaderFontSize}px
              </span>
              <button
                type="button"
                onClick={() =>
                  setHtmlReaderFontSize((s) => Math.min(28, s + 1))
                }
                className="px-2.5 py-1 rounded-lg text-xs font-extrabold hover:bg-[#F2EFF6] dark:hover:bg-[#261F33] cursor-pointer"
                title="Increase Font Size"
              >
                A+
              </button>
            </div>

            {/* Line Spacing */}
            <select
              value={String(htmlReaderLineHeight)}
              onChange={(e) => setHtmlReaderLineHeight(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#16111F] border border-[#E4DFEC] dark:border-[#261F33] text-[11px] font-bold"
              title="Line Spacing"
            >
              <option value="1.45">Compact (1.45x)</option>
              <option value="1.75">Comfort (1.75x)</option>
              <option value="2.05">Wide (2.05x)</option>
            </select>

            {/* Read Aloud TTS Button */}
            <button
              type="button"
              onClick={() => {
                const allPlainText = readerBlocks
                  .map((b) =>
                    b.rows
                      ? b.rows.map((r) => r.join(' ')).join('. ')
                      : b.text || ''
                  )
                  .join('. ');
                toggleHtmlReaderReadAloud(allPlainText);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                htmlReaderSpeaking
                  ? 'bg-[#DC2626] text-white'
                  : 'bg-[#0D9488]/15 text-[#0D9488] dark:text-[#5EEAD4]'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{htmlReaderSpeaking ? 'Stop Reading' : 'Read Aloud'}</span>
            </button>
          </div>
        </div>

        {/* Search & Stats Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-[#6E667D] dark:text-[#A39BB5] font-mono">
            <span className="font-bold text-[#14101B] dark:text-[#F4F1F8]">
              {htmlFileName}
            </span>
            <span>·</span>
            <span>{readerBlocks.length} blocks</span>
            <span>·</span>
            <span>{totalWordCount} words</span>
            <span>·</span>
            <span>~{estReadMin} min read</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-72">
            <input
              type="search"
              value={htmlReaderSearchQuery}
              onChange={(e) => setHtmlReaderSearchQuery(e.target.value)}
              placeholder="Search inside HTML / eBook..."
              className="w-full px-3 py-1.5 text-xs rounded-xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33]"
            />
          </div>
        </div>

        {/* Main Reader Body: TOC Sidebar + Active Reader View */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Chapters & Headings Outline (Table of Contents) */}
          <div className="lg:col-span-3 rounded-2xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] p-3.5 space-y-2 max-h-[520px] overflow-y-auto">
            <div className="flex items-center justify-between pb-1 border-b border-[#E4DFEC] dark:border-[#261F33]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6E667D]">
                Outline / Chapters ({readerHeadings.length})
              </span>
            </div>
            {readerHeadings.length === 0 ? (
              <p className="text-xs text-[#6E667D] py-2">
                No headings detected. All paragraphs are shown in the reader.
              </p>
            ) : (
              readerHeadings.map(({ blk, bIdx }, idx) => (
                <button
                  key={`${bIdx}-${idx}`}
                  type="button"
                  onClick={() => {
                    setHtmlReaderViewMode('reflow');
                    const targetEl = readerContentRef.current?.querySelector(
                      `[data-reader-block="${bIdx}"]`
                    );
                    if (targetEl) {
                      targetEl.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-xl text-xs hover:bg-[#0D9488]/10 transition-colors cursor-pointer truncate ${
                    blk.type === 'h1'
                      ? 'font-bold text-[#14101B] dark:text-[#F4F1F8]'
                      : blk.type === 'h2'
                        ? 'pl-4 font-semibold text-[#4B4458] dark:text-[#C5BED4]'
                        : 'pl-6 text-[#6E667D] dark:text-[#A39BB5]'
                  }`}
                >
                  {blk.text}
                </button>
              ))
            )}
          </div>

          {/* Right: Active View (Reflowable Reader | Webpage Iframe | HTML Source Editor) */}
          <div className="lg:col-span-9">
            {htmlReaderViewMode === 'reflow' && (
              <div
                ref={readerContentRef}
                style={{
                  fontSize: `${htmlReaderFontSize}px`,
                  lineHeight: htmlReaderLineHeight,
                }}
                className={`rounded-2xl border p-6 sm:p-8 max-h-[520px] overflow-y-auto shadow-xs space-y-4 transition-colors ${themeClasses} ${fontClass}`}
              >
                {filteredBlocks.length === 0 ? (
                  <p className="text-sm opacity-70">
                    No matching content found for &ldquo;{htmlReaderSearchQuery}&rdquo;.
                  </p>
                ) : (
                  filteredBlocks.map((blk, idx) => {
                    if (blk.type === 'h1') {
                      return (
                        <h1
                          key={idx}
                          data-reader-block={idx}
                          style={{ fontSize: `${htmlReaderFontSize + 8}px` }}
                          className="font-bold tracking-tight pt-2 pb-1 border-b border-current/15"
                        >
                          {blk.text}
                        </h1>
                      );
                    }
                    if (blk.type === 'h2') {
                      return (
                        <h2
                          key={idx}
                          data-reader-block={idx}
                          style={{ fontSize: `${htmlReaderFontSize + 4}px` }}
                          className="font-bold pt-3"
                        >
                          {blk.text}
                        </h2>
                      );
                    }
                    if (blk.type === 'h3') {
                      return (
                        <h3
                          key={idx}
                          data-reader-block={idx}
                          style={{ fontSize: `${htmlReaderFontSize + 2}px` }}
                          className="font-semibold pt-2"
                        >
                          {blk.text}
                        </h3>
                      );
                    }
                    if (blk.type === 'li') {
                      return (
                        <div
                          key={idx}
                          data-reader-block={idx}
                          className="pl-4 flex items-start gap-2"
                        >
                          <span className="text-[#0D9488] font-bold">•</span>
                          <span>
                            {(blk.text || '').replace(
                              /^(\*|-|\u2022|\d+\.)\s+/,
                              ''
                            )}
                          </span>
                        </div>
                      );
                    }
                    if (blk.type === 'table' && blk.rows) {
                      return (
                        <div
                          key={idx}
                          data-reader-block={idx}
                          className="overflow-x-auto my-3"
                        >
                          <table className="w-full border-collapse text-left">
                            <tbody>
                              {blk.rows.map((row, rIdx) => (
                                <tr
                                  key={rIdx}
                                  className={
                                    rIdx === 0
                                      ? 'font-bold bg-current/10'
                                      : 'border-t border-current/15'
                                  }
                                >
                                  {row.map((cell, cIdx) => (
                                    <td
                                      key={cIdx}
                                      className="p-2.5 border border-current/20"
                                      style={{
                                        fontSize: `${Math.max(12, htmlReaderFontSize - 2)}px`,
                                      }}
                                    >
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    }
                    if (blk.type === 'image' && blk.imageDataUrl) {
                      return (
                        <figure
                          key={idx}
                          data-reader-block={idx}
                          className="my-3 flex justify-center"
                        >
                          <img
                            src={blk.imageDataUrl}
                            alt="Document figure"
                            className="max-w-full max-h-96 rounded-xl border border-current/15"
                          />
                        </figure>
                      );
                    }
                    return (
                      <p
                        key={idx}
                        data-reader-block={idx}
                        className={`${blk.bold ? 'font-bold' : ''} ${
                          blk.italic ? 'italic opacity-90' : ''
                        }`}
                      >
                        {blk.text}
                      </p>
                    );
                  })
                )}
              </div>
            )}

            {htmlReaderViewMode === 'webpage' && (
              <div className="rounded-2xl border border-[#E4DFEC] dark:border-[#261F33] bg-white overflow-hidden h-[520px] shadow-xs">
                <iframe
                  title="HTML Reader Webpage Preview"
                  sandbox=""
                  srcDoc={fullHtmlDocument}
                  className="w-full h-full border-0 bg-white"
                />
              </div>
            )}

            {htmlReaderViewMode === 'source' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#6E667D]">
                  <span>
                    Edit HTML markup below — changes immediately update the
                    Reflowable Reader, Webpage View, and PDF Export:
                  </span>
                </div>
                <textarea
                  rows={18}
                  value={htmlSourceInput}
                  onChange={(e) => setHtmlSourceInput(e.target.value)}
                  className="w-full h-[490px] p-4 rounded-2xl bg-[#FAF9FB] dark:bg-[#0D0A12] border border-[#E4DFEC] dark:border-[#261F33] font-mono text-xs leading-relaxed"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
