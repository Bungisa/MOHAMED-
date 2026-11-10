import { Point2D, ScanFilterType } from '../types/document';

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Automatically detects the precise 4 outer corners [TL, TR, BR, BL] of an uploaded or captured
 * document image using a 5-stage Outside-In computer-vision pipeline:
 * 1. Wide border-safe morphological closing (15x15 window, R=7) on RGB & luminance to completely
 *    bridge internal printed table borders (such as exam question columns) and handwriting while
 *    preserving narrow outer background/desk strips at the frame perimeter.
 * 2. Wood/Desk Chromaticity & Saturation Rejection: distinguishes neutral paper (even in shadow)
 *    from warm wooden desks, colored surfaces, and dark backgrounds.
 * 3. Outside-In Sustained Boundary Ray Casting: scans inward from all 4 outer edges (Left->Right,
 *    Right->Left, Top->Bottom, Bottom->Top) to lock onto the FIRST true outer edge of the paper sheet,
 *    ensuring internal table lines never trap or clip outer document margins.
 * 4. Gradient-Weighted RANSAC Straight Line Fitting with Perspective Tilt Consistency: prevents
 *    isolated bright spots on a desk corner from skewing a single corner handle.
 */
export async function detectDocumentCorners(
  imageDataUrl: string
): Promise<[Point2D, Point2D, Point2D, Point2D]> {
  const fallback: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0.02, y: 0.02 },
    { x: 0.98, y: 0.02 },
    { x: 0.98, y: 0.98 },
    { x: 0.02, y: 0.98 },
  ];

  try {
    const img = await loadImageElement(imageDataUrl);
    const natW = img.naturalWidth || img.width || 800;
    const natH = img.naturalHeight || img.height || 1000;

    const maxAnalysisDim = 360;
    const scale = maxAnalysisDim / Math.max(natW, natH);
    const W = Math.max(120, Math.round(natW * scale));
    const H = Math.max(120, Math.round(natH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;

    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    // 1. Extract raw RGB and perceptual luminance channels
    const lum = new Float32Array(W * H);
    const rCh = new Float32Array(W * H);
    const gCh = new Float32Array(W * H);
    const bCh = new Float32Array(W * H);

    for (let i = 0; i < W * H; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      rCh[i] = r;
      gCh[i] = g;
      bCh[i] = b;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Separable border-safe morphological closing (radius R = 7 -> 15x15 window).
    // Completely bridges thick vertical/horizontal table borders and multi-line text inside exam papers
    // while anchoring out-of-bounds erosion samples to raw border pixels so even a 2px strip of desk
    // at the image edge is preserved.
    const R = 7;
    const morphCloseBorderSafe = (src: Float32Array): Float32Array => {
      const tmp = new Float32Array(W * H);
      const dil = new Float32Array(W * H);
      const ero = new Float32Array(W * H);

      // Horizontal dilation
      for (let y = 0; y < H; y++) {
        const rowOff = y * W;
        for (let x = 0; x < W; x++) {
          let m = 0;
          for (let dx = -R; dx <= R; dx++) {
            const xx = Math.max(0, Math.min(W - 1, x + dx));
            const v = src[rowOff + xx];
            if (v > m) m = v;
          }
          tmp[rowOff + x] = m;
        }
      }
      // Vertical dilation
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let m = 0;
          for (let dy = -R; dy <= R; dy++) {
            const yy = Math.max(0, Math.min(H - 1, y + dy));
            const v = tmp[yy * W + x];
            if (v > m) m = v;
          }
          dil[y * W + x] = m;
        }
      }
      // Horizontal erosion (anchored to raw left/right border pixels outside [0..W-1])
      for (let y = 0; y < H; y++) {
        const rowOff = y * W;
        for (let x = 0; x < W; x++) {
          let m = 255;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            const v =
              xx < 0
                ? src[rowOff]
                : xx >= W
                  ? src[rowOff + (W - 1)]
                  : dil[rowOff + xx];
            if (v < m) m = v;
          }
          tmp[rowOff + x] = m;
        }
      }
      // Vertical erosion (anchored to raw top/bottom border pixels outside [0..H-1])
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let m = 255;
          for (let dy = -R; dy <= R; dy++) {
            const yy = y + dy;
            const v =
              yy < 0
                ? src[x]
                : yy >= H
                  ? src[(H - 1) * W + x]
                  : tmp[yy * W + x];
            if (v < m) m = v;
          }
          ero[y * W + x] = m;
        }
      }
      return ero;
    };

    const cLum = morphCloseBorderSafe(lum);
    const cR = morphCloseBorderSafe(rCh);
    const cG = morphCloseBorderSafe(gCh);
    const cB = morphCloseBorderSafe(bCh);

    // 2. Model the paper surface from the central 50% region (using 70th percentile to ignore any dark stamps)
    const sL: number[] = [];
    const sR: number[] = [];
    const sG: number[] = [];
    const sB: number[] = [];
    const sWarm: number[] = [];
    const sSat: number[] = [];

    const cx0 = Math.floor(W * 0.25);
    const cx1 = Math.ceil(W * 0.75);
    const cy0 = Math.floor(H * 0.25);
    const cy1 = Math.ceil(H * 0.75);

    for (let y = cy0; y <= cy1; y += 2) {
      for (let x = cx0; x <= cx1; x += 2) {
        const i = y * W + x;
        const r = cR[i];
        const g = cG[i];
        const b = cB[i];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        sL.push(cLum[i]);
        sR.push(r);
        sG.push(g);
        sB.push(b);
        sWarm.push(r - b);
        sSat.push(maxC > 10 ? (maxC - minC) / maxC : 0);
      }
    }
    sL.sort((a, b) => a - b);
    sR.sort((a, b) => a - b);
    sG.sort((a, b) => a - b);
    sB.sort((a, b) => a - b);
    sWarm.sort((a, b) => a - b);
    sSat.sort((a, b) => a - b);

    const idx70 = Math.floor(sL.length * 0.7);
    const idx50 = Math.floor(sL.length * 0.5);
    const pLum = sL[idx70] || 200;
    const pR = sR[idx70] || 200;
    const pG = sG[idx70] || 200;
    const pB = sB[idx70] || 200;
    const pWarm = sWarm[idx50] || 0;
    const pSat = sSat[idx50] || 0.04;

    const pSum = Math.max(1, pR + pG + pB);
    const pNR = pR / pSum;
    const pNG = pG / pSum;
    const pNB = pB / pSum;

    // Classify pixels into paper vs. wooden desk / background:
    // - Rejects warm wood grain (where r - b exceeds paper warmth by > 16 or saturation exceeds pSat + 0.11)
    // - Allows shadowed paper margins (down to 0.52 * pLum) as long as their color remains neutral like paper
    const isPaper = new Uint8Array(W * H);
    const minPaperLum =
      pLum > 242
        ? pLum - 12
        : pLum >= 135
          ? Math.min(pLum * 0.52, 118)
          : pLum * 0.62;

    for (let i = 0; i < W * H; i++) {
      const L = cLum[i];
      const r = cR[i];
      const g = cG[i];
      const b = cB[i];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 10 ? (maxC - minC) / maxC : 0;
      const sum = Math.max(1, r + g + b);
      const chromaDist =
        Math.hypot(r / sum - pNR, g / sum - pNG, b / sum - pNB) * 255;
      const warmExcess = r - b - pWarm;

      // Wood grain on desks is warmer (r > g > b, warmExcess > 15) and more saturated than paper
      const isWoodLike =
        (warmExcess > 15 && r > g && g >= b - 4) ||
        sat > pSat + 0.115 ||
        Math.abs(warmExcess) > 20;

      if (L >= minPaperLum && chromaDist < 17 && !isWoodLike) {
        isPaper[i] = 1;
      }
    }

    // 3. Fill any remaining small internal holes inside the paper sheet (e.g. thick black header bars or stamps)
    //    by running a horizontal + vertical span fill across rows/columns whose outer paper span is established,
    //    then keep the main central connected component.
    const rowSpanPaper = new Uint8Array(isPaper);
    for (let y = Math.floor(H * 0.08); y <= Math.ceil(H * 0.92); y++) {
      const rowOff = y * W;
      let firstP = -1;
      let lastP = -1;
      // Find first sustained paper run from left (at least 5 of 7 pixels are paper)
      for (let x = 0; x < Math.floor(W * 0.45); x++) {
        let cnt = 0;
        for (let k = 0; k < 7 && x + k < W; k++) {
          cnt += isPaper[rowOff + x + k];
        }
        if (cnt >= 5) {
          firstP = x;
          break;
        }
      }
      // Find first sustained paper run from right
      for (let x = W - 1; x >= Math.ceil(W * 0.55); x--) {
        let cnt = 0;
        for (let k = 0; k < 7 && x - k >= 0; k++) {
          cnt += isPaper[rowOff + x - k];
        }
        if (cnt >= 5) {
          lastP = x;
          break;
        }
      }
      if (firstP !== -1 && lastP !== -1 && lastP - firstP > W * 0.35) {
        for (let x = firstP; x <= lastP; x++) {
          rowSpanPaper[rowOff + x] = 1;
        }
      }
    }

    // Keep only pixels connected to the center of the document
    const visited = new Uint8Array(W * H);
    const queue = new Int32Array(W * H);
    let qHead = 0;
    let qTail = 0;

    const sx0 = Math.floor(W * 0.35);
    const sx1 = Math.ceil(W * 0.65);
    const sy0 = Math.floor(H * 0.35);
    const sy1 = Math.ceil(H * 0.65);

    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const idx = y * W + x;
        if (rowSpanPaper[idx] === 1 && !visited[idx]) {
          visited[idx] = 1;
          queue[qTail++] = idx;
        }
      }
    }

    while (qHead < qTail) {
      const curr = queue[qHead++];
      const cx = curr % W;
      const cy = (curr - cx) / W;

      if (cy > 0 && rowSpanPaper[curr - W] === 1 && !visited[curr - W]) {
        visited[curr - W] = 1;
        queue[qTail++] = curr - W;
      }
      if (cy < H - 1 && rowSpanPaper[curr + W] === 1 && !visited[curr + W]) {
        visited[curr + W] = 1;
        queue[qTail++] = curr + W;
      }
      if (cx > 0 && rowSpanPaper[curr - 1] === 1 && !visited[curr - 1]) {
        visited[curr - 1] = 1;
        queue[qTail++] = curr - 1;
      }
      if (cx < W - 1 && rowSpanPaper[curr + 1] === 1 && !visited[curr + 1]) {
        visited[curr + 1] = 1;
        queue[qTail++] = curr + 1;
      }
    }

    if (qTail < W * H * 0.05) {
      return fallback;
    }

    // 4. Outside-In Sustained Boundary Ray Casting for all 4 sides (Top, Bottom, Left, Right)
    //    Requires 5 out of 6 consecutive pixels along the inward ray to be visited paper, preventing
    //    isolated bright specks on the wooden desk from triggering an early false boundary.
    const rawTopPts: { x: number; y: number }[] = [];
    const rawBottomPts: { x: number; y: number }[] = [];
    const rawLeftPts: { x: number; y: number }[] = [];
    const rawRightPts: { x: number; y: number }[] = [];

    for (let x = Math.floor(W * 0.08); x <= Math.ceil(W * 0.92); x += 2) {
      for (let y = 0; y < H - 6; y++) {
        if (
          visited[y * W + x] &&
          visited[(y + 1) * W + x] &&
          visited[(y + 2) * W + x] &&
          visited[(y + 3) * W + x] &&
          visited[(y + 4) * W + x]
        ) {
          rawTopPts.push({ x, y: Math.max(1, y) });
          break;
        }
      }
      for (let y = H - 1; y >= 6; y--) {
        if (
          visited[y * W + x] &&
          visited[(y - 1) * W + x] &&
          visited[(y - 2) * W + x] &&
          visited[(y - 3) * W + x] &&
          visited[(y - 4) * W + x]
        ) {
          rawBottomPts.push({ x, y: Math.min(H - 2, y) });
          break;
        }
      }
    }

    for (let y = Math.floor(H * 0.08); y <= Math.ceil(H * 0.92); y += 2) {
      const rowOff = y * W;
      for (let x = 0; x < W - 6; x++) {
        if (
          visited[rowOff + x] &&
          visited[rowOff + x + 1] &&
          visited[rowOff + x + 2] &&
          visited[rowOff + x + 3] &&
          visited[rowOff + x + 4]
        ) {
          rawLeftPts.push({ x: Math.max(1, x), y });
          break;
        }
      }
      for (let x = W - 1; x >= 6; x--) {
        if (
          visited[rowOff + x] &&
          visited[rowOff + x - 1] &&
          visited[rowOff + x - 2] &&
          visited[rowOff + x - 3] &&
          visited[rowOff + x - 4]
        ) {
          rawRightPts.push({ x: Math.min(W - 2, x), y });
          break;
        }
      }
    }

    if (
      rawTopPts.length < 6 ||
      rawBottomPts.length < 6 ||
      rawLeftPts.length < 6 ||
      rawRightPts.length < 6
    ) {
      return fallback;
    }

    // Trim extreme 10% ends of each side profile so rounded/torn corners don't skew the straight line fit
    const trimProfile = (pts: { x: number; y: number }[]) => {
      if (pts.length <= 10) return pts;
      const cut = Math.floor(pts.length * 0.1);
      return pts.slice(cut, pts.length - cut);
    };

    const topLine = fitRobustEdgeLine(trimProfile(rawTopPts), 'horizontal');
    const bottomLine = fitRobustEdgeLine(
      trimProfile(rawBottomPts),
      'horizontal'
    );
    const leftLine = fitRobustEdgeLine(trimProfile(rawLeftPts), 'vertical');
    const rightLine = fitRobustEdgeLine(trimProfile(rawRightPts), 'vertical');

    const tl = intersectEdgeLines(topLine, leftLine, {
      x: W * 0.02,
      y: H * 0.02,
    });
    const tr = intersectEdgeLines(topLine, rightLine, {
      x: W * 0.98,
      y: H * 0.02,
    });
    const br = intersectEdgeLines(bottomLine, rightLine, {
      x: W * 0.98,
      y: H * 0.98,
    });
    const bl = intersectEdgeLines(bottomLine, leftLine, {
      x: W * 0.02,
      y: H * 0.98,
    });

    const corners: [Point2D, Point2D, Point2D, Point2D] = [
      {
        x: clamp(tl.x / W, 0.008, 0.992),
        y: clamp(tl.y / H, 0.008, 0.992),
      },
      {
        x: clamp(tr.x / W, 0.008, 0.992),
        y: clamp(tr.y / H, 0.008, 0.992),
      },
      {
        x: clamp(br.x / W, 0.008, 0.992),
        y: clamp(br.y / H, 0.008, 0.992),
      },
      {
        x: clamp(bl.x / W, 0.008, 0.992),
        y: clamp(bl.y / H, 0.008, 0.992),
      },
    ];

    // 5. Perspective Consistency Sanity Check:
    //    If bottom edge is nearly level (|br.y - bl.y| < 0.045) but top edge has an extreme one-sided
    //    spike (> 0.065 difference because of bright lighting on one corner of the desk), level the outlier
    //    corner to match the opposite side's perspective slope.
    const bottomDy = corners[2].y - corners[3].y;
    const topDy = corners[1].y - corners[0].y;
    if (Math.abs(bottomDy) < 0.045 && Math.abs(topDy - bottomDy) > 0.055) {
      // Keep the safer (further-inward) top corner and align the outlier corner to match bottom slope
      if (corners[1].y < corners[0].y) {
        corners[1].y = clamp(corners[0].y + bottomDy, 0.01, 0.45);
      } else {
        corners[0].y = clamp(corners[1].y - bottomDy, 0.01, 0.45);
      }
    }

    const rightDx = corners[2].x - corners[1].x;
    const leftDx = corners[3].x - corners[0].x;
    if (Math.abs(rightDx) < 0.045 && Math.abs(leftDx - rightDx) > 0.055) {
      if (corners[0].x > corners[3].x) {
        corners[0].x = clamp(corners[3].x - rightDx, 0.01, 0.45);
      } else {
        corners[3].x = clamp(corners[0].x + rightDx, 0.01, 0.45);
      }
    }

    return corners;
  } catch {
    return fallback;
  }
}

