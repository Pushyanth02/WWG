import {
  GROUND_SHADOW_RGBA,
  OUTLINE_INK_RGBA,
  RasterBuffer,
  blitRaster,
  cloneRaster,
  createRaster,
  drawEllipse,
  injectOutlineInk,
  setPixelRaw,
} from './raster.ts';

export interface LabColor {
  L: number;
  a: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface QuantizationMetrics {
  meanDeltaE: number;
  p95DeltaE: number;
  uniqueColors: number;
  outlineInkPixels: number;
  sampledPixels: number;
  snappedFraction?: number;
  meanBeforeAfterDeltaE?: number;
  p95BeforeAfterDeltaE?: number;
}

export type QuantizeMode = 'hybrid_lab' | 'strict_rift' | 'preserve_hues' | 'v31_protected';

export interface RiftQuantizeOptions {
  mode?: QuantizeMode;
  cohesionStrength?: number; // 0..1 perceptual pull toward Rift Night ramps
  snapDarkToInk?: boolean; // Snap deep darks (L* <= 18) to exact #140E1D
  protectHighSaturation?: boolean; // V3.1 contract: keep high-chroma elemental hues unmodified
  deltaE00SnapMax?: number; // V3.1 contract: max CIEDE2000 threshold for neutral/ink snap (default 9)
  addOutline?: boolean;
  addGroundShadow?: boolean;
  shadowY?: number;
  shadowRx?: number;
  shadowRy?: number;
  ensureCornerTransparent?: boolean;
  computeMetrics?: boolean;
}

/** Exact neutral ramp from PIPELINE_STUDIO_V31_CONTRACT.json Stage 3 */
export const V31_CONTRACT_NEUTRALS: [number, number, number][] = [
  [20, 14, 29], // #140E1D Outline Ink
  [23, 19, 33], // #171321
  [41, 36, 49], // #292431
  [56, 52, 65], // #383441
  [81, 71, 91], // #51475B
  [113, 103, 122], // #71677A
  [153, 139, 162], // #998BA2
  [182, 171, 189], // #B6ABBD
];

/** Canonical 34-swatch Rift Night master palette (core 28 + warm skin/amber/indigo harmonic bridges) */
export const RIFT_NIGHT_STRUCTURAL_PALETTE: [number, number, number][] = [
  // Night & Outline Ink
  [20, 14, 29], // #140E1D Outline Ink
  [23, 19, 33], // #171321 Rift Night
  [36, 28, 51], // #241C33 Deep Violet Ground
  [48, 37, 69],
  // Obsidian Stone
  [61, 49, 82], // #3D3152
  [90, 74, 118],
  [122, 102, 156], // #7A669C
  // Arcane Violet
  [45, 18, 89],
  [91, 58, 168],
  [169, 145, 247], // #A991F7
  [232, 214, 255], // #E8D6FF
  // Antique Gold
  [139, 107, 50],
  [217, 186, 114], // #D9BA72
  [247, 227, 166], // #F7E3A6
  // Aether Teal
  [29, 109, 122],
  [63, 166, 160],
  [88, 214, 194], // #58D6C2
  [216, 255, 255],
  // Danger Crimson / Ember
  [125, 30, 52],
  [184, 50, 79],
  [233, 101, 120], // #E96578
  [255, 184, 196],
  // Blighted Marsh Viridian
  [30, 51, 44],
  [46, 89, 71],
  [67, 184, 116],
  [155, 232, 112],
  // Cursed Grove Blossom Magenta
  [110, 25, 88],
  [196, 53, 146],
  [255, 138, 212],
  // Bone Ivory
  [155, 145, 166],
  [232, 225, 213],
  [250, 246, 238],
  // Arcane Cobalt & Warm Timber/Skin Harmony Bridges
  [46, 86, 168],
  [196, 149, 116],
  [240, 200, 168],
  [255, 138, 43],
];

const NEUTRAL_STONE_RAMP: [number, number, number][] = [
  [20, 14, 29],
  [23, 19, 33],
  [36, 28, 51],
  [48, 37, 69],
  [61, 49, 82],
  [90, 74, 118],
  [122, 102, 156],
  [155, 145, 166],
  [232, 225, 213],
  [250, 246, 238],
];

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** Accurate sRGB -> CIE L*a*b* (D65 illuminant) */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) / 1.0;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Accurate CIE L*a*b* (D65) -> sRGB */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const finv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const x = finv(fx) * 0.95047;
  const y = finv(fy) * 1.0;
  const z = finv(fz) * 1.08883;

  const rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const gl = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

