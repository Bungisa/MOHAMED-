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
 * Automatically detects the precise 4 corners [TL, TR, BR, BL] of an uploaded or captured
 * document image using a 4-stage computer-vision pipeline:
 * 1. Aspect-preserving high-resolution grayscale & chroma extraction + morphological closing
 *    (7x7 dilation/erosion to erase internal text ink and isolate the continuous paper sheet).
 * 2. Adaptive center-vs-border segmentation + Flood-Fill Connected Component analysis to
 *    extract the true document page silhouette (works on angled desk photos, screenshots with
 *    top/bottom UI bars, receipts, and dark/light backgrounds).
 * 3. Convex Hull + Maximum-Area Quadrilateral vertex detection to find the 4 structural corners
 *    even under perspective skew or rotation.
 * 4. Local Sobel Edge-Line Fitting & Line-Line Intersection refinement so each corner snaps
 *    with sub-pixel accuracy to the physical paper edge.
 */
export async function detectDocumentCorners(
  imageDataUrl: string
): Promise<[Point2D, Point2D, Point2D, Point2D]> {
  const fallback: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0.04, y: 0.04 },
    { x: 0.96, y: 0.04 },
    { x: 0.96, y: 0.96 },
    { x: 0.04, y: 0.96 },
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

    // 1. Compute luminance and color channels
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

    // Morphological closing (dilation followed by erosion) with radius 3 (7x7 window)
    // This completely erases thin dark text characters inside the document so the paper
    // surface becomes a uniform, continuous bright/homogeneous region.
    const dilateRadius = 3;
    const dilatedLum = new Float32Array(W * H);
    const closedLum = new Float32Array(W * H);

    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - dilateRadius);
      const y1 = Math.min(H - 1, y + dilateRadius);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - dilateRadius);
        const x1 = Math.min(W - 1, x + dilateRadius);
        let maxV = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const rowOff = yy * W;
          for (let xx = x0; xx <= x1; xx++) {
            const v = lum[rowOff + xx];
            if (v > maxV) maxV = v;
          }
        }
        dilatedLum[y * W + x] = maxV;
      }
    }

    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - dilateRadius);
      const y1 = Math.min(H - 1, y + dilateRadius);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - dilateRadius);
        const x1 = Math.min(W - 1, x + dilateRadius);
        let minV = 255;
        for (let yy = y0; yy <= y1; yy++) {
          const rowOff = yy * W;
          for (let xx = x0; xx <= x1; xx++) {
            const v = dilatedLum[rowOff + xx];
            if (v < minV) minV = v;
          }
        }
        closedLum[y * W + x] = minV;
      }
    }

    // 2. Compute Sobel edge gradients on closedLum (captures true page boundaries without internal text clutter)
    // and also on raw lum (for fine edge-line refinement)
    const gradMag = new Float32Array(W * H);
    let maxGrad = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const gxClosed =
          -closedLum[(y - 1) * W + (x - 1)] +
          closedLum[(y - 1) * W + (x + 1)] -
          2 * closedLum[y * W + (x - 1)] +
          2 * closedLum[y * W + (x + 1)] -
          closedLum[(y + 1) * W + (x - 1)] +
          closedLum[(y + 1) * W + (x + 1)];
        const gyClosed =
          -closedLum[(y - 1) * W + (x - 1)] -
          2 * closedLum[(y - 1) * W + x] -
          closedLum[(y - 1) * W + (x + 1)] +
          closedLum[(y + 1) * W + (x - 1)] +
          2 * closedLum[(y + 1) * W + x] +
          closedLum[(y + 1) * W + (x + 1)];

        const gxRaw =
          -lum[(y - 1) * W + (x - 1)] +
          lum[(y - 1) * W + (x + 1)] -
          2 * lum[y * W + (x - 1)] +
          2 * lum[y * W + (x + 1)] -
          lum[(y + 1) * W + (x - 1)] +
          lum[(y + 1) * W + (x + 1)];
        const gyRaw =
          -lum[(y - 1) * W + (x - 1)] -
          2 * lum[(y - 1) * W + x] -
          lum[(y - 1) * W + (x + 1)] +
          lum[(y + 1) * W + (x - 1)] +
          2 * lum[(y + 1) * W + x] +
          lum[(y + 1) * W + (x + 1)];

        const m = Math.hypot(gxClosed, gyClosed) * 0.7 + Math.hypot(gxRaw, gyRaw) * 0.3;
        gradMag[y * W + x] = m;
        if (m > maxGrad) maxGrad = m;
      }
    }

    // 3. Model the document paper surface from the central region vs. outer border
    const centerLums: number[] = [];
    const centerR: number[] = [];
    const centerG: number[] = [];
    const centerB: number[] = [];

    const cx0 = Math.floor(W * 0.28);
    const cx1 = Math.ceil(W * 0.72);
    const cy0 = Math.floor(H * 0.28);
    const cy1 = Math.ceil(H * 0.72);

    for (let y = cy0; y <= cy1; y += 2) {
      for (let x = cx0; x <= cx1; x += 2) {
        const i = y * W + x;
        centerLums.push(closedLum[i]);
        centerR.push(rCh[i]);
        centerG.push(gCh[i]);
        centerB.push(bCh[i]);
      }
    }
    centerLums.sort((a, b) => a - b);
    centerR.sort((a, b) => a - b);
    centerG.sort((a, b) => a - b);
    centerB.push(255);
    centerB.sort((a, b) => a - b);

    const paperLum = centerLums[Math.floor(centerLums.length * 0.65)] || 220;
    const paperR = centerR[Math.floor(centerR.length * 0.65)] || 220;
    const paperG = centerG[Math.floor(centerG.length * 0.65)] || 220;
    const paperB = centerB[Math.floor(centerB.length * 0.65)] || 220;

    // Sample outer perimeter border (top, bottom, left, right strips)
    const borderLums: number[] = [];
    const borderMarginX = Math.max(2, Math.floor(W * 0.03));
    const borderMarginY = Math.max(2, Math.floor(H * 0.03));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (
          x < borderMarginX ||
          x >= W - borderMarginX ||
          y < borderMarginY ||
          y >= H - borderMarginY
        ) {
          borderLums.push(closedLum[y * W + x]);
        }
      }
    }
    borderLums.sort((a, b) => a - b);
    const borderMedianLum =
      borderLums[Math.floor(borderLums.length * 0.45)] || 100;

    // Compute Otsu global threshold on closedLum
    const hist = new Int32Array(256);
    for (let i = 0; i < W * H; i++) {
      hist[Math.min(255, Math.max(0, Math.round(closedLum[i])))]++;
    }
    let totalSum = 0;
    for (let t = 0; t < 256; t++) totalSum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let maxVar = 0;
    let otsuThresh = 160;
    const totalPixels = W * H;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = totalPixels - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (totalSum - sumB) / wF;
      const betweenVar = wB * wF * (mB - mF) * (mB - mF);
      if (betweenVar > maxVar) {
        maxVar = betweenVar;
        otsuThresh = t;
      }
    }

    // Build binary candidate mask of the document page
    const mask = new Uint8Array(W * H);
    const lumContrast = Math.abs(paperLum - borderMedianLum);
    const adaptiveLumThresh =
      lumContrast > 22
        ? (paperLum * 0.55 + borderMedianLum * 0.45)
        : Math.min(otsuThresh, paperLum - 28);

    for (let i = 0; i < W * H; i++) {
      const cLum = closedLum[i];
      const colorDist = Math.hypot(
        rCh[i] - paperR,
        gCh[i] - paperG,
        bCh[i] - paperB
      );
      if (paperLum >= borderMedianLum - 10) {
        // Standard bright paper on darker/colored desk or screenshot UI frame
        if (cLum >= adaptiveLumThresh && colorDist < 125) {
          mask[i] = 1;
        }
      } else {
        // Darker document/card on a bright background
        if (cLum <= (paperLum + borderMedianLum) * 0.5) {
          mask[i] = 1;
        }
      }
    }

    // 4. Flood-Fill Connected Component from center seeds so background islands are discarded
    const visited = new Uint8Array(W * H);
    const queue = new Int32Array(W * H);
    let qHead = 0;
    let qTail = 0;

    // Seed from center 20% box where mask[i] === 1
    const sx0 = Math.floor(W * 0.4);
    const sx1 = Math.ceil(W * 0.6);
    const sy0 = Math.floor(H * 0.4);
    const sy1 = Math.ceil(H * 0.6);
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const idx = y * W + x;
        if (mask[idx] === 1 && !visited[idx]) {
          visited[idx] = 1;
          queue[qTail++] = idx;
        }
      }
    }

    const edgeBarrier = maxGrad * 0.42;
    while (qHead < qTail) {
      const curr = queue[qHead++];
      const cx = curr % W;
      const cy = (curr - cx) / W;

      const neighbors = [
        cy > 0 ? curr - W : -1,
        cy < H - 1 ? curr + W : -1,
        cx > 0 ? curr - 1 : -1,
        cx < W - 1 ? curr + 1 : -1,
      ];
      for (const nIdx of neighbors) {
        if (
          nIdx >= 0 &&
          !visited[nIdx] &&
          mask[nIdx] === 1 &&
          gradMag[nIdx] < edgeBarrier
        ) {
          visited[nIdx] = 1;
          queue[qTail++] = nIdx;
        }
      }
    }

    // Extract boundary contour points of the connected component
    const boundaryPts: { x: number; y: number }[] = [];
    if (qTail > W * H * 0.04 && qTail < W * H * 0.96) {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const idx = y * W + x;
          if (!visited[idx]) continue;
          if (
            x === 1 ||
            x === W - 2 ||
            y === 1 ||
            y === H - 2 ||
            !visited[idx - 1] ||
            !visited[idx + 1] ||
            !visited[idx - W] ||
            !visited[idx + W]
          ) {
            boundaryPts.push({ x, y });
          }
        }
      }
    }

    // If the image is nearly uniform or segmentation covered >96% (e.g. screenshot with subtle frame or edge-only photo),
    // collect strong outer Sobel edge points via directional ray-casting from the 4 sides inward
    if (boundaryPts.length < 24) {
      const edgeThresh = Math.max(25, maxGrad * 0.24);
      // Cast rays from top, bottom, left, right edges inward to find the first strong document boundary
      for (let x = Math.floor(W * 0.05); x < Math.ceil(W * 0.95); x += 2) {
        for (let y = 2; y < Math.floor(H * 0.45); y++) {
          if (gradMag[y * W + x] >= edgeThresh) {
            boundaryPts.push({ x, y });
            break;
          }
        }
        for (let y = H - 3; y > Math.ceil(H * 0.55); y--) {
          if (gradMag[y * W + x] >= edgeThresh) {
            boundaryPts.push({ x, y });
            break;
          }
        }
      }
      for (let y = Math.floor(H * 0.05); y < Math.ceil(H * 0.95); y += 2) {
        for (let x = 2; x < Math.floor(W * 0.45); x++) {
          if (gradMag[y * W + x] >= edgeThresh) {
            boundaryPts.push({ x, y });
            break;
          }
        }
        for (let x = W - 3; x > Math.ceil(W * 0.55); x--) {
          if (gradMag[y * W + x] >= edgeThresh) {
            boundaryPts.push({ x, y });
            break;
          }
        }
      }
    }

    if (boundaryPts.length < 8) {
      return fallback;
    }

    // 5. Compute Convex Hull (Monotone Chain) of boundaryPts
    const hull = computeConvexHull(boundaryPts);
    if (hull.length < 4) {
      return fallback;
    }

    // 6. Find the 4 corners [TL, TR, BR, BL] on the hull using combined
    //    Maximum-Area Quadrilateral + Directional Extreme Scoring
    let cornersPx = findBestQuadrilateralCorners(hull, W, H);

    // 7. Refine each of the 4 sides using local Sobel edge-line fitting and compute exact
    //    line-line intersections for sub-pixel corner accuracy
    cornersPx = refineCornersWithEdgeLines(cornersPx, gradMag, W, H);

    return [
      {
        x: clamp(cornersPx[0].x / W, 0.005, 0.995),
        y: clamp(cornersPx[0].y / H, 0.005, 0.995),
      },
      {
        x: clamp(cornersPx[1].x / W, 0.005, 0.995),
        y: clamp(cornersPx[1].y / H, 0.005, 0.995),
      },
      {
        x: clamp(cornersPx[2].x / W, 0.005, 0.995),
        y: clamp(cornersPx[2].y / H, 0.005, 0.995),
      },
      {
        x: clamp(cornersPx[3].x / W, 0.005, 0.995),
        y: clamp(cornersPx[3].y / H, 0.005, 0.995),
      },
    ];
  } catch {
    return fallback;
  }
}

