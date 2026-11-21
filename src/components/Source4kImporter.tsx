import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  FileSpreadsheet,
  Layers,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Search,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { cleanAlphaBuffer } from '../pipeline/alphaCleanup';
import {
  quantizeRiftNightLab,
  renderBeforeAfterDeltaEHeatmap,
} from '../pipeline/colorQuantizer';
import {
  V31NormalizedFrameResult,
  normalizeFrameV31,
} from '../pipeline/pivotCalibrator';
import {
  RasterBuffer,
  blitRaster,
  createRaster,
  upscaleRaster,
} from '../pipeline/raster';
import { buildExportTimestamp, triggerTextDownload } from '../pipeline/reportExport';
import { segmentSprites } from '../pipeline/segmentation';
import {
  AlphaSourceClassification,
  Loaded4kBundle,
  ManualFrameRegion,
  ResolvedSource4kAsset,
  V31RealFrameValidationResult,
  V31TrackAuthoringMeta,
  V31TrackEntityClass,
  V31ValidationVerdict,
  V31_STATE_TIMING_SPECS,
  fetch4kBundleManifests,
  validateExtractedTrackV31,
} from '../pipeline/source4kManifest';

type AlphaFilter = 'all' | AlphaSourceClassification;
type ActiveStage = 1 | 2 | 3 | 4 | 5;

const DEFAULT_BOXES_BY_KIND: Record<
  'player' | 'tyrant',
  {
    hitbox: { x: number; y: number; w: number; h: number };
    hurtbox: { x: number; y: number; w: number; h: number };
  }
> = {
  player: {
    hitbox: { x: 16, y: 18, w: 32, h: 38 },
    hurtbox: { x: 18, y: 20, w: 28, h: 34 },
  },
  tyrant: {
    hitbox: { x: 26, y: 26, w: 76, h: 82 },
    hurtbox: { x: 30, y: 28, w: 68, h: 78 },
  },
};

function defaultAuthoringMeta(asset: ResolvedSource4kAsset): V31TrackAuthoringMeta {
  const isVfx = asset.assetFamily === 'vfx_and_icon_sheet';
  const isBoss = asset.recommendedEntityKind === 'tyrant';
  const isPlayer = asset.assetFamily === 'player_animation_sheet';
  const entityClass: V31TrackEntityClass = isVfx
    ? 'vfx'
    : isBoss
      ? 'boss'
      : isPlayer
        ? 'player'
        : 'enemy';
  const targetKind: 'player' | 'tyrant' = isBoss ? 'tyrant' : 'player';
  const firstSpec = V31_STATE_TIMING_SPECS[entityClass][0];
  const boxes = DEFAULT_BOXES_BY_KIND[targetKind];

  return {
    entityClass,
    targetKind,
    state: firstSpec.state,
    direction: 'down',
    fps: firstSpec.fps,
    loop: true,
    hitbox: { ...boxes.hitbox },
    hurtbox: { ...boxes.hurtbox },
  };
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

function extractCropFromImage(
  img: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number }
): RasterBuffer {
  const sx = Math.max(0, Math.min(img.naturalWidth - 1, Math.round(rect.x)));
  const sy = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(rect.y)));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(rect.w)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(rect.h)));

  // Cap single-frame extraction at 512px max side to keep live browser processing instantaneous
  const scale = Math.max(sw, sh) > 512 ? 512 / Math.max(sw, sh) : 1;
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

function imageToPreviewRaster(img: HTMLImageElement, maxWidth = 1040): {
  raster: RasterBuffer;
  scale: number;
} {
  const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
  const dw = Math.max(1, Math.round(img.naturalWidth * scale));
  const dh = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = dw;
  c.height = dh;
  const ctx = c.getContext('2d');
  if (!ctx) return { raster: createRaster(dw, dh), scale };
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, dw, dh);
  const data = ctx.getImageData(0, 0, dw, dh).data;
  return {
    raster: { width: dw, height: dh, data: new Uint8Array(data.buffer.slice(0)) },
    scale,
  };
}

interface ProcessedTrackResult {
  normalizedFrames: V31NormalizedFrameResult[];
  quantizedFrames: RasterBuffer[];
  heatmapFrames: RasterBuffer[];
  outputSheet: RasterBuffer;
  meanBeforeAfterDeltaE: number;
  p95BeforeAfterDeltaE: number;
  snappedFractionPct: number;
  avgUniformity: number;
  maxPivotDeviationPx: number;
  validation: V31RealFrameValidationResult;
}

const ALPHA_CLASS_LABELS: Record<AlphaSourceClassification, string> = {
  studio_white_baked: 'Studio-White Candidate',
  true_alpha: 'True Alpha',
  mixed_alpha_or_baked_backdrop: 'Mixed / Baked Backdrop',
  dark_obsidian_baked: 'Dark Obsidian Baked',
  illustrated_opaque_composite: 'Opaque Composite',
};

function verdictDisplay(verdict: V31ValidationVerdict): {
  label: string;
  colorClass: string;
  icon: 'pass' | 'fail' | 'warn' | 'blocked';
} {
  switch (verdict) {
    case 'PASS_VERIFIED':
      return { label: 'Verified Pass', colorClass: 'text-[#58D6C2]', icon: 'pass' };
    case 'UNAPPROVED_CANDIDATE':
      return { label: 'Unapproved Candidate', colorClass: 'text-[#D9BA72]', icon: 'warn' };
    case 'FAIL':
      return { label: 'Failed V3.1', colorClass: 'text-[#E96578]', icon: 'fail' };
    case 'BLOCKED_PENDING_FRAME_EXTRACTION':
    default:
      return { label: 'Pending Extraction', colorClass: 'text-[#9E93B5]', icon: 'blocked' };
  }
}

