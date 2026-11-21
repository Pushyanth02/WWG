import { RasterBuffer, cloneRaster } from './raster.ts';

export type BackdropMode =
  | 'auto'
  | 'alpha'
  | 'checker'
  | 'white'
  | 'dark'
  | 'dark_additive'
  | 'preserve_opaque'
  | 'studio_white_preview';
export type ResolvedBackdropMode = Exclude<BackdropMode, 'auto'>;

export interface AlphaCleanupResult {
  buffer: RasterBuffer;
  detectedMode: ResolvedBackdropMode;
  strippedBgPixels: number;
  haloPixelsRemoved: number;
  specklesPruned: number;
}

/**
 * Autonomously inspects the perimeter border and periodic texture statistics of a source buffer
 * to classify its backdrop type: true alpha, baked checkerboard, studio white, dark obsidian,
 * or dark-backdrop additive VFX.
 */
export function detectBackdropMode(src: RasterBuffer): ResolvedBackdropMode {
  const w = src.width;
  const h = src.height;
  const d = src.data;

  let borderTotal = 0;
  let borderTransparent = 0;
  let borderBrightNeutral = 0;
  let borderMidLightGray = 0;
  let borderDark = 0;
  let borderTransitions = 0;
  let prevLum = -1;

  const inspectBorderPixel = (x: number, y: number, trackTransition: boolean) => {
    const off = (y * w + x) * 4;
    const r = d[off];
    const g = d[off + 1];
    const b = d[off + 2];
    const a = d[off + 3];
    borderTotal++;
    if (a < 20) {
      borderTransparent++;
      return;
    }
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    if (max - min <= 20 && min >= 235) borderBrightNeutral++;
    else if (max - min <= 20 && min >= 188 && min < 235) borderMidLightGray++;
    else if (max <= 44 && r <= 38 && g <= 34 && b <= 48) borderDark++;

    if (trackTransition && prevLum >= 0) {
      const diff = Math.abs(lum - prevLum);
      if (diff >= 12 && diff <= 65 && max - min <= 20 && min >= 185) {
        borderTransitions++;
      }
    }
    prevLum = lum;
  };

  for (let x = 0; x < w; x++) inspectBorderPixel(x, 0, true);
  prevLum = -1;
  for (let x = 0; x < w; x++) inspectBorderPixel(x, h - 1, true);
  for (let y = 1; y < h - 1; y++) {
    inspectBorderPixel(0, y, false);
    inspectBorderPixel(w - 1, y, false);
  }

  if (borderTotal === 0) return 'alpha';
  if (borderTransparent / borderTotal >= 0.22) return 'alpha';
  if (borderDark / borderTotal >= 0.6) return 'dark';

  // Checkerboard signature: alternating bright-white + light-gray tiles along border
  const lightNeutralRatio = (borderBrightNeutral + borderMidLightGray) / borderTotal;
  if (lightNeutralRatio >= 0.55) {
    if (borderMidLightGray / borderTotal >= 0.12 || borderTransitions >= 6) {
      return 'checker';
    }
    return 'white';
  }
  return 'checker';
}

function isCheckerBg(r: number, g: number, b: number, a: number): boolean {
  if (a < 20) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 22 && min >= 186;
}

function isWhiteBg(r: number, g: number, b: number, a: number): boolean {
  if (a < 20) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 24 && min >= 224;
}

function isDarkBg(r: number, g: number, b: number, a: number): boolean {
  if (a < 20) return true;
  const max = Math.max(r, g, b);
  return max <= 46 && r <= 40 && g <= 36 && b <= 54;
}

/**
 * Samples the median RGB along the 1px outer perimeter of a buffer so dark-panel
 * crops (e.g. obsidian #1E1224 or slate-indigo #3B3354) key accurately without
 * eating sprite interiors.
 */
