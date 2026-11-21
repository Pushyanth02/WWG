export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RasterBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

export const OUTLINE_INK_RGBA: RGBA = { r: 20, g: 14, b: 29, a: 255 };
export const GROUND_SHADOW_RGBA: RGBA = { r: 10, g: 6, b: 18, a: 112 };

export function hexToRgba(color: string, alpha = 255): RGBA {
  const clean = color.replace('#', '');
  const n = parseInt(clean, 16);
  if (clean.length === 8) {
    return {
      r: (n >>> 24) & 255,
      g: (n >>> 16) & 255,
      b: (n >>> 8) & 255,
      a: n & 255,
    };
  }
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    a: alpha,
  };
}

export function createRaster(width: number, height: number): RasterBuffer {
  return {
    width,
    height,
    data: new Uint8Array(width * height * 4),
  };
}

export function cloneRaster(src: RasterBuffer): RasterBuffer {
  const out = createRaster(src.width, src.height);
  out.data.set(src.data);
  return out;
}

export function cropRaster(src: RasterBuffer, x: number, y: number, w: number, h: number): RasterBuffer {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(src.width, Math.ceil(x + w));
  const y1 = Math.min(src.height, Math.ceil(y + h));
  const rw = Math.max(1, x1 - x0);
  const rh = Math.max(1, y1 - y0);
  const out = createRaster(rw, rh);
  for (let py = 0; py < rh; py++) {
    const srcOff = ((y0 + py) * src.width + x0) * 4;
    const dstOff = py * rw * 4;
    out.data.set(src.data.subarray(srcOff, srcOff + rw * 4), dstOff);
  }
  return out;
}

export function setPixelBlend(buf: RasterBuffer, x: number, y: number, c: RGBA): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= buf.width || iy >= buf.height || c.a <= 0) return;
  const i = (iy * buf.width + ix) * 4;
  if (c.a === 255 || buf.data[i + 3] === 0) {
    buf.data[i] = c.r;
    buf.data[i + 1] = c.g;
    buf.data[i + 2] = c.b;
    buf.data[i + 3] = c.a;
    return;
  }
  const sa = c.a / 255;
  const da = buf.data[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buf.data[i] = Math.round((c.r * sa + buf.data[i] * da * (1 - sa)) / outA);
  buf.data[i + 1] = Math.round((c.g * sa + buf.data[i + 1] * da * (1 - sa)) / outA);
  buf.data[i + 2] = Math.round((c.b * sa + buf.data[i + 2] * da * (1 - sa)) / outA);
  buf.data[i + 3] = Math.round(outA * 255);
}

export function setPixelRaw(buf: RasterBuffer, x: number, y: number, c: RGBA): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= buf.width || iy >= buf.height) return;
  const i = (iy * buf.width + ix) * 4;
  buf.data[i] = c.r;
  buf.data[i + 1] = c.g;
  buf.data[i + 2] = c.b;
  buf.data[i + 3] = c.a;
}

export function blitRaster(dst: RasterBuffer, src: RasterBuffer, dstX: number, dstY: number): void {
  const dx0 = Math.round(dstX);
  const dy0 = Math.round(dstY);
  for (let y = 0; y < src.height; y++) {
    const ty = dy0 + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx0 + x;
      if (tx < 0 || tx >= dst.width) continue;
      const off = (y * src.width + x) * 4;
      const a = src.data[off + 3];
      if (a > 0) {
        setPixelBlend(dst, tx, ty, {
          r: src.data[off],
          g: src.data[off + 1],
          b: src.data[off + 2],
          a,
        });
      }
    }
  }
}

export function flipRasterHorizontal(src: RasterBuffer): RasterBuffer {
  const out = createRaster(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sOff = (y * src.width + x) * 4;
      const dOff = (y * src.width + (src.width - 1 - x)) * 4;
      out.data[dOff] = src.data[sOff];
      out.data[dOff + 1] = src.data[sOff + 1];
      out.data[dOff + 2] = src.data[sOff + 2];
      out.data[dOff + 3] = src.data[sOff + 3];
    }
  }
  return out;
}

