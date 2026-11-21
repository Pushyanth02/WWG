import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  FileSpreadsheet,
  FolderArchive,
  Layers,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Swords,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { PRODUCTION_REPORT } from '../data/gameData';
import { drawAtlasTile, getAnimation, spriteRegistry, type LoadedSpriteAsset } from '../game/spriteLoader';
import { exportValidationReportFile, type CsvGranularity } from '../pipeline/reportExport';
import type { AssetManifest, Direction, MasterManifest, ValidationItem, ValidationReport } from '../types/game';
import {
  downloadCanonicalFile,
  exportSingleAssetPack,
  formatBytes,
} from '../utils/assetExporter';
import { AssetExportCenter } from './AssetExportCenter';
import { PipelineStudio } from './PipelineStudio';

interface AssetLabProps {
  manifest: MasterManifest;
  validation: ValidationReport | null;
  initialTab?: 'preview' | 'atlas' | 'validation' | 'pipeline' | 'export';
  onBack: () => void;
  onLaunchDemo: () => void;
}

const CATEGORIES: { id: 'all' | AssetManifest['category']; label: string }[] = [
  { id: 'all', label: 'All (46)' },
  { id: 'mage', label: '6 Mages' },
  { id: 'enemy', label: '13 Enemies' },
  { id: 'boss', label: '5 Tyrants' },
  { id: 'vfx', label: '14 VFX' },
  { id: 'environment', label: '5 Biomes' },
  { id: 'icons', label: 'Icons' },
];

type BgMode = 'checker' | 'grove' | 'crypt' | 'marsh' | 'citadel' | 'abyss' | 'night';

