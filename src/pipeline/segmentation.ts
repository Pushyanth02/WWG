import { BackdropMode, cleanAlphaBuffer } from './alphaCleanup.ts';
import { RasterBuffer, createRaster, cropRaster } from './raster.ts';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ContourPoint {
  x: number;
  y: number;
}

export interface SeamCut {
  /** Seam x-coordinate in component-local space for each row y */
  xs: number[];
  /** Absolute sheet-space origin offset */
  originX: number;
  originY: number;
  energy: number;
}

export interface SegmentedSprite {
  buffer: RasterBuffer;
  bbox: BBox;
  silhouetteArea: number;
  contour: ContourPoint[];
  splitBySeam: boolean;
}

export interface SegmentationResult {
  sprites: SegmentedSprite[];
  seamCuts: SeamCut[];
  rawComponentCount: number;
}

export interface SegmentOptions {
  minArea?: number;
  minW?: number;
  minH?: number;
  mergeGap?: number;
  /** If a component exceeds this width, split it adaptively via minimum-energy vertical seam */
  maxSpriteWidth?: number;
  /** Optional hint for expected number of sprites in a band (forces adaptive seam splitting on widest merged blobs) */
  expectedCount?: number;
  /** Include Moore-neighbor outer contour trace for overlay inspection */
  traceContours?: boolean;
  /** Sort order: 'ltr' for single strip bands, 'reading' for multi-row atlases */
  sortOrder?: 'ltr' | 'reading';
  minAlpha?: number;
}

interface RawComponent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

/**
 * Moore-Neighbor Outer Contour Tracer (8-connected boundary walk).
 * Returns an ordered polygon of boundary pixel coordinates in buffer-local space.
 */
export function traceOuterContour(buf: RasterBuffer, minAlpha = 28): ContourPoint[] {
  const w = buf.width;
  const h = buf.height;
  const d = buf.data;
  const isFg = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= minAlpha;

  let startX = -1;
  let startY = -1;
  for (let y = 0; y < h && startX === -1; y++) {
    for (let x = 0; x < w; x++) {
      if (isFg(x, y)) {
        startX = x;
        startY = y;
        break;
      }
    }
  }
  if (startX === -1) return [];

  // Clockwise Moore neighborhood offsets: W, NW, N, NE, E, SE, S, SW
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, -1, -1, -1, 0, 1, 1, 1];

  const contour: ContourPoint[] = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  // Came from West (left of start pixel, which is guaranteed empty)
  let backDir = 0;
  const maxSteps = Math.min(w * h * 2, 4096);

  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const dir = (backDir + k) & 7;
      const nx = cx + dx[dir];
      const ny = cy + dy[dir];
      if (isFg(nx, ny)) {
        cx = nx;
        cy = ny;
        // Backtrack direction points to the neighbor right before `dir` in clockwise order
        backDir = (dir + 5) & 7;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === startX && cy === startY && contour.length > 2) break;
    contour.push({ x: cx, y: cy });
  }

  return contour;
}

/**
 * Computes a minimum-energy vertical seam path through a cropped sprite component using
 * Dynamic Programming over alpha opacity + Sobel gradient magnitude.
 * This cleanly separates touching capes, staves, or aura fringes along their natural gap
 * without slicing through solid character limbs.
 */