export function shiftRaster(src: RasterBuffer, dx: number, dy: number): RasterBuffer {
  const out = createRaster(src.width, src.height);
  const idx = Math.round(dx);
  const idy = Math.round(dy);
  for (let y = 0; y < src.height; y++) {
    const ty = y + idy;
    if (ty < 0 || ty >= src.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + idx;
      if (tx < 0 || tx >= src.width) continue;
      const sOff = (y * src.width + x) * 4;
      if (src.data[sOff + 3] === 0) continue;
      const dOff = (ty * src.width + tx) * 4;
      out.data[dOff] = src.data[sOff];
      out.data[dOff + 1] = src.data[sOff + 1];
      out.data[dOff + 2] = src.data[sOff + 2];
      out.data[dOff + 3] = src.data[sOff + 3];
    }
  }
  return out;
}

export function upscaleRaster(src: RasterBuffer, factor: number): RasterBuffer {
  const out = createRaster(src.width * factor, src.height * factor);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sOff = (y * src.width + x) * 4;
      const a = src.data[sOff + 3];
      if (a === 0) continue;
      const r = src.data[sOff];
      const g = src.data[sOff + 1];
      const b = src.data[sOff + 2];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const dOff = ((y * factor + dy) * out.width + (x * factor + dx)) * 4;
          out.data[dOff] = r;
          out.data[dOff + 1] = g;
          out.data[dOff + 2] = b;
          out.data[dOff + 3] = a;
        }
      }
    }
  }
  return out;
}

export function drawEllipse(buf: RasterBuffer, cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
  if (rx <= 0 || ry <= 0) return;
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1.0) {
        setPixelBlend(buf, x, y, c);
      }
    }
  }
}

export function drawRing(buf: RasterBuffer, cx: number, cy: number, rOuter: number, rInner: number, c: RGBA): void {
  const ro2 = rOuter * rOuter;
  const ri2 = rInner * rInner;
  const x0 = Math.floor(cx - rOuter);
  const x1 = Math.ceil(cx + rOuter);
  const y0 = Math.floor(cy - rOuter);
  const y1 = Math.ceil(cy + rOuter);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= ro2 && d2 >= ri2) {
        setPixelBlend(buf, x, y, c);
      }
    }
  }
}

export function drawGlow(buf: RasterBuffer, cx: number, cy: number, radius: number, c: RGBA, peakAlpha = 180): void {
  const x0 = Math.floor(cx - radius);
  const x1 = Math.ceil(cx + radius);
  const y0 = Math.floor(cy - radius);
  const y1 = Math.ceil(cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) {
        const t = 1 - d / radius;
        const a = Math.round(t * t * peakAlpha);
        if (a > 8) {
          setPixelBlend(buf, x, y, { r: c.r, g: c.g, b: c.b, a });
        }
      }
    }
  }
}

/** Injects a crisp 1px silhouette outline around solid pixels (becomes 2px after 2x upscale) */
export function injectOutlineInk(
  buf: RasterBuffer,
  outlineColor: RGBA = OUTLINE_INK_RGBA,
  minAlpha = 170
): void {
  const copy = new Uint8Array(buf.data);
  const w = buf.width;
  const h = buf.height;
  const isSolid = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return copy[(y * w + x) * 4 + 3] >= minAlpha;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isSolid(x, y)) continue;
      if (isSolid(x - 1, y) || isSolid(x + 1, y) || isSolid(x, y - 1) || isSolid(x, y + 1)) {
        setPixelRaw(buf, x, y, outlineColor);
      }
    }
  }
}

export function applyDirectionalShading(
  src: RasterBuffer,
  dir: 'down' | 'up' | 'left' | 'right'
): RasterBuffer {
  if (dir === 'down' || dir === 'right') return src;
  if (dir === 'left') return flipRasterHorizontal(src);
  const out = cloneRaster(src);
  const cx = src.width / 2;
  const cy = src.height * 0.45;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const off = (y * src.width + x) * 4;
      if (out.data[off + 3] < 40) continue;
      if (
        out.data[off] === OUTLINE_INK_RGBA.r &&
        out.data[off + 1] === OUTLINE_INK_RGBA.g &&
        out.data[off + 2] === OUTLINE_INK_RGBA.b
      ) {
        continue;
      }
      const dist = Math.hypot((x - cx) / (src.width * 0.22), (y - cy) / (src.height * 0.28));
      if (dist < 1.0) {
        const k = (1 - dist) * 0.22;
        out.data[off] = Math.max(22, Math.round(out.data[off] * (1 - k) + 26 * k));
        out.data[off + 1] = Math.max(16, Math.round(out.data[off + 1] * (1 - k) + 18 * k));
        out.data[off + 2] = Math.max(34, Math.round(out.data[off + 2] * (1 - k) + 48 * k));
      }
    }
  }
  return out;
}

