import zlib from 'node:zlib';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function hex(color: string, alpha = 255): RGBA {
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

export function mix(c1: RGBA, c2: RGBA, t: number): RGBA {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * k),
    g: Math.round(c1.g + (c2.g - c1.g) * k),
    b: Math.round(c1.b + (c2.b - c1.b) * k),
    a: Math.round(c1.a + (c2.a - c1.a) * k),
  };
}

export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return { r: 0, g: 0, b: 0, a: 0 };
    const i = (iy * this.width + ix) * 4;
    return {
      r: this.data[i],
      g: this.data[i + 1],
      b: this.data[i + 2],
      a: this.data[i + 3],
    };
  }

  set(x: number, y: number, c: RGBA): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return;
    if (c.a <= 0) return;
    const i = (iy * this.width + ix) * 4;
    if (c.a === 255 || this.data[i + 3] === 0) {
      this.data[i] = c.r;
      this.data[i + 1] = c.g;
      this.data[i + 2] = c.b;
      this.data[i + 3] = c.a;
      return;
    }
    const sa = c.a / 255;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return;
    this.data[i] = Math.round((c.r * sa + this.data[i] * da * (1 - sa)) / outA);
    this.data[i + 1] = Math.round((c.g * sa + this.data[i + 1] * da * (1 - sa)) / outA);
    this.data[i + 2] = Math.round((c.b * sa + this.data[i + 2] * da * (1 - sa)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  setRaw(x: number, y: number, c: RGBA): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return;
    const i = (iy * this.width + ix) * 4;
    this.data[i] = c.r;
    this.data[i + 1] = c.g;
    this.data[i + 2] = c.b;
    this.data[i + 3] = c.a;
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    for (let py = y0; py < y0 + Math.floor(h); py++) {
      for (let px = x0; px < x0 + Math.floor(w); px++) {
        this.set(px, py, c);
      }
    }
  }

  shadedRect(x: number, y: number, w: number, h: number, base: RGBA, hi: RGBA, sh: RGBA): void {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const iw = Math.floor(w);
    const ih = Math.floor(h);
    for (let dy = 0; dy < ih; dy++) {
      for (let dx = 0; dx < iw; dx++) {
        let col = base;
        if (dy === 0 || dx === 0) col = hi;
        else if (dy === ih - 1 || dx === iw - 1) col = sh;
        this.set(x0 + dx, y0 + dy, col);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: RGBA): void {
    const rr = r * r;
    const x0 = Math.floor(cx - r);
    const x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r);
    const y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rr) {
          this.set(x, y, c);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
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
          this.set(x, y, c);
        }
      }
    }
  }

  ring(cx: number, cy: number, rOuter: number, rInner: number, c: RGBA): void {
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
          this.set(x, y, c);
        }
      }
    }
  }

  glow(cx: number, cy: number, radius: number, c: RGBA, peakAlpha = 180): void {
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
            this.set(x, y, { r: c.r, g: c.g, b: c.b, a });
          }
        }
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA, thickness = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    const half = Math.floor(thickness / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(x0 + (x1 - x0) * t);
      const py = Math.round(y0 + (y1 - y0) * t);
      if (thickness <= 1) {
        this.set(px, py, c);
      } else {
        this.rect(px - half, py - half, thickness, thickness, c);
      }
    }
  }

  triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGBA): void {
    const minX = Math.floor(Math.min(x0, x1, x2));
    const maxX = Math.ceil(Math.max(x0, x1, x2));
    const minY = Math.floor(Math.min(y0, y1, y2));
    const maxY = Math.ceil(Math.max(y0, y1, y2));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 0.001) return;
    const sign = area > 0 ? 1 : -1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) * sign;
        const w1 = ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) * sign;
        const w2 = ((x0 - x2) * (y - y2) - (y0 - y2) * (x - x2)) * sign;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          this.set(x, y, c);
        }
      }
    }
  }

  /** Adds a crisp 1px pixel-art dark outline around opaque pixels */
  addOutline(outlineColor: RGBA = hex('#140E1D'), minAlpha = 170): void {
    const copy = new Uint8Array(this.data);
    const isSolid = (x: number, y: number) => {
      if (!this.inBounds(x, y)) return false;
      return copy[(y * this.width + x) * 4 + 3] >= minAlpha;
    };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (isSolid(x, y)) continue;
        if (isSolid(x - 1, y) || isSolid(x + 1, y) || isSolid(x, y - 1) || isSolid(x, y + 1)) {
          this.setRaw(x, y, outlineColor);
        }
      }
    }
  }

  /** Upscale a low-res pixel canvas by integer factor (e.g. 2x from 32x32 to 64x64) with zero blur */
  upscale(factor: number): PixelCanvas {
    const out = new PixelCanvas(this.width * factor, this.height * factor);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.get(x, y);
        if (c.a === 0) continue;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            out.setRaw(x * factor + dx, y * factor + dy, c);
          }
        }
      }
    }
    return out;
  }

  flipHorizontal(): PixelCanvas {
    const out = new PixelCanvas(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        out.setRaw(this.width - 1 - x, y, this.get(x, y));
      }
    }
    return out;
  }

  blit(src: PixelCanvas, dstX: number, dstY: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c.a > 0) {
          this.set(dstX + x, dstY + y, c);
        }
      }
    }
  }

  tint(color: RGBA, strength: number): void {
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] < 40) continue;
      this.data[i] = Math.round(this.data[i] * (1 - strength) + color.r * strength);
      this.data[i + 1] = Math.round(this.data[i + 1] * (1 - strength) + color.g * strength);
      this.data[i + 2] = Math.round(this.data[i + 2] * (1 - strength) + color.b * strength);
    }
  }

  scaleAlpha(factor: number): void {
    for (let i = 3; i < this.data.length; i += 4) {
      this.data[i] = Math.max(0, Math.min(255, Math.round(this.data[i] * factor)));
    }
  }

  toPNG(): Buffer {
    return encodePNG(this.width, this.height, this.data);
  }
}