export function AssetLab({ manifest, validation, initialTab = 'preview', onBack, onLaunchDemo }: AssetLabProps) {
  const [category, setCategory] = useState<'all' | AssetManifest['category']>('all');
  const [selectedId, setSelectedId] = useState<string>(manifest.assets[0]?.assetId ?? 'mage_pyromancer');
  const [selectedState, setSelectedState] = useState<string>('idle');
  const [selectedDir, setSelectedDir] = useState<Direction>('down');
  const [playing, setPlaying] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(4);
  const [bgMode, setBgMode] = useState<BgMode>('checker');
  const [showPivot, setShowPivot] = useState<boolean>(true);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [inspectorTab, setInspectorTab] = useState<
    'preview' | 'atlas' | 'validation' | 'pipeline' | 'export'
  >(initialTab);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [qaExportScope, setQaExportScope] = useState<'all' | 'category' | 'selected'>('all');
  const [qaCsvGranularity, setQaCsvGranularity] = useState<CsvGranularity>('track');
  const [qaExportFeedback, setQaExportFeedback] = useState<string | null>(null);
  const [exportingAssetAction, setExportingAssetAction] = useState<'pack' | 'track' | null>(null);
  const [assetExportNotice, setAssetExportNotice] = useState<string | null>(null);

  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameFloatRef = useRef<number>(0);
  const qaFeedbackTimerRef = useRef<number | null>(null);
  const assetNoticeTimerRef = useRef<number | null>(null);

  const filteredAssets = useMemo(() => {
    if (category === 'all') return manifest.assets;
    return manifest.assets.filter((a) => a.category === category);
  }, [manifest.assets, category]);

  const currentAsset = useMemo(
    () => manifest.assets.find((a) => a.assetId === selectedId) ?? manifest.assets[0],
    [manifest.assets, selectedId]
  );

  const availableStates = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const anim of currentAsset.animations) {
      if (!seen.has(anim.state)) {
        seen.add(anim.state);
        list.push(anim.state);
      }
    }
    return list;
  }, [currentAsset]);

  const availableDirs = useMemo(() => {
    const dirs = currentAsset.animations
      .filter((a) => a.state === selectedState)
      .map((a) => a.direction);
    return dirs.length > 0 ? dirs : (['down'] as Direction[]);
  }, [currentAsset, selectedState]);

  useEffect(() => {
    if (!availableStates.includes(selectedState)) {
      setSelectedState(availableStates[0] ?? 'idle');
    }
    frameFloatRef.current = 0;
    setFrameIndex(0);
  }, [currentAsset.assetId, availableStates, selectedState]);

  useEffect(() => {
    if (!availableDirs.includes(selectedDir)) {
      setSelectedDir(availableDirs[0] ?? 'down');
    }
    frameFloatRef.current = 0;
    setFrameIndex(0);
  }, [availableDirs, selectedDir]);

  const activeAnim = useMemo(() => {
    return (
      currentAsset.animations.find((a) => a.state === selectedState && a.direction === selectedDir) ||
      currentAsset.animations.find((a) => a.state === selectedState) ||
      currentAsset.animations[0]
    );
  }, [currentAsset, selectedState, selectedDir]);

  const validationForCurrent = useMemo(
    () => validation?.results.find((r) => r.assetId === currentAsset.assetId) ?? null,
    [validation, currentAsset.assetId]
  );

  const qaExportTargets = useMemo(() => {
    const all = validation?.results ?? [];
    if (qaExportScope === 'selected') {
      return all.filter((r) => r.assetId === currentAsset.assetId);
    }
    if (qaExportScope === 'category' && category !== 'all') {
      return all.filter((r) => r.category === category);
    }
    return all;
  }, [validation, qaExportScope, category, currentAsset.assetId]);

  useEffect(() => {
    return () => {
      if (qaFeedbackTimerRef.current) window.clearTimeout(qaFeedbackTimerRef.current);
      if (assetNoticeTimerRef.current) window.clearTimeout(assetNoticeTimerRef.current);
    };
  }, []);

  const flashAssetNotice = (msg: string) => {
    setAssetExportNotice(msg);
    if (assetNoticeTimerRef.current) window.clearTimeout(assetNoticeTimerRef.current);
    assetNoticeTimerRef.current = window.setTimeout(() => setAssetExportNotice(null), 4000);
  };

  const handleDownloadAssetFile = async (url: string, filename: string, mimeType: string) => {
    soundEngine.playUiClick();
    try {
      const size = await downloadCanonicalFile(url, filename, mimeType);
      flashAssetNotice(`Downloaded ${filename} (${formatBytes(size)}, lossless)`);
    } catch {
      flashAssetNotice(`Failed to download ${filename}`);
    }
  };

  const handleExportCurrentPack = async (onlyActiveTrack: boolean) => {
    if (exportingAssetAction) return;
    soundEngine.playUiClick();
    setExportingAssetAction(onlyActiveTrack ? 'track' : 'pack');
    try {
      const receipt = await exportSingleAssetPack(currentAsset, validationForCurrent, {
        includeEngineAtlas: true,
        includeValidationAudit: true,
        includeSlicedFrames: onlyActiveTrack,
        onlyTrack:
          onlyActiveTrack && activeAnim
            ? { state: activeAnim.state, direction: activeAnim.direction }
            : undefined,
      });
      flashAssetNotice(
        `Exported ${receipt.filename} (${receipt.fileCount} files · ${formatBytes(receipt.totalBytes)} · SHA-256 verified)`
      );
    } catch {
      flashAssetNotice('Export failed — verify asset availability and retry.');
    } finally {
      setExportingAssetAction(null);
    }
  };

  const handleQaExport = (
    format: 'json' | 'csv',
    overrideItems?: ValidationItem[],
    overrideScope?: string
  ) => {
    const items = overrideItems ?? qaExportTargets;
    if (items.length === 0) return;
    soundEngine.playUiClick();

    const scopeLabel =
      overrideScope ??
      (qaExportScope === 'selected'
        ? `sheet_${currentAsset.assetId}`
        : qaExportScope === 'category'
          ? `category_${category}`
          : 'all_sheets');

    exportValidationReportFile(items, format, {
      granularity: qaCsvGranularity,
      reportMeta: validation ?? undefined,
      scopeLabel,
      filenamePrefix: overrideScope ? `archmage_qa_${overrideScope}` : 'archmage_qa_validation',
    });

    setQaExportFeedback(
      `Exported ${items.length} sheet${items.length > 1 ? 's' : ''} as ${
        format === 'json'
          ? 'JSON QA log'
          : `CSV (${qaCsvGranularity === 'track' ? 'per-track' : 'sheet summary'})`
      }`
    );
    if (qaFeedbackTimerRef.current) window.clearTimeout(qaFeedbackTimerRef.current);
    qaFeedbackTimerRef.current = window.setTimeout(() => setQaExportFeedback(null), 3500);
  };

  useEffect(() => {
    if (inspectorTab !== 'preview') return;
    let raf = 0;
    let lastTs = performance.now();

    const drawStage = (now: number) => {
      const dt = Math.min((now - lastTs) / 1000, 0.05);
      lastTs = now;

      if (playing && activeAnim) {
        frameFloatRef.current += dt * activeAnim.fps * speed;
        if (frameFloatRef.current >= activeAnim.frameCount) {
          frameFloatRef.current = frameFloatRef.current % activeAnim.frameCount;
        }
        const nextInt = Math.floor(frameFloatRef.current) % activeAnim.frameCount;
        setFrameIndex((prev) => (prev !== nextInt ? nextInt : prev));
      }

      const canvas = stageCanvasRef.current;
      const loaded: LoadedSpriteAsset | undefined = spriteRegistry.get(currentAsset.assetId);
      if (canvas && loaded && activeAnim) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          if (bgMode === 'night') {
            ctx.fillStyle = '#171321';
            ctx.fillRect(0, 0, w, h);
          } else if (
            bgMode === 'grove' ||
            bgMode === 'crypt' ||
            bgMode === 'marsh' ||
            bgMode === 'citadel' ||
            bgMode === 'abyss'
          ) {
            const tileKey =
              bgMode === 'crypt'
                ? 'tileset_undead_crypt'
                : bgMode === 'marsh'
                  ? 'tileset_blighted_marsh'
                  : bgMode === 'citadel'
                    ? 'tileset_ashen_citadel'
                    : bgMode === 'abyss'
                      ? 'tileset_astral_abyss'
                      : 'tileset_cursed_grove';
            const tiles = spriteRegistry.get(tileKey);
            if (tiles) {
              for (let ty = 0; ty < h; ty += 64) {
                for (let tx = 0; tx < w; tx += 64) {
                  drawAtlasTile(ctx, tiles, ((tx + ty) / 64) % 2 === 0 ? 0 : 1, tx, ty, 1);
                }
              }
            }
          }

          const anim = getAnimation(loaded, activeAnim.state, activeAnim.direction);
          const curFrame = Math.floor(frameFloatRef.current) % anim.frameCount;
          const fw = loaded.manifest.frameWidth;
          const fh = loaded.manifest.frameHeight;
          const effZoom = fw >= 128 ? Math.max(1.5, zoom * 0.6) : zoom;
          const dw = Math.round(fw * effZoom);
          const dh = Math.round(fh * effZoom);
          const dx = Math.round((w - dw) / 2);
          const dy = Math.round((h - dh) / 2);

          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            loaded.image,
            curFrame * fw,
            anim.row * fh,
            fw,
            fh,
            dx,
            dy,
            dw,
            dh
          );

          if (showGrid) {
            ctx.strokeStyle = 'rgba(217, 186, 114, 0.35)';
            ctx.lineWidth = 1;
            ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
          }

          if (showBoxes) {
            ctx.strokeStyle = '#E96578';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(
              Math.round(dx + anim.hitbox.x * effZoom),
              Math.round(dy + anim.hitbox.y * effZoom),
              Math.round(anim.hitbox.w * effZoom),
              Math.round(anim.hitbox.h * effZoom)
            );
            ctx.strokeStyle = '#58D6C2';
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(
              Math.round(dx + anim.hurtbox.x * effZoom),
              Math.round(dy + anim.hurtbox.y * effZoom),
              Math.round(anim.hurtbox.w * effZoom),
              Math.round(anim.hurtbox.h * effZoom)
            );
            ctx.setLineDash([]);
          }

          if (showPivot) {
            const px = Math.round(dx + anim.pivot.x * effZoom);
            const py = Math.round(dy + anim.pivot.y * effZoom);
            ctx.strokeStyle = '#D9BA72';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px - 8, py);
            ctx.lineTo(px + 8, py);
            ctx.moveTo(px, py - 8);
            ctx.lineTo(px, py + 8);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      raf = requestAnimationFrame(drawStage);
    };

    raf = requestAnimationFrame(drawStage);
    return () => cancelAnimationFrame(raf);
  }, [currentAsset.assetId, activeAnim, playing, speed, zoom, bgMode, showPivot, showBoxes, showGrid, inspectorTab]);

  const stepFrame = (delta: number) => {
    if (!activeAnim) return;
    setPlaying(false);
    const next = ((Math.floor(frameFloatRef.current) + delta) % activeAnim.frameCount + activeAnim.frameCount) % activeAnim.frameCount;
    frameFloatRef.current = next;
    setFrameIndex(next);
  };

  const activeEventsOnFrame = useMemo(() => {
    if (!activeAnim) return [];
    return activeAnim.events.filter((ev) => ev.frame === frameIndex);
  }, [activeAnim, frameIndex]);

  return (
    <div className="flex min-h-screen flex-col bg-[#171321] text-[#EFEAF7]">
      <header className="flex items-center justify-between gap-8 border-b border-[#D9BA72]/25 bg-[#1B1528] px-6 py-4">
        <button
          onClick={() => {
            soundEngine.playUiClick();
            onBack();
          }}
          className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-wide text-[#D9BA72] hover:text-[#F7E5B8] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Archmage Asset Lab
        </button>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#B8AEC9]">
          {[
            { id: 'preview' as const, label: 'Inspector' },
            { id: 'atlas' as const, label: 'Sprite Atlas' },
            { id: 'validation' as const, label: 'Validation' },
            { id: 'pipeline' as const, label: 'Pipeline Studio' },
            { id: 'export' as const, label: 'Export Center' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                soundEngine.playUiClick();
                setInspectorTab(t.id);
              }}
              className={`pb-0.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                inspectorTab === t.id
                  ? 'text-[#D9BA72] border-b border-[#D9BA72]'
                  : 'hover:text-[#EFEAF7]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <button
          onClick={() => {
            soundEngine.playUiClick();
            onLaunchDemo();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-[#D9BA72]/70 bg-[#34283F] px-4 py-2 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Swords className="h-3.5 w-3.5" />
          Play Solo Demo
        </button>
      </header>

      <div
        className={`mx-auto grid w-full max-w-[1480px] flex-1 grid-cols-1 gap-6 p-6 ${
          inspectorTab === 'pipeline' || inspectorTab === 'export' ? '' : 'lg:grid-cols-[310px_1fr]'
        }`}
      >
        {/* Left Sidebar (hidden on full-width Pipeline Studio & Export Center tabs) */}
        {inspectorTab !== 'pipeline' && inspectorTab !== 'export' && (
        <aside className="arcane-panel flex flex-col rounded-xl p-4 lg:max-h-[calc(100vh-116px)]">
          <div className="flex flex-wrap gap-1.5 border-b border-[#D9BA72]/20 pb-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  soundEngine.playUiClick();
                  setCategory(cat.id);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  category === cat.id
                    ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/45'
                    : 'bg-[#171321] text-[#A89EC0] hover:text-[#EFEAF7]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-[#9E93B5]">
            <span>{filteredAssets.length} sprite sheets</span>
            {validation && (
              <span className="font-mono tabular-nums text-[#58D6C2]">
                {validation.passedSheets}/{validation.totalSheets} verified
              </span>
            )}
          </div>

          <div className="mt-2.5 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {filteredAssets.map((asset) => {
              const active = asset.assetId === currentAsset.assetId;
              return (
                <button
                  key={asset.assetId}
                  onClick={() => {
                    soundEngine.playUiClick();
                    setSelectedId(asset.assetId);
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[#D9BA72] bg-[#2B213A]'
                      : 'border-[#A991F7]/12 bg-[#1A1426] hover:border-[#A991F7]/35 hover:bg-[#221A32]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold text-[#EFEAF7] truncate">
                      {asset.name}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[#9E93B5] shrink-0">
                      {asset.frameWidth}×{asset.frameHeight}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#A99EC2] truncate">{asset.subtitle}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#8E82A8]">
                    <span>{asset.animations.length} tracks</span>
                    <span aria-hidden="true">·</span>
                    <span className={asset.integratedInDemo ? 'text-[#58D6C2]' : 'text-[#D9BA72]'}>
                      {asset.integratedInDemo ? 'Live in Demo' : 'Asset Ready'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 border-t border-[#D9BA72]/20 pt-3">
            <button
              onClick={() => {
                soundEngine.playUiClick();
                setInspectorTab('export');
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#D9BA72]/50 bg-[#2A203A] px-3 py-2 text-xs font-semibold text-[#F5E4BC] hover:border-[#D9BA72] hover:bg-[#382B4D] transition-colors cursor-pointer whitespace-nowrap"
            >
              <FolderArchive className="h-3.5 w-3.5 text-[#D9BA72]" />
              Export All ({manifest.assets.length} Sheets)
            </button>
          </div>
        </aside>
        )}

        {/* Right Workspace */}
        <main className="arcane-panel flex flex-col rounded-xl p-5 md:p-6">
          {inspectorTab !== 'pipeline' && inspectorTab !== 'export' && (
            <div className="border-b border-[#D9BA72]/20 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#9E93B5]">
                    <span className="font-mono text-[#A991F7]">{currentAsset.assetId}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {currentAsset.frameWidth}×{currentAsset.frameHeight}px frame
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {currentAsset.columns}×{currentAsset.rows} grid
                    </span>
                  </div>
                  <h1 className="mt-1 font-display text-2xl font-bold text-[#D9BA72]">
                    {currentAsset.name}
                  </h1>
                  <p className="mt-0.5 text-sm text-[#BFB5D4]">{currentAsset.subtitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() =>
                      void handleDownloadAssetFile(
                        currentAsset.sheetUrl,
                        `${currentAsset.assetId}.png`,
                        'image/png'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9BA72]/45 bg-[#261D36] px-3 py-2 text-xs font-semibold text-[#F5E4BC] hover:border-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export PNG
                  </button>
                  <button
                    onClick={() =>
                      void handleDownloadAssetFile(
                        currentAsset.manifestUrl,
                        `${currentAsset.assetId}.json`,
                        'application/json'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#A991F7]/35 bg-[#1D162B] px-3 py-2 text-xs font-semibold text-[#DFD7F0] hover:border-[#A991F7] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export JSON
                  </button>
                  {inspectorTab === 'preview' && activeAnim && (
                    <button
                      onClick={() => void handleExportCurrentPack(true)}
                      disabled={exportingAssetAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#58D6C2]/40 bg-[#15252B] px-3 py-2 text-xs font-semibold text-[#9CF0E2] hover:border-[#58D6C2] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
                      title={`Slice and download lossless 2x PNG frames for ${activeAnim.state} (${activeAnim.direction})`}
                    >
                      {exportingAssetAction === 'track' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Layers className="h-3.5 w-3.5" />
                      )}
                      Track Frames (.zip)
                    </button>
                  )}
                  <button
                    onClick={() => void handleExportCurrentPack(false)}
                    disabled={exportingAssetAction !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9BA72] bg-[#34283F] px-3.5 py-2 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
                    title="Download PNG + JSON + Engine Atlas + V3.1 Audit + SHA-256 Integrity Manifest"
                  >
                    {exportingAssetAction === 'pack' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" />
                    )}
                    Export Pack (.zip)
                  </button>
                </div>
              </div>
              {assetExportNotice && (
                <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-[#58D6C2]">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{assetExportNotice}</span>
                </div>
              )}
            </div>
          )}

          {/* Mobile switcher */}
          <div className="mt-4 flex flex-wrap gap-2 md:hidden">
            {(
              [
                { id: 'preview', label: 'Inspector' },
                { id: 'atlas', label: 'Atlas' },
                { id: 'validation', label: 'Validation' },
                { id: 'pipeline', label: 'Pipeline' },
                { id: 'export', label: 'Export' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setInspectorTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                  inspectorTab === t.id ? 'bg-[#34283F] text-[#D9BA72]' : 'bg-[#171321] text-[#A89EC0]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {inspectorTab === 'preview' && activeAnim && (
            <div className="mt-5 grid flex-1 grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
              <div className="flex flex-col gap-4">
                <div
                  className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-[#D9BA72]/25 ${
                    bgMode === 'checker' ? 'checkerboard-bg' : 'bg-[#171321]'
                  }`}
                >
                  <canvas
                    ref={stageCanvasRef}
                    width={520}
                    height={380}
                    className="pixel-art max-h-[380px] w-full max-w-[520px]"
                  />

                  <div className="pointer-events-none absolute top-3 left-3.5 rounded-md bg-[#140E1E]/85 px-2.5 py-1 font-mono text-xs tabular-nums text-[#D9BA72]">
                    Frame {frameIndex + 1} / {activeAnim.frameCount} · {activeAnim.fps} FPS · {activeAnim.loop ? 'Loop' : 'One-shot'}
                  </div>

                  {activeEventsOnFrame.length > 0 && (
                    <div className="pointer-events-none absolute bottom-3 left-3.5 rounded-md border border-[#58D6C2]/50 bg-[#140E1E]/90 px-2.5 py-1 font-mono text-xs text-[#58D6C2]">
                      Event: {activeEventsOnFrame.map((e) => e.name).join(', ')}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#A991F7]/18 bg-[#1A1426] p-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => stepFrame(-1)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#A991F7]/25 bg-[#241B35] text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer"
                      aria-label="Previous frame"
                    >
                      <SkipBack className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPlaying((p) => !p)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D9BA72]/55 bg-[#34283F] px-4 text-xs font-semibold text-[#F6E6BD] hover:bg-[#453554] cursor-pointer whitespace-nowrap"
                    >
                      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {playing ? 'Pause' : 'Play'}
                    </button>
                    <button
                      onClick={() => stepFrame(1)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#A991F7]/25 bg-[#241B35] text-[#EFEAF7] hover:border-[#D9BA72] cursor-pointer"
                      aria-label="Next frame"
                    >
                      <SkipForward className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-[#9E93B5]">Speed</span>
                    <input
                      type="range"
                      min={0.25}
                      max={2}
                      step={0.25}
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                      className="w-28 accent-[#D9BA72]"
                    />
                    <span className="w-10 font-mono tabular-nums text-[#D9BA72]">{speed.toFixed(2)}×</span>
                  </div>

                  <div className="flex items-center gap-1 rounded-lg bg-[#140E1E] p-1">
                    {[2, 3, 4, 6].map((z) => (
                      <button
                        key={z}
                        onClick={() => setZoom(z)}
                        className={`rounded px-2 py-1 font-mono text-xs cursor-pointer ${
                          zoom === z ? 'bg-[#34283F] text-[#D9BA72]' : 'text-[#9E93B5] hover:text-[#EFEAF7]'
                        }`}
                      >
                        {z}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {Array.from({ length: activeAnim.frameCount }).map((_, idx) => {
                    const hasEvent = activeAnim.events.some((ev) => ev.frame === idx);
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setPlaying(false);
                          frameFloatRef.current = idx;
                          setFrameIndex(idx);
                        }}
                        className={`flex h-9 min-w-10 flex-col items-center justify-center rounded-md border font-mono text-xs tabular-nums transition-colors cursor-pointer ${
                          frameIndex === idx
                            ? 'border-[#D9BA72] bg-[#34283F] text-[#F8E7BF]'
                            : 'border-[#A991F7]/20 bg-[#1A1426] text-[#A89EC0] hover:border-[#A991F7]/50'
                        }`}
                      >
                        <span>{idx + 1}</span>
                        {hasEvent && <span className="text-[9px] leading-none text-[#58D6C2]">EV</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#D9BA72]">Animation State</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {availableStates.map((st) => (
                      <button
                        key={st}
                        onClick={() => {
                          soundEngine.playUiClick();
                          setSelectedState(st);
                          frameFloatRef.current = 0;
                          setFrameIndex(0);
                        }}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                          selectedState === st
                            ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/50'
                            : 'bg-[#1A1426] text-[#B5AACB] hover:text-[#EFEAF7] border border-[#A991F7]/15'
                        }`}
                      >
                        {st.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-display text-sm font-semibold text-[#D9BA72]">Direction</h3>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {(['down', 'up', 'left', 'right'] as Direction[]).map((dir) => {
                      const supported = availableDirs.includes(dir);
                      return (
                        <button
                          key={dir}
                          disabled={!supported}
                          onClick={() => {
                            soundEngine.playUiClick();
                            setSelectedDir(dir);
                          }}
                          className={`rounded-md py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                            selectedDir === dir
                              ? 'bg-[#34283F] text-[#58D6C2] border border-[#58D6C2]/50 cursor-pointer'
                              : supported
                                ? 'bg-[#1A1426] text-[#B5AACB] hover:text-[#EFEAF7] border border-[#A991F7]/15 cursor-pointer'
                                : 'bg-[#151020] text-[#574D6D] border border-transparent cursor-not-allowed'
                          }`}
                        >
                          {dir}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="font-display text-sm font-semibold text-[#D9BA72]">Stage &amp; Debug Overlays</h3>
                  <div className="mt-2 grid grid-cols-4 gap-1">
                    {(
                      [
                        { id: 'checker', label: 'Alpha' },
                        { id: 'grove', label: 'Grove' },
                        { id: 'crypt', label: 'Crypt' },
                        { id: 'marsh', label: 'Marsh' },
                        { id: 'citadel', label: 'Citadel' },
                        { id: 'abyss', label: 'Abyss' },
                        { id: 'night', label: 'Night' },
                      ] as const
                    ).map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setBgMode(b.id)}
                        className={`rounded-md py-1.5 text-[11px] font-medium cursor-pointer ${
                          bgMode === b.id
                            ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/45'
                            : 'bg-[#1A1426] text-[#A99EC2] border border-[#A991F7]/15'
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2.5 space-y-1.5 text-xs">
                    {[
                      { label: 'Pivot Crosshair (Gold)', val: showPivot, set: setShowPivot },
                      { label: 'Hitbox (Crimson) & Hurtbox (Teal)', val: showBoxes, set: setShowBoxes },
                      { label: 'Frame Boundary Grid', val: showGrid, set: setShowGrid },
                    ].map((opt) => (
                      <label key={opt.label} className="flex items-center justify-between rounded-md bg-[#1A1426] px-3 py-1.5 cursor-pointer">
                        <span className="text-[#C7BED8]">{opt.label}</span>
                        <input
                          type="checkbox"
                          checked={opt.val}
                          onChange={(e) => opt.set(e.target.checked)}
                          className="accent-[#D9BA72] cursor-pointer"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-[#A991F7]/18 bg-[#181224] p-3.5 text-xs">
                  <div className="font-display font-semibold text-[#D9BA72]">JSON Animation Metadata</div>
                  <dl className="mt-2 space-y-1.5 font-mono tabular-nums">
                    <div className="flex justify-between">
                      <dt className="text-[#9E93B5]">Pivot</dt>
                      <dd className="text-[#EFEAF7]">({activeAnim.pivot.x}, {activeAnim.pivot.y})</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#9E93B5]">Hitbox</dt>
                      <dd className="text-[#E96578]">
                        {activeAnim.hitbox.x},{activeAnim.hitbox.y} · {activeAnim.hitbox.w}×{activeAnim.hitbox.h}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#9E93B5]">Hurtbox</dt>
                      <dd className="text-[#58D6C2]">
                        {activeAnim.hurtbox.x},{activeAnim.hurtbox.y} · {activeAnim.hurtbox.w}×{activeAnim.hurtbox.h}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#9E93B5]">Events</dt>
                      <dd className="text-[#A991F7]">
                        {activeAnim.events.length > 0
                          ? activeAnim.events.map((e) => `f${e.frame + 1}:${e.name}`).join(', ')
                          : 'None'}
                      </dd>
                    </div>
                    {validationForCurrent && (
                      <div className="flex justify-between border-t border-[#A991F7]/15 pt-1.5">
                        <dt className="text-[#9E93B5]">Style Contract</dt>
                        <dd className="text-[#58D6C2]">
                          {validationForCurrent.passed ? 'PASS · 2× · #140E1D' : 'Needs Review'}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>
            </div>
          )}

          {inspectorTab === 'atlas' && (
            <div className="mt-5 flex-1 space-y-4">
              <div className="flex items-center justify-between text-xs text-[#B5AACB]">
                <span>Full Transparent PNG Sprite Sheet ({currentAsset.sheetUrl})</span>
                <span className="font-mono tabular-nums text-[#D9BA72]">
                  {currentAsset.columns * currentAsset.frameWidth} × {currentAsset.rows * currentAsset.frameHeight} px
                </span>
              </div>
              <div className="checkerboard-bg max-h-[560px] overflow-auto rounded-xl border border-[#D9BA72]/25 p-4">
                <img
                  src={currentAsset.sheetUrl}
                  alt={`${currentAsset.name} transparent pixel-art sprite sheet`}
                  referrerPolicy="no-referrer"
                  className="pixel-art mx-auto block"
                />
              </div>
            </div>
          )}

          {inspectorTab === 'validation' && (
            <div className="mt-5 space-y-6 overflow-y-auto">
              {validation && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg border border-[#58D6C2]/30 bg-[#1A1426] p-3.5">
                    <div className="text-xs text-[#9E93B5]">Sheets Passed</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[#58D6C2]">
                      {validation.passedSheets} / {validation.totalSheets}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#A991F7]/25 bg-[#1A1426] p-3.5">
                    <div className="text-xs text-[#9E93B5]">Frames Audited</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[#EFEAF7]">
                      {validation.totalFramesValidated.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#D9BA72]/25 bg-[#1A1426] p-3.5">
                    <div className="text-xs text-[#9E93B5]">Avg Mean ΔE</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[#D9BA72]">
                      {validation.avgMeanDeltaE !== undefined ? validation.avgMeanDeltaE.toFixed(1) : '—'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#D9BA72]/25 bg-[#1A1426] p-3.5">
                    <div className="text-xs text-[#9E93B5]">#140E1D Outline</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[#D9BA72]">
                      {validation.avgOutlineCoverage !== undefined ? `${validation.avgOutlineCoverage}%` : '100%'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#58D6C2]/25 bg-[#1A1426] p-3.5">
                    <div className="text-xs text-[#9E93B5]">Residual Halos</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[#58D6C2]">
                      {validation.totalResidualHaloPixels ?? 0} px
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#A991F7]/25 bg-[#1A1426] p-3.5">
                    <div className="text-xs text-[#9E93B5]">2× Grid / Timing</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[#58D6C2]">
                      {validation.pixelDensity2xPassed ?? validation.passedSheets}/{validation.totalSheets}
                    </div>
                  </div>
                </div>
              )}

              {validation && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D9BA72]/22 bg-[#1A1426] px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-display text-sm font-semibold text-[#D9BA72]">
                        External QA Report Export
                      </span>
                      {qaExportFeedback && (
                        <span className="text-xs font-medium text-[#58D6C2]">
                          {qaExportFeedback}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[#9E93B5]">
                      Download formatted JSON or RFC-4180 CSV frame-by-frame validation logs for external QA review.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={qaExportScope}
                      onChange={(e) =>
                        setQaExportScope(e.target.value as 'all' | 'category' | 'selected')
                      }
                      className="rounded-lg border border-[#A991F7]/25 bg-[#140E1D] px-2.5 py-1.5 text-xs text-[#EFEAF7]"
                      aria-label="QA export scope"
                    >
                      <option value="all">All Sheets ({validation.results.length})</option>
                      <option value="category">
                        Current Filter ({category === 'all' ? validation.results.length : validation.results.filter((r) => r.category === category).length})
                      </option>
                      <option value="selected">Selected Sheet ({currentAsset.name})</option>
                    </select>

                    <select
                      value={qaCsvGranularity}
                      onChange={(e) => setQaCsvGranularity(e.target.value as CsvGranularity)}
                      className="rounded-lg border border-[#A991F7]/25 bg-[#140E1D] px-2.5 py-1.5 text-xs text-[#EFEAF7]"
                      aria-label="CSV detail granularity"
                    >
                      <option value="track">CSV: Per-Track Frame Log</option>
                      <option value="sheet">CSV: Sheet Summary</option>
                    </select>

                    <button
                      onClick={() => handleQaExport('json')}
                      disabled={qaExportTargets.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#A991F7]/35 bg-[#221933] px-3 py-1.5 text-xs font-semibold text-[#DFD7F0] hover:border-[#A991F7] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FileJson className="h-3.5 w-3.5" />
                      Export QA JSON
                    </button>

                    <button
                      onClick={() => handleQaExport('csv')}
                      disabled={qaExportTargets.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#58D6C2]/45 bg-[#1A282E] px-3 py-1.5 text-xs font-semibold text-[#58D6C2] hover:border-[#58D6C2] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Export QA CSV
                    </button>
                  </div>
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-[#D9BA72]">
                    High-Precision Frame-by-Frame &amp; Collision Audit
                  </h3>
                  <span className="text-xs text-[#9E93B5]">
                    Click any asset row to inspect per-track pivot jitter, hurtbox containment, and CIEDE2000 ΔE
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#D9BA72]/20 text-[#9E93B5]">
                        <th className="pb-2 pr-3">Asset</th>
                        <th className="pb-2 pr-3">Grid</th>
                        <th className="pb-2 pr-3">Frames</th>
                        <th className="pb-2 pr-3">Mean ΔE</th>
                        <th className="pb-2 pr-3">Outline %</th>
                        <th className="pb-2 pr-3">Halos</th>
                        <th className="pb-2 pr-3">Pivot Jitter</th>
                        <th className="pb-2 pr-3">Hurtbox Fit</th>
                        <th className="pb-2">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#A991F7]/10 font-mono tabular-nums">
                      {validation?.results.map((r) => {
                        const isExpanded = expandedAuditId === r.assetId;
                        const hasTracks = (r.trackDiagnostics?.length ?? 0) > 0;
                        return (
                          <Fragment key={r.assetId}>
                            <tr
                              onClick={() =>
                                hasTracks && setExpandedAuditId(isExpanded ? null : r.assetId)
                              }
                              className={`text-[#D4CCE6] transition-colors ${
                                hasTracks ? 'cursor-pointer hover:bg-[#221A32]' : ''
                              }`}
                            >
                              <td className="py-2 pr-3 font-sans font-medium text-[#EFEAF7]">
                                <span className="inline-flex items-center gap-1.5">
                                  {hasTracks &&
                                    (isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-[#D9BA72]" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-[#8E82A8]" />
                                    ))}
                                  {r.name}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-[#9E93B5]">{r.sheetDimensions}</td>
                              <td className="py-2 pr-3">
                                {r.nonEmptyFrames}/{r.totalFrames}
                              </td>
                              <td className="py-2 pr-3 text-[#EFEAF7]">
                                {r.meanDeltaE !== undefined ? r.meanDeltaE.toFixed(1) : '—'}
                              </td>
                              <td className="py-2 pr-3 text-[#D9BA72]">
                                {r.category === 'vfx'
                                  ? 'VFX'
                                  : r.outlinePerimeterCoverage !== undefined
                                    ? `${r.outlinePerimeterCoverage}%`
                                    : 'OK'}
                              </td>
                              <td className="py-2 pr-3 text-[#58D6C2]">
                                {r.residualHaloPixels ?? 0}px
                              </td>
                              <td className="py-2 pr-3 text-[#A991F7]">
                                {r.maxPivotJitterPx !== undefined ? `${r.maxPivotJitterPx}px` : '—'}
                              </td>
                              <td className="py-2 pr-3 text-[#58D6C2]">
                                {r.hurtboxContainmentPct !== undefined
                                  ? `${r.hurtboxContainmentPct}%`
                                  : '—'}
                              </td>
                              <td className="py-2">
                                <span className="inline-flex items-center gap-1 text-[#58D6C2]">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {r.passed ? 'Pass' : 'Review'}
                                </span>
                              </td>
                            </tr>
                            {isExpanded && r.trackDiagnostics && (
                              <tr className="bg-[#140E1D]/80">
                                <td colSpan={9} className="p-3">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9E93B5]">
                                    <span className="font-sans font-semibold text-[#D9BA72]">
                                      Per-Track Diagnostic Matrix ({r.trackDiagnostics.length} tracks · P95 ΔE {r.p95DeltaE ?? '—'} · Hitbox Overflow {r.hitboxOverflowPct ?? 0}%)
                                    </span>
                                    <div className="flex flex-wrap items-center gap-3">
                                      <span>2× Uniformity: {r.pixelDensity2xValid !== false ? 'PASS' : 'DRIFT'} · Timing: {r.timingContractValid !== false ? 'PASS' : 'MISMATCH'}</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQaExport('json', [r], r.assetId);
                                        }}
                                        className="inline-flex items-center gap-1 font-sans font-medium text-[#A991F7] hover:text-[#E8D6FF] cursor-pointer"
                                      >
                                        <FileJson className="h-3 w-3" />
                                        Sheet JSON
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQaExport('csv', [r], r.assetId);
                                        }}
                                        className="inline-flex items-center gap-1 font-sans font-medium text-[#58D6C2] hover:text-[#9CF0E2] cursor-pointer"
                                      >
                                        <FileSpreadsheet className="h-3 w-3" />
                                        Sheet CSV
                                      </button>
                                    </div>
                                  </div>
                                  <div className="max-h-56 overflow-y-auto">
                                    <table className="w-full text-left text-[11px]">
                                      <thead>
                                        <tr className="border-b border-[#A991F7]/15 text-[#8E82A8]">
                                          <th className="pb-1.5 pr-3">State</th>
                                          <th className="pb-1.5 pr-3">Dir</th>
                                          <th className="pb-1.5 pr-3">Frames @ FPS</th>
                                          <th className="pb-1.5 pr-3">Pivot Jitter</th>
                                          <th className="pb-1.5 pr-3">Hurtbox Fit</th>
                                          <th className="pb-1.5 pr-3">Overflow</th>
                                          <th className="pb-1.5 pr-3">Mean ΔE</th>
                                          <th className="pb-1.5">Outline %</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#A991F7]/10 text-[#C7BED8]">
                                        {r.trackDiagnostics.map((td) => (
                                          <tr key={`${td.row}-${td.state}-${td.direction}`}>
                                            <td className="py-1 pr-3 font-sans capitalize text-[#EFEAF7]">
                                              {td.state.replace('_', ' ')}
                                            </td>
                                            <td className="py-1 pr-3 capitalize">{td.direction}</td>
                                            <td className="py-1 pr-3">
                                              {td.frameCount}f @ {td.fps}
                                            </td>
                                            <td className="py-1 pr-3 text-[#A991F7]">
                                              {td.maxPivotJitterPx}px
                                            </td>
                                            <td className="py-1 pr-3 text-[#58D6C2]">
                                              {td.hurtboxContainmentPct}%
                                            </td>
                                            <td className="py-1 pr-3 text-[#D9BA72]">
                                              {td.hitboxOverflowPct}%
                                            </td>
                                            <td className="py-1 pr-3">{td.meanDeltaE}</td>
                                            <td className="py-1 text-[#D9BA72]">
                                              {td.outlinePerimeterCoverage}%
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="font-display text-base font-semibold text-[#D9BA72]">
                  Full Production Roster Coverage
                </h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#D9BA72]/20 text-[#9E93B5]">
                        <th className="pb-2 pr-3">Batch</th>
                        <th className="pb-2 pr-3">Target</th>
                        <th className="pb-2 pr-3">Generated</th>
                        <th className="pb-2 pr-3">Integrated</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#A991F7]/10">
                      {PRODUCTION_REPORT.map((row) => (
                        <tr key={row.category} className="text-[#D4CCE6]">
                          <td className="py-2.5 pr-3 font-medium text-[#EFEAF7]">{row.category}</td>
                          <td className="py-2.5 pr-3 font-mono tabular-nums">{row.target}</td>
                          <td className="py-2.5 pr-3 font-mono text-[#58D6C2]">{row.generated}</td>
                          <td className="py-2.5 pr-3">{row.integrated}</td>
                          <td className="py-2.5 text-[#D9BA72]">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {inspectorTab === 'pipeline' && <PipelineStudio />}

          {inspectorTab === 'export' && (
            <AssetExportCenter
              manifest={manifest}
              validation={validation}
              onInspectAsset={(assetId) => {
                setSelectedId(assetId);
                setInspectorTab('preview');
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