function findMinimumEnergySeam(
  buf: RasterBuffer,
  minX: number,
  maxX: number
): { xs: number[]; energy: number } {
  const w = buf.width;
  const h = buf.height;
  const d = buf.data;
  const xStart = Math.max(1, Math.min(w - 2, Math.floor(minX)));
  const xEnd = Math.max(xStart, Math.min(w - 2, Math.ceil(maxX)));
  const span = xEnd - xStart + 1;

  // Per-pixel energy map inside [xStart..xEnd]
  const energy = new Float32Array(h * span);
  const dp = new Float32Array(h * span);
  const prev = new Int8Array(h * span);

  const lumaAt = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    const off = (cy * w + cx) * 4;
    const a = d[off + 3] / 255;
    return (0.299 * d[off] + 0.587 * d[off + 1] + 0.114 * d[off + 2]) * a;
  };

  const center = (xStart + xEnd) * 0.5;
  const halfSpan = Math.max(1, span * 0.5);

  for (let y = 0; y < h; y++) {
    for (let sx = 0; sx < span; sx++) {
      const x = xStart + sx;
      const off = (y * w + x) * 4;
      const alphaNorm = d[off + 3] / 255;

      // Sobel horizontal + vertical luminance gradient
      const gx =
        -lumaAt(x - 1, y - 1) +
        lumaAt(x + 1, y - 1) -
        2 * lumaAt(x - 1, y) +
        2 * lumaAt(x + 1, y) -
        lumaAt(x - 1, y + 1) +
        lumaAt(x + 1, y + 1);
      const gy =
        -lumaAt(x - 1, y - 1) -
        2 * lumaAt(x, y - 1) -
        lumaAt(x + 1, y - 1) +
        lumaAt(x - 1, y + 1) +
        2 * lumaAt(x, y + 1) +
        lumaAt(x + 1, y + 1);
      const gradNorm = Math.min(1, Math.hypot(gx, gy) / 600);

      // Gentle quadratic bias toward the expected center of the split window
      const distBias = Math.pow((x - center) / halfSpan, 2) * 0.12;
      // Opaque foreground pixels carry heavy cut cost; transparent valleys cost ~0
      const e = alphaNorm * alphaNorm * 10.0 + gradNorm * 2.5 + distBias;
      energy[y * span + sx] = e;
    }
  }

  // DP forward pass
  for (let sx = 0; sx < span; sx++) {
    dp[sx] = energy[sx];
  }
  for (let y = 1; y < h; y++) {
    for (let sx = 0; sx < span; sx++) {
      let bestCost = dp[(y - 1) * span + sx];
      let bestStep = 0;
      if (sx > 0) {
        const leftCost = dp[(y - 1) * span + (sx - 1)] + 0.18;
        if (leftCost < bestCost) {
          bestCost = leftCost;
          bestStep = -1;
        }
      }
      if (sx + 1 < span) {
        const rightCost = dp[(y - 1) * span + (sx + 1)] + 0.18;
        if (rightCost < bestCost) {
          bestCost = rightCost;
          bestStep = 1;
        }
      }
      dp[y * span + sx] = energy[y * span + sx] + bestCost;
      prev[y * span + sx] = bestStep;
    }
  }

  // Backtrack lowest-energy vertical path
  let bestSx = 0;
  let bestTotal = dp[(h - 1) * span];
  for (let sx = 1; sx < span; sx++) {
    const cost = dp[(h - 1) * span + sx];
    if (cost < bestTotal) {
      bestTotal = cost;
      bestSx = sx;
    }
  }

  const xs = new Array<number>(h);
  let curSx = bestSx;
  for (let y = h - 1; y >= 0; y--) {
    xs[y] = xStart + curSx;
    if (y > 0) {
      curSx = Math.max(0, Math.min(span - 1, curSx + prev[y * span + curSx]));
    }
  }

  return { xs, energy: bestTotal };
}

/** Tight-crops a RasterBuffer to its non-transparent silhouette bounding box */
export function trimTightAlpha(
  buf: RasterBuffer,
  minAlpha = 20
): { buffer: RasterBuffer; offsetX: number; offsetY: number; area: number } | null {
  const w = buf.width;
  const h = buf.height;
  const d = buf.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
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

  if (maxX < minX || maxY < minY) return null;
  return {
    buffer: cropRaster(buf, minX, minY, maxX - minX + 1, maxY - minY + 1),
    offsetX: minX,
    offsetY: minY,
    area,
  };
}

/** Splits a RasterBuffer into left & right halves along a DP seam path */
function splitBufferAlongSeam(
  buf: RasterBuffer,
  seamXs: number[],
  minAlpha = 20
): [
  { buffer: RasterBuffer; offsetX: number; offsetY: number; area: number } | null,
  { buffer: RasterBuffer; offsetX: number; offsetY: number; area: number } | null,
] {
  const w = buf.width;
  const h = buf.height;
  const left = createRaster(w, h);
  const right = createRaster(w, h);

  for (let y = 0; y < h; y++) {
    const cutX = seamXs[y];
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      if (buf.data[off + 3] === 0) continue;
      if (x < cutX) {
        left.data[off] = buf.data[off];
        left.data[off + 1] = buf.data[off + 1];
        left.data[off + 2] = buf.data[off + 2];
        left.data[off + 3] = buf.data[off + 3];
      } else if (x > cutX) {
        right.data[off] = buf.data[off];
        right.data[off + 1] = buf.data[off + 1];
        right.data[off + 2] = buf.data[off + 2];
        right.data[off + 3] = buf.data[off + 3];
      } else {
        // Assign seam pixel to whichever side has stronger immediate opacity
        const lA = x > 0 ? buf.data[(y * w + x - 1) * 4 + 3] : 0;
        const rA = x + 1 < w ? buf.data[(y * w + x + 1) * 4 + 3] : 0;
        const target = lA >= rA ? left : right;
        target.data[off] = buf.data[off];
        target.data[off + 1] = buf.data[off + 1];
        target.data[off + 2] = buf.data[off + 2];
        target.data[off + 3] = buf.data[off + 3];
      }
    }
  }

  return [trimTightAlpha(left, minAlpha), trimTightAlpha(right, minAlpha)];
}