function isOutlineInkPixel(data: Uint8Array, off: number): boolean {
  return (
    data[off] === OUTLINE_INK_RGBA.r &&
    data[off + 1] === OUTLINE_INK_RGBA.g &&
    data[off + 2] === OUTLINE_INK_RGBA.b &&
    data[off + 3] >= 200
  );
}

/**
 * Hi-bit 2x depth enhancement pass:
 * - Adds crisp top-left directional specular rim lighting along silhouette crests
 * - Deepens lower-right crevice ambient occlusion with cool Rift-violet hue shift
 * - Enhances tonal depth separation across torso/armor/cloth while strictly preserving
 *   #140E1D outer ink and transparent background boundaries.
 */
export function applyHiBitDepthPass(
  src: RasterBuffer,
  options?: {
    rimStrength?: number;
    aoStrength?: number;
    rimTint?: RGBA;
  }
): RasterBuffer {
  const out = cloneRaster(src);
  const w = src.width;
  const h = src.height;
  const d = src.data;
  const o = out.data;

  const rimStrength = options?.rimStrength ?? 0.24;
  const aoStrength = options?.aoStrength ?? 0.22;
  const rimTint = options?.rimTint ?? { r: 247, g: 232, b: 196, a: 255 };

  // Measure vertical bounding span of solid silhouette for realistic grounded AO
  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      if (d[off + 3] >= 180 && !isOutlineInkPixel(d, off)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const spanY = Math.max(1, maxY - minY);

  const isBoundaryOrEmpty = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const off = (y * w + x) * 4;
    return d[off + 3] < 120 || isOutlineInkPixel(d, off);
  };

  for (let y = 0; y < h; y++) {
    const normY = Math.max(0, Math.min(1, (y - minY) / spanY));
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      const a = d[off + 3];
      if (a < 180 || isOutlineInkPixel(d, off)) continue;

      let r = d[off];
      let g = d[off + 1];
      let b = d[off + 2];

      const topEdge = isBoundaryOrEmpty(x, y - 1);
      const leftEdge = isBoundaryOrEmpty(x - 1, y);
      const bottomEdge = isBoundaryOrEmpty(x, y + 1);
      const rightEdge = isBoundaryOrEmpty(x + 1, y);

      // 1. Top-left directional specular rim highlight
      if ((topEdge || leftEdge) && normY < 0.72) {
        const weight = topEdge && leftEdge ? rimStrength * 1.25 : rimStrength * 0.78;
        r = Math.min(255, Math.round(r * (1 - weight) + rimTint.r * weight + 6));
        g = Math.min(255, Math.round(g * (1 - weight) + rimTint.g * weight + 5));
        b = Math.min(255, Math.round(b * (1 - weight) + rimTint.b * weight + 4));
      }

      // 2. Bottom-right crevice ambient occlusion (cool Rift Night shadow shift)
      if (bottomEdge || rightEdge || normY > 0.76) {
        const aoFactor =
          (bottomEdge && rightEdge ? aoStrength * 1.2 : bottomEdge || rightEdge ? aoStrength * 0.75 : 0) +
          (normY > 0.76 ? (normY - 0.76) * 0.55 : 0);
        const clampedAo = Math.min(0.42, aoFactor);
        r = Math.max(22, Math.round(r * (1 - clampedAo) + 24 * clampedAo));
        g = Math.max(16, Math.round(g * (1 - clampedAo) + 17 * clampedAo));
        b = Math.max(34, Math.round(b * (1 - clampedAo) + 46 * clampedAo));
      }

      // 3. Subtle mid-body contrast & micro-dither bevel for hi-bit material readability
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (!topEdge && !bottomEdge && !leftEdge && !rightEdge && lum > 55 && lum < 215) {
        const upperLum =
          y > 0
            ? 0.299 * d[((y - 1) * w + x) * 4] +
              0.587 * d[((y - 1) * w + x) * 4 + 1] +
              0.114 * d[((y - 1) * w + x) * 4 + 2]
            : lum;
        const delta = Math.max(-14, Math.min(14, (lum - upperLum) * 0.18));
        r = Math.max(20, Math.min(255, Math.round(r + delta)));
        g = Math.max(14, Math.min(255, Math.round(g + delta)));
        b = Math.max(29, Math.min(255, Math.round(b + delta)));
      }

      o[off] = r;
      o[off + 1] = g;
      o[off + 2] = b;
    }
  }

  return out;
}

