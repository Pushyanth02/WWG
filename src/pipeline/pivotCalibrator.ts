import { RasterBuffer, createRaster } from './raster.ts';

export interface FeetAnchor {
  feetCentroidX: number;
  baselineY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  silhouetteArea: number;
}

export interface CalibrateCellOptions {
  /** Target fit strategy: 'feet_pivot' locks bottom-22% feet centroid onto targetPivotX/Y */
  anchor?: 'feet_pivot' | 'bottom' | 'center' | 'fill';
  maxW?: number;
  maxH?: number;
  /** Target half-res pivot X (e.g., 16 for 64x64 unit, 32 for 128x128 boss) */
  targetPivotX?: number;
  /** Target half-res ground-contact baseline Y (e.g., 28 for 64x64 unit, 55 for 128x128 boss) */
  targetPivotY?: number;
  /** Extra intentional animation offset (e.g., attack lunge or idle breath) */
  offsetX?: number;
  offsetY?: number;
  preserveSoftAlpha?: boolean;
  /** Prevent any opaque silhouette pixel from clipping outside frame padding */
  safeMargin?: number;
}

export interface CalibratedCellResult {
  buffer: RasterBuffer;
  feetX: number;
  baselineY: number;
  pivotShiftDx: number;
  pivotShiftDy: number;
  scaleUsed: number;
}

/**
 * Computes the dynamic ground-contact anchor (feet horizontal centroid + solid foot baseline)
 * of a sprite silhouette.
 *
 * Uses the bottom 22% slice of the opaque silhouette and weights horizontally toward dense
 * ground-contact columns so extended capes, swords, or side spells do not yank the pivot off center.
 */
export function computeFeetAnchor(buf: RasterBuffer, minAlpha = 110): FeetAnchor {
  const w = buf.width;
  const h = buf.height;
  const d = buf.data;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let area = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= minAlpha) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        area++;
      }
    }
  }

  // Fallback for wispy VFX with lower alpha
  if (area === 0 && minAlpha > 20) {
    return computeFeetAnchor(buf, 20);
  }
  if (area === 0) {
    return {
      feetCentroidX: w * 0.5,
      baselineY: h - 1,
      minX: 0,
      maxX: w - 1,
      minY: 0,
      maxY: h - 1,
      silhouetteArea: 0,
    };
  }

  const silH = Math.max(1, maxY - minY + 1);
  const sliceStartY = Math.max(minY, Math.floor(maxY - Math.max(2, silH * 0.22)));

  // Row widths inside bottom 22% slice to find solid ground baseline (ignoring 1px stray drops)
  const rowCounts: number[] = [];
  for (let y = sliceStartY; y <= maxY; y++) {
    let cnt = 0;
    for (let x = minX; x <= maxX; x++) {
      if (d[(y * w + x) * 4 + 3] >= minAlpha) cnt++;
    }
    rowCounts.push(cnt);
  }
  const sortedCounts = [...rowCounts].sort((a, b) => a - b);
  const medianRowW = sortedCounts[Math.floor(sortedCounts.length * 0.5)] || 1;

  let baselineY = maxY;
  for (let y = maxY; y >= sliceStartY; y--) {
    const cnt = rowCounts[y - sliceStartY];
    if (cnt >= Math.max(2, medianRowW * 0.28)) {
      baselineY = y;
      break;
    }
  }

  // Trimmed alpha-weighted horizontal centroid across the bottom 22% feet slice
  let sumX = 0;
  let sumW = 0;
  for (let y = sliceStartY; y <= baselineY; y++) {
    // Emphasize rows closer to the actual foot contact line
    const rowWeight = 1 + ((y - sliceStartY) / Math.max(1, baselineY - sliceStartY)) * 0.6;
    for (let x = minX; x <= maxX; x++) {
      const a = d[(y * w + x) * 4 + 3];
      if (a >= minAlpha) {
        const wgt = (a / 255) * rowWeight;
        sumX += x * wgt;
        sumW += wgt;
      }
    }
  }

  const rawFeetX = sumW > 0 ? sumX / sumW : (minX + maxX) * 0.5;
  // Second pass: reject extreme horizontal outliers (> 42% of silhouette width from raw centroid)
  const silW = Math.max(1, maxX - minX + 1);
  const outlierRadius = Math.max(4, silW * 0.42);
  let trimmedSumX = 0;
  let trimmedSumW = 0;
  for (let y = sliceStartY; y <= baselineY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = d[(y * w + x) * 4 + 3];
      if (a >= minAlpha && Math.abs(x - rawFeetX) <= outlierRadius) {
        const wgt = a / 255;
        trimmedSumX += x * wgt;
        trimmedSumW += wgt;
      }
    }
  }

  const feetCentroidX = trimmedSumW > 0 ? trimmedSumX / trimmedSumW : rawFeetX;

  return {
    feetCentroidX,
    baselineY,
    minX,
    maxX,
    minY,
    maxY,
    silhouetteArea: area,
  };
}

