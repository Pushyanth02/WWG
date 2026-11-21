import {
  Archive,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { EXTERNAL_PACK_PRESETS } from '../data/styleContract';
import { spriteRegistry } from '../game/spriteLoader';
import type { AssetManifest, VfxStyleTier } from '../types/game';
import { exportPipelineStudioBundle, formatBytes } from '../utils/assetExporter';
import {
  BackdropMode,
  ResolvedBackdropMode,
  cleanAlphaBuffer,
} from '../pipeline/alphaCleanup';
import {
  QuantizationMetrics,
  QuantizeMode,
  quantizeRiftNightLab,
  renderDeltaEHeatmap,
} from '../pipeline/colorQuantizer';
import {
  HighPrecisionValidationItem,
  validateSheetBuffer,
} from '../pipeline/frameValidator';
import { resampleToCalibratedCell } from '../pipeline/pivotCalibrator';
import {
  RasterBuffer,
  blitRaster,
  createRaster,
  ensureDistinctFrame,
  upscaleRaster,
} from '../pipeline/raster';
import {
  BBox,
  SegmentationResult,
  segmentSprites,
} from '../pipeline/segmentation';

const V31_BOXES = {
  enemy: {
    pivot: { x: 32, y: 54 },
    hitbox: { x: 16, y: 18, w: 32, h: 38 },
    hurtbox: { x: 18, y: 20, w: 28, h: 34 },
  },
  boss: {
    pivot: { x: 64, y: 104 },
    hitbox: { x: 26, y: 26, w: 76, h: 82 },
    hurtbox: { x: 30, y: 28, w: 68, h: 78 },
  },
  icon: {
    pivot: { x: 16, y: 16 },
    hitbox: { x: 4, y: 4, w: 24, h: 24 },
    hurtbox: { x: 4, y: 4, w: 24, h: 24 },
  },
};

const VFX_COMBAT_SLOTS = [
  { id: 'vfx_fire', label: 'Fire School Spells (Pyromancer)' },
  { id: 'vfx_ice', label: 'Frost School Spells (Cryomancer)' },
  { id: 'vfx_lightning', label: 'Storm School Spells (Stormcaller)' },
  { id: 'vfx_thermal_shatter', label: 'Thermal & Shatter Resonances' },
  { id: 'vfx_arcane_utility', label: 'Arcane Utility & Telegraphs' },
  { id: 'vfx_schools_extended', label: 'Void / Venom / Blood / Chrono' },
  { id: 'vfx_resonances_arcane', label: 'Arcane & Boss Resonances' },
] as const;

type PipelineStage = 'raw' | 'alpha' | 'segment' | 'quantize' | 'output';

interface BundledSample {
  id: string;
  label: string;
  subtitle: string;
  url: string;
  cropBand?: BBox;
  backdrop: BackdropMode;
  targetCell: 32 | 64 | 128;
  expectedCount?: number;
  maxSpriteWidth?: number;
  isVfx?: boolean;
}

const BUNDLED_SAMPLES: BundledSample[] = [
  {
    id: 'mage_revive_white',
    label: 'Blue Mage Revive (White BG)',
    subtitle: 'White backdrop flood-fill + 6-frame respawn sequence',
    url: '/assets/aistudio/image_d7db875b.png',
    cropBand: { x: 500, y: 904, w: 685, h: 80 },
    backdrop: 'white',
    targetCell: 64,
    expectedCount: 6,
  },
  {
    id: 'skeleton_seam_split',
    label: 'Skeleton Warrior (DP Seam Split)',
    subtitle: 'Touching frames split via min-energy seam',
    url: '/assets/aistudio/image_7c0891e3.png',
    cropBand: { x: 15, y: 215, w: 745, h: 65 },
    backdrop: 'alpha',
    targetCell: 64,
    expectedCount: 13,
    maxSpriteWidth: 68,
  },
  {
    id: 'vertical_slice_tyrants',
    label: '3 Active Tyrants (4K Atlas)',
    subtitle: 'Adaptive obsidian keying + 128×128 feet-pivot lock',
    url: '/assets/aistudio/image_743550f4.png',
    cropBand: { x: 434, y: 686, w: 288, h: 90 },
    backdrop: 'dark',
    targetCell: 128,
    expectedCount: 3,
  },
  {
    id: 'boss_warning_rings',
    label: 'Boss Warning Rings (Additive)',
    subtitle: 'Adaptive slate-indigo additive keying on VFX',
    url: '/assets/aistudio/image_287c1c89.png',
    cropBand: { x: 25, y: 1196, w: 660, h: 90 },
    backdrop: 'dark_additive',
    targetCell: 64,
    expectedCount: 6,
    isVfx: true,
  },
  {
    id: 'magic_atlas_vfx',
    label: '9 Elemental Spells (Magic Atlas)',
    subtitle: '9 distinct school spell effects via dark-additive keying',
    url: '/assets/aistudio/image_e5369a8c.png',
    cropBand: { x: 825, y: 660, w: 685, h: 56 },
    backdrop: 'dark_additive',
    targetCell: 64,
    expectedCount: 9,
    isVfx: true,
  },
];

interface PipelineOutputBundle {
  rawBuffer: RasterBuffer;
  cleanedBuffer: RasterBuffer;
  detectedMode: ResolvedBackdropMode;
  strippedBgPixels: number;
  haloPixelsRemoved: number;
  specklesPruned: number;
  segmentation: SegmentationResult;
  quantizedFrames: RasterBuffer[];
  heatmapFrames: RasterBuffer[];
  outputSheet: RasterBuffer;
  avgQuantMetrics: QuantizationMetrics;
  pivotShifts: { dx: number; dy: number; feetX: number; baselineY: number }[];
  validation: HighPrecisionValidationItem;
  elapsedMs: number;
}

function rasterToCanvas(buf: RasterBuffer): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = buf.width;
  c.height = buf.height;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(buf.width, buf.height);
    img.data.set(buf.data);
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

function imageToRaster(img: HTMLImageElement, cropBand?: BBox): RasterBuffer {
  const sx = cropBand ? Math.max(0, Math.min(img.width - 1, cropBand.x)) : 0;
  const sy = cropBand ? Math.max(0, Math.min(img.height - 1, cropBand.y)) : 0;
  const sw = cropBand ? Math.min(img.width - sx, cropBand.w) : img.width;
  const sh = cropBand ? Math.min(img.height - sy, cropBand.h) : img.height;

  // Cap huge arbitrary local uploads at 1600px wide for responsive live editing
  const scale = sw > 1600 ? 1600 / sw : 1;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const c = document.createElement('canvas');
  c.width = dw;
  c.height = dh;
  const ctx = c.getContext('2d');
  if (!ctx) return createRaster(dw, dh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  const data = ctx.getImageData(0, 0, dw, dh).data;
  return {
    width: dw,
    height: dh,
    data: new Uint8Array(data.buffer.slice(0)),
  };
}

export function PipelineStudio() {
  const [stage, setStage] = useState<PipelineStage>('output');
  const [sampleId, setSampleId] = useState<string>(BUNDLED_SAMPLES[1].id);
  const [sourceName, setSourceName] = useState<string>(BUNDLED_SAMPLES[1].label);
  const [rawRaster, setRawRaster] = useState<RasterBuffer | null>(null);
  const [loadingSource, setLoadingSource] = useState<boolean>(false);

  // Pipeline parameters
  const [backdropMode, setBackdropMode] = useState<BackdropMode>('auto');
  const [adaptiveSeamSplit, setAdaptiveSeamSplit] = useState<boolean>(true);
  const [expectedCount, setExpectedCount] = useState<number>(13);
  const [maxSpriteWidth, setMaxSpriteWidth] = useState<number>(68);
  const [quantizeMode, setQuantizeMode] = useState<QuantizeMode>('hybrid_lab');
  const [cohesionStrength, setCohesionStrength] = useState<number>(0.42);
  const [outlineEnabled, setOutlineEnabled] = useState<boolean>(true);
  const [feetPivotAlign, setFeetPivotAlign] = useState<boolean>(true);
  const [targetCell, setTargetCell] = useState<32 | 64 | 128>(64);
  const [isVfxMode, setIsVfxMode] = useState<boolean>(false);

  // Overlay & playback controls
  const [showBBoxes, setShowBBoxes] = useState<boolean>(true);
  const [showSeams, setShowSeams] = useState<boolean>(true);
  const [showContours, setShowContours] = useState<boolean>(true);
  const [showPivotOverlay, setShowPivotOverlay] = useState<boolean>(true);
  const [showBoxesOverlay, setShowBoxesOverlay] = useState<boolean>(true);
  const [showDeltaEHeatmap, setShowDeltaEHeatmap] = useState<boolean>(false);

  const [playing, setPlaying] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(8);
  const [zoom, setZoom] = useState<number>(4);
  const [frameIndex, setFrameIndex] = useState<number>(0);

  // External pack license preset selector & PVFX Foundry / Pixel Burst hot-swap importer
  const [packPresetId, setPackPresetId] = useState<string>(EXTERNAL_PACK_PRESETS[0].id);
  const [vfxPackTier, setVfxPackTier] = useState<VfxStyleTier>('lit');
  const [targetVfxSlot, setTargetVfxSlot] = useState<string>(VFX_COMBAT_SLOTS[0].id);
  const [parsedJsonNote, setParsedJsonNote] = useState<string | null>(null);
  const [activeOverrideIds, setActiveOverrideIds] = useState<string[]>(() =>
    spriteRegistry.getRuntimeOverrideIds()
  );
  const [exportingBundle, setExportingBundle] = useState<boolean>(false);
  const [bundleNotice, setBundleNotice] = useState<string | null>(null);

  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const frameFloatRef = useRef<number>(0);

  const activePackPreset =
    EXTERNAL_PACK_PRESETS.find((p) => p.id === packPresetId) ?? EXTERNAL_PACK_PRESETS[0];
  const resolvedOverrideSlotId =
    vfxPackTier === 'strict' ? `${targetVfxSlot}_strict` : targetVfxSlot;
  const isSlotOverridden = activeOverrideIds.includes(resolvedOverrideSlotId);

  const loadBundledSample = (sample: BundledSample) => {
    setLoadingSource(true);
    setSampleId(sample.id);
    setSourceName(sample.label);
    setBackdropMode(sample.backdrop);
    setTargetCell(sample.targetCell);
    setExpectedCount(sample.expectedCount ?? 0);
    setMaxSpriteWidth(sample.maxSpriteWidth ?? 0);
    setIsVfxMode(Boolean(sample.isVfx));
    setOutlineEnabled(!sample.isVfx);
    setFeetPivotAlign(!sample.isVfx);
    setFrameIndex(0);
    frameFloatRef.current = 0;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setRawRaster(imageToRaster(img, sample.cropBand));
      setLoadingSource(false);
    };
    img.onerror = () => {
      setLoadingSource(false);
    };
    img.src = sample.url;
  };

  useEffect(() => {
    loadBundledSample(BUNDLED_SAMPLES[1]);
  }, []);

  const handleLocalUpload = (file: File | undefined) => {
    if (!file) return;
    setLoadingSource(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.onload = () => {
          setSampleId('local_upload');
          setSourceName(file.name);
          setBackdropMode('auto');
          setExpectedCount(0);
          setMaxSpriteWidth(0);
          setRawRaster(imageToRaster(img));
          setFrameIndex(0);
          frameFloatRef.current = 0;
          setLoadingSource(false);
        };
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVfxJsonUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}')) as Record<string, unknown>;
        const firstEntry = Array.isArray(parsed)
          ? (parsed[0] as Record<string, unknown> | undefined)
          : Array.isArray(parsed.effects)
            ? (parsed.effects[0] as Record<string, unknown> | undefined)
            : parsed;

        const rawW = Number(
          firstEntry?.frameWidth ?? firstEntry?.width ?? firstEntry?.cellSize ?? 64
        );
        const rawFps = Number(firstEntry?.fps ?? firstEntry?.frameRate ?? 12);
        const rawCount = Number(
          firstEntry?.frameCount ??
            (Array.isArray(firstEntry?.frames) ? firstEntry.frames.length : 0)
        );

        const nextCell: 32 | 64 | 128 = rawW >= 96 ? 128 : rawW <= 40 ? 32 : 64;
        setIsVfxMode(true);
        setBackdropMode('dark_additive');
        setTargetCell(nextCell);
        setFeetPivotAlign(false);
        if (Number.isFinite(rawFps) && rawFps >= 4 && rawFps <= 30) {
          setFps(Math.round(rawFps));
        }
        if (Number.isFinite(rawCount) && rawCount > 0 && rawCount <= 24) {
          setExpectedCount(Math.round(rawCount));
        }
        setParsedJsonNote(
          `Loaded ${file.name}: ${nextCell}×${nextCell}px${rawCount > 0 ? `, ${Math.round(rawCount)} frames` : ''}${Number.isFinite(rawFps) ? ` @ ${Math.round(rawFps)} fps` : ''}`
        );
      } catch {
        setParsedJsonNote(`Could not parse ${file.name} as PVFX/Pixel Burst JSON.`);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyToLiveCombat = () => {
    if (!bundle || !cachedCanvases) return;
    const dataUrl = cachedCanvases.outputSheet.toDataURL('image/png');
    const img = new Image();
    img.onload = () => {
      const existing = spriteRegistry.get(resolvedOverrideSlotId)?.manifest ??
        spriteRegistry.get(targetVfxSlot)?.manifest;
      const half = Math.round(targetCell / 2);
      const count = bundle.quantizedFrames.length;
      const baseStates = existing
        ? existing.animations.map((a) => ({ state: a.state, direction: a.direction, loop: a.loop }))
        : [
            { state: 'cast_charge', direction: 'down' as const, loop: false },
            { state: 'projectile', direction: 'down' as const, loop: true },
            { state: 'impact', direction: 'down' as const, loop: false },
            { state: 'aoe_burst', direction: 'down' as const, loop: false },
            { state: 'ground_linger', direction: 'down' as const, loop: true },
          ];

      const overrideManifest: AssetManifest = {
        assetId: resolvedOverrideSlotId,
        name: `${sourceName} (Imported ${vfxPackTier.toUpperCase()})`,
        category: 'vfx',
        subtitle: `Imported via Pipeline Studio (${activePackPreset.creator} • ${vfxPackTier.toUpperCase()})`,
        sheetUrl: dataUrl,
        manifestUrl: existing?.manifestUrl ?? `/assets/sprites/${resolvedOverrideSlotId}.json`,
        frameWidth: targetCell,
        frameHeight: targetCell,
        columns: count,
        rows: 1,
        animations: baseStates.map((st) => ({
          state: st.state,
          direction: st.direction,
          row: 0,
          frameCount: count,
          fps,
          loop: st.loop,
          pivot: { x: half, y: half },
          hitbox: { x: 8, y: 8, w: Math.max(16, targetCell - 16), h: Math.max(16, targetCell - 16) },
          hurtbox: { x: 8, y: 8, w: Math.max(16, targetCell - 16), h: Math.max(16, targetCell - 16) },
          events: [],
        })),
        tags: ['imported', vfxPackTier, activePackPreset.id],
        integratedInDemo: true,
      };

      spriteRegistry.registerRuntimeOverride(resolvedOverrideSlotId, img, overrideManifest);
      setActiveOverrideIds(spriteRegistry.getRuntimeOverrideIds());
      setBundleNotice(
        `Applied ${count}-frame ${vfxPackTier.toUpperCase()} strip to live combat slot ${resolvedOverrideSlotId}.`
      );
      soundEngine.playUiClick();
    };
    img.src = dataUrl;
  };

  const handleResetCombatOverride = () => {
    spriteRegistry.clearRuntimeOverride(resolvedOverrideSlotId);
    setActiveOverrideIds(spriteRegistry.getRuntimeOverrideIds());
    setBundleNotice(`Restored built-in V3.1 sheet for ${resolvedOverrideSlotId}.`);
    soundEngine.playUiClick();
  };

  // Run the full isomorphic graphics pipeline reactively in-browser
  const bundle: PipelineOutputBundle | null = useMemo(() => {
    if (!rawRaster) return null;
    const t0 = performance.now();

    // Stage 2: Autonomous Transparency Cleanup & Halo Decontamination
    const alphaRes = cleanAlphaBuffer(rawRaster, backdropMode, {
      pruneSpeckles: true,
      decontaminateHalos: true,
    });

    // Stage 3: Hybrid Segmentation + DP Minimum-Energy Seam Splitting + Moore Contours
    const seg = segmentSprites(alphaRes.buffer, {
      mergeGap: 3,
      maxSpriteWidth: adaptiveSeamSplit && maxSpriteWidth > 0 ? maxSpriteWidth : undefined,
      expectedCount: adaptiveSeamSplit && expectedCount > 0 ? expectedCount : undefined,
      traceContours: true,
      sortOrder: rawRaster.height > rawRaster.width * 0.45 ? 'reading' : 'ltr',
    });

    const halfCell = Math.max(16, targetCell / 2);
    const contractBoxes =
      targetCell === 128
        ? V31_BOXES.boss
        : targetCell === 32
          ? V31_BOXES.icon
          : V31_BOXES.enemy;

    const targetPivotHalfX = Math.round(contractBoxes.pivot.x / 2);
    const targetPivotHalfY = Math.round(contractBoxes.pivot.y / 2);

    const spritesToUse =
      seg.sprites.length > 0
        ? seg.sprites.slice(0, 24)
        : [{ buffer: alphaRes.buffer, bbox: { x: 0, y: 0, w: alphaRes.buffer.width, h: alphaRes.buffer.height }, silhouetteArea: 1, contour: [], splitBySeam: false }];

    const quantizedFrames: RasterBuffer[] = [];
    const heatmapFrames: RasterBuffer[] = [];
    const pivotShifts: { dx: number; dy: number; feetX: number; baselineY: number }[] = [];
    const outputSheet = createRaster(spritesToUse.length * targetCell, targetCell);

    let meanDeSum = 0;
    let p95DeMax = 0;
    let uniqueColorMax = 0;
    let totalInkPx = 0;
    let totalSampled = 0;
    let prevHash: string | null = null;

    spritesToUse.forEach((sp, idx) => {
      const strictVfxQuantize = isVfxMode && vfxPackTier === 'strict';
      // Stage 4a: Dynamic Feet-Centroid Pivot Calibration + Outline-Aware Resampling
      const cal = resampleToCalibratedCell(sp.buffer, halfCell, halfCell, {
        anchor: isVfxMode || targetCell === 32 ? 'center' : feetPivotAlign ? 'feet_pivot' : 'bottom',
        maxW: Math.round(halfCell * 0.82),
        maxH: Math.round(halfCell * 0.82),
        targetPivotX: targetPivotHalfX,
        targetPivotY: targetPivotHalfY,
        preserveSoftAlpha: isVfxMode && !strictVfxQuantize,
      });

      pivotShifts.push({
        dx: cal.pivotShiftDx * 2,
        dy: cal.pivotShiftDy * 2,
        feetX: Number((cal.feetX * 2).toFixed(1)),
        baselineY: Number((cal.baselineY * 2).toFixed(1)),
      });

      // Stage 4b: Multi-Pass Hybrid CIELAB Quantization & #140E1D Outline Ink
      const qRes =
        isVfxMode && !strictVfxQuantize
          ? {
              buffer: cal.buffer,
              metrics: { meanDeltaE: 0, p95DeltaE: 0, uniqueColors: 0, outlineInkPixels: 0, sampledPixels: 0 },
            }
          : quantizeRiftNightLab(cal.buffer, {
              mode: quantizeMode,
              cohesionStrength,
              addOutline: strictVfxQuantize ? true : outlineEnabled,
              addGroundShadow: !isVfxMode && targetCell >= 64,
              shadowY: Math.min(halfCell - 2, targetPivotHalfY + 1),
              shadowRx: Math.round(halfCell * 0.25),
              shadowRy: Math.max(2, Math.round(halfCell * 0.08)),
              computeMetrics: true,
            });

      meanDeSum += qRes.metrics.meanDeltaE;
      if (qRes.metrics.p95DeltaE > p95DeMax) p95DeMax = qRes.metrics.p95DeltaE;
      if (qRes.metrics.uniqueColors > uniqueColorMax) uniqueColorMax = qRes.metrics.uniqueColors;
      totalInkPx += qRes.metrics.outlineInkPixels;
      totalSampled += qRes.metrics.sampledPixels;

      const deduped = ensureDistinctFrame(qRes.buffer, prevHash, idx);
      prevHash = deduped.hash;

      const up = upscaleRaster(deduped.buffer, 2);
      quantizedFrames.push(up);
      heatmapFrames.push(upscaleRaster(renderDeltaEHeatmap(deduped.buffer), 2));
      blitRaster(outputSheet, up, idx * targetCell, 0);
    });

    // Stage 5: High-Precision Frame-by-Frame Validation on Generated Strip
    const validation = validateSheetBuffer(outputSheet, {
      assetId: sampleId,
      name: sourceName,
      category: isVfxMode ? 'vfx' : targetCell === 128 ? 'boss' : targetCell === 32 ? 'icons' : 'enemy',
      frameWidth: targetCell,
      frameHeight: targetCell,
      columns: spritesToUse.length,
      rows: 1,
      animations: [
        {
          state: 'processed_strip',
          direction: 'down',
          row: 0,
          frameCount: spritesToUse.length,
          fps,
          loop: true,
          pivot: contractBoxes.pivot,
          hitbox: contractBoxes.hitbox,
          hurtbox: contractBoxes.hurtbox,
        },
      ],
    });

    const elapsedMs = Number((performance.now() - t0).toFixed(1));

    return {
      rawBuffer: rawRaster,
      cleanedBuffer: alphaRes.buffer,
      detectedMode: alphaRes.detectedMode,
      strippedBgPixels: alphaRes.strippedBgPixels,
      haloPixelsRemoved: alphaRes.haloPixelsRemoved,
      specklesPruned: alphaRes.specklesPruned,
      segmentation: seg,
      quantizedFrames,
      heatmapFrames,
      outputSheet,
      avgQuantMetrics: {
        meanDeltaE: Number((meanDeSum / Math.max(1, spritesToUse.length)).toFixed(2)),
        p95DeltaE: Number(p95DeMax.toFixed(2)),
        uniqueColors: uniqueColorMax,
        outlineInkPixels: totalInkPx,
        sampledPixels: totalSampled,
      },
      pivotShifts,
      validation,
      elapsedMs,
    };
  }, [
    rawRaster,
    backdropMode,
    adaptiveSeamSplit,
    maxSpriteWidth,
    expectedCount,
    quantizeMode,
    cohesionStrength,
    outlineEnabled,
    feetPivotAlign,
    targetCell,
    isVfxMode,
    vfxPackTier,
    sampleId,
    sourceName,
    fps,
  ]);

  // Cached offscreen canvases for crisp 60fps canvas rendering without re-allocating ImageData every frame
  const cachedCanvases = useMemo(() => {
    if (!bundle) return null;
    return {
      raw: rasterToCanvas(bundle.rawBuffer),
      cleaned: rasterToCanvas(bundle.cleanedBuffer),
      frames: bundle.quantizedFrames.map(rasterToCanvas),
      heatmaps: bundle.heatmapFrames.map(rasterToCanvas),
      outputSheet: rasterToCanvas(bundle.outputSheet),
    };
  }, [bundle]);

  const frameCount = bundle?.quantizedFrames.length ?? 1;

  useEffect(() => {
    if (frameIndex >= frameCount) {
      setFrameIndex(0);
      frameFloatRef.current = 0;
    }
  }, [frameCount, frameIndex]);

  // Live Interactive Stage Renderer
  useEffect(() => {
    if (!bundle || !cachedCanvases) return;
    let raf = 0;
    let lastTs = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - lastTs) / 1000, 0.05);
      lastTs = now;

      if (playing && (stage === 'output' || stage === 'quantize') && frameCount > 1) {
        frameFloatRef.current = (frameFloatRef.current + dt * fps) % frameCount;
        const nextInt = Math.floor(frameFloatRef.current) % frameCount;
        setFrameIndex((prev) => (prev !== nextInt ? nextInt : prev));
      }

      const canvas = stageCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const cw = canvas.width;
          const ch = canvas.height;
          ctx.clearRect(0, 0, cw, ch);
          ctx.save();
          ctx.imageSmoothingEnabled = false;

          if (stage === 'raw' || stage === 'alpha' || stage === 'segment') {
            const srcCanvas = stage === 'raw' ? cachedCanvases.raw : cachedCanvases.cleaned;
            const scale = Math.min((cw - 32) / srcCanvas.width, (ch - 32) / srcCanvas.height);
            const dw = Math.max(1, Math.round(srcCanvas.width * scale));
            const dh = Math.max(1, Math.round(srcCanvas.height * scale));
            const ox = Math.round((cw - dw) / 2);
            const oy = Math.round((ch - dh) / 2);

            ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, ox, oy, dw, dh);

            if (stage === 'segment') {
              // 1. Draw Moore-neighbor outer contours (Aether Teal)
              if (showContours) {
                ctx.strokeStyle = '#58D6C2';
                ctx.lineWidth = 1.25;
                for (const sp of bundle.segmentation.sprites) {
                  if (sp.contour.length < 3) continue;
                  ctx.beginPath();
                  sp.contour.forEach((pt, idx) => {
                    const px = ox + (sp.bbox.x + pt.x + 0.5) * scale;
                    const py = oy + (sp.bbox.y + pt.y + 0.5) * scale;
                    if (idx === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                  });
                  ctx.closePath();
                  ctx.stroke();
                }
              }

              // 2. Draw Sprite Bounding Boxes (Gold; dashed if produced by DP seam split)
              if (showBBoxes) {
                bundle.segmentation.sprites.forEach((sp, idx) => {
                  ctx.strokeStyle = sp.splitBySeam ? '#A991F7' : '#D9BA72';
                  ctx.lineWidth = 1.25;
                  ctx.setLineDash(sp.splitBySeam ? [4, 2] : []);
                  const rx = ox + sp.bbox.x * scale;
                  const ry = oy + sp.bbox.y * scale;
                  const rw = sp.bbox.w * scale;
                  const rh = sp.bbox.h * scale;
                  ctx.strokeRect(rx, ry, rw, rh);
                  ctx.setLineDash([]);

                  ctx.fillStyle = '#140E1D';
                  ctx.fillRect(rx, Math.max(2, ry - 14), 18, 13);
                  ctx.fillStyle = sp.splitBySeam ? '#E8D6FF' : '#D9BA72';
                  ctx.font = '10px JetBrains Mono, monospace';
                  ctx.fillText(String(idx + 1), rx + 3, Math.max(12, ry - 4));
                });
              }

              // 3. Draw DP Minimum-Energy Seam Cuts (Danger Crimson)
              if (showSeams) {
                ctx.strokeStyle = '#E96578';
                ctx.lineWidth = 2;
                for (const cut of bundle.segmentation.seamCuts) {
                  ctx.beginPath();
                  cut.xs.forEach((sx, rowY) => {
                    const px = ox + (cut.originX + sx + 0.5) * scale;
                    const py = oy + (cut.originY + rowY + 0.5) * scale;
                    if (rowY === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                  });
                  ctx.stroke();
                }
              }
            }
          } else {
            // Stage 4 (CIELAB Quantize / ΔE Heatmap) or Stage 5 (Calibrated 2x Output Preview)
            const fIdx = Math.min(frameCount - 1, Math.floor(frameFloatRef.current));
            const frameCanvas =
              showDeltaEHeatmap || stage === 'quantize'
                ? showDeltaEHeatmap
                  ? cachedCanvases.heatmaps[fIdx]
                  : cachedCanvases.frames[fIdx]
                : cachedCanvases.frames[fIdx];

            const effZoom = targetCell >= 128 ? Math.max(1.5, zoom * 0.65) : zoom;
            const dw = Math.round(targetCell * effZoom);
            const dh = Math.round(targetCell * effZoom);
            const dx = Math.round((cw - dw) / 2);
            const dy = Math.round((ch - dh) / 2);

            if (frameCanvas) {
              ctx.drawImage(frameCanvas, 0, 0, targetCell, targetCell, dx, dy, dw, dh);
            }

            // Frame boundary hairline
            ctx.strokeStyle = 'rgba(217, 186, 114, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);

            const contractBoxes =
              targetCell === 128
                ? V31_BOXES.boss
                : targetCell === 32
                  ? V31_BOXES.icon
                  : V31_BOXES.enemy;

            if (showBoxesOverlay) {
              ctx.strokeStyle = '#E96578';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(
                Math.round(dx + contractBoxes.hitbox.x * effZoom),
                Math.round(dy + contractBoxes.hitbox.y * effZoom),
                Math.round(contractBoxes.hitbox.w * effZoom),
                Math.round(contractBoxes.hitbox.h * effZoom)
              );
              ctx.strokeStyle = '#58D6C2';
              ctx.setLineDash([4, 3]);
              ctx.strokeRect(
                Math.round(dx + contractBoxes.hurtbox.x * effZoom),
                Math.round(dy + contractBoxes.hurtbox.y * effZoom),
                Math.round(contractBoxes.hurtbox.w * effZoom),
                Math.round(contractBoxes.hurtbox.h * effZoom)
              );
              ctx.setLineDash([]);
            }

            if (showPivotOverlay) {
              // Contract V3.1 Pivot (Gold crosshair)
              const px = Math.round(dx + contractBoxes.pivot.x * effZoom);
              const py = Math.round(dy + contractBoxes.pivot.y * effZoom);
              ctx.strokeStyle = '#D9BA72';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(px - 9, py);
              ctx.lineTo(px + 9, py);
              ctx.moveTo(px, py - 9);
              ctx.lineTo(px, py + 9);
              ctx.stroke();

              // Detected Feet-Centroid dot (Arcane Violet)
              const shiftInfo = bundle.pivotShifts[fIdx];
              if (shiftInfo) {
                const fx = Math.round(dx + shiftInfo.feetX * effZoom);
                const fy = Math.round(dy + shiftInfo.baselineY * effZoom);
                ctx.fillStyle = '#A991F7';
                ctx.beginPath();
                ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }

          ctx.restore();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [
    bundle,
    cachedCanvases,
    stage,
    playing,
    fps,
    zoom,
    frameCount,
    targetCell,
    showBBoxes,
    showSeams,
    showContours,
    showPivotOverlay,
    showBoxesOverlay,
    showDeltaEHeatmap,
  ]);

  const stepFrame = (delta: number) => {
    setPlaying(false);
    const next = ((Math.floor(frameFloatRef.current) + delta) % frameCount + frameCount) % frameCount;
    frameFloatRef.current = next;
    setFrameIndex(next);
  };

  const exportOutputPng = () => {
    if (!cachedCanvases) return;
    soundEngine.playUiClick();
    const cleanBase = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const a = document.createElement('a');
    a.download = `${cleanBase || 'pipeline_sheet'}_v31.png`;
    a.href = cachedCanvases.outputSheet.toDataURL('image/png');
    a.click();
  };

  const exportOutputManifest = () => {
    if (!bundle) return;
    soundEngine.playUiClick();
    const cleanBase = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const contractBoxes =
      targetCell === 128 ? V31_BOXES.boss : targetCell === 32 ? V31_BOXES.icon : V31_BOXES.enemy;
    const manifestObj = {
      assetId: cleanBase || 'pipeline_asset',
      name: sourceName,
      category: isVfxMode ? 'vfx' : targetCell === 128 ? 'boss' : 'enemy',
      pipeline: 'v3.1-cielab-contour-pivot-pipeline',
      frameWidth: targetCell,
      frameHeight: targetCell,
      columns: bundle.quantizedFrames.length,
      rows: 1,
      quantizeMode,
      cohesionStrength,
      outlineInkHex: '#140E1D',
      licenseReminder: activePackPreset.licenseNote,
      animations: [
        {
          state: 'processed_strip',
          direction: 'down',
          row: 0,
          frameCount: bundle.quantizedFrames.length,
          fps,
          loop: true,
          pivot: contractBoxes.pivot,
          hitbox: contractBoxes.hitbox,
          hurtbox: contractBoxes.hurtbox,
          events: [],
        },
      ],
    };
    const blob = new Blob([JSON.stringify(manifestObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanBase || 'pipeline_sheet'}_v31.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAuditJson = () => {
    if (!bundle) return;
    soundEngine.playUiClick();
    const cleanBase = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const blob = new Blob([JSON.stringify(bundle.validation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanBase || 'pipeline_sheet'}_audit.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportOutputBundle = async () => {
    if (!bundle || !cachedCanvases || exportingBundle) return;
    soundEngine.playUiClick();
    setExportingBundle(true);
    setBundleNotice(null);
    try {
      const cleanBase =
        sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') ||
        'pipeline_sheet';
      const contractBoxes =
        targetCell === 128 ? V31_BOXES.boss : targetCell === 32 ? V31_BOXES.icon : V31_BOXES.enemy;
      const manifestObj = {
        assetId: cleanBase,
        name: sourceName,
        category: isVfxMode ? 'vfx' : targetCell === 128 ? 'boss' : targetCell === 32 ? 'icons' : 'enemy',
        pipeline: 'v3.1-cielab-contour-pivot-pipeline',
        frameWidth: targetCell,
        frameHeight: targetCell,
        columns: bundle.quantizedFrames.length,
        rows: 1,
        quantizeMode,
        cohesionStrength,
        outlineInkHex: '#140E1D',
        licenseReminder: activePackPreset.licenseNote,
        animations: [
          {
            state: 'processed_strip',
            direction: 'down',
            row: 0,
            frameCount: bundle.quantizedFrames.length,
            fps,
            loop: true,
            pivot: contractBoxes.pivot,
            hitbox: contractBoxes.hitbox,
            hurtbox: contractBoxes.hurtbox,
            events: [],
          },
        ],
      };

      const atlasObj = {
        schema: 'archmage-v3.1-atlas/1.0',
        styleContract: {
          version: '3.1',
          pixelDensity: '2x',
          outlineInkHex: '#140E1D',
          palette: 'Rift Night (CIELAB Hybrid)',
        },
        meta: {
          assetId: cleanBase,
          image: `../sprites/${cleanBase}_v31.png`,
          size: {
            w: cachedCanvases.outputSheet.width,
            h: cachedCanvases.outputSheet.height,
          },
          tileSize: { w: targetCell, h: targetCell },
          grid: { columns: bundle.quantizedFrames.length, rows: 1 },
        },
        frames: bundle.quantizedFrames.map((_, idx) => ({
          id: `${cleanBase}_f${String(idx).padStart(2, '0')}`,
          frameIndex: idx,
          rect: { x: idx * targetCell, y: 0, w: targetCell, h: targetCell },
          pivot: contractBoxes.pivot,
          hitbox: contractBoxes.hitbox,
          hurtbox: contractBoxes.hurtbox,
          durationMs: Math.round(1000 / Math.max(1, fps)),
        })),
      };

      const receipt = await exportPipelineStudioBundle({
        baseName: cleanBase,
        outputSheetCanvas: cachedCanvases.outputSheet,
        frameCanvases: cachedCanvases.frames,
        manifestObj,
        atlasObj,
        auditObj: bundle.validation as unknown as Record<string, unknown>,
        frameSize: targetCell,
      });

      setBundleNotice(
        `Exported ${receipt.filename} (${receipt.fileCount} files · ${formatBytes(receipt.totalBytes)} · SHA-256 verified)`
      );
    } finally {
      setExportingBundle(false);
    }
  };

  const currentShift = bundle?.pivotShifts[Math.min(frameIndex, (bundle?.pivotShifts.length ?? 1) - 1)];

  return (
    <div className="space-y-5">
      {/* Studio Header & Source Selector */}
      <div className="border-b border-[#D9BA72]/20 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#9E93B5]">
              <span className="font-mono text-[#A991F7]">v3.1-cielab-contour-pivot-pipeline</span>
              <span aria-hidden="true">·</span>
              <span>Isomorphic CLI + Browser Engine</span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold text-[#D9BA72]">
              Graphics Pipeline Studio
            </h1>
            <p className="mt-0.5 text-sm text-[#BFB5D4]">
              Inspect live backdrop decontamination, DP minimum-energy seam splitting, Moore-neighbor contours, hybrid CIELAB Rift Night quantization, and feet-centroid pivot calibration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/webp"
              className="hidden"
              onChange={(e) => handleLocalUpload(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9BA72]/60 bg-[#261D36] px-3.5 py-2 text-xs font-semibold text-[#F8E7BF] hover:border-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Local PNG
            </button>
            <button
              onClick={exportOutputPng}
              disabled={!bundle}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#A991F7]/35 bg-[#221933] px-3 py-2 text-xs font-semibold text-[#DFD7F0] hover:border-[#A991F7] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export PNG
            </button>
            <button
              onClick={exportOutputManifest}
              disabled={!bundle}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#A991F7]/35 bg-[#1D162B] px-3 py-2 text-xs font-semibold text-[#DFD7F0] hover:border-[#A991F7] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export JSON
            </button>
            <button
              onClick={() => void exportOutputBundle()}
              disabled={!bundle || exportingBundle}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9BA72] bg-[#34283F] px-3.5 py-2 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
              title="Download processed PNG sheet + JSON manifest + Engine Atlas + Frame Audit + Sliced Frames + SHA-256"
            >
              {exportingBundle ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              Export Bundle (.zip)
            </button>
          </div>
        </div>
        {bundleNotice && (
          <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-[#58D6C2]">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{bundleNotice}</span>
          </div>
        )}
      </div>

      {/* Bundled Raw Source Samples Strip */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-[#9E93B5]">
          <span className="font-display font-semibold text-[#D9BA72]">Raw Source Samples</span>
          {bundle && (
            <span className="font-mono tabular-nums text-[#58D6C2]">
              Processed in {bundle.elapsedMs} ms · {bundle.quantizedFrames.length} frames extracted
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {BUNDLED_SAMPLES.map((s) => {
            const active = sampleId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  soundEngine.playUiClick();
                  loadBundledSample(s);
                }}
                className={`rounded-lg border p-2.5 text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[#D9BA72] bg-[#2D2240]'
                    : 'border-[#A991F7]/15 bg-[#181224] hover:border-[#A991F7]/40'
                }`}
              >
                <div className="text-xs font-semibold text-[#EFEAF7] leading-snug">{s.label}</div>
                <div className="mt-0.5 text-[11px] text-[#9E93B5] line-clamp-2">{s.subtitle}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 5-Stage Pipeline Stepper */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {(
          [
            { id: 'raw', num: '01', label: 'Raw Input' },
            { id: 'alpha', num: '02', label: 'Alpha Clean' },
            { id: 'segment', num: '03', label: 'Segment & Seams' },
            { id: 'quantize', num: '04', label: 'CIELAB Quantize' },
            { id: 'output', num: '05', label: 'Pivot & 2× Output' },
          ] as const
        ).map((st) => {
          const active = stage === st.id;
          return (
            <button
              key={st.id}
              onClick={() => {
                soundEngine.playUiClick();
                setStage(st.id);
              }}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'border-[#D9BA72] bg-[#34283F] text-[#F8E7BF]'
                  : 'border-[#A991F7]/18 bg-[#181224] text-[#B5AACB] hover:text-[#EFEAF7]'
              }`}
            >
              <span className="font-mono text-[11px] text-[#58D6C2]">{st.num}</span>
              <span>{st.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Split Workspace: Interactive Stage + Controls & Live Diagnostics */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {/* Interactive Viewport */}
          <div className="checkerboard-bg relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-[#D9BA72]/25 p-3">
            {loadingSource || !bundle ? (
              <div className="text-xs text-[#A99EC2]">Decoding raster buffer…</div>
            ) : (
              <>
                <canvas
                  ref={stageCanvasRef}
                  width={680}
                  height={360}
                  className="pixel-art max-h-[360px] w-full max-w-[680px]"
                />
                <div className="pointer-events-none absolute top-3 left-3.5 rounded bg-[#140E1D]/88 px-2.5 py-1 font-mono text-xs tabular-nums text-[#D9BA72]">
                  {stage === 'raw' && `Raw · ${bundle.rawBuffer.width}×${bundle.rawBuffer.height}px`}
                  {stage === 'alpha' &&
                    `Backdrop: ${bundle.detectedMode} · Stripped ${bundle.strippedBgPixels.toLocaleString()} px · Halos ${bundle.haloPixelsRemoved} px`}
                  {stage === 'segment' &&
                    `Sprites: ${bundle.segmentation.sprites.length} · DP Seam Cuts: ${bundle.segmentation.seamCuts.length} · Contours Active`}
                  {(stage === 'quantize' || stage === 'output') &&
                    `Frame ${frameIndex + 1}/${frameCount} · ${targetCell}×${targetCell} · ${showDeltaEHeatmap ? 'CIEDE2000 ΔE Heatmap' : quantizeMode}`}
                </div>

                {(stage === 'quantize' || stage === 'output') && currentShift && (
                  <div className="pointer-events-none absolute bottom-3 left-3.5 rounded bg-[#140E1D]/88 px-2.5 py-1 font-mono text-[11px] tabular-nums text-[#58D6C2]">
                    Feet ({currentShift.feetX}, {currentShift.baselineY}) · Shift Δ({currentShift.dx >= 0 ? `+${currentShift.dx}` : currentShift.dx}, {currentShift.dy >= 0 ? `+${currentShift.dy}` : currentShift.dy}) px
                  </div>
                )}
              </>
            )}
          </div>

          {/* Playback & Stage Overlay Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#A991F7]/18 bg-[#181224] px-3.5 py-2.5">
            {stage === 'segment' ? (
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer text-[#D4CCE6]">
                  <input type="checkbox" checked={showBBoxes} onChange={(e) => setShowBBoxes(e.target.checked)} className="accent-[#D9BA72]" />
                  Bounding Boxes
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[#E96578]">
                  <input type="checkbox" checked={showSeams} onChange={(e) => setShowSeams(e.target.checked)} className="accent-[#E96578]" />
                  DP Seam Cuts
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[#58D6C2]">
                  <input type="checkbox" checked={showContours} onChange={(e) => setShowContours(e.target.checked)} className="accent-[#58D6C2]" />
                  Moore Contours
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => stepFrame(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[#A991F7]/25 bg-[#241B35] text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer"
                  aria-label="Previous frame"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D9BA72]/55 bg-[#34283F] px-3 text-xs font-semibold text-[#F8E7BF] hover:bg-[#453554] cursor-pointer whitespace-nowrap"
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={() => stepFrame(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[#A991F7]/25 bg-[#241B35] text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer"
                  aria-label="Next frame"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </button>

                <label className="ml-2 flex items-center gap-1.5 text-xs text-[#D9BA72] cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={showDeltaEHeatmap}
                    onChange={(e) => setShowDeltaEHeatmap(e.target.checked)}
                    className="accent-[#D9BA72]"
                  />
                  ΔE Heatmap
                </label>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-[#9E93B5]">FPS</span>
              <input
                type="number"
                min={1}
                max={24}
                value={fps}
                onChange={(e) => setFps(Math.max(1, Math.min(24, Number(e.target.value) || 8)))}
                className="w-14 rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1 font-mono text-xs tabular-nums text-[#EFEAF7]"
              />
              <div className="flex items-center gap-1">
                {[2, 3, 4, 6].map((z) => (
                  <button
                    key={z}
                    onClick={() => setZoom(z)}
                    className={`rounded px-2 py-1 font-mono text-xs cursor-pointer ${
                      zoom === z ? 'bg-[#34283F] text-[#D9BA72]' : 'bg-[#140E1D] text-[#9E93B5]'
                    }`}
                  >
                    {z}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Frame-by-Frame Diagnostic Telemetry Grid */}
          {bundle && (
            <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#A991F7]/15 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-semibold text-[#D9BA72]">
                    Live V3.1 Frame Audit
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-[#58D6C2]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {bundle.validation.passed ? 'All Contracts Passed' : 'Review Notes'}
                  </span>
                </div>
                <button
                  onClick={exportAuditJson}
                  className="text-xs font-medium text-[#A991F7] hover:text-[#E8D6FF] cursor-pointer whitespace-nowrap"
                >
                  Download Audit JSON
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono tabular-nums">
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">CIEDE2000 Mean / P95</div>
                  <div className="mt-0.5 text-sm font-bold text-[#EFEAF7]">
                    {bundle.validation.meanDeltaE} <span className="text-[#9E93B5]">/ {bundle.validation.p95DeltaE}</span>
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">#140E1D Outline Cov.</div>
                  <div className="mt-0.5 text-sm font-bold text-[#D9BA72]">
                    {bundle.validation.outlinePerimeterCoverage}%
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">Pivot Jitter (Max)</div>
                  <div className="mt-0.5 text-sm font-bold text-[#58D6C2]">
                    {bundle.validation.maxPivotJitterPx} px
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">Hurtbox Fit / Halos</div>
                  <div className="mt-0.5 text-sm font-bold text-[#58D6C2]">
                    {bundle.validation.hurtboxContainmentPct}% · {bundle.validation.residualHaloPixels}px
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Real-Time Graphics Pipeline Controls */}
        <div className="space-y-4 rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 text-xs">
          {/* Stage 2: Transparency & Halo Cleanup */}
          <div className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-[#D9BA72]">
              Transparency &amp; Segmentation
            </h3>
            <label className="block">
              <span className="text-[#9E93B5]">Backdrop Classification</span>
              <select
                value={backdropMode}
                onChange={(e) => setBackdropMode(e.target.value as BackdropMode)}
                className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2.5 py-1.5 text-xs text-[#EFEAF7]"
              >
                <option value="auto">Auto-Detect ({bundle?.detectedMode ?? 'alpha'})</option>
                <option value="alpha">True Alpha + Fringe Clean</option>
                <option value="checker">Checkerboard Decontamination</option>
                <option value="white">Studio White Flood-Fill</option>
                <option value="dark">Obsidian Dark Flood-Fill</option>
                <option value="dark_additive">Dark Additive VFX Keying</option>
              </select>
            </label>

            <label className="flex items-center justify-between pt-1 cursor-pointer">
              <span className="text-[#C7BED8]">Adaptive DP Seam Splitting</span>
              <input
                type="checkbox"
                checked={adaptiveSeamSplit}
                onChange={(e) => setAdaptiveSeamSplit(e.target.checked)}
                className="accent-[#D9BA72]"
              />
            </label>

            {adaptiveSeamSplit && (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[#9E93B5]">Expected Count</span>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    value={expectedCount}
                    onChange={(e) => setExpectedCount(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                    className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1 font-mono tabular-nums text-[#EFEAF7]"
                  />
                </label>
                <label className="block">
                  <span className="text-[#9E93B5]">Max Width (px)</span>
                  <input
                    type="number"
                    min={0}
                    max={512}
                    value={maxSpriteWidth}
                    onChange={(e) => setMaxSpriteWidth(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1 font-mono tabular-nums text-[#EFEAF7]"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Stage 3: Multi-Pass CIELAB Quantization */}
          <div className="space-y-2 border-t border-[#A991F7]/15 pt-3">
            <h3 className="font-display text-sm font-semibold text-[#D9BA72]">
              CIELAB Rift Night Quantizer
            </h3>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'hybrid_lab', label: 'Hybrid Lab' },
                  { id: 'strict_rift', label: 'Strict Rift' },
                  { id: 'preserve_hues', label: 'Keep Hues' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setQuantizeMode(m.id)}
                  className={`rounded border py-1.5 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                    quantizeMode === m.id
                      ? 'border-[#D9BA72] bg-[#34283F] text-[#F8E7BF]'
                      : 'border-[#A991F7]/15 bg-[#140E1D] text-[#A99EC2]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[#9E93B5]">Rift Cohesion</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cohesionStrength}
                onChange={(e) => setCohesionStrength(Number(e.target.value))}
                className="w-28 accent-[#D9BA72]"
              />
              <span className="w-9 text-right font-mono tabular-nums text-[#D9BA72]">
                {Math.round(cohesionStrength * 100)}%
              </span>
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[#C7BED8]">Inject #140E1D Outline Ink (2px)</span>
              <input
                type="checkbox"
                checked={outlineEnabled}
                onChange={(e) => setOutlineEnabled(e.target.checked)}
                className="accent-[#D9BA72]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[#C7BED8]">Soft Alpha VFX Mode</span>
              <input
                type="checkbox"
                checked={isVfxMode}
                onChange={(e) => {
                  const v = e.target.checked;
                  setIsVfxMode(v);
                  if (v) setOutlineEnabled(false);
                }}
                className="accent-[#58D6C2]"
              />
            </label>
          </div>

          {/* Stage 4: Dynamic Pivot Calibration & V3.1 Grid */}
          <div className="space-y-2 border-t border-[#A991F7]/15 pt-3">
            <h3 className="font-display text-sm font-semibold text-[#D9BA72]">
              Dynamic Pivot &amp; V3.1 Output
            </h3>
            <div className="grid grid-cols-3 gap-1">
              {([32, 64, 128] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setTargetCell(sz)}
                  className={`rounded border py-1.5 font-mono text-xs cursor-pointer ${
                    targetCell === sz
                      ? 'border-[#58D6C2] bg-[#24323F] text-[#58D6C2]'
                      : 'border-[#A991F7]/15 bg-[#140E1D] text-[#A99EC2]'
                  }`}
                >
                  {sz}×{sz}
                </button>
              ))}
            </div>

            <label className="flex items-center justify-between pt-1 cursor-pointer">
              <span className="text-[#C7BED8]">Feet-Centroid Pivot Lock</span>
              <input
                type="checkbox"
                checked={feetPivotAlign}
                onChange={(e) => setFeetPivotAlign(e.target.checked)}
                className="accent-[#D9BA72]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[#C7BED8]">Show Pivot &amp; Feet Centroid</span>
              <input
                type="checkbox"
                checked={showPivotOverlay}
                onChange={(e) => setShowPivotOverlay(e.target.checked)}
                className="accent-[#D9BA72]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[#C7BED8]">Show V3.1 Hitbox / Hurtbox</span>
              <input
                type="checkbox"
                checked={showBoxesOverlay}
                onChange={(e) => setShowBoxesOverlay(e.target.checked)}
                className="accent-[#58D6C2]"
              />
            </label>
          </div>

          {/* External VFX Pack Importer (PVFX Foundry & Pixel Burst) + Live Combat Hot-Swap */}
          <div className="space-y-2.5 border-t border-[#A991F7]/15 pt-3">
            <h3 className="font-display text-sm font-semibold text-[#D9BA72]">
              PVFX Foundry &amp; Pixel Burst Importer
            </h3>

            <label className="block">
              <span className="text-[11px] text-[#9E93B5]">External Pack License Preset</span>
              <select
                value={packPresetId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPackPresetId(id);
                  const preset = EXTERNAL_PACK_PRESETS.find((p) => p.id === id);
                  if (preset && (id.includes('pvfx') || id.includes('pixel_burst'))) {
                    setIsVfxMode(true);
                    setBackdropMode('dark_additive');
                    setTargetCell(preset.frameWidth >= 96 ? 128 : preset.frameWidth <= 40 ? 32 : 64);
                    setFeetPivotAlign(false);
                  }
                }}
                className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2.5 py-1.5 text-xs text-[#EFEAF7]"
              >
                {EXTERNAL_PACK_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.creator} ({p.frameWidth}×{p.frameHeight})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsVfxMode(true);
                  setVfxPackTier('lit');
                }}
                className={`rounded border py-1.5 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                  vfxPackTier === 'lit'
                    ? 'border-[#58D6C2] bg-[#24323F] text-[#58D6C2]'
                    : 'border-[#A991F7]/15 bg-[#140E1D] text-[#A99EC2]'
                }`}
              >
                Lit (Glow Alpha)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsVfxMode(true);
                  setVfxPackTier('strict');
                }}
                className={`rounded border py-1.5 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                  vfxPackTier === 'strict'
                    ? 'border-[#D9BA72] bg-[#34283F] text-[#F8E7BF]'
                    : 'border-[#A991F7]/15 bg-[#140E1D] text-[#A99EC2]'
                }`}
              >
                Strict (Banded Ink)
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                ref={jsonInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(e) => handleVfxJsonUpload(e.target.files?.[0])}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => jsonInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#A991F7]/30 bg-[#140E1D] px-2.5 py-1.5 text-[11px] font-medium text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer whitespace-nowrap"
              >
                <FileJson className="h-3.5 w-3.5 text-[#58D6C2]" />
                Import effects.json
              </button>
            </div>

            {parsedJsonNote && (
              <div className="rounded border border-[#58D6C2]/30 bg-[#140E1D] px-2.5 py-1.5 text-[11px] text-[#58D6C2]">
                {parsedJsonNote}
              </div>
            )}

            <label className="block">
              <span className="text-[11px] text-[#9E93B5]">Live Combat VFX Slot</span>
              <select
                value={targetVfxSlot}
                onChange={(e) => setTargetVfxSlot(e.target.value)}
                className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2.5 py-1.5 text-xs text-[#EFEAF7]"
              >
                {VFX_COMBAT_SLOTS.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleApplyToLiveCombat}
                disabled={!bundle || !cachedCanvases}
                className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#D9BA72]/60 bg-[#34283F] px-2.5 py-1.5 text-[11px] font-semibold text-[#F8E7BF] hover:bg-[#41324F] disabled:opacity-40 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#D9BA72]" />
                Apply to Live Combat
              </button>
              {isSlotOverridden && (
                <button
                  type="button"
                  onClick={handleResetCombatOverride}
                  title="Restore built-in V3.1 sheet"
                  className="flex items-center gap-1 rounded border border-[#E96578]/40 bg-[#140E1D] px-2 py-1.5 text-[11px] text-[#E96578] hover:bg-[#2A1826] cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              )}
            </div>

            {activeOverrideIds.length > 0 && (
              <div className="text-[11px] text-[#58D6C2]">
                Active combat overrides: <span className="font-mono">{activeOverrideIds.join(', ')}</span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-[#D9BA72]/20 bg-[#140E1D] p-2.5 text-[11px] leading-relaxed text-[#BFB5D4]">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#D9BA72]" />
              <span>{activePackPreset.licenseNote}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