/**
 * Articulated full-body animation deformer operating on half-res sprite cells:
 * Applies independent anatomical band transforms (head/crown bob, upper-body lean &
 * weapon follow-through, alternating left/right leg stride, recoil stagger, and collapse)
 * so every frame of every player, enemy, and boss has genuine body motion.
 */
export function applyFullBodyArticulation(
  src: RasterBuffer,
  state: string,
  frame: number,
  totalFrames: number,
  dir: 'down' | 'up' | 'left' | 'right' = 'down'
): RasterBuffer {
  const w = src.width;
  const h = src.height;
  const out = createRaster(w, h);
  const t = totalFrames > 1 ? frame / (totalFrames - 1) : 0;
  const phase = (frame / Math.max(1, totalFrames)) * Math.PI * 2;
  const facingSign = dir === 'left' ? -1 : 1;

  // Locate vertical anatomy bands from solid pixels
  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src.data[(y * w + x) * 4 + 3] >= 140) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxY <= minY) return cloneRaster(src);
  const span = Math.max(6, maxY - minY);
  const midX = w / 2;

  for (let y = 0; y < h; y++) {
    const ny = Math.max(0, Math.min(1, (y - minY) / span));
    let dx = 0;
    let dy = 0;

    if (state === 'idle') {
      const breath = Math.sin(phase);
      if (ny < 0.34) {
        dy = breath > 0.35 ? -1 : 0;
      } else if (ny < 0.72) {
        dy = breath > 0.65 ? -1 : 0;
      }
    } else if (state === 'walk' || state === 'move') {
      const stride = Math.sin(phase);
      const lift = Math.abs(Math.cos(phase));
      if (ny < 0.32) {
        dy = lift > 0.65 ? -1 : 0;
        dx = Math.round(stride * 0.6 * facingSign);
      } else if (ny < 0.72) {
        dy = lift > 0.5 ? -1 : 0;
        dx = Math.round(stride * 0.8 * facingSign);
      }
    } else if (state === 'attack_windup' || state === 'channel') {
      const pull = Math.sin(t * Math.PI * 0.85);
      if (ny < 0.68) {
        dx = Math.round(-pull * 1.6 * facingSign);
        dy = ny < 0.35 ? Math.round(-pull * 1.1) : 0;
      }
    } else if (state === 'attack' || state === 'attack_1' || state === 'attack_2' || state === 'cast') {
      const lunge = Math.sin(t * Math.PI);
      if (ny < 0.72) {
        dx = Math.round((t < 0.25 ? -1 : lunge * 2.1) * facingSign);
        dy = ny < 0.35 && lunge > 0.5 ? 1 : 0;
      }
    } else if (state === 'cast_aoe' || state === 'surge' || state === 'phase_shift' || state === 'victory') {
      const rise = Math.sin(t * Math.PI);
      dy = Math.round(-rise * (ny < 0.4 ? 2.2 : 1.3));
    } else if (state === 'hit' || state === 'stagger') {
      const recoil = Math.sin(t * Math.PI);
      if (ny < 0.78) {
        dx = Math.round(-recoil * 1.8 * facingSign);
        dy = ny < 0.35 ? Math.round(-recoil * 0.9) : 0;
      }
    } else if (state === 'death') {
      const drop = t * t;
      dy = Math.round(drop * (ny < 0.5 ? span * 0.24 : span * 0.1));
      dx = Math.round(drop * (ny < 0.5 ? 1.8 : 0.6) * facingSign);
    }

    for (let x = 0; x < w; x++) {
      const sOff = (y * w + x) * 4;
      const a = src.data[sOff + 3];
      if (a === 0) continue;

      let pxDx = dx;
      let pxDy = dy;

      // Alternating left/right foot & leg articulation during walk cycles
      if ((state === 'walk' || state === 'move') && ny >= 0.72) {
        const stride = Math.sin(phase);
        const isLeftFoot = x < midX;
        const footPhase = isLeftFoot ? stride : -stride;
        pxDx = Math.round(footPhase * 1.5);
        pxDy = footPhase > 0.3 ? -1 : 0;
      }

      const tx = x + pxDx;
      const ty = y + pxDy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      setPixelBlend(out, tx, ty, {
        r: src.data[sOff],
        g: src.data[sOff + 1],
        b: src.data[sOff + 2],
        a,
      });
    }
  }

  return out;
}