/**
 * Fits a straight line (a*x + b*y + c = 0) to a side boundary point set using
 * orientation-regularized RANSAC consensus so local corner tears, fingers, or desk glare
 * are ignored and the true straight paper edge is recovered.
 */
function fitRobustEdgeLine(
  pts: { x: number; y: number }[],
  orientation: 'horizontal' | 'vertical'
): { a: number; b: number; c: number } {
  if (pts.length < 2) {
    return orientation === 'horizontal'
      ? { a: 0, b: 1, c: 0 }
      : { a: 1, b: 0, c: 0 };
  }

  let bestScore = -1;
  let bestA = 0;
  let bestB = 1;
  let bestC = 0;

  const minSpanIdx = Math.max(2, Math.floor(pts.length * 0.25));
  const stepJ = Math.max(1, Math.floor(pts.length / 28));

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + minSpanIdx; j < pts.length; j += stepJ) {
      const p1 = pts[i];
      const p2 = pts[j];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;

      // Reject candidate lines tilted more than ~24 degrees from their expected axis
      if (
        orientation === 'horizontal' &&
        Math.abs(dy) > Math.abs(dx) * 0.45
      ) {
        continue;
      }
      if (
        orientation === 'vertical' &&
        Math.abs(dx) > Math.abs(dy) * 0.45
      ) {
        continue;
      }

      const a = -dy / len;
      const b = dx / len;
      const c = -(a * p1.x + b * p1.y);

      let score = 0;
      for (let k = 0; k < pts.length; k++) {
        const d = Math.abs(a * pts[k].x + b * pts[k].y + c);
        if (d < 2.4) {
          score += 2.4 - d;
        }
      }

      // Slight preference for calmer angles when inlier scores are nearly tied
      const anglePenalty =
        orientation === 'horizontal'
          ? Math.abs(dy / Math.max(1, Math.abs(dx))) * 1.5
          : Math.abs(dx / Math.max(1, Math.abs(dy))) * 1.5;
      const finalScore = score - anglePenalty;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestA = a;
        bestB = b;
        bestC = c;
      }
    }
  }

  if (bestScore < 0) {
    // Fallback to median coordinate along axis
    if (orientation === 'horizontal') {
      const sortedY = pts.map((p) => p.y).sort((x, y) => x - y);
      const medY = sortedY[Math.floor(sortedY.length / 2)];
      return { a: 0, b: 1, c: -medY };
    } else {
      const sortedX = pts.map((p) => p.x).sort((x, y) => x - y);
      const medX = sortedX[Math.floor(sortedX.length / 2)];
      return { a: 1, b: 0, c: -medX };
    }
  }

  return { a: bestA, b: bestB, c: bestC };
}