/**
 * Outline-Aware Area Resampling + Dynamic Feet-Centroid Pivot Recalibration.
 *
 * Resamples an arbitrarily sized raw source sprite into a crisp half-res pixel-art cell
 * (e.g. 32x32 -> 64x64 at 2x, or 64x64 -> 128x128 at 2x), anchoring the computed feet centroid
 * onto the exact V3.1 contract pivot while preserving crisp dark pixel-art outlines and preventing
 * boundary clipping.
 */
export function resampleToCalibratedCell(
  src: RasterBuffer,
  cellW: number,
  cellH: number,
  options?: CalibrateCellOptions
): CalibratedCellResult {
  const out = createRaster(cellW, cellH);
  const anchor = options?.anchor ?? 'feet_pivot';
  const maxW = options?.maxW ?? (anchor === 'fill' ? cellW : cellW - 4);
  const maxH = options?.maxH ?? (anchor === 'fill' ? cellH : cellH - 4);
  const safeMargin = options?.safeMargin ?? (anchor === 'fill' ? 0 : 1);
  const preserveSoftAlpha = options?.preserveSoftAlpha ?? false;

  const srcW = Math.max(1, src.width);
  const srcH = Math.max(1, src.height);

  let scaleX: number;
  let scaleY: number;
  if (anchor === 'fill') {
    scaleX = cellW / srcW;
    scaleY = cellH / srcH;
  } else {
    const s = Math.min(maxW / srcW, maxH / srcH);
    scaleX = s;
    scaleY = s;
  }

  const dstW = Math.max(1, Math.round(srcW * scaleX));
  const dstH = Math.max(1, Math.round(srcH * scaleY));

  const srcAnchor = computeFeetAnchor(src, preserveSoftAlpha ? 20 : 110);
  const targetPivotX = options?.targetPivotX ?? Math.floor(cellW / 2);
  const targetPivotY = options?.targetPivotY ?? (cellH >= 64 ? 55 : 28);

  const naiveDx = Math.floor((cellW - dstW) / 2);
  const naiveDy = anchor === 'center' ? Math.floor((cellH - dstH) / 2) : targetPivotY - dstH + 1;

  let dx = naiveDx;
  let dy = naiveDy;

  if (anchor === 'fill') {
    dx = 0;
    dy = 0;
  } else if (anchor === 'center') {
    dx = Math.floor((cellW - dstW) / 2) + (options?.offsetX ?? 0);
    dy = Math.floor((cellH - dstH) / 2) + (options?.offsetY ?? 0);
  } else if (anchor === 'bottom') {
    dx = Math.floor((cellW - dstW) / 2) + (options?.offsetX ?? 0);
    dy = targetPivotY - dstH + 1 + (options?.offsetY ?? 0);
  } else {
    // Dynamic feet-centroid alignment onto exact V3.1 contract pivot
    const scaledFeetX = (srcAnchor.feetCentroidX + 0.5) * scaleX;
    const scaledBaseY = (srcAnchor.baselineY + 1) * scaleY;
    dx = Math.round(targetPivotX - scaledFeetX) + (options?.offsetX ?? 0);
    dy = Math.round(targetPivotY - scaledBaseY + 1) + (options?.offsetY ?? 0);

    // Safe boundary clamp so hats, staves, or wide cloaks never clip off the cell edge
    const minDx = safeMargin;
    const maxDx = Math.max(minDx, cellW - safeMargin - dstW);
    const minDy = safeMargin;
    const maxDy = Math.max(minDy, cellH - safeMargin - dstH);
    dx = Math.max(minDx, Math.min(maxDx, dx));
    dy = Math.max(minDy, Math.min(maxDy, dy));
  }

  const d = src.data;
  for (let ty = 0; ty < dstH; ty++) {
    const outY = dy + ty;
    if (outY < 0 || outY >= cellH) continue;
    const sy0 = (ty / dstH) * srcH;
    const sy1 = ((ty + 1) / dstH) * srcH;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(srcH - 1, Math.max(iy0, Math.ceil(sy1) - 1));

    for (let tx = 0; tx < dstW; tx++) {
      const outX = dx + tx;
      if (outX < 0 || outX >= cellW) continue;
      const sx0 = (tx / dstW) * srcW;
      const sx1 = ((tx + 1) / dstW) * srcW;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(srcW - 1, Math.max(ix0, Math.ceil(sx1) - 1));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let totalSamples = 0;
      let opaqueSamples = 0;
      let darkInkSamples = 0;
      let darkR = 0;
      let darkG = 0;
      let darkB = 0;

      for (let sy = iy0; sy <= iy1; sy++) {
        for (let sx = ix0; sx <= ix1; sx++) {
          totalSamples++;
          const off = (sy * srcW + sx) * 4;
          const a = d[off + 3];
          if (a < 20) continue;
          const r = d[off];
          const g = d[off + 1];
          const b = d[off + 2];
          opaqueSamples++;
          const wgt = a / 255;
          sumR += r * wgt;
          sumG += g * wgt;
          sumB += b * wgt;
          sumA += wgt;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < 48 && a > 180) {
            darkInkSamples++;
            darkR += r;
            darkG += g;
            darkB += b;
          }
        }
      }

      if (totalSamples === 0 || opaqueSamples === 0) continue;
      const coverage = sumA / totalSamples;
      if (!preserveSoftAlpha && coverage < 0.34) continue;
      if (preserveSoftAlpha && coverage < 0.08) continue;

      let r = Math.round(sumR / sumA);
      let g = Math.round(sumG / sumA);
      let b = Math.round(sumB / sumA);
      const a = preserveSoftAlpha
        ? Math.min(255, Math.round(coverage * 255))
        : coverage >= 0.58
          ? 255
          : Math.min(255, Math.round(coverage * 285));

      // Outline-aware preservation: retain crisp internal pixel ink lines during downsampling
      if (!preserveSoftAlpha && darkInkSamples / totalSamples >= 0.22 && darkInkSamples > 0) {
        const inkR = darkR / darkInkSamples;
        const inkG = darkG / darkInkSamples;
        const inkB = darkB / darkInkSamples;
        r = Math.round(r * 0.35 + inkR * 0.65);
        g = Math.round(g * 0.35 + inkG * 0.65);
        b = Math.round(b * 0.35 + inkB * 0.65);
      }

      const outOff = (outY * cellW + outX) * 4;
      out.data[outOff] = r;
      out.data[outOff + 1] = g;
      out.data[outOff + 2] = b;
      out.data[outOff + 3] = a;
    }
  }

  const finalAnchor = computeFeetAnchor(out, preserveSoftAlpha ? 20 : 120);

  return {
    buffer: out,
    feetX: Number(finalAnchor.feetCentroidX.toFixed(2)),
    baselineY: Number(finalAnchor.baselineY.toFixed(2)),
    pivotShiftDx: dx - naiveDx,
    pivotShiftDy: dy - naiveDy,
    scaleUsed: Number(scaleX.toFixed(3)),
  };
}