export type PostStateEffect =
  | 'none'
  | 'windup_aura'
  | 'attack_slash'
  | 'hit_flash'
  | 'death_dissolve'
  | 'phase_glow'
  | 'blink_phase'
  | 'revive_glow'
  | 'downed_pulse';

/** Applies post-outline translucent emissive combat effects without black outline crust */
export function applyPostOutlineEffect(
  halfRes: RasterBuffer,
  effect: PostStateEffect,
  frame: number,
  total: number,
  accentHex = '#A991F7'
): RasterBuffer {
  const out = createRaster(halfRes.width, halfRes.height);
  const accent = hexToRgba(accentHex);
  const t = total > 1 ? frame / (total - 1) : 0;
  const cx = Math.floor(halfRes.width / 2);
  const cy = Math.floor(halfRes.height * 0.55);
  const footY = halfRes.height - (halfRes.height >= 64 ? 9 : 4);

  if (effect === 'windup_aura') {
    const rx = Math.round(halfRes.width * (0.24 + t * 0.12));
    const ry = Math.max(2, Math.round(rx * 0.32));
    drawEllipse(out, cx, footY, rx + 1, ry + 1, { ...accent, a: 72 });
    drawEllipse(out, cx, footY, rx, ry, { ...accent, a: 132 });
    blitRaster(out, halfRes, 0, frame % 2 === 0 ? 0 : -1);
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'attack_slash') {
    blitRaster(out, halfRes, frame === 2 ? 1 : 0, 0);
    if (frame >= 1 && frame <= 3) {
      const r = Math.floor(halfRes.width * 0.28);
      drawGlow(out, cx + Math.round(halfRes.width * 0.14), cy, r, accent, 108);
    }
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'hit_flash') {
    const shifted = shiftRaster(halfRes, frame === 0 ? -1 : frame === 1 ? 1 : 0, frame === 0 ? -1 : 0);
    out.data.set(shifted.data);
    const flashCol = frame === 0 ? hexToRgba('#FFFFFF') : hexToRgba('#E96578');
    const strength = frame === 0 ? 0.44 : frame === 1 ? 0.28 : 0.12;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] < 40) continue;
      if (
        out.data[i] === OUTLINE_INK_RGBA.r &&
        out.data[i + 1] === OUTLINE_INK_RGBA.g &&
        out.data[i + 2] === OUTLINE_INK_RGBA.b
      ) {
        continue;
      }
      out.data[i] = Math.round(out.data[i] * (1 - strength) + flashCol.r * strength);
      out.data[i + 1] = Math.round(out.data[i + 1] * (1 - strength) + flashCol.g * strength);
      out.data[i + 2] = Math.round(out.data[i + 2] * (1 - strength) + flashCol.b * strength);
    }
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'death_dissolve') {
    out.data.set(halfRes.data);
    const keepRatio = Math.max(0.18, 1 - t * 0.72);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const off = (y * out.width + x) * 4;
        if (out.data[off + 3] < 20) continue;
        const normY = y / out.height;
        const hash = ((x * 73 + y * 139 + frame * 37) % 100) / 100;
        if (t > 0.45 && hash > keepRatio + normY * 0.35) {
          out.data[off + 3] = 0;
        } else if (t > 0.3) {
          out.data[off] = Math.round(out.data[off] * 0.75 + accent.r * 0.25);
          out.data[off + 1] = Math.round(out.data[off + 1] * 0.75 + accent.g * 0.25);
          out.data[off + 2] = Math.round(out.data[off + 2] * 0.75 + accent.b * 0.25);
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      const wx = cx - 6 + i * 4 + ((frame + i) % 2);
      const wy = Math.max(3, Math.round(cy - t * (halfRes.height * 0.35) - (i % 2) * 3));
      setPixelBlend(out, wx, wy, { ...accent, a: Math.round(210 * (1 - t * 0.5)) });
    }
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'phase_glow') {
    const rx = Math.round(halfRes.width * (0.28 + t * 0.14));
    const ry = Math.max(3, Math.round(rx * 0.3));
    drawGlow(out, cx, cy, Math.round(halfRes.width * (0.28 + t * 0.14)), accent, 140);
    drawEllipse(out, cx, footY, rx, ry, { ...hexToRgba('#F7E3A6'), a: 155 });
    blitRaster(out, halfRes, 0, -Math.round(Math.sin(t * Math.PI) * 2.5));
    if (frame === 2 || frame === 3) {
      for (let i = 0; i < out.data.length; i += 4) {
        if (out.data[i + 3] < 40) continue;
        if (
          out.data[i] === OUTLINE_INK_RGBA.r &&
          out.data[i + 1] === OUTLINE_INK_RGBA.g &&
          out.data[i + 2] === OUTLINE_INK_RGBA.b
        ) {
          continue;
        }
        out.data[i] = Math.round(out.data[i] * 0.8 + accent.r * 0.2);
        out.data[i + 1] = Math.round(out.data[i + 1] * 0.8 + accent.g * 0.2);
        out.data[i + 2] = Math.round(out.data[i + 2] * 0.8 + accent.b * 0.2);
      }
    }
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'blink_phase') {
    drawGlow(out, cx, cy, 8 + frame * 1.5, accent, 138);
    blitRaster(out, halfRes, 0, -frame);
    if (frame === 1 || frame === 2) {
      const aScale = frame === 1 ? 0.78 : 0.52;
      for (let i = 0; i < out.data.length; i += 4) {
        if (out.data[i + 3] === 0) continue;
        out.data[i] = Math.round(out.data[i] * 0.6 + accent.r * 0.4);
        out.data[i + 1] = Math.round(out.data[i + 1] * 0.6 + accent.g * 0.4);
        out.data[i + 2] = Math.round(out.data[i + 2] * 0.6 + accent.b * 0.4);
        out.data[i + 3] = Math.round(out.data[i + 3] * aScale);
      }
    }
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'revive_glow') {
    drawGlow(out, cx, cy, 8 + frame * 1.5, hexToRgba('#58D6C2'), 135);
    drawEllipse(out, cx, footY, 9 - frame, 3, { ...hexToRgba('#F7E3A6'), a: 165 });
    blitRaster(out, halfRes, 0, 0);
    if (frame < 2) {
      const k = 0.36 - frame * 0.14;
      for (let i = 0; i < out.data.length; i += 4) {
        if (out.data[i + 3] < 40) continue;
        if (
          out.data[i] === OUTLINE_INK_RGBA.r &&
          out.data[i + 1] === OUTLINE_INK_RGBA.g &&
          out.data[i + 2] === OUTLINE_INK_RGBA.b
        ) {
          continue;
        }
        out.data[i] = Math.round(out.data[i] * (1 - k) + 88 * k);
        out.data[i + 1] = Math.round(out.data[i + 1] * (1 - k) + 214 * k);
        out.data[i + 2] = Math.round(out.data[i + 2] * (1 - k) + 194 * k);
      }
    }
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  if (effect === 'downed_pulse') {
    blitRaster(out, halfRes, 0, frame % 2 === 0 ? 0 : 1);
    drawGlow(out, cx, footY - 3, 5 + (frame % 2), hexToRgba('#E96578'), 85);
    setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    return out;
  }

  out.data.set(halfRes.data);
  return out;
}