/** Perceptual CIEDE2000 color difference */
export function deltaE2000(lab1: LabColor, lab2: LabColor): number {
  const avgL = (lab1.L + lab2.L) * 0.5;
  const c1 = Math.hypot(lab1.a, lab1.b);
  const c2 = Math.hypot(lab2.a, lab2.b);
  const avgC = (c1 + c2) * 0.5;
  const avgC7 = Math.pow(avgC, 7);
  const g = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + 6103515625))); // 25^7

  const a1p = lab1.a * (1 + g);
  const a2p = lab2.a * (1 + g);
  const c1p = Math.hypot(a1p, lab1.b);
  const c2p = Math.hypot(a2p, lab2.b);
  const avgCp = (c1p + c2p) * 0.5;

  const hAngle = (bVal: number, aVal: number) => {
    if (aVal === 0 && bVal === 0) return 0;
    const deg = (Math.atan2(bVal, aVal) * 180) / Math.PI;
    return deg >= 0 ? deg : deg + 360;
  };
  const h1p = hAngle(lab1.b, a1p);
  const h2p = hAngle(lab2.b, a2p);

  const dLp = lab2.L - lab1.L;
  const dCp = c2p - c1p;

  let dhp = 0;
  if (c1p * c2p !== 0) {
    if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * Math.PI) / 360);

  let avgHp = h1p + h2p;
  if (c1p * c2p === 0) {
    avgHp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    avgHp = (h1p + h2p) * 0.5;
  } else if (h1p + h2p < 360) {
    avgHp = (h1p + h2p + 360) * 0.5;
  } else {
    avgHp = (h1p + h2p - 360) * 0.5;
  }

  const deg2rad = Math.PI / 180;
  const T =
    1 -
    0.17 * Math.cos((avgHp - 30) * deg2rad) +
    0.24 * Math.cos(2 * avgHp * deg2rad) +
    0.32 * Math.cos((3 * avgHp + 6) * deg2rad) -
    0.2 * Math.cos((4 * avgHp - 63) * deg2rad);

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const avgCp7 = Math.pow(avgCp, 7);
  const Rc = 2 * Math.sqrt(avgCp7 / (avgCp7 + 6103515625));
  const lTerm = Math.pow(avgL - 50, 2);
  const Sl = 1 + (0.015 * lTerm) / Math.sqrt(20 + lTerm);
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(2 * dTheta * deg2rad) * Rc;

  const dl = dLp / Sl;
  const dc = dCp / Sc;
  const dh = dHp / Sh;
  return Math.sqrt(dl * dl + dc * dc + dh * dh + Rt * dc * dh);
}

const MASTER_LAB = RIFT_NIGHT_STRUCTURAL_PALETTE.map((rgb) => ({
  rgb,
  lab: rgbToLab(rgb[0], rgb[1], rgb[2]),
}));

const NEUTRAL_LAB = NEUTRAL_STONE_RAMP.map((rgb) => ({
  rgb,
  lab: rgbToLab(rgb[0], rgb[1], rgb[2]),
}));

const V31_CONTRACT_LAB = V31_CONTRACT_NEUTRALS.map((rgb) => ({
  rgb,
  lab: rgbToLab(rgb[0], rgb[1], rgb[2]),
}));

const RIFT_SHADOW_LAB = rgbToLab(36, 28, 51); // #241C33 Deep Violet Ground

export function findNearestRiftSwatch(
  lab: LabColor,
  pool: { rgb: [number, number, number]; lab: LabColor }[] = MASTER_LAB
): { rgb: [number, number, number]; lab: LabColor; deltaE: number } {
  let best = pool[0];
  let bestD = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const entry = pool[i];
    const d = deltaE2000(lab, entry.lab);
    if (d < bestD) {
      bestD = d;
      best = entry;
    }
  }
  return { rgb: best.rgb, lab: best.lab, deltaE: bestD };
}