export interface V31NormalizedFrameResult {
  kind: 'player' | 'tyrant';
  buffer: RasterBuffer;
  nativeBuffer: RasterBuffer;
  cellSize: 64 | 128;
  nativeSize: 32 | 64;
  targetPivot: { x: number; y: number };
  detectedFeet: { x: number; y: number };
  pivotDeviationPx: number;
  clamped: boolean;
  scaleUsed: number;
  twoByTwoUniformity: number;
  cornerAlphas: [number, number, number, number];
}

/**
 * V3.1 Contract Stage 4 Frame Normalizer (parity with normalize_extracted_frame_v31.py):
 * - Player / Enemy: 32x32 native draft -> 64x64 cell via 2x nearest-neighbor, pivot locked to (32, 54)
 * - Tyrant Boss: 64x64 native draft -> 128x128 cell via 2x nearest-neighbor, pivot locked to (64, 104)
 * - Uses 0.20 contact_foot_height_fraction, room-above/room-below scale clamping, and outline-aware resampling.
 */
export function normalizeFrameV31(
  src: RasterBuffer,
  kind: 'player' | 'tyrant',
  options?: { preserveSoftAlpha?: boolean }
): V31NormalizedFrameResult {
  const cellSize: 64 | 128 = kind === 'tyrant' ? 128 : 64;
  const nativeSize: 32 | 64 = kind === 'tyrant' ? 64 : 32;
  const targetPivot = kind === 'tyrant' ? { x: 64, y: 104 } : { x: 32, y: 54 };
  const px = Math.floor(targetPivot.x / 2);
  const py = Math.floor(targetPivot.y / 2);
  const margin = kind === 'tyrant' ? 2 : 1;
  const preserveSoftAlpha = options?.preserveSoftAlpha ?? false;

  const srcAnchor = computeFeetAnchor(src, preserveSoftAlpha ? 20 : 65);
  const roomAbove = Math.max(1, py - margin);
  const roomBelow = Math.max(1, nativeSize - margin - 1 - py);
  const footAbove = Math.max(1, srcAnchor.baselineY);
  const footBelow = Math.max(1, src.height - 1 - srcAnchor.baselineY);

  const maxW = nativeSize - 2 * margin;
  const maxH = nativeSize - 2 * margin;
  const scaleBound = Math.min(
    1,
    maxW / Math.max(1, src.width),
    maxH / Math.max(1, src.height),
    roomAbove / footAbove,
    roomBelow / footBelow
  );
  const maxFittedW = Math.max(1, Math.round(src.width * scaleBound));
  const maxFittedH = Math.max(1, Math.round(src.height * scaleBound));

  const cal = resampleToCalibratedCell(src, nativeSize, nativeSize, {
    anchor: preserveSoftAlpha ? 'center' : 'feet_pivot',
    maxW: maxFittedW,
    maxH: maxFittedH,
    targetPivotX: px,
    targetPivotY: py,
    safeMargin: margin,
    preserveSoftAlpha,
  });

  // Integer 2x nearest-neighbor upscale
  const high = createRaster(cellSize, cellSize);
  for (let y = 0; y < nativeSize; y++) {
    for (let x = 0; x < nativeSize; x++) {
      const sOff = (y * nativeSize + x) * 4;
      const r = cal.buffer.data[sOff];
      const g = cal.buffer.data[sOff + 1];
      const b = cal.buffer.data[sOff + 2];
      const a = cal.buffer.data[sOff + 3];
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const dOff = ((y * 2 + oy) * cellSize + (x * 2 + ox)) * 4;
          high.data[dOff] = r;
          high.data[dOff + 1] = g;
          high.data[dOff + 2] = b;
          high.data[dOff + 3] = a;
        }
      }
    }
  }

  // Measure final feet centroid & 2x2 block uniformity on full-res output
  const finalFeet = computeFeetAnchor(high, preserveSoftAlpha ? 20 : 65);
  const deviation = Math.hypot(
    finalFeet.feetCentroidX - targetPivot.x,
    finalFeet.baselineY - targetPivot.y
  );

  let uniformBlocks = 0;
  let totalBlocks = 0;
  for (let y = 0; y < cellSize; y += 2) {
    for (let x = 0; x < cellSize; x += 2) {
      totalBlocks++;
      const i00 = (y * cellSize + x) * 4;
      const i10 = (y * cellSize + x + 1) * 4;
      const i01 = ((y + 1) * cellSize + x) * 4;
      const i11 = ((y + 1) * cellSize + x + 1) * 4;
      let eq = true;
      for (let c = 0; c < 4; c++) {
        const base = high.data[i00 + c];
        if (high.data[i10 + c] !== base || high.data[i01 + c] !== base || high.data[i11 + c] !== base) {
          eq = false;
          break;
        }
      }
      if (eq) uniformBlocks++;
    }
  }

  const cornerAlphas: [number, number, number, number] = [
    high.data[3],
    high.data[(cellSize - 1) * 4 + 3],
    high.data[(cellSize - 1) * cellSize * 4 + 3],
    high.data[((cellSize - 1) * cellSize + (cellSize - 1)) * 4 + 3],
  ];

  const clamped = cal.pivotShiftDx !== 0 || cal.pivotShiftDy !== 0 ? deviation > 2.5 : false;

  return {
    kind,
    buffer: high,
    nativeBuffer: cal.buffer,
    cellSize,
    nativeSize,
    targetPivot,
    detectedFeet: {
      x: Number(finalFeet.feetCentroidX.toFixed(2)),
      y: Number(finalFeet.baselineY.toFixed(2)),
    },
    pivotDeviationPx: Number(deviation.toFixed(2)),
    clamped,
    scaleUsed: cal.scaleUsed,
    twoByTwoUniformity: Number((uniformBlocks / Math.max(1, totalBlocks)).toFixed(4)),
    cornerAlphas,
  };
}