// CRC32 table for PNG encoding
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, payload]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, payload, crcBuf]);
}

export function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    const srcStart = y * stride;
    raw.set(rgba.subarray(srcStart, srcStart + stride), y * (stride + 1) + 1);
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePNG(buffer: Buffer): { width: number; height: number; data: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== sig[i]) throw new Error('Invalid PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
      interlace = payload[12];
    } else if (type === 'PLTE') {
      palette = payload;
    } else if (type === 'tRNS') {
      trns = payload;
    } else if (type === 'IDAT') {
      idatChunks.push(payload);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported');
  }
  if (bitDepth !== 8 && !(colorType === 3 && (bitDepth === 4 || bitDepth === 2 || bitDepth === 1))) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth} for color type ${colorType}`);
  }

  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 || colorType === 3 ? 1 : 0;
  if (channels === 0) {
    throw new Error(`Unsupported PNG color type ${colorType}`);
  }

  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const scanlineBytes = Math.ceil((width * channels * bitDepth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const recon = new Uint8Array(height * scanlineBytes);

  for (let y = 0; y < height; y++) {
    const rowInStart = y * (scanlineBytes + 1);
    const filter = raw[rowInStart];
    const rowOutStart = y * scanlineBytes;
    const prevRowStart = (y - 1) * scanlineBytes;

    for (let x = 0; x < scanlineBytes; x++) {
      const filtByte = raw[rowInStart + 1 + x];
      const a = x >= bpp ? recon[rowOutStart + x - bpp] : 0;
      const b = y > 0 ? recon[prevRowStart + x] : 0;
      const c = x >= bpp && y > 0 ? recon[prevRowStart + x - bpp] : 0;
      let val = filtByte;
      if (filter === 0) {
        val = filtByte;
      } else if (filter === 1) {
        val = (filtByte + a) & 0xff;
      } else if (filter === 2) {
        val = (filtByte + b) & 0xff;
      } else if (filter === 3) {
        val = (filtByte + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        val = (filtByte + paethPredictor(a, b, c)) & 0xff;
      } else {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
      recon[rowOutStart + x] = val;
    }
  }

  const data = new Uint8Array(width * height * 4);
  if (colorType === 6) {
    data.set(recon);
  } else if (colorType === 2) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      const d = i * 4;
      data[d] = recon[j];
      data[d + 1] = recon[j + 1];
      data[d + 2] = recon[j + 2];
      data[d + 3] = 255;
    }
  } else if (colorType === 4) {
    for (let i = 0, j = 0; i < width * height; i++, j += 2) {
      const d = i * 4;
      const g = recon[j];
      data[d] = g;
      data[d + 1] = g;
      data[d + 2] = g;
      data[d + 3] = recon[j + 1];
    }
  } else if (colorType === 0) {
    for (let i = 0; i < width * height; i++) {
      const d = i * 4;
      const g = recon[i];
      data[d] = g;
      data[d + 1] = g;
      data[d + 2] = g;
      data[d + 3] = 255;
    }
  } else if (colorType === 3) {
    if (!palette) throw new Error('Indexed PNG missing PLTE chunk');
    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineBytes;
      for (let x = 0; x < width; x++) {
        let idx = 0;
        if (bitDepth === 8) {
          idx = recon[rowStart + x];
        } else {
          const pixelsPerByte = 8 / bitDepth;
          const byte = recon[rowStart + Math.floor(x / pixelsPerByte)];
          const shift = 8 - bitDepth * ((x % pixelsPerByte) + 1);
          idx = (byte >> shift) & ((1 << bitDepth) - 1);
        }
        const d = (y * width + x) * 4;
        data[d] = palette[idx * 3] ?? 0;
        data[d + 1] = palette[idx * 3 + 1] ?? 0;
        data[d + 2] = palette[idx * 3 + 2] ?? 0;
        data[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }

  return { width, height, data };
}