export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(1, s));
  const ln = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hn < 60) [r1, g1, b1] = [c, x, 0];
  else if (hn < 120) [r1, g1, b1] = [x, c, 0];
  else if (hn < 180) [r1, g1, b1] = [0, c, x];
  else if (hn < 240) [r1, g1, b1] = [0, x, c];
  else if (hn < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/**
 * Multi-Pass Perceptual CIELAB Quantizer for the Rift Night Palette:
 * - Supports `v31_protected` (PIPELINE_STUDIO_V31_CONTRACT.json Stage 3): D65 CIEDE2000,
 *   outline ink #140E1D, 7 contract neutrals, protect_high_saturation=true, deltaE00_snap_max=9.
 * - Supports `hybrid_lab`, `strict_rift`, and `preserve_hues`.
 */
export function quantizeRiftNightLab(
  halfRes: RasterBuffer,
  options?: RiftQuantizeOptions
): { buffer: RasterBuffer; metrics: QuantizationMetrics } {
  const mode = options?.mode ?? 'hybrid_lab';
  const cohesion = Math.max(0, Math.min(1, options?.cohesionStrength ?? 0.42));
  const snapDark = options?.snapDarkToInk !== false;
  const protectHighSaturation = options?.protectHighSaturation !== false;
  const deltaE00SnapMax = options?.deltaE00SnapMax ?? 9;
  const out = cloneRaster(halfRes);
  const d = out.data;

  const deltaEs: number[] = [];
  const beforeAfterDeltaEs: number[] = [];
  const colorSet = new Set<number>();
  let outlineInkPixels = 0;
  let snappedPixels = 0;
  let totalOpaque = 0;

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 20) continue;
    totalOpaque++;
    const origR = d[i];
    const origG = d[i + 1];
    const origB = d[i + 2];
    let r = origR;
    let g = origG;
    let b = origB;
    const lab = rgbToLab(r, g, b);
    const chroma = Math.hypot(lab.a, lab.b);

    if (mode === 'v31_protected') {
      // PIPELINE_STUDIO_V31_CONTRACT.json Stage 3:
      // High-saturation elemental/class colors stay completely protected;
      // only low-chroma neutrals / deep darks snap to #140E1D or contract neutral ramp within ΔE00 <= 9.
      const isLowChroma = !protectHighSaturation || chroma < 14;
      if (isLowChroma) {
        const nearestContract = findNearestRiftSwatch(lab, V31_CONTRACT_LAB);
        if (nearestContract.deltaE <= deltaE00SnapMax) {
          [r, g, b] = nearestContract.rgb;
          snappedPixels++;
          if (
            r === OUTLINE_INK_RGBA.r &&
            g === OUTLINE_INK_RGBA.g &&
            b === OUTLINE_INK_RGBA.b
          ) {
            outlineInkPixels++;
          }
        }
      }
    } else if (snapDark && a >= 175 && lab.L <= 17.5) {
      // Pass 1: Deep outline ink snapping (L* <= 17.5 -> #140E1D)
      r = OUTLINE_INK_RGBA.r;
      g = OUTLINE_INK_RGBA.g;
      b = OUTLINE_INK_RGBA.b;
      d[i + 3] = 255;
      outlineInkPixels++;
      snappedPixels++;
    } else if (mode === 'strict_rift') {
      const nearest = findNearestRiftSwatch(lab, MASTER_LAB);
      const k = Math.max(0.25, cohesion);
      const bL = lab.L * (1 - k) + nearest.lab.L * k;
      const ba = lab.a * (1 - k) + nearest.lab.a * k;
      const bb = lab.b * (1 - k) + nearest.lab.b * k;
      [r, g, b] = labToRgb(bL, ba, bb);
      snappedPixels++;
    } else {
      // Hybrid CIELAB ramp quantization keeping class/element hues
      const nearest = findNearestRiftSwatch(lab, chroma < 14 ? NEUTRAL_LAB : MASTER_LAB);

      if (chroma < 14) {
        const k = Math.min(0.85, cohesion * 1.15);
        const bL = lab.L * (1 - k) + nearest.lab.L * k;
        const ba = lab.a * (1 - k) + nearest.lab.a * k;
        const bb = lab.b * (1 - k) + nearest.lab.b * k;
        [r, g, b] = labToRgb(bL, ba, bb);
        snappedPixels++;
      } else {
        const shadowWeight = lab.L < 48 ? ((48 - lab.L) / 48) * cohesion * 0.48 : 0;
        const rampWeight =
          mode === 'preserve_hues'
            ? cohesion * 0.16
            : nearest.deltaE < 22
              ? cohesion * 0.45
              : cohesion * 0.22;

        let targetL = lab.L * (1 - rampWeight) + nearest.lab.L * rampWeight;
        let targetA = lab.a * (1 - rampWeight) + nearest.lab.a * rampWeight;
        let targetB = lab.b * (1 - rampWeight) + nearest.lab.b * rampWeight;

        if (shadowWeight > 0) {
          targetL = targetL * (1 - shadowWeight * 0.35) + RIFT_SHADOW_LAB.L * (shadowWeight * 0.35);
          targetA = targetA * (1 - shadowWeight) + RIFT_SHADOW_LAB.a * shadowWeight;
          targetB = targetB * (1 - shadowWeight) + RIFT_SHADOW_LAB.b * shadowWeight;
        }

        if (cohesion >= 0.3 && mode === 'hybrid_lab') {
          const bandedL = Math.round(targetL / 4.5) * 4.5;
          targetL = targetL * 0.55 + bandedL * 0.45;
        }

        [r, g, b] = labToRgb(targetL, targetA, targetB);
        if (r !== origR || g !== origG || b !== origB) snappedPixels++;
      }
    }

    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;

    if (options?.computeMetrics) {
      const postLab = rgbToLab(r, g, b);
      const nearestPost = findNearestRiftSwatch(postLab, MASTER_LAB);
      deltaEs.push(nearestPost.deltaE);
      beforeAfterDeltaEs.push(deltaE2000(lab, postLab));
      colorSet.add((r << 16) | (g << 8) | b);
    }
  }

  // Pass 3: Crisp 1px #140E1D silhouette ink at half-res (becomes 2px at 2x upscale)
  if (options?.addOutline !== false) {
    injectOutlineInk(out, OUTLINE_INK_RGBA, 170);
  }

  let finalBuf = out;
  if (options?.addGroundShadow) {
    const shadowed = createRaster(out.width, out.height);
    const sy = options.shadowY ?? out.height - 5;
    const srx = options.shadowRx ?? Math.round(out.width * 0.25);
    const sry = options.shadowRy ?? Math.max(2, Math.round(out.height * 0.08));
    drawEllipse(shadowed, Math.floor(out.width / 2), sy, srx, sry, GROUND_SHADOW_RGBA);
    blitRaster(shadowed, out, 0, 0);
    finalBuf = shadowed;
  }

  if (options?.ensureCornerTransparent !== false) {
    setPixelRaw(finalBuf, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
  }

  deltaEs.sort((a, b) => a - b);
  beforeAfterDeltaEs.sort((a, b) => a - b);
  const meanDeltaE =
    deltaEs.length > 0 ? deltaEs.reduce((acc, v) => acc + v, 0) / deltaEs.length : 0;
  const p95DeltaE =
    deltaEs.length > 0 ? deltaEs[Math.min(deltaEs.length - 1, Math.floor(deltaEs.length * 0.95))] : 0;
  const meanBeforeAfterDeltaE =
    beforeAfterDeltaEs.length > 0
      ? beforeAfterDeltaEs.reduce((acc, v) => acc + v, 0) / beforeAfterDeltaEs.length
      : 0;
  const p95BeforeAfterDeltaE =
    beforeAfterDeltaEs.length > 0
      ? beforeAfterDeltaEs[
          Math.min(beforeAfterDeltaEs.length - 1, Math.floor(beforeAfterDeltaEs.length * 0.95))
        ]
      : 0;

  return {
    buffer: finalBuf,
    metrics: {
      meanDeltaE: Number(meanDeltaE.toFixed(2)),
      p95DeltaE: Number(p95DeltaE.toFixed(2)),
      uniqueColors: colorSet.size,
      outlineInkPixels,
      sampledPixels: deltaEs.length,
      snappedFraction: Number((snappedPixels / Math.max(1, totalOpaque)).toFixed(4)),
      meanBeforeAfterDeltaE: Number(meanBeforeAfterDeltaE.toFixed(2)),
      p95BeforeAfterDeltaE: Number(p95BeforeAfterDeltaE.toFixed(2)),
    },
  };
}