function sampleDarkBorderColor(src: RasterBuffer): { r: number; g: number; b: number; valid: boolean } {
  const w = src.width;
  const h = src.height;
  const d = src.data;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const push = (x: number, y: number) => {
    const off = (y * w + x) * 4;
    if (d[off + 3] < 20) return;
    const max = Math.max(d[off], d[off + 1], d[off + 2]);
    if (max <= 102) {
      rs.push(d[off]);
      gs.push(d[off + 1]);
      bs.push(d[off + 2]);
    }
  };

  for (let x = 0; x < w; x += 2) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y += 2) {
    push(0, y);
    push(w - 1, y);
  }

  if (rs.length < 8) return { r: 22, g: 16, b: 30, valid: false };
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return { r: rs[mid], g: gs[mid], b: bs[mid], valid: true };
}

/**
 * Edge-Case Autonomous Transparency Cleanup:
 * 1. Auto-detects or applies specified backdrop keying via 8-connected border flood-fill
 *    (protecting enclosed interior whites, eyes, gems, and bone highlights).
 * 2. Performs multi-pass edge color decontamination & halo un-blending on border pixels.
 * 3. Prunes isolated 1..3px orphan noise speckles without touching intentional sparkles.
 */
export function cleanAlphaBuffer(
  src: RasterBuffer,
  mode: BackdropMode = 'auto',
  options?: {
    pruneSpeckles?: boolean;
    maxSpeckleArea?: number;
    decontaminateHalos?: boolean;
  }
): AlphaCleanupResult {
  const detectedMode: ResolvedBackdropMode = mode === 'auto' ? detectBackdropMode(src) : mode;
  const out = cloneRaster(src);
  const w = out.width;
  const h = out.height;
  const d = out.data;

  let strippedBgPixels = 0;
  let haloPixelsRemoved = 0;
  let specklesPruned = 0;

  if (detectedMode === 'preserve_opaque') {
    return {
      buffer: out,
      detectedMode,
      strippedBgPixels: 0,
      haloPixelsRemoved: 0,
      specklesPruned: 0,
    };
  }

  if (detectedMode === 'alpha') {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && d[i + 3] <= 18) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        strippedBgPixels++;
      }
    }
  } else if (detectedMode === 'dark_additive') {
    const border = sampleDarkBorderColor(src);
    const floorR = border.valid ? border.r : 20;
    const floorG = border.valid ? border.g : 16;
    const floorB = border.valid ? border.b : 26;
    const bgMax = Math.max(floorR, floorG, floorB);

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const dr = Math.max(0, r - floorR);
      const dg = Math.max(0, g - floorG);
      const db = Math.max(0, b - floorB);
      const dist = Math.hypot(r - floorR, g - floorG, b - floorB);
      const excessMax = Math.max(dr, dg, db);
      const rawMax = Math.max(r, g, b);

      if (rawMax <= Math.max(26, bgMax - 4) || (dist <= 22 && excessMax <= 18)) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        strippedBgPixels++;
      } else {
        const signal = Math.max(excessMax, dist * 0.85);
        if (signal < 118) {
          const a = Math.min(255, Math.max(0, Math.round(((signal - 14) / 104) * 255)));
          if (a <= 14) {
            d[i] = 0;
            d[i + 1] = 0;
            d[i + 2] = 0;
            d[i + 3] = 0;
            strippedBgPixels++;
          } else {
            const boost = Math.min(2.0, 255 / Math.max(rawMax, 1));
            d[i] = Math.min(255, Math.round(Math.max(dr * 1.15, r * 0.72) * boost));
            d[i + 1] = Math.min(255, Math.round(Math.max(dg * 1.15, g * 0.72) * boost));
            d[i + 2] = Math.min(255, Math.round(Math.max(db * 1.15, b * 0.72) * boost));
            d[i + 3] = a;
          }
        }
      }
    }
  } else {
    const darkBorder = detectedMode === 'dark' ? sampleDarkBorderColor(src) : null;
    const isAdaptiveDarkBg = (r: number, g: number, b: number, a: number): boolean => {
      if (isDarkBg(r, g, b, a)) return true;
      if (darkBorder && darkBorder.valid) {
        const dist = Math.hypot(r - darkBorder.r, g - darkBorder.g, b - darkBorder.b);
        const max = Math.max(r, g, b);
        if (dist <= 26 && max <= Math.max(darkBorder.r, darkBorder.g, darkBorder.b) + 22) {
          return true;
        }
      }
      return false;
    };

    const matcher =
      detectedMode === 'checker'
        ? isCheckerBg
        : detectedMode === 'white' || detectedMode === 'studio_white_preview'
          ? isWhiteBg
          : isAdaptiveDarkBg;

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    const pushIfBg = (x: number, y: number) => {
      const idx = y * w + x;
      if (visited[idx]) return;
      const off = idx * 4;
      if (matcher(d[off], d[off + 1], d[off + 2], d[off + 3])) {
        visited[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < w; x++) {
      pushIfBg(x, 0);
      pushIfBg(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      pushIfBg(0, y);
      pushIfBg(w - 1, y);
    }

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w;
      const y = (idx - x) / w;
      const off = idx * 4;
      d[off] = 0;
      d[off + 1] = 0;
      d[off + 2] = 0;
      d[off + 3] = 0;
      strippedBgPixels++;

      if (x > 0) pushIfBg(x - 1, y);
      if (x + 1 < w) pushIfBg(x + 1, y);
      if (y > 0) pushIfBg(x, y - 1);
      if (y + 1 < h) pushIfBg(x, y + 1);
    }

    // Multi-pass edge halo decontamination for light backdrops (checker / white)
    if (
      options?.decontaminateHalos !== false &&
      (detectedMode === 'checker' ||
        detectedMode === 'white' ||
        detectedMode === 'studio_white_preview')
    ) {
      for (let pass = 0; pass < 2; pass++) {
        const snap = new Uint8Array(d);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const off = (y * w + x) * 4;
            const a = snap[off + 3];
            if (a === 0) continue;
            const adjTrans =
              snap[((y - 1) * w + x) * 4 + 3] === 0 ||
              snap[((y + 1) * w + x) * 4 + 3] === 0 ||
              snap[(y * w + x - 1) * 4 + 3] === 0 ||
              snap[(y * w + x + 1) * 4 + 3] === 0;
            if (!adjTrans) continue;

            const r = snap[off];
            const g = snap[off + 1];
            const b = snap[off + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);

            // Strip anti-aliased light neutral halo pixels bordering transparent background
            const isLightHalo = max - min <= 28 && min >= (pass === 0 ? 168 : 185);
            if (isLightHalo || a < 64) {
              d[off] = 0;
              d[off + 1] = 0;
              d[off + 2] = 0;
              d[off + 3] = 0;
              haloPixelsRemoved++;
            } else if (a < 215 && min > 120) {
              // Un-blend partial white background matte contamination from translucent edge pixels
              const alphaNorm = Math.max(0.25, a / 255);
              d[off] = Math.max(0, Math.min(255, Math.round((r - (1 - alphaNorm) * 240) / alphaNorm)));
              d[off + 1] = Math.max(0, Math.min(255, Math.round((g - (1 - alphaNorm) * 240) / alphaNorm)));
              d[off + 2] = Math.max(0, Math.min(255, Math.round((b - (1 - alphaNorm) * 240) / alphaNorm)));
            }
          }
        }
      }
    }
  }

  // Optional orphan speckle pruning (strips stray 1..3px isolated backdrop specks)
  if (options?.pruneSpeckles !== false) {
    const maxSpeckleArea = options?.maxSpeckleArea ?? 3;
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    const component: number[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const start = y * w + x;
        if (visited[start] || d[start * 4 + 3] < 25) continue;
        visited[start] = 1;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        component.length = 0;

        while (head < tail) {
          const cur = queue[head++];
          component.push(cur);
          const cx = cur % w;
          const cy = (cur - cx) / w;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nIdx = ny * w + nx;
              if (!visited[nIdx] && d[nIdx * 4 + 3] >= 25) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            }
          }
        }

        if (component.length <= maxSpeckleArea) {
          for (let k = 0; k < component.length; k++) {
            const off = component[k] * 4;
            d[off] = 0;
            d[off + 1] = 0;
            d[off + 2] = 0;
            d[off + 3] = 0;
          }
          specklesPruned += component.length;
        }
      }
    }
  }

  return {
    buffer: out,
    detectedMode,
    strippedBgPixels,
    haloPixelsRemoved,
    specklesPruned,
  };
}
