import React from 'react';
import { ToolId } from '../types/document';

interface ToolIconProps {
  toolId: ToolId;
  className?: string;
}

/**
 * Custom multi-layered SVG icons faithfully matching the reference PDF Tools grid:
 * - Two-layer overlapping conversion badges (PDF <-> Word, PPT, Excel, JPG, HTML, PDF/A, Markdown)
 * - Coral-orange Organize badges (Merge, Split, Organize, Scan to PDF)
 * - Green Optimize badges (Compress 2x2 inward arrows, Repair crossed wrench/screwdriver, OCR viewfinder)
 * - Purple Edit badges (Edit PDF frame+pencil, Watermark stamp, Rotate circular arrow, Page numbers 1-2-3-4 grid, Crop marks, PDF Forms Ab|)
 * - Blue Security badges (Sign nib, Unlock open lock, Protect shield+keyhole, Compare side-by-side docs, Redact bars)
 * - Indigo Intelligence badges (Summarizer list+sparkle, Translate symbol+sparkle)
 */
export const PdfToolCustomIcon: React.FC<ToolIconProps> = ({
  toolId,
  className = 'w-11 h-11',
}) => {
  switch (toolId) {
    // 1. MERGE PDF: Coral square with two white inward arrows & dashed diagonal
    case 'merge-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#F26144" />
          {/* Top-left arrow pointing down-right */}
          <path
            d="M11 11L19 19M19 19V13.5M19 19H13.5"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Bottom-right arrow pointing up-left */}
          <path
            d="M33 33L25 25M25 25V30.5M25 25H30.5"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Dotted diagonal line in center */}
          <path
            d="M16 28L28 16"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="2.5 3.5"
            opacity="0.85"
          />
        </svg>
      );

    // 2. SPLIT PDF: Coral square with two white outward arrows & dashed diagonal
    case 'split-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#F26144" />
          {/* Top-left arrow pointing up-left */}
          <path
            d="M19 19L11 11M11 11V16.5M11 11H16.5"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Bottom-right arrow pointing down-right */}
          <path
            d="M25 25L33 33M33 33V27.5M33 33H27.5"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Dotted diagonal separator */}
          <path
            d="M16 28L28 16"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="2.5 3.5"
            opacity="0.85"
          />
        </svg>
      );

    // 3. COMPRESS PDF: 2x2 grid of 4 green squares with inward-pointing arrows
    case 'compress-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          {/* Top-left mini square */}
          <rect x="3" y="3" width="17.5" height="17.5" rx="4.5" fill="#62C250" />
          <path
            d="M8.5 8.5L15 15M15 15V10.2M15 15H10.2"
            stroke="white"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Top-right mini square */}
          <rect x="23.5" y="3" width="17.5" height="17.5" rx="4.5" fill="#62C250" />
          <path
            d="M35.5 8.5L29 15M29 15V10.2M29 15H33.8"
            stroke="white"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Bottom-left mini square */}
          <rect x="3" y="23.5" width="17.5" height="17.5" rx="4.5" fill="#62C250" />
          <path
            d="M8.5 35.5L15 29M15 29V33.8M15 29H10.2"
            stroke="white"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Bottom-right mini square */}
          <rect x="23.5" y="23.5" width="17.5" height="17.5" rx="4.5" fill="#62C250" />
          <path
            d="M35.5 35.5L29 29M29 29V33.8M29 29H33.8"
            stroke="white"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 4. PDF TO WORD: Back light-blue square with arrow ↘, front royal-blue square with W
    case 'pdf-to-word':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DCE8FB" />
          <path
            d="M9.5 9.5L16.5 16.5M16.5 16.5V11.5M16.5 16.5H11.5"
            stroke="#3B68B8"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#3B68B8" />
          <text
            x="29.5"
            y="34.5"
            textAnchor="middle"
            fill="white"
            fontSize="15"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            W
          </text>
        </svg>
      );

    // 5. PDF TO POWERPOINT: Back light-peach square with arrow ↘, front coral-orange square with P
    case 'pdf-to-ppt':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#FDE3DB" />
          <path
            d="M9.5 9.5L16.5 16.5M16.5 16.5V11.5M16.5 16.5H11.5"
            stroke="#EB5E3C"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#EB5E3C" />
          <text
            x="29.5"
            y="34.5"
            textAnchor="middle"
            fill="white"
            fontSize="15"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            P
          </text>
        </svg>
      );

    // 6. PDF TO EXCEL: Back light-green square with arrow ↘, front green square with X
    case 'pdf-to-excel':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DCF4E1" />
          <path
            d="M9.5 9.5L16.5 16.5M16.5 16.5V11.5M16.5 16.5H11.5"
            stroke="#3C9E53"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#3C9E53" />
          <text
            x="29.5"
            y="34.5"
            textAnchor="middle"
            fill="white"
            fontSize="15"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            X
          </text>
        </svg>
      );

    // 7. WORD TO PDF: Top-left light-blue square with blue W, bottom-right royal-blue square with white arrow ↘
    case 'word-to-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DCE8FB" />
          <text
            x="14"
            y="19"
            textAnchor="middle"
            fill="#3B68B8"
            fontSize="13.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            W
          </text>
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#3B68B8" />
          <path
            d="M25.5 25.5L33.5 33.5M33.5 33.5V27.5M33.5 33.5H27.5"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 8. POWERPOINT TO PDF: Top-left light-peach square with coral P, bottom-right coral square with white arrow ↘
    case 'ppt-to-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#FDE3DB" />
          <text
            x="14"
            y="19"
            textAnchor="middle"
            fill="#EB5E3C"
            fontSize="14"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            P
          </text>
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#EB5E3C" />
          <path
            d="M25.5 25.5L33.5 33.5M33.5 33.5V27.5M33.5 33.5H27.5"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 9. EXCEL TO PDF: Top-left light-green square with green X, bottom-right green square with white arrow ↘
    case 'excel-to-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DCF4E1" />
          <text
            x="14"
            y="19"
            textAnchor="middle"
            fill="#3C9E53"
            fontSize="14"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            X
          </text>
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#3C9E53" />
          <path
            d="M25.5 25.5L33.5 33.5M33.5 33.5V27.5M33.5 33.5H27.5"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 10. EDIT PDF: Purple square with selection frame + corner nodes + diagonal pencil
    case 'edit-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#9E4B9E" />
          <rect
            x="11"
            y="11"
            width="22"
            height="22"
            rx="2"
            stroke="white"
            strokeWidth="2.1"
          />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" fill="white" />
          <rect x="30.5" y="9" width="4.5" height="4.5" rx="1" fill="white" />
          <rect x="9" y="30.5" width="4.5" height="4.5" rx="1" fill="white" />
          <rect x="30.5" y="30.5" width="4.5" height="4.5" rx="1" fill="white" />
          <path
            d="M17.5 26.5L26.5 17.5M17.5 26.5L16.5 28.5L18.5 27.5L17.5 26.5Z"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 11. PDF TO JPG: Top-left soft-yellow square with gold arrow ↘, bottom-right gold square with mountain+sun
    case 'pdf-to-img':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#FCF3C1" />
          <path
            d="M9.5 9.5L16.5 16.5M16.5 16.5V11.5M16.5 16.5H11.5"
            stroke="#DFBF2B"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#DFBF2B" />
          <circle cx="24.5" cy="24.5" r="2.2" fill="white" />
          <path
            d="M20.5 36L26.5 28.5L30.5 33L33.5 29.5L38.5 36H20.5Z"
            fill="white"
          />
        </svg>
      );

    // 12. JPG TO PDF: Top-left gold square with white JPG, bottom-right soft-yellow square with gold arrow ↘
    case 'img-to-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DFBF2B" />
          <text
            x="14"
            y="17.5"
            textAnchor="middle"
            fill="white"
            fontSize="9.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            JPG
          </text>
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#FCF3C1" />
          <path
            d="M25.5 25.5L33.5 33.5M33.5 33.5V27.5M33.5 33.5H27.5"
            stroke="#C7A618"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 13. SIGN PDF: Navy-blue square with white fountain pen nib
    case 'sign-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#3762A6" />
          <path
            d="M28.5 11.5L32.5 15.5L26.5 27.5L13 31L16.5 17.5L28.5 11.5Z"
            fill="white"
          />
          <path
            d="M13 31L20.5 23.5"
            stroke="#3762A6"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="21.5" cy="22.5" r="1.6" fill="#3762A6" />
        </svg>
      );

    // 14. WATERMARK: Purple square with white stamp handle + base
    case 'watermark-pdf':
    case 'remove-watermark':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#9E4B9E" />
          <path
            d="M22 10.5C19.5 10.5 17.8 12.2 17.8 14.5C17.8 16.5 19.2 18 19.5 20.5H24.5C24.8 18 26.2 16.5 26.2 14.5C26.2 12.2 24.5 10.5 22 10.5Z"
            fill="white"
          />
          <rect x="13" y="22" width="18" height="4.5" rx="2" fill="white" />
          <rect x="14.5" y="29" width="15" height="2.8" rx="1.4" fill="white" opacity="0.85" />
        </svg>
      );

    // 15. ROTATE PDF: Purple square with circular clockwise arrow
    case 'rotate-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#9E4B9E" />
          <path
            d="M29.5 16.5C27.8 13.8 24.8 12 21.5 12C16.2 12 12 16.2 12 21.5C12 26.8 16.2 31 21.5 31C26 31 29.8 27.9 30.8 23.7"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M30.5 11.5V17H25"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 16. HTML TO PDF: Top-left gold square with HTML, bottom-right soft-yellow square with arrow ↘
    case 'html-to-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DFBF2B" />
          <text
            x="14"
            y="17"
            textAnchor="middle"
            fill="white"
            fontSize="7.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            HTML
          </text>
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#FCF3C1" />
          <path
            d="M25.5 25.5L33.5 33.5M33.5 33.5V27.5M33.5 33.5H27.5"
            stroke="#C7A618"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 17. UNLOCK PDF: Slate-blue square with white open padlock
    case 'unlock-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#376298" />
          <rect x="13" y="20" width="18" height="14" rx="3" fill="white" />
          <path
            d="M17 20V15C17 12.2 19.2 10 22 10C24.4 10 26.4 11.6 26.9 13.8"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx="22" cy="26" r="1.8" fill="#376298" />
          <path d="M22 27.5V30" stroke="#376298" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    // 18. PROTECT PDF: Slate-blue square with white shield + keyhole
    case 'security-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#376298" />
          <path
            d="M22 10L31 13.8V21.5C31 27.2 27.2 31.8 22 34C16.8 31.8 13 27.2 13 21.5V13.8L22 10Z"
            stroke="white"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <circle cx="22" cy="20.5" r="2" fill="white" />
          <path d="M22 22V26" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );

    // 19. ORGANIZE PDF: Coral vertical bar on left with ↓ arrow, A & B blocks on right
    case 'organize-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="3" y="3" width="16" height="38" rx="5" fill="#F26144" />
          <path
            d="M11 11V32M11 32L7.5 28.5M11 32L14.5 28.5"
            stroke="white"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="23" y="3" width="18" height="17.5" rx="4.5" fill="#FDE3DB" />
          <text
            x="32"
            y="15.5"
            textAnchor="middle"
            fill="#F26144"
            fontSize="11"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            A
          </text>
          <rect x="23" y="23.5" width="18" height="17.5" rx="4.5" fill="#F26144" />
          <text
            x="32"
            y="36"
            textAnchor="middle"
            fill="white"
            fontSize="11"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            B
          </text>
        </svg>
      );

    // 20. PDF TO PDF/A: Back light-blue square with arrow ↘, front royal-blue square with /A
    case 'pdf-to-pdfa':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#DCE8FB" />
          <path
            d="M9.5 9.5L16.5 16.5M16.5 16.5V11.5M16.5 16.5H11.5"
            stroke="#3B68B8"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#3B68B8" />
          <text
            x="29.5"
            y="34"
            textAnchor="middle"
            fill="white"
            fontSize="12.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            /A
          </text>
        </svg>
      );

    // 21. REPAIR PDF: Green square with crossed wrench and screwdriver
    case 'repair-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#62C250" />
          <path
            d="M14 30L28 16M13 13L18 18L15 21L10 16L13 13ZM26 26L32 32"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="29" cy="15" r="4" stroke="white" strokeWidth="2.4" />
        </svg>
      );

    // 22. PAGE NUMBERS: 2x2 grid of 1, 2, 3 (solid purple) and 4 (lavender)
    case 'page-numbers-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="3" y="3" width="17.5" height="17.5" rx="4.5" fill="#9E4B9E" />
          <text
            x="11.75"
            y="15.5"
            textAnchor="middle"
            fill="white"
            fontSize="11"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            1
          </text>
          <rect x="23.5" y="3" width="17.5" height="17.5" rx="4.5" fill="#9E4B9E" />
          <text
            x="32.25"
            y="15.5"
            textAnchor="middle"
            fill="white"
            fontSize="11"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            2
          </text>
          <rect x="3" y="23.5" width="17.5" height="17.5" rx="4.5" fill="#9E4B9E" />
          <text
            x="11.75"
            y="36"
            textAnchor="middle"
            fill="white"
            fontSize="11"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            3
          </text>
          <rect x="23.5" y="23.5" width="17.5" height="17.5" rx="4.5" fill="#F0DFF2" />
          <text
            x="32.25"
            y="36"
            textAnchor="middle"
            fill="#9E4B9E"
            fontSize="11"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            4
          </text>
        </svg>
      );

    // 23. SCAN TO PDF: Coral square with corner viewfinder brackets & document inside
    case 'scan-to-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#F26144" />
          <path
            d="M11 16V12.5C11 11.7 11.7 11 12.5 11H16M28 11H31.5C32.3 11 33 11.7 33 12.5V16M33 28V31.5C33 32.3 32.3 33 31.5 33H28M16 33H12.5C11.7 33 11 32.3 11 31.5V28"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <rect
            x="16"
            y="15"
            width="12"
            height="14"
            rx="1.5"
            stroke="white"
            strokeWidth="2"
          />
          <path d="M10 22H34" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    // 24. OCR PDF: Green square with corner viewfinder brackets & bold OCR text
    case 'ocr-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#62C250" />
          <path
            d="M10 16V12.5C10 11.7 10.7 11 11.5 11H15M29 11H32.5C33.3 11 34 11.7 34 12.5V16M34 28V31.5C34 32.3 33.3 33 32.5 33H29M15 33H11.5C10.7 33 10 32.3 10 31.5V28"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <text
            x="22"
            y="25.5"
            textAnchor="middle"
            fill="white"
            fontSize="9.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            OCR
          </text>
        </svg>
      );

    // 25. COMPARE PDF: Slate-blue square with two side-by-side document pages
    case 'compare-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#376298" />
          <rect
            x="10"
            y="12"
            width="10.5"
            height="20"
            rx="1.8"
            stroke="white"
            strokeWidth="2"
          />
          <path
            d="M13 17H17.5M13 21H17.5M13 25H16"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <rect
            x="23.5"
            y="12"
            width="10.5"
            height="20"
            rx="1.8"
            stroke="white"
            strokeWidth="2"
          />
          <path
            d="M26.5 17H31M26.5 21H31M26.5 25H29.5"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );

    // 26. REDACT PDF: Slate-blue square with lines + redacted block with X
    case 'redact-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#376298" />
          <path
            d="M12 13H32M12 17.5H26M12 31H29"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <rect
            x="12"
            y="21.5"
            width="20"
            height="6"
            rx="1.5"
            stroke="white"
            strokeWidth="2"
          />
          <path
            d="M20.5 23L23.5 26M23.5 23L20.5 26"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );

    // 27. CROP PDF: Purple square with intersecting crop corner frame
    case 'crop-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#9E4B9E" />
          <path
            d="M15 10V29H34"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 15H29V34"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // 28. PDF FORMS: Rose-magenta square with Ab| form input box
    case 'pdf-forms':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#B25482" />
          <rect x="19" y="9" width="14" height="5" rx="1.5" fill="white" opacity="0.85" />
          <rect
            x="9"
            y="17"
            width="26"
            height="16"
            rx="3"
            fill="white"
          />
          <text
            x="19"
            y="28.5"
            textAnchor="middle"
            fill="#B25482"
            fontSize="10.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            Ab
          </text>
          <path
            d="M28.5 20.5V29.5"
            stroke="#B25482"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );

    // 29. AI / PDF SUMMARIZER: Indigo-violet square with bullet lines & 4-point star
    case 'summarize-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#635BFF" />
          <circle cx="13" cy="15" r="1.5" fill="white" />
          <path d="M17.5 15H25" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="13" cy="22" r="1.5" fill="white" />
          <path d="M17.5 22H31" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="13" cy="29" r="1.5" fill="white" />
          <path d="M17.5 29H29" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
          {/* 4-point sparkle star in top-right */}
          <path
            d="M31 10L32.1 12.9L35 14L32.1 15.1L31 18L29.9 15.1L27 14L29.9 12.9L31 10Z"
            fill="white"
          />
        </svg>
      );

    // 30. TRANSLATE PDF: Indigo-violet square with character symbol + A + sparkle
    case 'translate-pdf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#635BFF" />
          <path
            d="M11 15H22M16.5 12V15M13.5 15C14.2 19.2 16.8 22.5 20.5 24.2M19.5 15C18.5 19.2 15.8 22.5 12 24.2"
            stroke="white"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M23.5 32L27.5 21L31.5 32M24.8 29H30.2"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M31.5 10.5L32.4 12.8L34.7 13.7L32.4 14.6L31.5 16.9L30.6 14.6L28.3 13.7L30.6 12.8L31.5 10.5Z"
            fill="white"
          />
        </svg>
      );

    // 31. PDF TO MARKDOWN: Top-left lavender square with sparkle, bottom-right indigo square with {#}
    case 'pdf-to-markdown':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#E3E1FF" />
          <path
            d="M12.5 7.5L13.8 11.2L17.5 12.5L13.8 13.8L12.5 17.5L11.2 13.8L7.5 12.5L11.2 11.2L12.5 7.5Z"
            fill="#635BFF"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#635BFF" />
          <text
            x="29.5"
            y="33.5"
            textAnchor="middle"
            fill="white"
            fontSize="11.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {'{#}'}
          </text>
        </svg>
      );

    // 32. PDF TO KPF (Amazon Kindle Package Format): Back soft-amber square with arrow ↘, front Kindle-orange square with KPF
    case 'pdf-to-kpf':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#FEEBD4" />
          <path
            d="M9.5 9.5L16.5 16.5M16.5 16.5V11.5M16.5 16.5H11.5"
            stroke="#E47911"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#E47911" />
          <text
            x="29.5"
            y="33.5"
            textAnchor="middle"
            fill="white"
            fontSize="9.5"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            KPF
          </text>
        </svg>
      );

    // 33. HTML & EBOOK READER: Top-left teal-mint square with </> code badge, bottom-right deep-teal square with open book icon
    case 'html-reader':
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="24" height="24" rx="6" fill="#D5F5F0" />
          <text
            x="14"
            y="17.5"
            textAnchor="middle"
            fill="#0D9488"
            fontSize="10"
            fontWeight="800"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {'</>'}
          </text>
          <rect x="17" y="17" width="25" height="25" rx="6.5" fill="#0D9488" />
          <path
            d="M22.5 23.5C24.5 22.8 27 23.2 29.5 24.8C32 23.2 34.5 22.8 36.5 23.5V35.2C34.5 34.5 32 34.9 29.5 36.5C27 34.9 24.5 34.5 22.5 35.2V23.5Z"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M29.5 24.8V36.5"
            stroke="white"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );

    // 34. WORKFLOW PDF
    case 'workflow-pdf':
    default:
      return (
        <svg viewBox="0 0 44 44" fill="none" className={className}>
          <rect x="2" y="2" width="40" height="40" rx="10" fill="#F26144" />
          <circle cx="14" cy="15" r="3.5" stroke="white" strokeWidth="2.2" />
          <circle cx="30" cy="29" r="3.5" stroke="white" strokeWidth="2.2" />
          <path
            d="M17.5 15H24C27.3 15 30 17.7 30 21V25.5"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray="3 3"
          />
        </svg>
      );
  }
};
