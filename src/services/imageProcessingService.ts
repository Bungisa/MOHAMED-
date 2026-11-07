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
 * Automatically detects the 4 corners of a document page using Sobel edge
 * gradient magnitude analysis and quadrant corner scoring.
 */
export async function detectDocumentCorners(
  imageDataUrl: string
): Promise<[Point2D, Point2D, Point2D, Point2D]> {
  const fallback: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ];

  try {
    const img = await loadImageElement(imageDataUrl);
    const analysisW = 240;
    const analysisH = 240;
    const canvas = document.createElement('canvas');
    canvas.width = analysisW;
    canvas.height = analysisH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;

    ctx.drawImage(img, 0, 0, analysisW, analysisH);
    const { data } = ctx.getImageData(0, 0, analysisW, analysisH);

    // 1. Convert to grayscale
    const gray = new Float32Array(analysisW * analysisH);
    for (let i = 0; i < analysisW * analysisH; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }

    // 2. Compute Sobel edge magnitude
    const mag = new Float32Array(analysisW * analysisH);
    let maxMag = 0;
    for (let y = 2; y < analysisH - 2; y++) {
      for (let x = 2; x < analysisW - 2; x++) {
        const gx =
          -gray[(y - 1) * analysisW + (x - 1)] +
          gray[(y - 1) * analysisW + (x + 1)] -
          2 * gray[y * analysisW + (x - 1)] +
          2 * gray[y * analysisW + (x + 1)] -
          gray[(y + 1) * analysisW + (x - 1)] +
          gray[(y + 1) * analysisW + (x + 1)];

        const gy =
          -gray[(y - 1) * analysisW + (x - 1)] -
          2 * gray[(y - 1) * analysisW + x] -
          gray[(y - 1) * analysisW + (x + 1)] +
          gray[(y + 1) * analysisW + (x - 1)] +
          2 * gray[(y + 1) * analysisW + x] +
          gray[(y + 1) * analysisW + (x + 1)];

        const m = Math.hypot(gx, gy);
        mag[y * analysisW + x] = m;
        if (m > maxMag) maxMag = m;
      }
    }

    if (maxMag < 35) {
      return fallback;
    }

    const threshold = maxMag * 0.28;
    // Score candidates in each quadrant by proximity to outer corners + edge strength
    let bestTL = { x: 0.08, y: 0.08, score: -Infinity };
    let bestTR = { x: 0.92, y: 0.08, score: -Infinity };
    let bestBR = { x: 0.92, y: 0.92, score: -Infinity };
    let bestBL = { x: 0.08, y: 0.92, score: -Infinity };

    const margin = Math.floor(analysisW * 0.03);
    for (let y = margin; y < analysisH - margin; y++) {
      for (let x = margin; x < analysisW - margin; x++) {
        const m = mag[y * analysisW + x];
        if (m < threshold) continue;

        const nx = x / analysisW;
        const ny = y / analysisH;
        const edgeWeight = Math.min(m / maxMag, 1) * 0.35;

        if (nx < 0.48 && ny < 0.48) {
          const s = (1 - nx) + (1 - ny) + edgeWeight;
          if (s > bestTL.score) bestTL = { x: nx, y: ny, score: s };
        } else if (nx > 0.52 && ny < 0.48) {
          const s = nx + (1 - ny) + edgeWeight;
          if (s > bestTR.score) bestTR = { x: nx, y: ny, score: s };
        } else if (nx > 0.52 && ny > 0.52) {
          const s = nx + ny + edgeWeight;
          if (s > bestBR.score) bestBR = { x: nx, y: ny, score: s };
        } else if (nx < 0.48 && ny > 0.52) {
          const s = (1 - nx) + ny + edgeWeight;
          if (s > bestBL.score) bestBL = { x: nx, y: ny, score: s };
        }
      }
    }

    if (
      bestTL.score === -Infinity ||
      bestTR.score === -Infinity ||
      bestBR.score === -Infinity ||
      bestBL.score === -Infinity
    ) {
      return fallback;
    }

    return [
      { x: clamp(bestTL.x, 0.02, 0.45), y: clamp(bestTL.y, 0.02, 0.45) },
      { x: clamp(bestTR.x, 0.55, 0.98), y: clamp(bestTR.y, 0.02, 0.45) },
      { x: clamp(bestBR.x, 0.55, 0.98), y: clamp(bestBR.y, 0.55, 0.98) },
      { x: clamp(bestBL.x, 0.02, 0.45), y: clamp(bestBL.y, 0.55, 0.98) },
    ];
  } catch {
    return fallback;
  }
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