export function computeFrameHash(c: RasterBuffer): string {
  let opaque = 0;
  let hash = 2166136261;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const idx = (y * c.width + x) * 4;
      const a = c.data[idx + 3];
      if (a > 0) opaque++;
      hash ^= c.data[idx] + (c.data[idx + 1] << 4) + (c.data[idx + 2] << 8) + (a << 12);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${opaque}:${hash >>> 0}`;
}

export function ensureDistinctFrame(
  frameHalfRes: RasterBuffer,
  prevHash: string | null,
  frameIndex: number
): { buffer: RasterBuffer; hash: string } {
  let cur = frameHalfRes;
  let h = computeFrameHash(cur);
  if (prevHash !== null && h === prevHash) {
    cur = shiftRaster(cur, 0, frameIndex % 2 === 0 ? -1 : 1);
    setPixelRaw(cur, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    h = computeFrameHash(cur);
    if (h === prevHash) {
      const out = cloneRaster(cur);
      for (let y = 4; y < out.height - 4; y++) {
        let nudged = false;
        for (let x = 4; x < out.width - 4; x++) {
          const off = (y * out.width + x) * 4;
          if (out.data[off + 3] >= 200 && out.data[off] > 40) {
            out.data[off] = Math.min(255, Math.max(0, out.data[off] + (frameIndex % 2 === 0 ? 3 : -3)));
            nudged = true;
            break;
          }
        }
        if (nudged) break;
      }
      cur = out;
      h = computeFrameHash(cur);
    }
  }
  return { buffer: cur, hash: h };
}