function intersectEdgeLines(
  l1: { a: number; b: number; c: number },
  l2: { a: number; b: number; c: number },
  fallbackPt: { x: number; y: number }
): { x: number; y: number } {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-6) return fallbackPt;
  const x = (l1.b * l2.c - l2.b * l1.c) / det;
  const y = (l2.a * l1.c - l1.a * l2.c) / det;
  return { x, y };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Performs a real 4-point projective homography perspective transformation
 * mapping the quadrilateral defined by `corners` onto a rectified rectangular image.
 */
export async function applyPerspectiveCrop(
  imageDataUrl: string,
  corners: [Point2D, Point2D, Point2D, Point2D]
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImageElement(imageDataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  // Convert normalized corners to pixel coordinates
  const pts = corners.map((c) => ({
    x: c.x * srcW,
    y: c.y * srcH,
  }));

  // Compute target dimensions based on average top/bottom and left/right edge lengths
  const topW = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const bottomW = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
  const leftH = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
  const rightH = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);

  const maxDim = 1600;
  let dstW = Math.round(Math.max(topW, bottomW));
  let dstH = Math.round(Math.max(leftH, rightH));
  if (dstW < 100) dstW = srcW;
  if (dstH < 100) dstH = srcH;

  if (dstW > maxDim || dstH > maxDim) {
    const scale = maxDim / Math.max(dstW, dstH);
    dstW = Math.round(dstW * scale);
    dstH = Math.round(dstH * scale);
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) {
    return { dataUrl: imageDataUrl, width: srcW, height: srcH };
  }
  srcCtx.drawImage(img, 0, 0);
  const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);
  const srcPixels = srcImageData.data;

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;
  const dstCtx = dstCanvas.getContext('2d');
  if (!dstCtx) {
    return { dataUrl: imageDataUrl, width: srcW, height: srcH };
  }
  const dstImageData = dstCtx.createImageData(dstW, dstH);
  const dstPixels = dstImageData.data;

  // Compute homography from destination rectangle (0..dstW, 0..dstH) -> source quad pts
  const H = computeHomography(
    [
      { x: 0, y: 0 },
      { x: dstW, y: 0 },
      { x: dstW, y: dstH },
      { x: 0, y: dstH },
    ],
    pts
  );

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const denom = H[6] * x + H[7] * y + 1;
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const dstIdx = (y * dstW + x) * 4;

      if (x0 >= 0 && x0 < srcW - 1 && y0 >= 0 && y0 < srcH - 1) {
        const dx = sx - x0;
        const dy = sy - y0;
        const w00 = (1 - dx) * (1 - dy);
        const w10 = dx * (1 - dy);
        const w01 = (1 - dx) * dy;
        const w11 = dx * dy;

        const idx00 = (y0 * srcW + x0) * 4;
        const idx10 = idx00 + 4;
        const idx01 = ((y0 + 1) * srcW + x0) * 4;
        const idx11 = idx01 + 4;

        dstPixels[dstIdx] =
          srcPixels[idx00] * w00 +
          srcPixels[idx10] * w10 +
          srcPixels[idx01] * w01 +
          srcPixels[idx11] * w11;
        dstPixels[dstIdx + 1] =
          srcPixels[idx00 + 1] * w00 +
          srcPixels[idx10 + 1] * w10 +
          srcPixels[idx01 + 1] * w01 +
          srcPixels[idx11 + 1] * w11;
        dstPixels[dstIdx + 2] =
          srcPixels[idx00 + 2] * w00 +
          srcPixels[idx10 + 2] * w10 +
          srcPixels[idx01 + 2] * w01 +
          srcPixels[idx11 + 2] * w11;
        dstPixels[dstIdx + 3] = 255;
      } else {
        dstPixels[dstIdx] = 255;
        dstPixels[dstIdx + 1] = 255;
        dstPixels[dstIdx + 2] = 255;
        dstPixels[dstIdx + 3] = 255;
      }
    }
  }

  dstCtx.putImageData(dstImageData, 0, 0);
  return {
    dataUrl: dstCanvas.toDataURL('image/jpeg', 0.92),
    width: dstW,
    height: dstH,
  };
}