function computeConvexHull(
  points: { x: number; y: number }[]
): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) =>
    a.x !== b.x ? a.x - b.x : a.y - b.y
  );
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function quadArea(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): number {
  return (
    0.5 *
    Math.abs(
      p0.x * p1.y -
        p1.x * p0.y +
        (p1.x * p2.y - p2.x * p1.y) +
        (p2.x * p3.y - p3.x * p2.y) +
        (p3.x * p0.y - p0.x * p3.y)
    )
  );
}

function orderCornersClockwise(
  pts: { x: number; y: number }[]
): [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;

  // Sort by angle around centroid
  const byAngle = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );

  // Rotate array so index 0 is Top-Left (minimum x + y)
  let tlIdx = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const sum = byAngle[i].x + byAngle[i].y;
    if (sum < minSum) {
      minSum = sum;
      tlIdx = i;
    }
  }

  const ordered = [
    byAngle[tlIdx],
    byAngle[(tlIdx + 1) % 4],
    byAngle[(tlIdx + 2) % 4],
    byAngle[(tlIdx + 3) % 4],
  ];
  return [ordered[0], ordered[1], ordered[2], ordered[3]];
}

function findBestQuadrilateralCorners(
  hull: { x: number; y: number }[],
  W: number,
  H: number
): [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] {
  // Subsample hull to at most 40 vertices for fast exact 4-tuple search
  const maxVerts = 36;
  const step = Math.max(1, Math.floor(hull.length / maxVerts));
  const sampled: { x: number; y: number }[] = [];
  for (let i = 0; i < hull.length; i += step) {
    sampled.push(hull[i]);
  }

  // Also ensure the 4 diagonal extreme hull points are always in `sampled`
  let tl = hull[0];
  let tr = hull[0];
  let br = hull[0];
  let bl = hull[0];
  for (const p of hull) {
    if (p.x / W + p.y / H < tl.x / W + tl.y / H) tl = p;
    if (p.x / W - p.y / H > tr.x / W - tr.y / H) tr = p;
    if (p.x / W + p.y / H > br.x / W + br.y / H) br = p;
    if (p.y / H - p.x / W > bl.y / H - bl.x / W) bl = p;
  }
  for (const ext of [tl, tr, br, bl]) {
    if (!sampled.some((s) => s.x === ext.x && s.y === ext.y)) {
      sampled.push(ext);
    }
  }

  // Sort sampled vertices clockwise around their centroid
  const cx = sampled.reduce((s, p) => s + p.x, 0) / sampled.length;
  const cy = sampled.reduce((s, p) => s + p.y, 0) / sampled.length;
  sampled.sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );

  const n = sampled.length;
  if (n < 4) {
    return orderCornersClockwise([tl, tr, br, bl]);
  }

  let bestQuad: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ] = orderCornersClockwise([tl, tr, br, bl]);
  let maxScore = quadArea(bestQuad[0], bestQuad[1], bestQuad[2], bestQuad[3]);

  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const area = quadArea(sampled[i], sampled[j], sampled[k], sampled[l]);
          if (area > maxScore) {
            maxScore = area;
            bestQuad = orderCornersClockwise([
              sampled[i],
              sampled[j],
              sampled[k],
              sampled[l],
            ]);
          }
        }
      }
    }
  }

  return bestQuad;
}