/**
 * Generates a visual Delta-E perceptual distance heatmap for the Asset Lab Pipeline Studio:
 * Teal (ΔE <= 8, tightly harmonized) -> Gold (ΔE 8..18, warm harmonic) -> Crimson (ΔE > 18, divergent).
 */
export function renderDeltaEHeatmap(buf: RasterBuffer): RasterBuffer {
  const out = createRaster(buf.width, buf.height);
  for (let i = 0; i < buf.data.length; i += 4) {
    const a = buf.data[i + 3];
    if (a < 20) continue;
    const lab = rgbToLab(buf.data[i], buf.data[i + 1], buf.data[i + 2]);
    const { deltaE } = findNearestRiftSwatch(lab, MASTER_LAB);
    if (deltaE <= 8) {
      out.data[i] = 88;
      out.data[i + 1] = 214;
      out.data[i + 2] = 194;
    } else if (deltaE <= 18) {
      out.data[i] = 217;
      out.data[i + 1] = 186;
      out.data[i + 2] = 114;
    } else {
      out.data[i] = 233;
      out.data[i + 1] = 101;
      out.data[i + 2] = 120;
    }
    out.data[i + 3] = Math.min(255, Math.max(150, a));
  }
  return out;
}

/**
 * Generates a before-vs-after CIEDE2000 change heatmap matching pipeline_studio_preflight.py:
 * Highlights exact pixels altered during protected CIELAB snapping while keeping untouched pixels calm.
 */
