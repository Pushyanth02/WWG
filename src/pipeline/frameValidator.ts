import { findNearestRiftSwatch, rgbToLab } from './colorQuantizer.ts';
import { computeFeetAnchor } from './pivotCalibrator.ts';
import { OUTLINE_INK_RGBA, RasterBuffer, cropRaster } from './raster.ts';

export interface TimingRequirement {
  state: string;
  frames: number;
  fps: number;
}

export interface TimingContract {
  readonly enemy: readonly TimingRequirement[];
  readonly boss: readonly TimingRequirement[];
}

export interface ValidationAnimationLike {
  state: string;
  direction: string;
  row: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  pivot: { x: number; y: number };
  hitbox: { x: number; y: number; w: number; h: number };
  hurtbox: { x: number; y: number; w: number; h: number };
}

export interface ValidationManifestLike {
  assetId: string;
  name: string;
  category: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  animations: ValidationAnimationLike[];
}

export interface TrackDiagnostic {
  state: string;
  direction: string;
  row: number;
  frameCount: number;
  fps: number;
  maxPivotJitterPx: number;
  hurtboxContainmentPct: number;
  hitboxOverflowPct: number;
  meanDeltaE: number;
  outlinePerimeterCoverage: number;
  residualHaloPixels: number;
  duplicateAdjacentFrames: number;
}

export interface HighPrecisionValidationItem {
  assetId: string;
  name: string;
  category: string;
  sheetDimensions: string;
  expectedDimensions: string;
  dimensionsValid: boolean;
  transparentBackground: boolean;
  pixelDensity2xValid: boolean;
  outlineInkPresent: boolean;
  timingContractValid: boolean;
  nonEmptyFrames: number;
  totalFrames: number;
  duplicateAdjacentFrames: number;
  pivotsAndBoxesValid: boolean;
  meanDeltaE: number;
  p95DeltaE: number;
  outlinePerimeterCoverage: number;
  residualHaloPixels: number;
  maxPivotJitterPx: number;
  hurtboxContainmentPct: number;
  hitboxOverflowPct: number;
  trackDiagnostics: TrackDiagnostic[];
  passed: boolean;
  notes: string[];
}

const DEFAULT_TIMING_CONTRACT: TimingContract = {
  enemy: [
    { state: 'idle', frames: 4, fps: 6 },
    { state: 'walk', frames: 6, fps: 9 },
    { state: 'windup', frames: 4, fps: 10 },
    { state: 'attack', frames: 5, fps: 12 },
    { state: 'recovery', frames: 3, fps: 8 },
    { state: 'hit', frames: 3, fps: 10 },
    { state: 'death', frames: 5, fps: 8 },
  ],
  boss: [
    { state: 'idle', frames: 4, fps: 6 },
    { state: 'walk', frames: 6, fps: 8 },
    { state: 'windup', frames: 4, fps: 9 },
    { state: 'attack', frames: 5, fps: 11 },
    { state: 'phase_transition', frames: 6, fps: 8 },
    { state: 'signature', frames: 6, fps: 10 },
    { state: 'hit', frames: 3, fps: 10 },
    { state: 'death', frames: 6, fps: 7 },
  ],
};

/**
 * High-Precision Frame-by-Frame Sheet Validator (Isomorphic: runs identically in Node CLI & Browser Asset Lab).
 *
 * Audits:
 * 1. Exact dimensions & 2x2 uniform pixel-density blocks (zero anti-alias blur).
 * 2. V3.1 animation timing contract parity (enemy 7-state, boss 8-state).
 * 3. Outer silhouette perimeter #140E1D outline-ink coverage %.
 * 4. CIEDE2000 Rift Night Mean & P95 perceptual ΔE.
 * 5. Residual light-neutral edge halo count.
 * 6. Temporal feet-centroid pivot jitter (Δx/Δy in full-res px) across every track.
 * 7. V3.1 hurtbox containment % & hitbox overflow audit.
 * 8. Zero adjacent duplicate frames, transparent corners, and non-empty frames.
 */