/**
 * Refines each of the 4 quadrilateral edges by fitting a weighted line to the strongest
 * Sobel edge gradients along the middle 70% of each side, then computing the exact
 * geometric intersection of adjacent sides.
 */
function refineCornersWithEdgeLines(
  corners: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ],
  gradMag: Float32Array,
  W: number,
  H: number
): [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] {
  const fitRefinedSideLine = (
    pStart: { x: number; y: number },
    pEnd: { x: number; y: number }
  ): { a: number; b: number; c: number } => {
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) {
      // Standard line a*x + b*y + c = 0
      const a = -dy;
      const b = dx;
      const c = -(a * pStart.x + b * pStart.y);
      return { a, b, c };
    }

    const nx = -dy / len;
    const ny = dx / len;
    const searchRadius = Math.max(4, Math.min(12, Math.round(len * 0.05)));
    const samples = 28;

    const pts: { x: number; y: number; w: number }[] = [];
    for (let s = 0; s <= samples; s++) {
      // Sample middle 76% of the edge to avoid corner curvature
      const t = 0.12 + (s / samples) * 0.76;
      const bx = pStart.x + dx * t;
      const by = pStart.y + dy * t;

      let bestMag = -1;
      let bestX = bx;
      let bestY = by;

      for (let r = -searchRadius; r <= searchRadius; r++) {
        const sx = Math.round(bx + nx * r);
        const sy = Math.round(by + ny * r);
        if (sx >= 1 && sx < W - 1 && sy >= 1 && sy < H - 1) {
          const m = gradMag[sy * W + sx];
          // Slight Gaussian preference for staying close to initial edge
          const weightedM = m * (1 - Math.abs(r) / (searchRadius * 2.5));
          if (weightedM > bestMag) {
            bestMag = weightedM;
            bestX = sx;
            bestY = sy;
          }
        }
      }

      if (bestMag > 15) {
        pts.push({ x: bestX, y: bestY, w: bestMag });
      }
    }

    if (pts.length < 6) {
      const a = -dy;
      const b = dx;
      const c = -(a * pStart.x + b * pStart.y);
      return { a, b, c };
    }

    // Weighted orthogonal total least squares line fit
    let sumW = 0;
    let meanX = 0;
    let meanY = 0;
    for (const p of pts) {
      sumW += p.w;
      meanX += p.x * p.w;
      meanY += p.y * p.w;
    }
    meanX /= sumW;
    meanY /= sumW;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const ux = p.x - meanX;
      const uy = p.y - meanY;
      sxx += p.w * ux * ux;
      syy += p.w * uy * uy;
      sxy += p.w * ux * uy;
    }

    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dirX = Math.cos(theta);
    const dirY = Math.sin(theta);
    const a = -dirY;
    const b = dirX;
    const c = -(a * meanX + b * meanY);
    return { a, b, c };
  };

  const intersectLines = (
    l1: { a: number; b: number; c: number },
    l2: { a: number; b: number; c: number },
    fallbackPt: { x: number; y: number }
  ): { x: number; y: number } => {
    const det = l1.a * l2.b - l2.a * l1.b;
    if (Math.abs(det) < 1e-6) return fallbackPt;
    const x = (l1.b * l2.c - l2.b * l1.c) / det;
    const y = (l2.a * l1.c - l1.a * l2.c) / det;
    // Only accept refined intersection if within a reasonable distance of the hull vertex
    if (Math.hypot(x - fallbackPt.x, y - fallbackPt.y) > Math.max(W, H) * 0.12) {
      return fallbackPt;
    }
    return { x, y };
  };

  const topLine = fitRefinedSideLine(corners[0], corners[1]);
  const rightLine = fitRefinedSideLine(corners[1], corners[2]);
  const bottomLine = fitRefinedSideLine(corners[2], corners[3]);
  const leftLine = fitRefinedSideLine(corners[3], corners[0]);

  return [
    intersectLines(topLine, leftLine, corners[0]),
    intersectLines(topLine, rightLine, corners[1]),
    intersectLines(bottomLine, rightLine, corners[2]),
    intersectLines(bottomLine, leftLine, corners[3]),
  ];
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