export function renderBeforeAfterDeltaEHeatmap(
  before: RasterBuffer,
  after: RasterBuffer
): RasterBuffer {
  const w = Math.min(before.width, after.width);
  const h = Math.min(before.height, after.height);
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bi = (y * before.width + x) * 4;
      const ai = (y * after.width + x) * 4;
      const oi = (y * w + x) * 4;
      const a = after.data[ai + 3];
      if (a < 20) continue;
      const de = deltaE2000(
        rgbToLab(before.data[bi], before.data[bi + 1], before.data[bi + 2]),
        rgbToLab(after.data[ai], after.data[ai + 1], after.data[ai + 2])
      );
      if (de <= 0.25) {
        // Protected / unmodified pixel: dimmed original for clarity
        out.data[oi] = Math.round(after.data[ai] * 0.55);
        out.data[oi + 1] = Math.round(after.data[ai + 1] * 0.55);
        out.data[oi + 2] = Math.round(after.data[ai + 2] * 0.55);
      } else {
        const heat = Math.min(1, de / 10);
        out.data[oi] = Math.round(after.data[ai] * 0.35 + 255 * 0.65);
        out.data[oi + 1] = Math.round(after.data[ai + 1] * 0.35 + 165 * (1 - heat) * 0.65);
        out.data[oi + 2] = Math.round(after.data[ai + 2] * 0.35 + 50 * (1 - heat) * 0.65);
      }
      out.data[oi + 3] = a;
    }
  }
  return out;
}

/** Selective Mage class robe & orb recolor preserving warm skin, hair, gold trim, and #140E1D ink */
export function recolorBlueMageBuffer(
  src: RasterBuffer,
  robeTargetHue: number,
  robeSatScale: number,
  robeLumShift: number,
  orbTargetHue: number,
  orbSatBoost = 1.05
): RasterBuffer {
  const out = cloneRaster(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 25) continue;
    const hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (hsl.l < 0.12 || hsl.s < 0.16) continue;

    if (hsl.h >= 172 && hsl.h <= 214 && hsl.l >= 0.48) {
      const [r, g, b] = hslToRgb(orbTargetHue, Math.min(1, hsl.s * orbSatBoost), hsl.l);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      continue;
    }

    if (hsl.h >= 200 && hsl.h <= 270) {
      const hueOffset = (hsl.h - 228) * 0.45;
      const [r, g, b] = hslToRgb(
        robeTargetHue + hueOffset,
        Math.max(0.08, Math.min(0.98, hsl.s * robeSatScale)),
        Math.max(0.14, Math.min(0.88, hsl.l + robeLumShift))
      );
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  return out;
}

/** Semantic hue remapper for VFX schools, biome crystals/flora, and enemy variants */
export function remapBufferHue(
  src: RasterBuffer,
  targetHue: number,
  options?: {
    satScale?: number;
    lumShift?: number;
    minSat?: number;
    preserveWhiteCore?: boolean;
  }
): RasterBuffer {
  const out = cloneRaster(src);
  const d = out.data;
  const satScale = options?.satScale ?? 1;
  const lumShift = options?.lumShift ?? 0;
  const minSat = options?.minSat ?? 0.14;
  const preserveWhite = options?.preserveWhiteCore !== false;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 15) continue;
    const hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (hsl.l < 0.1 || hsl.s < minSat) continue;
    if (preserveWhite && hsl.l > 0.88) continue;
    const [r, g, b] = hslToRgb(
      targetHue,
      Math.max(0.06, Math.min(1, hsl.s * satScale)),
      Math.max(0.1, Math.min(0.94, hsl.l + lumShift))
    );
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  return out;
}