export function validateSheetBuffer(
  png: RasterBuffer,
  asset: ValidationManifestLike,
  timingContract: TimingContract = DEFAULT_TIMING_CONTRACT
): HighPrecisionValidationItem {
  const notes: string[] = [];
  const expectedW = asset.columns * asset.frameWidth;
  const expectedH = asset.rows * asset.frameHeight;
  const dimensionsValid = png.width === expectedW && png.height === expectedH;
  if (!dimensionsValid) {
    notes.push(`Expected ${expectedW}x${expectedH}, got ${png.width}x${png.height}`);
  }

  const isEnvironmentTileset = asset.category === 'environment';
  const isVfx = asset.category === 'vfx';
  const isCombatActor =
    asset.category === 'mage' || asset.category === 'enemy' || asset.category === 'boss';

  // 1. Verify 2x2 pixel-density uniformity & count #140E1D outline ink blocks
  let pixelDensity2xValid = true;
  let outlinePixelsFound = 0;

  for (let y = 0; y < png.height - 1 && pixelDensity2xValid; y += 2) {
    for (let x = 0; x < png.width - 1; x += 2) {
      const i00 = (y * png.width + x) * 4;
      const i10 = (y * png.width + (x + 1)) * 4;
      const i01 = ((y + 1) * png.width + x) * 4;
      const i11 = ((y + 1) * png.width + (x + 1)) * 4;

      if (
        png.data[i00 + 3] >= 240 &&
        png.data[i00] === OUTLINE_INK_RGBA.r &&
        png.data[i00 + 1] === OUTLINE_INK_RGBA.g &&
        png.data[i00 + 2] === OUTLINE_INK_RGBA.b
      ) {
        outlinePixelsFound++;
      }

      for (let ch = 0; ch < 4; ch++) {
        const base = png.data[i00 + ch];
        if (png.data[i10 + ch] !== base || png.data[i01 + ch] !== base || png.data[i11 + ch] !== base) {
          pixelDensity2xValid = false;
          break;
        }
      }
      if (!pixelDensity2xValid) break;
    }
  }

  if (!pixelDensity2xValid) {
    notes.push('Non-uniform 2x2 pixel block detected (sub-pixel blur or mismatched texel density)');
  }

  // 2. Verify V3.1 timing contract parity for enemies & bosses
  let timingContractValid = true;
  if (asset.category === 'enemy') {
    for (const req of timingContract.enemy) {
      const match = asset.animations.find((a) => a.state === req.state && a.direction === 'down');
      if (!match || match.frameCount !== req.frames || match.fps !== req.fps) {
        timingContractValid = false;
        notes.push(`Enemy timing mismatch on state "${req.state}"`);
      }
    }
  } else if (asset.category === 'boss') {
    for (const req of timingContract.boss) {
      const match = asset.animations.find((a) => a.state === req.state && a.direction === 'down');
      if (!match || match.frameCount !== req.frames || match.fps !== req.fps) {
        timingContractValid = false;
        notes.push(`Boss timing mismatch on state "${req.state}"`);
      }
    }
  }

  // 3. Per-track & per-frame high-precision diagnostics
  let transparentCorners = 0;
  let checkedFrames = 0;
  let nonEmptyFrames = 0;
  let duplicateAdjacentFrames = 0;
  let pivotsAndBoxesValid = true;
  let totalHaloPixels = 0;
  let totalPerimeterPx = 0;
  let totalInkPerimeterPx = 0;
  let maxSheetJitterPx = 0;
  let containmentSum = 0;
  let containmentCount = 0;
  let overflowMax = 0;

  const sheetDeltaEs: number[] = [];
  const trackDiagnostics: TrackDiagnostic[] = [];

  for (const anim of asset.animations) {
    if (
      anim.pivot.x < 0 ||
      anim.pivot.x > asset.frameWidth ||
      anim.pivot.y < 0 ||
      anim.pivot.y > asset.frameHeight ||
      anim.hitbox.w <= 0 ||
      anim.hurtbox.w <= 0
    ) {
      pivotsAndBoxesValid = false;
      notes.push(`Invalid pivot or bounds in ${anim.state}/${anim.direction}`);
    }

    let prevHash = '';
    let trackDuplicates = 0;
    let trackHalos = 0;
    let trackPerim = 0;
    let trackInkPerim = 0;
    const trackDeltaEs: number[] = [];
    const trackFeetPoints: { x: number; y: number }[] = [];
    let trackContainmentSum = 0;
    let trackContainmentCount = 0;
    let trackMaxOverflow = 0;

    const skipOutlineOnTrack = isVfx || (isEnvironmentTileset && anim.state === 'floor_tiles');
    const skipJitterOnTrack =
      !isCombatActor || anim.state === 'death' || anim.state === 'downed' || anim.state === 'blink';

    for (let f = 0; f < anim.frameCount; f++) {
      checkedFrames++;
      const x0 = f * asset.frameWidth;
      const y0 = anim.row * asset.frameHeight;

      if (x0 + asset.frameWidth > png.width || y0 + asset.frameHeight > png.height) {
        continue;
      }

      const cornerAlpha = png.data[(y0 * png.width + x0) * 4 + 3];
      if (cornerAlpha === 0) transparentCorners++;

      const fw = asset.frameWidth;
      const fh = asset.frameHeight;

      // Single pass at half-res (2px stride) for hash, ΔE, halo count, perimeter ink, & box containment
      let opaqueCount = 0;
      let solidBodyCount = 0;
      let insideHurtboxCount = 0;
      let outsideHitboxCount = 0;
      let hash = 2166136261;

      const alphaAt = (lx: number, ly: number) => {
        if (lx < 0 || ly < 0 || lx >= fw || ly >= fh) return 0;
        return png.data[((y0 + ly) * png.width + (x0 + lx)) * 4 + 3];
      };

      // Generous envelope around hitbox/hurtbox for overflow audit (+6px margin for capes/weapons)
      const envX0 = Math.min(anim.hitbox.x, anim.hurtbox.x) - 8;
      const envY0 = Math.min(anim.hitbox.y, anim.hurtbox.y) - 10;
      const envX1 = Math.max(anim.hitbox.x + anim.hitbox.w, anim.hurtbox.x + anim.hurtbox.w) + 8;
      const envY1 = Math.max(anim.hitbox.y + anim.hitbox.h, anim.hurtbox.y + anim.hurtbox.h) + 8;

      for (let py = 0; py < fh; py += 2) {
        for (let px = 0; px < fw; px += 2) {
          const idx = ((y0 + py) * png.width + (x0 + px)) * 4;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          const a = png.data[idx + 3];

          hash ^= r + (g << 4) + (b << 8) + (a << 12);
          hash = Math.imul(hash, 16777619);

          if (a === 0) continue;
          opaqueCount++;

          const touchesTransparent =
            alphaAt(px - 2, py) < 30 ||
            alphaAt(px + 2, py) < 30 ||
            alphaAt(px, py - 2) < 30 ||
            alphaAt(px, py + 2) < 30;

          // Residual light-neutral edge halo check (non-VFX, non-phase-transparent states)
          const skipHaloOnTrack = isVfx || anim.state === 'blink' || anim.state === 'floor_tiles';
          if (!skipHaloOnTrack && touchesTransparent && a >= 20 && a <= 180) {
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            if (maxC - minC <= 24 && minC >= 190) {
              trackHalos++;
              totalHaloPixels++;
            }
          }

          // Outer silhouette perimeter #140E1D coverage check
          if (!skipOutlineOnTrack && a >= 200 && touchesTransparent) {
            trackPerim++;
            totalPerimeterPx++;
            const isInk =
              (r === OUTLINE_INK_RGBA.r && g === OUTLINE_INK_RGBA.g && b === OUTLINE_INK_RGBA.b) ||
              (r <= 36 && g <= 28 && b <= 46);
            if (isInk) {
              trackInkPerim++;
              totalInkPerimeterPx++;
            }
          }

          // Perceptual CIEDE2000 ΔE sampling (stride 4px for ultra-fast full-sheet auditing)
          if (a >= 160 && py % 4 === 0 && px % 4 === 0) {
            const lab = rgbToLab(r, g, b);
            const { deltaE } = findNearestRiftSwatch(lab);
            trackDeltaEs.push(deltaE);
            sheetDeltaEs.push(deltaE);
          }

          // Combat actor hurtbox containment & hitbox overflow audit
          if (isCombatActor && a >= 185) {
            solidBodyCount++;
            if (
              px >= anim.hurtbox.x &&
              px <= anim.hurtbox.x + anim.hurtbox.w &&
              py >= anim.hurtbox.y &&
              py <= anim.hurtbox.y + anim.hurtbox.h
            ) {
              insideHurtboxCount++;
            }
            if (px < envX0 || px > envX1 || py < envY0 || py > envY1) {
              outsideHitboxCount++;
            }
          }
        }
      }

      if (opaqueCount > 0) nonEmptyFrames++;
      const hStr = `${opaqueCount}:${hash >>> 0}`;
      if (f > 0 && hStr === prevHash && anim.state !== 'downed' && anim.state !== 'recovery') {
        duplicateAdjacentFrames++;
        trackDuplicates++;
      }
      prevHash = hStr;

      if (isCombatActor && solidBodyCount > 0) {
        const fitPct = (insideHurtboxCount / solidBodyCount) * 100;
        const overPct = (outsideHitboxCount / solidBodyCount) * 100;
        trackContainmentSum += fitPct;
        trackContainmentCount++;
        if (overPct > trackMaxOverflow) trackMaxOverflow = overPct;
      }

      // Compute dynamic feet centroid for temporal pivot jitter tracking
      if (!skipJitterOnTrack) {
        const frameBuf = cropRaster(png, x0, y0, fw, fh);
        const feet = computeFeetAnchor(frameBuf, 185);
        if (feet.silhouetteArea > 0) {
          trackFeetPoints.push({ x: feet.feetCentroidX, y: feet.baselineY });
        }
      }
    }

    // Track-level temporal pivot jitter (max Euclidean deviation from track median anchor)
    let trackMaxJitter = 0;
    if (trackFeetPoints.length >= 2) {
      const xs = trackFeetPoints.map((p) => p.x).sort((a, b) => a - b);
      const ys = trackFeetPoints.map((p) => p.y).sort((a, b) => a - b);
      const medX = xs[Math.floor(xs.length / 2)];
      const medY = ys[Math.floor(ys.length / 2)];
      for (const p of trackFeetPoints) {
        const dist = Math.hypot(p.x - medX, p.y - medY);
        if (dist > trackMaxJitter) trackMaxJitter = dist;
      }
    }
    if (trackMaxJitter > maxSheetJitterPx) maxSheetJitterPx = trackMaxJitter;

    const trackMeanDe =
      trackDeltaEs.length > 0
        ? trackDeltaEs.reduce((acc, v) => acc + v, 0) / trackDeltaEs.length
        : 0;
    const trackOutlinePct =
      trackPerim > 0 ? (trackInkPerim / trackPerim) * 100 : skipOutlineOnTrack ? 100 : 0;
    const trackFitPct =
      trackContainmentCount > 0 ? trackContainmentSum / trackContainmentCount : 100;

    if (trackContainmentCount > 0) {
      containmentSum += trackFitPct;
      containmentCount++;
    }
    if (trackMaxOverflow > overflowMax) overflowMax = trackMaxOverflow;

    trackDiagnostics.push({
      state: anim.state,
      direction: anim.direction,
      row: anim.row,
      frameCount: anim.frameCount,
      fps: anim.fps,
      maxPivotJitterPx: Number(trackMaxJitter.toFixed(1)),
      hurtboxContainmentPct: Number(trackFitPct.toFixed(1)),
      hitboxOverflowPct: Number(trackMaxOverflow.toFixed(1)),
      meanDeltaE: Number(trackMeanDe.toFixed(2)),
      outlinePerimeterCoverage: Number(trackOutlinePct.toFixed(1)),
      residualHaloPixels: trackHalos,
      duplicateAdjacentFrames: trackDuplicates,
    });
  }

  const transparentBackground = isEnvironmentTileset ? true : transparentCorners === checkedFrames;
  if (!transparentBackground) {
    notes.push(`Non-transparent corner detected in ${checkedFrames - transparentCorners} frames`);
  }
  if (duplicateAdjacentFrames > 0) {
    notes.push(`${duplicateAdjacentFrames} adjacent identical frames found`);
  }

  const requiresOutline = !isVfx;
  const outlineInkPresent = !requiresOutline || outlinePixelsFound > 20;
  if (!outlineInkPresent) {
    notes.push('Missing mandatory #140E1D ink outline pixels');
  }

  sheetDeltaEs.sort((a, b) => a - b);
  const meanDeltaE =
    sheetDeltaEs.length > 0
      ? sheetDeltaEs.reduce((acc, v) => acc + v, 0) / sheetDeltaEs.length
      : 0;
  const p95DeltaE =
    sheetDeltaEs.length > 0
      ? sheetDeltaEs[Math.min(sheetDeltaEs.length - 1, Math.floor(sheetDeltaEs.length * 0.95))]
      : 0;
  const outlinePerimeterCoverage =
    totalPerimeterPx > 0 ? (totalInkPerimeterPx / totalPerimeterPx) * 100 : isVfx ? 100 : 0;
  const hurtboxContainmentPct =
    containmentCount > 0 ? containmentSum / containmentCount : 100;

  if (totalHaloPixels > 0 && !isVfx) {
    notes.push(`${totalHaloPixels} residual edge halo px detected`);
  }

  const passed =
    dimensionsValid &&
    transparentBackground &&
    pixelDensity2xValid &&
    outlineInkPresent &&
    timingContractValid &&
    nonEmptyFrames === checkedFrames &&
    pivotsAndBoxesValid &&
    duplicateAdjacentFrames === 0;

  return {
    assetId: asset.assetId,
    name: asset.name,
    category: asset.category,
    sheetDimensions: `${png.width}x${png.height}`,
    expectedDimensions: `${expectedW}x${expectedH}`,
    dimensionsValid,
    transparentBackground,
    pixelDensity2xValid,
    outlineInkPresent,
    timingContractValid,
    nonEmptyFrames,
    totalFrames: checkedFrames,
    duplicateAdjacentFrames,
    pivotsAndBoxesValid,
    meanDeltaE: Number(meanDeltaE.toFixed(2)),
    p95DeltaE: Number(p95DeltaE.toFixed(2)),
    outlinePerimeterCoverage: Number(outlinePerimeterCoverage.toFixed(1)),
    residualHaloPixels: totalHaloPixels,
    maxPivotJitterPx: Number(maxSheetJitterPx.toFixed(1)),
    hurtboxContainmentPct: Number(hurtboxContainmentPct.toFixed(1)),
    hitboxOverflowPct: Number(overflowMax.toFixed(1)),
    trackDiagnostics,
    passed,
    notes,
  };
}