/**
 * Solves the 8x8 linear system for a 2D projective homography matrix.
 */
function computeHomography(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[]
): number[] {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    const pivot = A[i][i] || 1e-10;
    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / pivot;
      b[k] -= factor * b[i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * x[j];
    }
    x[i] = sum / (A[i][i] || 1e-10);
  }
  return x;
}

/**
 * Applies rotation, document enhancement filters (Original, Magic Color,
 * Grayscale, Black & White Adaptive Threshold, Shadow Reduction), and
 * brightness/contrast adjustments.
 */
export async function applyImageEnhancements(
  sourceDataUrl: string,
  options: {
    filter: ScanFilterType;
    brightness: number; // -100 to 100
    contrast: number; // -100 to 100
    rotation: number; // 0, 90, 180, 270
  }
): Promise<string> {
  const img = await loadImageElement(sourceDataUrl);
  const normRot = ((options.rotation % 360) + 360) % 360;
  const swapDims = normRot === 90 || normRot === 270;

  const w = swapDims ? img.height : img.width;
  const h = swapDims ? img.width : img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return sourceDataUrl;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((normRot * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();

  if (
    options.filter === 'original' &&
    options.brightness === 0 &&
    options.contrast === 0
  ) {
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Contrast factor
  const extraContrast =
    options.filter === 'ocv-black'
      ? 48
      : options.filter === 'vivid-light'
        ? 34
        : options.filter === 'magic'
          ? 28
          : options.filter === 'shadow-clean'
            ? 22
            : 0;
  const totalContrast = clamp(options.contrast + extraContrast, -100, 100);
  const contrastFactor =
    (259 * (totalContrast + 255)) / (255 * (259 - totalContrast));

  const extraBrightness =
    options.filter === 'vivid-light'
      ? 18
      : options.filter === 'magic'
        ? 10
        : options.filter === 'shadow-clean'
          ? 16
          : 0;
  const brightnessOffset = (options.brightness + extraBrightness) * 1.8;

  if (options.filter === 'bw' || options.filter === 'ocv-black') {
    // Compute effective luminance (lifting colored watermarks/stamps so they bleach to white in OCV BLACK)
    // and build a 2D integral image for fast OpenCV-style local thresholding & watermark suppression
    const gray = new Uint8Array(w * h);
    const integral = new Float64Array((w + 1) * (h + 1));

    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        let effLum = lum;
        if (options.filter === 'ocv-black') {
          // Chromatic watermark suppression: colored watermarks/stamps (red, blue, cyan, purple, etc.)
          // have high chroma (max - min), whereas true black document ink is neutral (R ≈ G ≈ B).
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const chroma = maxC - minC;
          if (chroma > 32 && lum > 42) {
            effLum = Math.min(255, lum + chroma * 1.35);
          }
        }

        const clampedLum = Math.max(0, Math.min(255, Math.round(effLum)));
        gray[y * w + x] = clampedLum;
        rowSum += clampedLum;
        integral[(y + 1) * (w + 1) + (x + 1)] =
          integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    const getBoxMean = (
      cx: number,
      cy: number,
      rx: number,
      ry: number
    ): number => {
      const x1 = Math.max(0, cx - rx);
      const x2 = Math.min(w - 1, cx + rx);
      const y1 = Math.max(0, cy - ry);
      const y2 = Math.min(h - 1, cy + ry);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[y1 * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      return sum / count;
    };

    // In OCV BLACK, detect solid dark-filled watermark banner boxes (e.g. black/red rectangular stamp banners with inverted text)
    // Normal text strokes are thin (1-4px), so their local mean in a medium window remains > 145.
    // Solid filled watermark blocks have a very low local mean (< 112) over a sustained horizontal/vertical block.
    let solidWatermarkMask: Uint8Array | null = null;
    if (options.filter === 'ocv-black') {
      const denseR = Math.max(7, Math.round(Math.min(w, h) / 80));
      const coreMask = new Uint8Array(w * h);
      let hasCorePixels = false;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const denseMean = getBoxMean(x, y, denseR, denseR);
          const wideMean = getBoxMean(x, y, denseR * 2, denseR);
          if (denseMean < 110 && wideMean < 122) {
            coreMask[y * w + x] = 1;
            hasCorePixels = true;
          }
        }
      }

      if (hasCorePixels) {
        // Build integral image of coreMask to fast-dilate and erase the entire solid watermark banner box & its borders
        const maskIntegral = new Int32Array((w + 1) * (h + 1));
        for (let y = 0; y < h; y++) {
          let rSum = 0;
          for (let x = 0; x < w; x++) {
            rSum += coreMask[y * w + x];
            maskIntegral[(y + 1) * (w + 1) + (x + 1)] =
              maskIntegral[y * (w + 1) + (x + 1)] + rSum;
          }
        }
        const dilateR = denseR + Math.max(4, Math.round(denseR * 0.6));
        solidWatermarkMask = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          const y1 = Math.max(0, y - dilateR);
          const y2 = Math.min(h - 1, y + dilateR);
          for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - dilateR);
            const x2 = Math.min(w - 1, x + dilateR);
            const mSum =
              maskIntegral[(y2 + 1) * (w + 1) + (x2 + 1)] -
              maskIntegral[y1 * (w + 1) + (x2 + 1)] -
              maskIntegral[(y2 + 1) * (w + 1) + x1] +
              maskIntegral[y1 * (w + 1) + x1];
            if (mSum >= 6) {
              solidWatermarkMask[y * w + x] = 1;
            }
          }
        }
      }
    }

    const radius =
      options.filter === 'ocv-black'
        ? Math.max(15, Math.floor(Math.min(w, h) / 26))
        : Math.max(12, Math.floor(Math.min(w, h) / 32));
    const bias =
      (options.filter === 'ocv-black' ? 22 : 12) - options.brightness * 0.25;
    // Global watermark bleach threshold: any grey/faint watermark lighter than watermarkCutoff disappears into pure white (255)
    const watermarkCutoff = clamp(120 - options.brightness * 0.85, 50, 190);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pIndex = y * w + x;
        const idx = pIndex * 4;

        if (solidWatermarkMask && solidWatermarkMask[pIndex] === 1) {
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
          continue;
        }

        const localMean = getBoxMean(x, y, radius, radius);
        const px = gray[pIndex];

        let val: number;
        if (options.filter === 'ocv-black') {
          // 1. Bleach all light-grey, mid-grey, and colored watermarks above watermarkCutoff to pure white (#FFFFFF)
          if (px > watermarkCutoff) {
            val = 255;
          } else {
            // 2. For dark document ink, apply crisp adaptive thresholding
            const diff = localMean - bias - px;
            if (diff > 12) {
              val = 5;
            } else if (diff > 0) {
              const t = diff / 12;
              val = Math.round(255 - t * 250);
            } else {
              val = 255;
            }
          }
        } else {
          val = px < localMean - bias && px < 165 ? 18 : 252;
        }

        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
      }
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (options.filter === 'shadow-clean' || options.filter === 'vivid-light') {
        // Lift mid-to-high luminance paper background toward clean luminous white
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 140) {
          const boost =
            ((lum - 140) / 115) * (options.filter === 'vivid-light' ? 48 : 42);
          r = Math.min(255, r + boost);
          g = Math.min(255, g + boost);
          b = Math.min(255, b + boost);
        }
      }

      // Apply contrast and brightness
      r = contrastFactor * (r - 128) + 128 + brightnessOffset;
      g = contrastFactor * (g - 128) + 128 + brightnessOffset;
      b = contrastFactor * (b - 128) + 128 + brightnessOffset;

      if (options.filter === 'grayscale') {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = lum;
      } else if (options.filter === 'vivid-light') {
        // Vivid Light: Boost color saturation for seals, coats of arms, and colored ink while keeping dark text deep
        const avg = (r + g + b) / 3;
        const satFactor = 1.48;
        r = avg + (r - avg) * satFactor;
        g = avg + (g - avg) * satFactor;
        b = avg + (b - avg) * satFactor;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 85) {
          r *= 0.78;
          g *= 0.78;
          b *= 0.78;
        }
      } else if (options.filter === 'magic') {
        // Whiten near-white background for crisp document look
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 195) {
          r = Math.min(255, r * 1.08);
          g = Math.min(255, g * 1.08);
          b = Math.min(255, b * 1.08);
        }
      }

      data[i] = clamp(Math.round(r), 0, 255);
      data[i + 1] = clamp(Math.round(g), 0, 255);
      data[i + 2] = clamp(Math.round(b), 0, 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}