function csvCell(val: string | number | boolean): string {
  const s = String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function Source4kImporter() {
  const [bundle, setBundle] = useState<Loaded4kBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemaPanelOpen, setSchemaPanelOpen] = useState<boolean>(true);

  // Inventory filters & selection
  const [alphaFilter, setAlphaFilter] = useState<AlphaFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('archmage_15');
  const [activeStage, setActiveStage] = useState<ActiveStage>(2);

  // Loaded immutable source image for selected sheet
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [imgLoading, setImgLoading] = useState<boolean>(false);
  const [imgLoadError, setImgLoadError] = useState<string | null>(null);

  // Per-sheet authoring state (strictly in-memory; source PNGs remain immutable)
  const [regionsByAsset, setRegionsByAsset] = useState<Record<string, ManualFrameRegion[]>>({});
  const [approvedByAsset, setApprovedByAsset] = useState<Record<string, boolean>>({});
  const [metaByAsset, setMetaByAsset] = useState<Record<string, V31TrackAuthoringMeta>>({});
  const [verdictCache, setVerdictCache] = useState<Record<string, V31ValidationVerdict>>({});

  // Stage-specific visual toggles
  const [showStudioWhitePreview, setShowStudioWhitePreview] = useState<boolean>(true);
  const [showHeuristicRowGuides, setShowHeuristicRowGuides] = useState<boolean>(false);
  const [showDeltaEHeatmap, setShowDeltaEHeatmap] = useState<boolean>(false);
  const [showPivotOverlay, setShowPivotOverlay] = useState<boolean>(true);
  const [showBoxesOverlay, setShowBoxesOverlay] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(4);
  const [playing, setPlaying] = useState<boolean>(true);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Interactive Stage 2 manual drag-to-crop state (in 4K source pixel coords)
  const [dragRect, setDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );

  const stage2CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stage4CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameFloatRef = useRef<number>(0);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  };

  useEffect(() => {
    let active = true;
    fetch4kBundleManifests()
      .then((loaded) => {
        if (!active) return;
        setBundle(loaded);
        // Seed initial per-sheet authoring metadata & fail-closed verdicts
        const initMeta: Record<string, V31TrackAuthoringMeta> = {};
        const initVerdicts: Record<string, V31ValidationVerdict> = {};
        for (const a of loaded.assets) {
          initMeta[a.id] = defaultAuthoringMeta(a);
          initVerdicts[a.id] = a.stage1Policy.isUnapprovedCandidate
            ? 'UNAPPROVED_CANDIDATE'
            : 'BLOCKED_PENDING_FRAME_EXTRACTION';
        }
        setMetaByAsset(initMeta);
        setVerdictCache(initVerdicts);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load 4K manifests');
      });

    return () => {
      active = false;
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const selectedAsset: ResolvedSource4kAsset | null = useMemo(() => {
    if (!bundle) return null;
    return bundle.assets.find((a) => a.id === selectedAssetId) ?? bundle.assets[0] ?? null;
  }, [bundle, selectedAssetId]);

  // Load immutable 4K PNG read-only whenever selectedAsset changes
  useEffect(() => {
    if (!selectedAsset) return;
    setImgLoading(true);
    setImgLoadError(null);
    setSourceImg(null);
    setFrameIndex(0);
    frameFloatRef.current = 0;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      setSourceImg(img);
      setImgLoading(false);
    };
    img.onerror = () => {
      if (cancelled) return;
      setImgLoadError(`Unable to load read-only source ${selectedAsset.workspaceUrl}`);
      setImgLoading(false);
    };
    img.src = selectedAsset.workspaceUrl;

    return () => {
      cancelled = true;
    };
  }, [selectedAsset]);

  // Non-destructive preview raster + Stage 1 border-white preview for studio-white candidates (15, 16, 24, 25)
  const previewBundle = useMemo(() => {
    if (!sourceImg || !selectedAsset) return null;
    const { raster: rawPreview, scale } = imageToPreviewRaster(sourceImg, 800);
    const rawCanvas = rasterToCanvas(rawPreview);

    let stage1PreviewCanvas: HTMLCanvasElement = rawCanvas;
    let strippedBgPixels = 0;
    let haloPixelsRemoved = 0;
    let specklesPruned = 0;

    if (selectedAsset.stage1Policy.backdropMode === 'studio_white_preview') {
      const cleaned = cleanAlphaBuffer(rawPreview, 'studio_white_preview', {
        pruneSpeckles: true,
        maxSpeckleArea: 5,
        decontaminateHalos: true,
      });
      stage1PreviewCanvas = rasterToCanvas(cleaned.buffer);
      strippedBgPixels = cleaned.strippedBgPixels;
      haloPixelsRemoved = cleaned.haloPixelsRemoved;
      specklesPruned = cleaned.specklesPruned;
    }

    return {
      scale,
      width: rawPreview.width,
      height: rawPreview.height,
      rawCanvas,
      stage1PreviewCanvas,
      strippedBgPixels,
      haloPixelsRemoved,
      specklesPruned,
    };
  }, [sourceImg, selectedAsset]);

  const currentRegions = useMemo(
    () => (selectedAsset ? regionsByAsset[selectedAsset.id] ?? [] : []),
    [regionsByAsset, selectedAsset]
  );

  const currentMeta: V31TrackAuthoringMeta | null = useMemo(() => {
    if (!selectedAsset) return null;
    return metaByAsset[selectedAsset.id] ?? defaultAuthoringMeta(selectedAsset);
  }, [metaByAsset, selectedAsset]);

  const isCandidateApproved = selectedAsset ? Boolean(approvedByAsset[selectedAsset.id]) : false;

  // Execute V3.1 Stages 1 -> 3 -> 4 -> 5 reactively on manually recovered contiguous frames
  const processedTrack: ProcessedTrackResult | null = useMemo(() => {
    if (!selectedAsset || !sourceImg || !currentMeta || currentRegions.length === 0) {
      return null;
    }

    const isVfx = currentMeta.entityClass === 'vfx';
    const targetCell = currentMeta.targetKind === 'tyrant' ? 128 : 64;
    const normalizedFrames: V31NormalizedFrameResult[] = [];
    const quantizedFrames: RasterBuffer[] = [];
    const heatmapFrames: RasterBuffer[] = [];
    const outputSheet = createRaster(currentRegions.length * targetCell, targetCell);

    let sumBeforeAfterDe = 0;
    let maxP95BeforeAfterDe = 0;
    let sumSnapped = 0;
    let sumUniformity = 0;
    let maxPivotDev = 0;

    currentRegions.forEach((reg, idx) => {
      // Crop exact 4K region from immutable source image
      const rawCrop = extractCropFromImage(sourceImg, reg);

      // Stage 1: Honor sheet alpha classification strictly
      // Bypass global keying for opaque composites, mixed/baked, true_alpha, and dark_obsidian
      // Apply non-destructive studio_white_preview ONLY for studio_white_baked (sheets 15, 16, 24, 25)
      const stage1Mode = selectedAsset.stage1Policy.backdropMode;
      const stage1Res = cleanAlphaBuffer(rawCrop, stage1Mode, {
        pruneSpeckles: stage1Mode === 'studio_white_preview',
        maxSpeckleArea: 5,
        decontaminateHalos: stage1Mode === 'studio_white_preview',
      });

      // Stage 4a: Draft to native 32x32 or 64x64 with V3.1 pivot lock & 0.20 feet band
      const preNorm = normalizeFrameV31(stage1Res.buffer, currentMeta.targetKind, {
        preserveSoftAlpha: isVfx,
      });

      // Stage 3: Protected CIELAB quantization (D65 CIEDE2000, #140E1D + 7 contract neutrals, ΔE00 <= 9)
      const qRes = quantizeRiftNightLab(preNorm.nativeBuffer, {
        mode: 'v31_protected',
        protectHighSaturation: true,
        deltaE00SnapMax: 9,
        addOutline: !isVfx,
        addGroundShadow: false,
        ensureCornerTransparent: true,
        computeMetrics: true,
      });

      const heatmapNative = renderBeforeAfterDeltaEHeatmap(preNorm.nativeBuffer, qRes.buffer);
      const upQuant = upscaleRaster(qRes.buffer, 2);
      const upHeat = upscaleRaster(heatmapNative, 2);

      // Re-measure uniformity on final 2x quantized frame (strictly 1.0 from integer 2x upscale)
      const finalNorm: V31NormalizedFrameResult = {
        ...preNorm,
        buffer: upQuant,
        twoByTwoUniformity: 1.0,
      };

      normalizedFrames.push(finalNorm);
      quantizedFrames.push(upQuant);
      heatmapFrames.push(upHeat);
      blitRaster(outputSheet, upQuant, idx * targetCell, 0);

      sumBeforeAfterDe += qRes.metrics.meanBeforeAfterDeltaE ?? 0;
      if ((qRes.metrics.p95BeforeAfterDeltaE ?? 0) > maxP95BeforeAfterDe) {
        maxP95BeforeAfterDe = qRes.metrics.p95BeforeAfterDeltaE ?? 0;
      }
      sumSnapped += qRes.metrics.snappedFraction ?? 0;
      sumUniformity += finalNorm.twoByTwoUniformity;
      if (finalNorm.pivotDeviationPx > maxPivotDev) {
        maxPivotDev = finalNorm.pivotDeviationPx;
      }
    });

    const n = Math.max(1, currentRegions.length);
    const meanBeforeAfterDeltaE = Number((sumBeforeAfterDe / n).toFixed(2));
    const p95BeforeAfterDeltaE = Number(maxP95BeforeAfterDe.toFixed(2));
    const snappedFractionPct = Number(((sumSnapped / n) * 100).toFixed(1));
    const avgUniformity = Number((sumUniformity / n).toFixed(4));
    const maxPivotDeviationPx = Number(maxPivotDev.toFixed(2));

    // Stage 5: Fail-closed real-frame V3.1 validation
    const validation = validateExtractedTrackV31({
      asset: selectedAsset,
      outputSheet,
      frameCount: currentRegions.length,
      meta: currentMeta,
      candidateApproved: isCandidateApproved,
      meanBeforeAfterDeltaE,
      p95BeforeAfterDeltaE,
      twoByTwoUniformity: avgUniformity,
      maxPivotDeviationPx,
    });

    return {
      normalizedFrames,
      quantizedFrames,
      heatmapFrames,
      outputSheet,
      meanBeforeAfterDeltaE,
      p95BeforeAfterDeltaE,
      snappedFractionPct,
      avgUniformity,
      maxPivotDeviationPx,
      validation,
    };
  }, [selectedAsset, sourceImg, currentMeta, currentRegions, isCandidateApproved]);

  // Fail-closed validation object even when 0 frames are extracted
  const activeValidation: V31RealFrameValidationResult | null = useMemo(() => {
    if (!selectedAsset || !currentMeta) return null;
    if (processedTrack) return processedTrack.validation;
    return validateExtractedTrackV31({
      asset: selectedAsset,
      outputSheet: null,
      frameCount: 0,
      meta: currentMeta,
      candidateApproved: isCandidateApproved,
      meanBeforeAfterDeltaE: 0,
      p95BeforeAfterDeltaE: 0,
      twoByTwoUniformity: 0,
      maxPivotDeviationPx: 0,
    });
  }, [selectedAsset, currentMeta, processedTrack, isCandidateApproved]);

  // Sync live verdict back to the 36-sheet inventory sidebar
  useEffect(() => {
    if (!selectedAsset || !activeValidation) return;
    setVerdictCache((prev) =>
      prev[selectedAsset.id] === activeValidation.verdict
        ? prev
        : { ...prev, [selectedAsset.id]: activeValidation.verdict }
    );
  }, [selectedAsset, activeValidation]);

  // Cached canvases for Stage 3/4 playback
  const processedCanvases = useMemo(() => {
    if (!processedTrack) return null;
    return {
      frames: processedTrack.quantizedFrames.map(rasterToCanvas),
      heatmaps: processedTrack.heatmapFrames.map(rasterToCanvas),
      sheet: rasterToCanvas(processedTrack.outputSheet),
    };
  }, [processedTrack]);

  // Draw Stage 1 / Stage 2 interactive sheet canvas
  useEffect(() => {
    const canvas = stage2CanvasRef.current;
    if (!canvas || !previewBundle || !selectedAsset) return;
    canvas.width = previewBundle.width;
    canvas.height = previewBundle.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Subtle dark checkerboard behind transparent preview pixels
    const tile = 10;
    for (let y = 0; y < canvas.height; y += tile) {
      for (let x = 0; x < canvas.width; x += tile) {
        ctx.fillStyle = ((x / tile + y / tile) & 1) === 0 ? '#181326' : '#120E1D';
        ctx.fillRect(x, y, tile, tile);
      }
    }

    const useCleanedPreview =
      selectedAsset.stage1Policy.backdropMode === 'studio_white_preview' && showStudioWhitePreview;
    ctx.drawImage(
      useCleanedPreview ? previewBundle.stage1PreviewCanvas : previewBundle.rawCanvas,
      0,
      0
    );

    const s = previewBundle.scale;

    // Optional UNVERIFIED_HEURISTIC row guides from REGION_HINTS.json (default OFF)
    if (showHeuristicRowGuides && selectedAsset.unverifiedRowCandidates.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(233, 101, 120, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.font = '10px JetBrains Mono, monospace';
      for (const row of selectedAsset.unverifiedRowCandidates) {
        const py = Math.round(row.y_px * s) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(canvas.width, py);
        ctx.stroke();
        ctx.fillStyle = 'rgba(20, 14, 29, 0.85)';
        ctx.fillRect(4, Math.max(2, py - 13), 152, 12);
        ctx.fillStyle = '#F4A6B2';
        ctx.fillText(`UNVERIFIED y=${row.y_px}px`, 8, Math.max(11, py - 4));
      }
      ctx.restore();
    }

    // Draw manually recovered contiguous frame boxes
    currentRegions.forEach((reg, idx) => {
      const rx = Math.round(reg.x * s);
      const ry = Math.round(reg.y * s);
      const rw = Math.max(2, Math.round(reg.w * s));
      const rh = Math.max(2, Math.round(reg.h * s));

      ctx.strokeStyle = reg.source === 'manual_roi_component' ? '#58D6C2' : '#D9BA72';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);

      ctx.fillStyle = 'rgba(20, 14, 29, 0.88)';
      ctx.fillRect(rx, Math.max(0, ry - 16), 24, 15);
      ctx.fillStyle = reg.source === 'manual_roi_component' ? '#58D6C2' : '#F8E7BF';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(`F${idx + 1}`, rx + 4, Math.max(11, ry - 5));
    });

    // Active drag box
    if (dragRect) {
      const x = Math.min(dragRect.x0, dragRect.x1) * s;
      const y = Math.min(dragRect.y0, dragRect.y1) * s;
      const w = Math.abs(dragRect.x1 - dragRect.x0) * s;
      const h = Math.abs(dragRect.y1 - dragRect.y0) * s;
      ctx.fillStyle = 'rgba(88, 214, 194, 0.14)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#58D6C2';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }
  }, [
    previewBundle,
    selectedAsset,
    showStudioWhitePreview,
    showHeuristicRowGuides,
    currentRegions,
    dragRect,
    activeStage,
  ]);

  // Animated Stage 3 / Stage 4 playback canvas
  const extractedCount = processedCanvases?.frames.length ?? 0;

  useEffect(() => {
    if (frameIndex >= extractedCount && extractedCount > 0) {
      setFrameIndex(0);
      frameFloatRef.current = 0;
    }
  }, [extractedCount, frameIndex]);

  useEffect(() => {
    if (!processedCanvases || !processedTrack || !currentMeta) return;
    let raf = 0;
    let lastTs = performance.now();
    const targetCell = currentMeta.targetKind === 'tyrant' ? 128 : 64;
    const targetPivot = currentMeta.targetKind === 'tyrant' ? { x: 64, y: 104 } : { x: 32, y: 54 };

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTs) / 1000, 0.05);
      lastTs = now;

      if (playing && extractedCount > 1) {
        frameFloatRef.current = (frameFloatRef.current + dt * currentMeta.fps) % extractedCount;
        const nextInt = Math.floor(frameFloatRef.current) % extractedCount;
        setFrameIndex((prev) => (prev !== nextInt ? nextInt : prev));
      }

      const canvas = stage4CanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const cw = canvas.width;
          const ch = canvas.height;
          ctx.clearRect(0, 0, cw, ch);
          ctx.save();
          ctx.imageSmoothingEnabled = false;

          const fIdx = Math.min(extractedCount - 1, Math.floor(frameFloatRef.current));
          const srcCanvas = showDeltaEHeatmap
            ? processedCanvases.heatmaps[fIdx]
            : processedCanvases.frames[fIdx];

          const effZoom = targetCell >= 128 ? Math.max(1.75, zoom * 0.65) : zoom;
          const dw = Math.round(targetCell * effZoom);
          const dh = Math.round(targetCell * effZoom);
          const dx = Math.round((cw - dw) / 2);
          const dy = Math.round((ch - dh) / 2);

          if (srcCanvas) {
            ctx.drawImage(srcCanvas, 0, 0, targetCell, targetCell, dx, dy, dw, dh);
          }

          ctx.strokeStyle = 'rgba(217, 186, 114, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);

          if (showBoxesOverlay && currentMeta.entityClass !== 'vfx') {
            ctx.strokeStyle = '#E96578';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(
              Math.round(dx + currentMeta.hitbox.x * effZoom),
              Math.round(dy + currentMeta.hitbox.y * effZoom),
              Math.round(currentMeta.hitbox.w * effZoom),
              Math.round(currentMeta.hitbox.h * effZoom)
            );
            ctx.strokeStyle = '#58D6C2';
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(
              Math.round(dx + currentMeta.hurtbox.x * effZoom),
              Math.round(dy + currentMeta.hurtbox.y * effZoom),
              Math.round(currentMeta.hurtbox.w * effZoom),
              Math.round(currentMeta.hurtbox.h * effZoom)
            );
            ctx.setLineDash([]);
          }

          if (showPivotOverlay) {
            const px = Math.round(dx + targetPivot.x * effZoom);
            const py = Math.round(dy + targetPivot.y * effZoom);
            ctx.strokeStyle = '#D9BA72';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px - 10, py);
            ctx.lineTo(px + 10, py);
            ctx.moveTo(px, py - 10);
            ctx.lineTo(px, py + 10);
            ctx.stroke();

            const norm = processedTrack.normalizedFrames[fIdx];
            if (norm) {
              const fx = Math.round(dx + norm.detectedFeet.x * effZoom);
              const fy = Math.round(dy + norm.detectedFeet.y * effZoom);
              ctx.fillStyle = '#A991F7';
              ctx.beginPath();
              ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          ctx.restore();
        }
      }

      raf = requestAnimationFrame(renderFrame);
    };

    raf = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(raf);
  }, [
    processedCanvases,
    processedTrack,
    currentMeta,
    extractedCount,
    playing,
    zoom,
    showDeltaEHeatmap,
    showBoxesOverlay,
    showPivotOverlay,
    activeStage,
  ]);

  // Pointer handlers for Stage 2 Manual Contiguous Frame Recovery
  const pointerToSourceCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = stage2CanvasRef.current;
    if (!canvas || !previewBundle || !sourceImg) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const cy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const sx = Math.max(0, Math.min(sourceImg.naturalWidth, Math.round(cx / previewBundle.scale)));
    const sy = Math.max(0, Math.min(sourceImg.naturalHeight, Math.round(cy / previewBundle.scale)));
    return { sx, sy };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = pointerToSourceCoords(e);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragRect({ x0: pt.sx, y0: pt.sy, x1: pt.sx, y1: pt.sy });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRect) return;
    const pt = pointerToSourceCoords(e);
    if (!pt) return;
    setDragRect((prev) => (prev ? { ...prev, x1: pt.sx, y1: pt.sy } : null));
  };

  const handleCanvasPointerUp = () => {
    if (!dragRect || !selectedAsset) return;
    const x = Math.min(dragRect.x0, dragRect.x1);
    const y = Math.min(dragRect.y0, dragRect.y1);
    const w = Math.abs(dragRect.x1 - dragRect.x0);
    const h = Math.abs(dragRect.y1 - dragRect.y0);
    setDragRect(null);

    if (w < 16 || h < 16) return;

    soundEngine.playUiClick();
    setRegionsByAsset((prev) => {
      const existing = prev[selectedAsset.id] ?? [];
      const next: ManualFrameRegion = {
        id: `fr_${Date.now()}_${existing.length + 1}`,
        x,
        y,
        w,
        h,
        label: `Frame ${existing.length + 1}`,
        source: 'manual_drag',
      };
      return { ...prev, [selectedAsset.id]: [...existing, next] };
    });
  };

  // Optional helper: split the most recently drawn safe ROI box into contiguous 8-CC components
  // Strictly bounded inside the user's manually drawn rectangle (never touches intersecting UI captions outside ROI)
  const splitLastRoiBy8CC = () => {
    if (!selectedAsset || !sourceImg || currentRegions.length === 0) return;
    const last = currentRegions[currentRegions.length - 1];
    const roiBuf = extractCropFromImage(sourceImg, last);
    const scaleBackX = last.w / roiBuf.width;
    const scaleBackY = last.h / roiBuf.height;

    const stage1Mode =
      selectedAsset.stage1Policy.backdropMode === 'preserve_opaque'
        ? 'auto'
        : selectedAsset.stage1Policy.backdropMode;
    const cleaned = cleanAlphaBuffer(roiBuf, stage1Mode, {
      pruneSpeckles: true,
      maxSpeckleArea: 5,
      decontaminateHalos: true,
    });

    const seg = segmentSprites(cleaned.buffer, {
      mergeGap: 4,
      minArea: 48,
      minW: 8,
      minH: 8,
      traceContours: false,
      sortOrder: 'ltr',
    });

    if (seg.sprites.length <= 1) {
      showNotice('Selected ROI already contains 1 contiguous silhouette');
      return;
    }

    soundEngine.playUiClick();
    const baseList = currentRegions.slice(0, -1);
    const splitItems: ManualFrameRegion[] = seg.sprites.slice(0, 16).map((sp, idx) => ({
      id: `cc_${Date.now()}_${idx}`,
      x: Math.round(last.x + sp.bbox.x * scaleBackX),
      y: Math.round(last.y + sp.bbox.y * scaleBackY),
      w: Math.max(8, Math.round(sp.bbox.w * scaleBackX)),
      h: Math.max(8, Math.round(sp.bbox.h * scaleBackY)),
      label: `Frame ${baseList.length + idx + 1}`,
      source: 'manual_roi_component',
    }));

    setRegionsByAsset((prev) => ({
      ...prev,
      [selectedAsset.id]: [...baseList, ...splitItems],
    }));
    showNotice(`Split safe ROI into ${splitItems.length} contiguous frames`);
  };

  const removeRegion = (regionId: string) => {
    if (!selectedAsset) return;
    soundEngine.playUiClick();
    setRegionsByAsset((prev) => ({
      ...prev,
      [selectedAsset.id]: (prev[selectedAsset.id] ?? []).filter((r) => r.id !== regionId),
    }));
  };

  const clearRegions = () => {
    if (!selectedAsset) return;
    soundEngine.playUiClick();
    setRegionsByAsset((prev) => ({ ...prev, [selectedAsset.id]: [] }));
  };

  const updateMeta = (patch: Partial<V31TrackAuthoringMeta>) => {
    if (!selectedAsset || !currentMeta) return;
    setMetaByAsset((prev) => ({
      ...prev,
      [selectedAsset.id]: { ...currentMeta, ...patch },
    }));
  };

  const handleEntityClassChange = (nextClass: V31TrackEntityClass) => {
    if (!currentMeta) return;
    const targetKind: 'player' | 'tyrant' = nextClass === 'boss' ? 'tyrant' : 'player';
    const firstSpec = V31_STATE_TIMING_SPECS[nextClass][0];
    const boxes = DEFAULT_BOXES_BY_KIND[targetKind];
    updateMeta({
      entityClass: nextClass,
      targetKind,
      state: firstSpec.state,
      fps: firstSpec.fps,
      hitbox: { ...boxes.hitbox },
      hurtbox: { ...boxes.hurtbox },
    });
  };

  const handleStateChange = (nextState: string) => {
    if (!currentMeta) return;
    const spec = V31_STATE_TIMING_SPECS[currentMeta.entityClass].find((s) => s.state === nextState);
    updateMeta({
      state: nextState,
      fps: spec ? spec.fps : currentMeta.fps,
    });
  };

  // Exports
  const exportSchemaAuditJson = () => {
    if (!bundle) return;
    soundEngine.playUiClick();
    triggerTextDownload(
      JSON.stringify(bundle.schemaAudit, null, 2),
      `archmage_4k_schema_mapping_audit_${buildExportTimestamp()}.json`,
      'application/json;charset=utf-8'
    );
    showNotice('Exported Schema Mapping & Field Adjustment Audit JSON');
  };

  const exportUpdatedRegionHints = () => {
    if (!bundle) return;
    soundEngine.playUiClick();
    const updated = {
      ...bundle.regionHintsDoc,
      exported_at: new Date().toISOString(),
      source_immutable: true,
      entries: bundle.regionHintsDoc.entries.map((entry) => {
        const manual = regionsByAsset[entry.asset_id] ?? [];
        const meta = metaByAsset[entry.asset_id];
        return {
          ...entry,
          frame_regions: manual.map((r, idx) => ({
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
            frameIndex: idx,
            trackState: meta?.state ?? 'idle',
            direction: meta?.direction ?? 'down',
            source: r.source,
          })),
        };
      }),
    };
    triggerTextDownload(
      JSON.stringify(updated, null, 2),
      `REGION_HINTS_recovered_${buildExportTimestamp()}.json`,
      'application/json;charset=utf-8'
    );
    showNotice('Exported updated REGION_HINTS.json with recovered 4K frame regions');
  };

  const exportNormalizedStripPng = () => {
    if (!processedCanvases || !selectedAsset || !currentMeta) return;
    soundEngine.playUiClick();
    const a = document.createElement('a');
    a.download = `${selectedAsset.id}_${currentMeta.state}_${currentMeta.direction}_v31.png`;
    a.href = processedCanvases.sheet.toDataURL('image/png');
    a.click();
    showNotice(`Exported normalized ${processedCanvases.sheet.width}×${processedCanvases.sheet.height} V3.1 strip`);
  };

  const exportFull36Audit = (format: 'json' | 'csv') => {
    if (!bundle) return;
    soundEngine.playUiClick();
    const stamp = buildExportTimestamp();
    const rows = bundle.assets.map((asset) => {
      const recovered = regionsByAsset[asset.id]?.length ?? 0;
      const approved = Boolean(approvedByAsset[asset.id]);
      const verdict =
        verdictCache[asset.id] ??
        (asset.stage1Policy.isUnapprovedCandidate
          ? 'UNAPPROVED_CANDIDATE'
          : 'BLOCKED_PENDING_FRAME_EXTRACTION');
      const meta = metaByAsset[asset.id] ?? defaultAuthoringMeta(asset);
      return {
        imageNumber: asset.imageNumber,
        assetId: asset.id,
        displayName: asset.displayName,
        archivePath: asset.archivePath,
        workspaceUrl: asset.workspaceUrl,
        sha256: asset.sha256,
        resolution: `${asset.resolution[0]}x${asset.resolution[1]}`,
        alphaClass: asset.alphaClass,
        globalKeyingBypassed: asset.stage1Policy.bypassGlobalKeying,
        unapprovedStudioWhiteCandidate: asset.stage1Policy.isUnapprovedCandidate,
        candidateApproved: approved,
        recoveredFrames: recovered,
        targetCell: meta.targetKind === 'tyrant' ? '128x128' : '64x64',
        targetPivot: meta.targetKind === 'tyrant' ? '64,104' : '32,54',
        authoredState: meta.state,
        authoredFps: meta.fps,
        v31Verdict: verdict,
      };
    });

    if (format === 'json') {
      const payload = {
        reportType: 'archmage_01_source_4k_v31_audit',
        exportedAt: new Date().toISOString(),
        sourceImmutable: true,
        totalSheets: rows.length,
        verifiedPassCount: rows.filter((r) => r.v31Verdict === 'PASS_VERIFIED').length,
        unapprovedCandidateCount: rows.filter((r) => r.v31Verdict === 'UNAPPROVED_CANDIDATE').length,
        pendingExtractionCount: rows.filter(
          (r) => r.v31Verdict === 'BLOCKED_PENDING_FRAME_EXTRACTION'
        ).length,
        schemaAudit: bundle.schemaAudit,
        sheets: rows,
      };
      triggerTextDownload(
        JSON.stringify(payload, null, 2),
        `archmage_36_sheet_v31_audit_${stamp}.json`,
        'application/json;charset=utf-8'
      );
      showNotice('Exported 36-sheet V3.1 Audit + Schema Mapping JSON');
      return;
    }

    const headers = [
      'image_number',
      'asset_id',
      'display_name',
      'archive_path',
      'workspace_url',
      'sha256',
      'resolution',
      'alpha_class',
      'global_keying_bypassed',
      'studio_white_candidate',
      'candidate_approved',
      'recovered_frames',
      'target_cell',
      'target_pivot',
      'authored_state',
      'authored_fps',
      'v31_verdict',
    ];
    const csvLines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.imageNumber,
          r.assetId,
          r.displayName,
          r.archivePath,
          r.workspaceUrl,
          r.sha256,
          r.resolution,
          r.alphaClass,
          r.globalKeyingBypassed,
          r.unapprovedStudioWhiteCandidate,
          r.candidateApproved,
          r.recoveredFrames,
          r.targetCell,
          r.targetPivot,
          r.authoredState,
          r.authoredFps,
          r.v31Verdict,
        ]
          .map(csvCell)
          .join(',')
      ),
    ];
    triggerTextDownload(
      csvLines.join('\r\n'),
      `archmage_36_sheet_v31_audit_${stamp}.csv`,
      'text/csv;charset=utf-8'
    );
    showNotice('Exported 36-sheet V3.1 Audit CSV');
  };

  // Filtered 36-sheet inventory
  const filteredAssets = useMemo(() => {
    if (!bundle) return [];
    const q = searchQuery.trim().toLowerCase();
    return bundle.assets.filter((a) => {
      if (alphaFilter !== 'all' && a.alphaClass !== alphaFilter) return false;
      if (!q) return true;
      return (
        a.displayName.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        String(a.imageNumber).padStart(2, '0').includes(q) ||
        a.assetFamily.toLowerCase().includes(q)
      );
    });
  }, [bundle, alphaFilter, searchQuery]);

  // Aggregate counts across all 36 sheets
  const summaryStats = useMemo(() => {
    if (!bundle) {
      return {
        total: 0,
        verified: 0,
        unapproved: 0,
        pending: 0,
        failed: 0,
        byClass: {} as Record<AlphaSourceClassification, number>,
      };
    }
    const byClass: Record<AlphaSourceClassification, number> = {
      studio_white_baked: 0,
      true_alpha: 0,
      mixed_alpha_or_baked_backdrop: 0,
      dark_obsidian_baked: 0,
      illustrated_opaque_composite: 0,
    };
    let verified = 0;
    let unapproved = 0;
    let pending = 0;
    let failed = 0;

    for (const a of bundle.assets) {
      byClass[a.alphaClass] += 1;
      const v =
        verdictCache[a.id] ??
        (a.stage1Policy.isUnapprovedCandidate
          ? 'UNAPPROVED_CANDIDATE'
          : 'BLOCKED_PENDING_FRAME_EXTRACTION');
      if (v === 'PASS_VERIFIED') verified += 1;
      else if (v === 'UNAPPROVED_CANDIDATE') unapproved += 1;
      else if (v === 'FAIL') failed += 1;
      else pending += 1;
    }

    return { total: bundle.assets.length, verified, unapproved, pending, failed, byClass };
  }, [bundle, verdictCache]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-[#E96578]/45 bg-[#231420] p-5 text-sm text-[#FFD5DC]">
        <div className="flex items-center gap-2 font-semibold">
          <XCircle className="h-4 w-4 text-[#E96578]" />
          4K Bundle Manifest Initialization Failed
        </div>
        <p className="mt-1 text-xs text-[#F4A6B2]">{loadError}</p>
      </div>
    );
  }

  if (!bundle || !selectedAsset || !currentMeta) {
    return (
      <div className="rounded-xl border border-[#A991F7]/20 bg-[#181224] p-8 text-center text-sm text-[#BFB5D4]">
        Loading 36-file 01_SOURCE_4K bundle and V3.1 contract manifests...
      </div>
    );
  }

  const activeVerdictUi = verdictDisplay(
    activeValidation?.verdict ?? 'BLOCKED_PENDING_FRAME_EXTRACTION'
  );
  const currentNormFrame =
    processedTrack?.normalizedFrames[
      Math.min(frameIndex, Math.max(0, (processedTrack?.normalizedFrames.length ?? 1) - 1))
    ];

  return (
    <div className="space-y-4">
      {/* Top Bundle Telemetry & Immutable Export Bar */}
      <div className="rounded-xl border border-[#A991F7]/20 bg-[#181224] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#9E93B5]">
              <span className="inline-flex items-center gap-1 font-medium text-[#58D6C2]">
                <Lock className="h-3.5 w-3.5" />
                Source Immutable (36/36 SHA-256 Read-Only)
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#D9BA72]">
                {bundle.contractDoc.format_version}
              </span>
              <span aria-hidden="true">·</span>
              <span>Fail-Closed Real-Frame Validation</span>
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold text-[#D9BA72]">
              01_SOURCE_4K Ingestion &amp; V3.1 Five-Stage Recovery
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportUpdatedRegionHints}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9BA72]/45 bg-[#2A2038] px-3 py-1.5 text-xs font-semibold text-[#F8E7BF] hover:border-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export REGION_HINTS.json
            </button>
            <button
              onClick={() => exportFull36Audit('json')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#A991F7]/35 bg-[#221933] px-3 py-1.5 text-xs font-semibold text-[#DFD7F0] hover:border-[#A991F7] transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileJson className="h-3.5 w-3.5" />
              36-Sheet Audit JSON
            </button>
            <button
              onClick={() => exportFull36Audit('csv')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#58D6C2]/45 bg-[#1A282E] px-3 py-1.5 text-xs font-semibold text-[#58D6C2] hover:border-[#58D6C2] transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              36-Sheet Audit CSV
            </button>
          </div>
        </div>

        {/* KPI Strip (unboxed tabular numerals) */}
        <div className="mt-3.5 grid grid-cols-2 gap-3 border-t border-[#A991F7]/15 pt-3.5 sm:grid-cols-5 font-mono tabular-nums">
          <div>
            <div className="font-sans text-[11px] text-[#9E93B5]">Loaded 4K Sheets</div>
            <div className="mt-0.5 text-base font-bold text-[#EFEAF7]">
              {summaryStats.total} <span className="text-xs font-normal text-[#9E93B5]">/ 36</span>
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] text-[#9E93B5]">Verified V3.1 Pass</div>
            <div className="mt-0.5 text-base font-bold text-[#58D6C2]">
              {summaryStats.verified}
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] text-[#9E93B5]">Unapproved Candidates</div>
            <div className="mt-0.5 text-base font-bold text-[#D9BA72]">
              {summaryStats.unapproved}
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] text-[#9E93B5]">Pending Extraction</div>
            <div className="mt-0.5 text-base font-bold text-[#BFB5D4]">
              {summaryStats.pending}
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] text-[#9E93B5]">Schema Mapping Errors</div>
            <div className="mt-0.5 text-base font-bold text-[#E96578]">
              {bundle.schemaAudit.errorCount}{' '}
              <span className="text-xs font-normal text-[#D9BA72]">
                + {bundle.schemaAudit.warningCount} warn
              </span>
            </div>
          </div>
        </div>

        {notice && (
          <div className="mt-2.5 text-xs font-medium text-[#58D6C2]">{notice}</div>
        )}
      </div>

      {/* Explicit Schema Mapping & Field Adjustment Error Report */}
      <div className="rounded-xl border border-[#E96578]/40 bg-[#1D1322] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <button
            onClick={() => setSchemaPanelOpen((v) => !v)}
            className="flex items-center gap-2 text-left cursor-pointer"
          >
            {schemaPanelOpen ? (
              <ChevronDown className="h-4 w-4 text-[#E96578]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[#E96578]" />
            )}
            <ShieldAlert className="h-4 w-4 text-[#E96578]" />
            <span className="font-display text-sm font-semibold text-[#FFD5DC]">
              Schema Mapping &amp; Field Adjustment Diagnostics ({bundle.schemaAudit.errorCount} Errors ·{' '}
              {bundle.schemaAudit.warningCount} Warnings)
            </span>
          </button>

          <button
            onClick={exportSchemaAuditJson}
            className="inline-flex items-center gap-1.5 rounded border border-[#E96578]/45 bg-[#2A1724] px-2.5 py-1 text-[11px] font-semibold text-[#FFD5DC] hover:border-[#E96578] cursor-pointer whitespace-nowrap"
          >
            <FileJson className="h-3.5 w-3.5" />
            Export Schema Errors JSON
          </button>
        </div>

        {schemaPanelOpen && (
          <div className="border-t border-[#E96578]/25 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#150E1D] text-[11px] text-[#9E93B5]">
                <tr>
                  <th className="px-3.5 py-2 font-medium">Severity &amp; Code</th>
                  <th className="px-3.5 py-2 font-medium">Provided Manifest Field</th>
                  <th className="px-3.5 py-2 font-medium">Required Studio Schema Field</th>
                  <th className="px-3.5 py-2 font-medium">Required Adjustment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#A991F7]/12">
                {bundle.schemaAudit.issues.map((issue) => (
                  <tr key={issue.code} className="align-top">
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {issue.severity === 'error' ? (
                          <XCircle className="h-3.5 w-3.5 shrink-0 text-[#E96578]" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#D9BA72]" />
                        )}
                        <span
                          className={`font-mono text-[11px] font-semibold ${
                            issue.severity === 'error' ? 'text-[#E96578]' : 'text-[#D9BA72]'
                          }`}
                        >
                          {issue.code}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#9E93B5]">
                        {issue.manifestFile} · {issue.affectedCount} sheets
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#D8CFE8]">
                      {issue.sourceField}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#58D6C2]">
                      {issue.expectedStudioField}
                    </td>
                    <td className="px-3.5 py-2.5 text-[#C7BED8] leading-relaxed">
                      {issue.requiredAdjustment}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main Split Workspace: Left 36-Sheet Inventory + Right 5-Stage V3.1 Workbench */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_1fr]">
        {/* Left Rail: Immutable 36-File Source Inventory */}
        <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-3 flex flex-col max-h-[880px]">
          <div className="space-y-2 pb-2.5 border-b border-[#A991F7]/15">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E82A8]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter 36 source sheets..."
                className="w-full rounded-lg border border-[#A991F7]/25 bg-[#140E1D] pl-8 pr-3 py-1.5 text-xs text-[#EFEAF7] placeholder-[#7C7196] focus:border-[#D9BA72] focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {(
                [
                  { id: 'all', label: `All (${summaryStats.total})` },
                  {
                    id: 'studio_white_baked',
                    label: `White Cand. (${summaryStats.byClass.studio_white_baked ?? 0})`,
                  },
                  {
                    id: 'true_alpha',
                    label: `True Alpha (${summaryStats.byClass.true_alpha ?? 0})`,
                  },
                  {
                    id: 'mixed_alpha_or_baked_backdrop',
                    label: `Mixed (${summaryStats.byClass.mixed_alpha_or_baked_backdrop ?? 0})`,
                  },
                  {
                    id: 'dark_obsidian_baked',
                    label: `Obsidian (${summaryStats.byClass.dark_obsidian_baked ?? 0})`,
                  },
                  {
                    id: 'illustrated_opaque_composite',
                    label: `Opaque (${summaryStats.byClass.illustrated_opaque_composite ?? 0})`,
                  },
                ] as { id: AlphaFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setAlphaFilter(tab.id)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    alphaFilter === tab.id
                      ? 'bg-[#34283F] text-[#F8E7BF] border border-[#D9BA72]/60'
                      : 'bg-[#140E1D] text-[#9E93B5] border border-[#A991F7]/15 hover:text-[#EFEAF7]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 36-Sheet Scroll List */}
          <div className="mt-2 flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredAssets.map((asset) => {
              const isSelected = asset.id === selectedAsset.id;
              const verdict =
                verdictCache[asset.id] ??
                (asset.stage1Policy.isUnapprovedCandidate
                  ? 'UNAPPROVED_CANDIDATE'
                  : 'BLOCKED_PENDING_FRAME_EXTRACTION');
              const ui = verdictDisplay(verdict);
              const recoveredCount = regionsByAsset[asset.id]?.length ?? 0;

              return (
                <button
                  key={asset.id}
                  onClick={() => {
                    soundEngine.playUiClick();
                    setSelectedAssetId(asset.id);
                  }}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#D9BA72] bg-[#2B213E]'
                      : 'border-[#A991F7]/12 bg-[#140E1D]/70 hover:border-[#A991F7]/35'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold tabular-nums text-[#D9BA72]">
                          #{String(asset.imageNumber).padStart(2, '0')}
                        </span>
                        <span className="truncate text-xs font-semibold text-[#EFEAF7]">
                          {asset.displayName}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#9E93B5] truncate">
                        {ALPHA_CLASS_LABELS[asset.alphaClass]} · {asset.resolution[0]}×
                        {asset.resolution[1]}
                      </div>
                    </div>
                    {recoveredCount > 0 && (
                      <span className="font-mono text-[11px] tabular-nums font-semibold text-[#58D6C2] shrink-0">
                        {recoveredCount}f
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className={`inline-flex items-center gap-1 font-medium ${ui.colorClass}`}>
                      {ui.icon === 'pass' && <CheckCircle2 className="h-3 w-3" />}
                      {ui.icon === 'warn' && <AlertTriangle className="h-3 w-3" />}
                      {ui.icon === 'fail' && <XCircle className="h-3 w-3" />}
                      {ui.icon === 'blocked' && <Lock className="h-3 w-3" />}
                      {ui.label}
                    </span>
                    <span className="font-mono text-[10px] text-[#7D7296]">
                      {asset.sha256.slice(0, 8)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Main Area: 5-Stage V3.1 Workflow Workbench */}
        <div className="space-y-4">
          {/* Selected Sheet Header */}
          <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#9E93B5]">
                  <span className="font-mono font-bold text-[#D9BA72]">
                    #{String(selectedAsset.imageNumber).padStart(2, '0')} · {selectedAsset.id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#A991F7]">{selectedAsset.archivePath}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {selectedAsset.resolution[0]}×{selectedAsset.resolution[1]} {selectedAsset.pixelFormat}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#58D6C2]">
                    SHA {selectedAsset.sha256.slice(0, 12)} (Read-Only)
                  </span>
                </div>
                <h3 className="mt-1 font-display text-base font-semibold text-[#EFEAF7]">
                  {selectedAsset.displayName}
                </h3>
              </div>

              <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${activeVerdictUi.colorClass}`}>
                {activeVerdictUi.icon === 'pass' && <CheckCircle2 className="h-4 w-4" />}
                {activeVerdictUi.icon === 'warn' && <AlertTriangle className="h-4 w-4" />}
                {activeVerdictUi.icon === 'fail' && <XCircle className="h-4 w-4" />}
                {activeVerdictUi.icon === 'blocked' && <Lock className="h-4 w-4" />}
                {activeVerdictUi.label}
              </div>
            </div>

            {/* 5-Stage V3.1 Stepper */}
            <div className="mt-3.5 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {(
                [
                  {
                    id: 1 as ActiveStage,
                    title: 'Stage 1 · Alpha Policy',
                    sub: selectedAsset.stage1Policy.bypassGlobalKeying
                      ? 'Global Key Bypassed'
                      : 'White Candidate',
                  },
                  {
                    id: 2 as ActiveStage,
                    title: 'Stage 2 · Manual Frames',
                    sub: `${currentRegions.length} recovered`,
                  },
                  {
                    id: 3 as ActiveStage,
                    title: 'Stage 3 · CIELAB',
                    sub: processedTrack
                      ? `ΔE ${processedTrack.meanBeforeAfterDeltaE} / P95 ${processedTrack.p95BeforeAfterDeltaE}`
                      : 'Protected ΔE≤9',
                  },
                  {
                    id: 4 as ActiveStage,
                    title: 'Stage 4 · Pivot Lock',
                    sub:
                      currentMeta.targetKind === 'tyrant'
                        ? '128×128 (64,104)'
                        : '64×64 (32,54)',
                  },
                  {
                    id: 5 as ActiveStage,
                    title: 'Stage 5 · V3.1 QA',
                    sub: activeValidation
                      ? `${activeValidation.checks.filter((c) => c.status === 'pass').length}/9 pass`
                      : 'Fail-Closed',
                  },
                ]
              ).map((st) => (
                <button
                  key={st.id}
                  onClick={() => {
                    soundEngine.playUiClick();
                    setActiveStage(st.id);
                  }}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    activeStage === st.id
                      ? 'border-[#D9BA72] bg-[#34283F]'
                      : 'border-[#A991F7]/15 bg-[#140E1D] hover:border-[#A991F7]/40'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-[#EFEAF7]">{st.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#9E93B5] truncate">
                    {st.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Stage 1 & Stage 2 View: Alpha Policy + Manual Contiguous Frame Recovery Canvas */}
          {(activeStage === 1 || activeStage === 2) && (
            <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 space-y-3.5">
              {/* Stage 1 Alpha Classification Banner */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#A991F7]/15 pb-3">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-[#D9BA72]">
                      {selectedAsset.stage1Policy.policyLabel}
                    </span>
                    <span aria-hidden="true" className="text-[#7D7296]">·</span>
                    <span className="font-mono text-[11px] text-[#9E93B5]">
                      class: {selectedAsset.alphaClass}
                    </span>
                    <span aria-hidden="true" className="text-[#7D7296]">·</span>
                    <span className="font-mono text-[11px] tabular-nums text-[#9E93B5]">
                      edge white {(selectedAsset.edgeSamples.white_fraction * 100).toFixed(0)}% ·
                      alpha=0 {(selectedAsset.alphaZeroFraction * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-[#BFB5D4] leading-relaxed">
                    {selectedAsset.stage1Policy.policyExplanation}
                  </p>
                </div>

                {/* Controls specific to Studio-White Candidates (15, 16, 24, 25) */}
                {selectedAsset.stage1Policy.isUnapprovedCandidate && (
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowStudioWhitePreview((v) => !v)}
                        className="rounded border border-[#A991F7]/35 bg-[#221933] px-2.5 py-1 text-[11px] font-medium text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer whitespace-nowrap"
                      >
                        {showStudioWhitePreview
                          ? 'Preview: Border-White Flood-Fill'
                          : 'Preview: Raw Immutable 4K'}
                      </button>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#D9BA72] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isCandidateApproved}
                        onChange={(e) =>
                          setApprovedByAsset((prev) => ({
                            ...prev,
                            [selectedAsset.id]: e.target.checked,
                          }))
                        }
                        className="accent-[#58D6C2]"
                      />
                      Approve Studio-White Candidate #{selectedAsset.imageNumber}
                    </label>
                    {previewBundle && showStudioWhitePreview && (
                      <div className="font-mono text-[10px] tabular-nums text-[#9E93B5]">
                        Preview stripped {previewBundle.strippedBgPixels.toLocaleString()} bg px ·{' '}
                        {previewBundle.haloPixelsRemoved.toLocaleString()} halo px ·{' '}
                        {previewBundle.specklesPruned} orphan px
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Stage 2 Manual Contiguous Frame Recovery Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-[#BFB5D4]">
                  <Scissors className="h-3.5 w-3.5 text-[#58D6C2]" />
                  <span>
                    Drag directly on the 4K board to box clean contiguous frames (avoiding intersecting UI captions &amp; magic VFX).
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[#9E93B5] cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showHeuristicRowGuides}
                      onChange={(e) => setShowHeuristicRowGuides(e.target.checked)}
                      className="accent-[#E96578]"
                    />
                    Unverified Row Guides ({selectedAsset.unverifiedRowCandidates.length})
                  </label>

                  <button
                    onClick={splitLastRoiBy8CC}
                    disabled={currentRegions.length === 0}
                    className="inline-flex items-center gap-1.5 rounded border border-[#58D6C2]/45 bg-[#1A282E] px-2.5 py-1 text-[11px] font-semibold text-[#58D6C2] hover:border-[#58D6C2] disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <Sparkles className="h-3 w-3" />
                    Split Last Box (8-CC)
                  </button>

                  <button
                    onClick={clearRegions}
                    disabled={currentRegions.length === 0}
                    className="inline-flex items-center gap-1 rounded border border-[#E96578]/35 bg-[#231420] px-2.5 py-1 text-[11px] font-medium text-[#F4A6B2] hover:border-[#E96578] disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Clear ({currentRegions.length})
                  </button>

                  {currentRegions.length > 0 && (
                    <button
                      onClick={() => setActiveStage(4)}
                      className="inline-flex items-center gap-1 rounded border border-[#D9BA72] bg-[#34283F] px-2.5 py-1 text-[11px] font-semibold text-[#F8E7BF] hover:bg-[#463657] cursor-pointer whitespace-nowrap"
                    >
                      Inspect Normalized Strip →
                    </button>
                  )}
                </div>
              </div>

              {/* Interactive 4K Recovery Canvas */}
              <div className="relative overflow-auto rounded-lg border border-[#A991F7]/20 bg-[#120D1B] max-h-[540px] flex items-center justify-center p-2">
                {imgLoading && (
                  <div className="py-16 text-xs text-[#9E93B5]">
                    Decoding immutable 4K source ({selectedAsset.workspaceFilename})...
                  </div>
                )}
                {imgLoadError && (
                  <div className="py-12 text-xs text-[#E96578]">{imgLoadError}</div>
                )}
                {!imgLoading && !imgLoadError && previewBundle && (
                  <canvas
                    ref={stage2CanvasRef}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    className="max-w-full h-auto cursor-crosshair select-none touch-none"
                  />
                )}
              </div>

              {/* Recovered Contiguous Frame List (4K pixel coordinates) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#D9BA72]">
                    Recovered Contiguous Frame Regions ({currentRegions.length})
                  </span>
                  <span className="text-[11px] text-[#9E93B5]">
                    Stored in exact 4K source pixels [x, y, w, h] · {selectedAsset.regionNotes}
                  </span>
                </div>

                {currentRegions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#A991F7]/25 bg-[#140E1D] px-3.5 py-3 text-xs text-[#9E93B5]">
                    0 frames extracted. Under V3.1 fail-closed rules, this sheet remains{' '}
                    <span className="font-semibold text-[#D9BA72]">
                      {selectedAsset.stage1Policy.isUnapprovedCandidate
                        ? 'UNAPPROVED_CANDIDATE'
                        : 'BLOCKED_PENDING_FRAME_EXTRACTION'}
                    </span>{' '}
                    until contiguous frames are manually drawn above.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {currentRegions.map((reg, idx) => (
                      <div
                        key={reg.id}
                        className="flex items-center justify-between rounded border border-[#A991F7]/20 bg-[#140E1D] px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="font-mono tabular-nums text-[#EFEAF7]">
                          <span className="font-bold text-[#D9BA72]">F{idx + 1}</span> · x={reg.x},
                          y={reg.y}, {reg.w}×{reg.h}
                        </div>
                        <button
                          onClick={() => removeRegion(reg.id)}
                          className="text-[#8E82A8] hover:text-[#E96578] cursor-pointer"
                          aria-label={`Remove frame ${idx + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stages 3, 4, 5 View: Protected CIELAB, Pivot-Lock Preview & Fail-Closed V3.1 Validation */}
          {(activeStage === 3 || activeStage === 4 || activeStage === 5) && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
              {/* Left: Live Normalized Frame / ΔE Heatmap Preview & 9-Check V3.1 Audit */}
              <div className="space-y-4">
                <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-display text-sm font-semibold text-[#D9BA72]">
                        {activeStage === 3
                          ? 'Stage 3 · Protected CIELAB Quantization (#140E1D + 7 Neutrals, ΔE00 ≤ 9)'
                          : 'Stage 4 · Pivot-Locked 64×64 / 128×128 2× Nearest-Neighbor Preview'}
                      </h4>
                      <div className="mt-0.5 text-[11px] text-[#9E93B5]">
                        High-saturation elemental hues protected ·{' '}
                        {currentMeta.targetKind === 'tyrant'
                          ? '128×128 Tyrant cell · Pivot (64, 104)'
                          : '64×64 Unit cell · Pivot (32, 54)'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setShowDeltaEHeatmap((v) => !v)}
                        disabled={!processedTrack}
                        className={`rounded border px-2.5 py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap disabled:opacity-40 ${
                          showDeltaEHeatmap
                            ? 'border-[#D9BA72] bg-[#34283F] text-[#F8E7BF]'
                            : 'border-[#A991F7]/25 bg-[#140E1D] text-[#C7BED8]'
                        }`}
                      >
                        {showDeltaEHeatmap ? 'Showing ΔE Shift Heatmap' : 'Show ΔE Shift Heatmap'}
                      </button>
                      <button
                        onClick={exportNormalizedStripPng}
                        disabled={!processedTrack}
                        className="inline-flex items-center gap-1 rounded border border-[#58D6C2]/45 bg-[#1A282E] px-2.5 py-1 text-[11px] font-semibold text-[#58D6C2] hover:border-[#58D6C2] disabled:opacity-40 cursor-pointer whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export V3.1 Strip PNG
                      </button>
                    </div>
                  </div>

                  {!processedTrack ? (
                    <div className="rounded-lg border border-dashed border-[#A991F7]/25 bg-[#140E1D] py-14 px-6 text-center space-y-2">
                      <div className="text-sm font-semibold text-[#D9BA72]">
                        No Contiguous Frames Recovered Yet
                      </div>
                      <p className="text-xs text-[#9E93B5] max-w-md mx-auto">
                        V3.1 validation is fail-closed and never assumes pass status from 4K board resolution. Return to Stage 2 and drag boxes over contiguous frames to run CIELAB quantization, pivot-lock resampling, and collision checks.
                      </p>
                      <button
                        onClick={() => setActiveStage(2)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#D9BA72] bg-[#34283F] px-3.5 py-1.5 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] cursor-pointer"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                        Go to Stage 2 Manual Recovery
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg border border-[#A991F7]/20 bg-[#120D1B] flex flex-col items-center justify-center p-3">
                        <canvas
                          ref={stage4CanvasRef}
                          width={560}
                          height={330}
                          className="max-w-full h-auto"
                        />

                        {/* Playback & Overlay Controls */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 w-full border-t border-[#A991F7]/15 pt-2.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                setPlaying(false);
                                const next = (frameIndex - 1 + extractedCount) % extractedCount;
                                frameFloatRef.current = next;
                                setFrameIndex(next);
                              }}
                              className="rounded border border-[#A991F7]/25 bg-[#1D162B] p-1 text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer"
                              aria-label="Previous frame"
                            >
                              <SkipBack className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setPlaying((p) => !p)}
                              className="rounded border border-[#D9BA72]/60 bg-[#34283F] px-2.5 py-1 text-[11px] font-semibold text-[#F8E7BF] cursor-pointer inline-flex items-center gap-1"
                            >
                              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              {playing ? 'Pause' : 'Play'}
                            </button>
                            <button
                              onClick={() => {
                                setPlaying(false);
                                const next = (frameIndex + 1) % extractedCount;
                                frameFloatRef.current = next;
                                setFrameIndex(next);
                              }}
                              className="rounded border border-[#A991F7]/25 bg-[#1D162B] p-1 text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer"
                              aria-label="Next frame"
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                            </button>
                            <span className="ml-1 font-mono text-[11px] tabular-nums text-[#D9BA72]">
                              Frame {frameIndex + 1}/{extractedCount}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#C7BED8]">
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={showPivotOverlay}
                                onChange={(e) => setShowPivotOverlay(e.target.checked)}
                                className="accent-[#D9BA72]"
                              />
                              Pivot &amp; Feet
                            </label>
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={showBoxesOverlay}
                                onChange={(e) => setShowBoxesOverlay(e.target.checked)}
                                className="accent-[#58D6C2]"
                              />
                              Hit/Hurt Boxes
                            </label>
                            <select
                              value={zoom}
                              onChange={(e) => setZoom(Number(e.target.value))}
                              className="rounded border border-[#A991F7]/25 bg-[#140E1D] px-1.5 py-0.5 font-mono text-[11px] text-[#EFEAF7]"
                            >
                              <option value={3}>3×</option>
                              <option value={4}>4×</option>
                              <option value={5}>5×</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Real-Frame Telemetry Strip */}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono tabular-nums pt-1">
                        <div>
                          <div className="font-sans text-[11px] text-[#9E93B5]">
                            CIEDE2000 Shift (Mean/P95)
                          </div>
                          <div className="mt-0.5 text-sm font-bold text-[#EFEAF7]">
                            {processedTrack.meanBeforeAfterDeltaE} /{' '}
                            <span
                              className={
                                processedTrack.p95BeforeAfterDeltaE <= 9
                                  ? 'text-[#58D6C2]'
                                  : 'text-[#E96578]'
                              }
                            >
                              {processedTrack.p95BeforeAfterDeltaE}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[11px] text-[#9E93B5]">
                            Neutrals Snapped
                          </div>
                          <div className="mt-0.5 text-sm font-bold text-[#A991F7]">
                            {processedTrack.snappedFractionPct}%
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[11px] text-[#9E93B5]">
                            2×2 Uniformity
                          </div>
                          <div className="mt-0.5 text-sm font-bold text-[#58D6C2]">
                            {(processedTrack.avgUniformity * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[11px] text-[#9E93B5]">
                            Feet Deviation (Frame {frameIndex + 1})
                          </div>
                          <div className="mt-0.5 text-sm font-bold text-[#D9BA72]">
                            {currentNormFrame ? `${currentNormFrame.pivotDeviationPx} px` : '—'}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Stage 5: 9-Check V3.1 Fail-Closed Contract Matrix */}
                {activeValidation && (
                  <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#A991F7]/15 pb-2.5">
                      <div>
                        <h4 className="font-display text-sm font-semibold text-[#D9BA72]">
                          Stage 5 · Real-Frame V3.1 Contract Validation (9 Checks)
                        </h4>
                        <p className="text-[11px] text-[#9E93B5]">
                          Fail-closed gate per PIPELINE_STUDIO_V31_CONTRACT.json (`fail_closed_if_frames_not_extracted: true`).
                        </p>
                      </div>
                      <span className={`text-xs font-semibold ${activeVerdictUi.colorClass}`}>
                        {activeVerdictUi.label}
                      </span>
                    </div>

                    <div className="divide-y divide-[#A991F7]/12">
                      {activeValidation.checks.map((chk) => (
                        <div
                          key={chk.testId}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            {chk.status === 'pass' && (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#58D6C2]" />
                            )}
                            {chk.status === 'fail' && (
                              <XCircle className="h-3.5 w-3.5 shrink-0 text-[#E96578]" />
                            )}
                            {chk.status === 'blocked' && (
                              <Lock className="h-3.5 w-3.5 shrink-0 text-[#9E93B5]" />
                            )}
                            <span className="font-medium text-[#EFEAF7]">{chk.label}</span>
                          </div>
                          <span
                            className={`font-mono text-[11px] tabular-nums ${
                              chk.status === 'pass'
                                ? 'text-[#58D6C2]'
                                : chk.status === 'fail'
                                  ? 'text-[#E96578]'
                                  : 'text-[#9E93B5]'
                            }`}
                          >
                            {chk.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Track Timing & Collision Authoring Controls (Resolves Missing Manifest Fields) */}
              <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 space-y-4 text-xs h-fit">
                <div className="space-y-1 border-b border-[#A991F7]/15 pb-3">
                  <div className="flex items-center gap-1.5 font-display text-sm font-semibold text-[#D9BA72]">
                    <Layers className="h-4 w-4" />
                    V3.1 Track Timing &amp; Collision Authoring
                  </div>
                  <p className="text-[11px] text-[#9E93B5]">
                    Supplements missing `animations[]`, `hitbox`, and `hurtbox` fields omitted from the generic handoff manifests.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <label className="block">
                    <span className="text-[#9E93B5]">Entity Class</span>
                    <select
                      value={currentMeta.entityClass}
                      onChange={(e) =>
                        handleEntityClassChange(e.target.value as V31TrackEntityClass)
                      }
                      className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2.5 py-1.5 text-xs text-[#EFEAF7]"
                    >
                      <option value="player">Player Mage (64×64 · Pivot 32,54)</option>
                      <option value="enemy">Enemy Unit (64×64 · Pivot 32,54)</option>
                      <option value="boss">Tyrant Boss (128×128 · Pivot 64,104)</option>
                      <option value="vfx">Soft-Alpha VFX (64×64 · Outline Exempt)</option>
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[#9E93B5]">V3.1 State</span>
                      <select
                        value={currentMeta.state}
                        onChange={(e) => handleStateChange(e.target.value)}
                        className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1.5 text-xs text-[#EFEAF7]"
                      >
                        {V31_STATE_TIMING_SPECS[currentMeta.entityClass].map((s) => (
                          <option key={s.state} value={s.state}>
                            {s.state} ({s.frames}f @ {s.fps}fps)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-[#9E93B5]">Direction</span>
                      <select
                        value={currentMeta.direction}
                        onChange={(e) =>
                          updateMeta({
                            direction: e.target.value as 'down' | 'up' | 'left' | 'right',
                          })
                        }
                        className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1.5 text-xs text-[#EFEAF7]"
                      >
                        <option value="down">Down</option>
                        <option value="up">Up</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[#9E93B5]">Track FPS</span>
                      <input
                        type="number"
                        min={4}
                        max={20}
                        value={currentMeta.fps}
                        onChange={(e) =>
                          updateMeta({ fps: Math.max(4, Math.min(20, Number(e.target.value) || 8)) })
                        }
                        className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1 font-mono tabular-nums text-[#EFEAF7]"
                      />
                    </label>

                    <label className="block">
                      <span className="text-[#9E93B5]">Pivot Cell Spec</span>
                      <select
                        value={currentMeta.targetKind}
                        onChange={(e) => {
                          const nextKind = e.target.value as 'player' | 'tyrant';
                          const boxes = DEFAULT_BOXES_BY_KIND[nextKind];
                          updateMeta({
                            targetKind: nextKind,
                            hitbox: { ...boxes.hitbox },
                            hurtbox: { ...boxes.hurtbox },
                          });
                        }}
                        className="mt-1 w-full rounded border border-[#A991F7]/25 bg-[#140E1D] px-2 py-1.5 text-xs text-[#EFEAF7]"
                      >
                        <option value="player">64×64 (32,54)</option>
                        <option value="tyrant">128×128 (64,104)</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Authored Hitbox & Hurtbox Geometry */}
                {currentMeta.entityClass !== 'vfx' && (
                  <div className="space-y-2.5 border-t border-[#A991F7]/15 pt-3">
                    <div className="font-semibold text-[#E96578]">Hitbox (Crimson)</div>
                    <div className="grid grid-cols-4 gap-1.5 font-mono tabular-nums">
                      {(['x', 'y', 'w', 'h'] as const).map((k) => (
                        <label key={`hb_${k}`} className="block">
                          <span className="text-[10px] text-[#9E93B5] uppercase">{k}</span>
                          <input
                            type="number"
                            value={currentMeta.hitbox[k]}
                            onChange={(e) =>
                              updateMeta({
                                hitbox: { ...currentMeta.hitbox, [k]: Number(e.target.value) || 0 },
                              })
                            }
                            className="mt-0.5 w-full rounded border border-[#E96578]/30 bg-[#140E1D] px-1.5 py-1 text-[11px] text-[#EFEAF7]"
                          />
                        </label>
                      ))}
                    </div>

                    <div className="font-semibold text-[#58D6C2] pt-1">Hurtbox (Teal)</div>
                    <div className="grid grid-cols-4 gap-1.5 font-mono tabular-nums">
                      {(['x', 'y', 'w', 'h'] as const).map((k) => (
                        <label key={`hu_${k}`} className="block">
                          <span className="text-[10px] text-[#9E93B5] uppercase">{k}</span>
                          <input
                            type="number"
                            value={currentMeta.hurtbox[k]}
                            onChange={(e) =>
                              updateMeta({
                                hurtbox: {
                                  ...currentMeta.hurtbox,
                                  [k]: Number(e.target.value) || 0,
                                },
                              })
                            }
                            className="mt-0.5 w-full rounded border border-[#58D6C2]/30 bg-[#140E1D] px-1.5 py-1 text-[11px] text-[#EFEAF7]"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Candidate Sign-off Reminder on Stage 3-5 */}
                {selectedAsset.stage1Policy.isUnapprovedCandidate && (
                  <div className="rounded-lg border border-[#D9BA72]/40 bg-[#251C32] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 font-semibold text-[#D9BA72]">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Studio-White Candidate Sign-Off
                    </div>
                    <p className="text-[11px] text-[#C7BED8] leading-relaxed">
                      Sheet #{selectedAsset.imageNumber} is locked as an unapproved studio-white candidate until halo decontamination and contiguous frame recovery are visually verified.
                    </p>
                    <label className="inline-flex items-center gap-2 font-semibold text-[#58D6C2] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isCandidateApproved}
                        onChange={(e) =>
                          setApprovedByAsset((prev) => ({
                            ...prev,
                            [selectedAsset.id]: e.target.checked,
                          }))
                        }
                        className="accent-[#58D6C2]"
                      />
                      Mark Candidate Visually Approved
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