/**
 * Hybrid Segmentation & Boundary Detection:
 * 1. 8-connected component extraction on an alpha-cleaned buffer.
 * 2. Fragment merging for separated sparkles/hats/weapons within `mergeGap`.
 * 3. Adaptive minimum-energy DP vertical seam splitting when sprites touch or merge.
 * 4. Optional Moore-neighbor outer boundary contour tracing for diagnostics & overlays.
 */
export function segmentSprites(
  cleaned: RasterBuffer,
  options?: SegmentOptions
): SegmentationResult {
  const w = cleaned.width;
  const h = cleaned.height;
  const d = cleaned.data;
  const minAlpha = options?.minAlpha ?? 25;
  const minArea = options?.minArea ?? 18;
  const minW = options?.minW ?? 5;
  const minH = options?.minH ?? 5;
  const mergeGap = options?.mergeGap ?? 3;
  const traceContours = options?.traceContours ?? false;

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const rawComponents: RawComponent[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (visited[start] || d[start * 4 + 3] < minAlpha) continue;
      visited[start] = 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      let x0 = x;
      let y0 = y;
      let x1 = x;
      let y1 = y;
      let area = 0;

      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % w;
        const cy = (cur - cx) / w;
        area++;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (!visited[nIdx] && d[nIdx * 4 + 3] >= minAlpha) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }
      }
      rawComponents.push({ x0, y0, x1, y1, area });
    }
  }

  // Merge nearby fragments belonging to the same sprite (e.g., floating orb, hit sparks, crown)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rawComponents.length; i++) {
      for (let j = i + 1; j < rawComponents.length; j++) {
        const a = rawComponents[i];
        const b = rawComponents[j];
        const overlapX = a.x0 <= b.x1 + mergeGap && b.x0 <= a.x1 + mergeGap;
        const overlapY = a.y0 <= b.y1 + mergeGap && b.y0 <= a.y1 + mergeGap;
        if (overlapX && overlapY) {
          a.x0 = Math.min(a.x0, b.x0);
          a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y1 = Math.max(a.y1, b.y1);
          a.area += b.area;
          rawComponents.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  const filtered = rawComponents.filter(
    (c) => c.area >= minArea && c.x1 - c.x0 + 1 >= minW && c.y1 - c.y0 + 1 >= minH
  );

  interface WorkItem {
    buffer: RasterBuffer;
    bbox: BBox;
    area: number;
    splitBySeam: boolean;
  }

  const items: WorkItem[] = filtered.map((c) => {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    return {
      buffer: cropRaster(cleaned, c.x0, c.y0, bw, bh),
      bbox: { x: c.x0, y: c.y0, w: bw, h: bh },
      area: c.area,
      splitBySeam: false,
    };
  });

  const seamCuts: SeamCut[] = [];

  // Pass A: Width-threshold adaptive seam splitting (when touching frames merge wider than maxSpriteWidth)
  if (options?.maxSpriteWidth && options.maxSpriteWidth > 8) {
    const maxW = options.maxSpriteWidth;
    let safety = 0;
    while (safety < 32) {
      const idx = items.findIndex((it) => it.bbox.w > maxW);
      if (idx === -1) break;
      safety++;
      const target = items[idx];
      const pieces = Math.max(2, Math.round(target.bbox.w / (maxW * 0.85)));
      const idealX = target.bbox.w / pieces;
      const winHalf = Math.max(4, Math.round(target.bbox.w * 0.14));
      const seam = findMinimumEnergySeam(
        target.buffer,
        Math.max(2, idealX - winHalf),
        Math.min(target.bbox.w - 3, idealX + winHalf)
      );
      seamCuts.push({
        xs: seam.xs,
        originX: target.bbox.x,
        originY: target.bbox.y,
        energy: Number(seam.energy.toFixed(2)),
      });
      const [left, right] = splitBufferAlongSeam(target.buffer, seam.xs, minAlpha);
      const replacements: WorkItem[] = [];
      if (left && left.buffer.width >= minW && left.area >= minArea) {
        replacements.push({
          buffer: left.buffer,
          bbox: {
            x: target.bbox.x + left.offsetX,
            y: target.bbox.y + left.offsetY,
            w: left.buffer.width,
            h: left.buffer.height,
          },
          area: left.area,
          splitBySeam: true,
        });
      }
      if (right && right.buffer.width >= minW && right.area >= minArea) {
        replacements.push({
          buffer: right.buffer,
          bbox: {
            x: target.bbox.x + right.offsetX,
            y: target.bbox.y + right.offsetY,
            w: right.buffer.width,
            h: right.buffer.height,
          },
          area: right.area,
          splitBySeam: true,
        });
      }
      if (replacements.length <= 1) break;
      items.splice(idx, 1, ...replacements);
    }
  }

  // Pass B: Expected-count adaptive seam splitting (if a known band has N touching sprites)
  if (options?.expectedCount && options.expectedCount > items.length && items.length > 0) {
    let safety = 0;
    while (items.length < options.expectedCount && safety < 24) {
      safety++;
      // Pick widest remaining sprite to split along its lowest-energy vertical valley
      let widestIdx = 0;
      for (let i = 1; i < items.length; i++) {
        if (items[i].bbox.w > items[widestIdx].bbox.w) widestIdx = i;
      }
      const target = items[widestIdx];
      if (target.bbox.w < minW * 2 + 2) break;
      const missing = options.expectedCount - items.length + 1;
      const estPieces = Math.min(missing, Math.max(2, Math.round(target.bbox.w / Math.max(12, target.bbox.h * 0.7))));
      const idealX = target.bbox.w / estPieces;
      const winHalf = Math.max(4, Math.round(target.bbox.w * 0.16));
      const seam = findMinimumEnergySeam(
        target.buffer,
        Math.max(2, idealX - winHalf),
        Math.min(target.bbox.w - 3, idealX + winHalf)
      );
      seamCuts.push({
        xs: seam.xs,
        originX: target.bbox.x,
        originY: target.bbox.y,
        energy: Number(seam.energy.toFixed(2)),
      });
      const [left, right] = splitBufferAlongSeam(target.buffer, seam.xs, minAlpha);
      const replacements: WorkItem[] = [];
      if (left && left.buffer.width >= minW) {
        replacements.push({
          buffer: left.buffer,
          bbox: {
            x: target.bbox.x + left.offsetX,
            y: target.bbox.y + left.offsetY,
            w: left.buffer.width,
            h: left.buffer.height,
          },
          area: left.area,
          splitBySeam: true,
        });
      }
      if (right && right.buffer.width >= minW) {
        replacements.push({
          buffer: right.buffer,
          bbox: {
            x: target.bbox.x + right.offsetX,
            y: target.bbox.y + right.offsetY,
            w: right.buffer.width,
            h: right.buffer.height,
          },
          area: right.area,
          splitBySeam: true,
        });
      }
      if (replacements.length <= 1) break;
      items.splice(widestIdx, 1, ...replacements);
    }
  }

  // Sort sprites left-to-right (single band) or reading order (multi-row atlas)
  if (options?.sortOrder === 'reading') {
    const avgH =
      items.length > 0 ? items.reduce((sum, it) => sum + it.bbox.h, 0) / items.length : 32;
    const rowTolerance = Math.max(12, avgH * 0.55);
    items.sort((a, b) => {
      const cyA = a.bbox.y + a.bbox.h * 0.5;
      const cyB = b.bbox.y + b.bbox.h * 0.5;
      if (Math.abs(cyA - cyB) > rowTolerance) return cyA - cyB;
      return a.bbox.x - b.bbox.x;
    });
  } else {
    items.sort((a, b) => a.bbox.x - b.bbox.x);
  }

  const sprites: SegmentedSprite[] = items.map((it) => ({
    buffer: it.buffer,
    bbox: it.bbox,
    silhouetteArea: it.area,
    contour: traceContours ? traceOuterContour(it.buffer, minAlpha) : [],
    splitBySeam: it.splitBySeam,
  }));

  return {
    sprites,
    seamCuts,
    rawComponentCount: rawComponents.length,
  };
}

/** Extracts all sprites from a band region using autonomous alpha cleanup + hybrid segmentation */
export function segmentBandSprites(
  src: RasterBuffer,
  region: BBox,
  backdropMode: BackdropMode = 'auto',
  options?: SegmentOptions
): SegmentationResult {
  const cropped = cropRaster(src, region.x, region.y, region.w, region.h);
  const cleaned = cleanAlphaBuffer(cropped, backdropMode);
  return segmentSprites(cleaned.buffer, options);
}

/** Extracts a single sprite from a bounding region with autonomous alpha cleanup & tight trim */
export function extractTightSprite(
  src: RasterBuffer,
  region: BBox,
  backdropMode: BackdropMode = 'auto',
  minAlpha = 20
): RasterBuffer {
  const cropped = cropRaster(src, region.x, region.y, region.w, region.h);
  const cleaned = cleanAlphaBuffer(cropped, backdropMode);
  const trimmed = trimTightAlpha(cleaned.buffer, minAlpha);
  return trimmed ? trimmed.buffer : cleaned.buffer;
}
