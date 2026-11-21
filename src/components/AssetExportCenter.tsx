import {
  Archive,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FolderArchive,
  Image as ImageIcon,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { spriteRegistry } from '../game/spriteLoader';
import type { AssetManifest, MasterManifest, ValidationItem, ValidationReport } from '../types/game';
import {
  downloadCanonicalFile,
  exportLibraryArchive,
  exportSingleAssetPack,
  formatBytes,
  type ExportProgress,
  type ExportReceipt,
} from '../utils/assetExporter';

interface AssetExportCenterProps {
  manifest: MasterManifest;
  validation: ValidationReport | null;
  onInspectAsset: (assetId: string) => void;
}

const CATEGORY_FILTERS: { id: 'all' | AssetManifest['category']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mage', label: 'Mages' },
  { id: 'enemy', label: 'Enemies' },
  { id: 'boss', label: 'Tyrants' },
  { id: 'vfx', label: 'Spells & VFX' },
  { id: 'environment', label: 'Biomes' },
  { id: 'icons', label: 'Icons & Relics' },
];

const SOURCE_LABELS: Record<string, string> = {
  'image_050e7303.png': 'Tyrants & Dark Enemies Atlas (4K)',
  'image_287c1c89.png': 'Archmage Blue Mage Effects Sheet (4K)',
  'image_30cd6dea.png': 'Archmage Combat Sheet (4K)',
  'image_5f9076f6.png': 'Blighted Marsh & Crypt Tilesets (4K)',
  'image_743550f4.png': 'Vertical Slice Characters & Bosses (4K)',
  'image_7c0891e3.png': 'Skeleton & Undead Roster Sheet (4K)',
  'image_891f543c.png': 'Icons, Portraits & Relics Sheet (4K)',
  'image_abe57f87.png': 'Blue Mage 4-Dir & States Sheet (4K)',
  'image_d7db875b.png': 'Blue Mage Master Reference Sheet (4K)',
  'image_dfe3c9c6.png': 'Spell & Barrier VFX Reference (4K)',
  'image_e5369a8c.png': 'Elemental Magic & Biome Atlas (4K)',
  'image_fccd2ef6.png': 'Blue Mage Core Animation Grid (4K)',
};

function AssetThumbnail({ asset }: { asset: AssetManifest }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const loaded = spriteRegistry.get(asset.assetId);
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const firstAnim = asset.animations[0];
    const row = firstAnim?.row ?? 0;
    const sw = asset.frameWidth;
    const sh = asset.frameHeight;
    const scale = Math.min(canvas.width / sw, canvas.height / sh);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const dx = Math.round((canvas.width - dw) / 2);
    const dy = Math.round((canvas.height - dh) / 2);

    ctx.drawImage(loaded.image, 0, row * sh, sw, sh, dx, dy, dw, dh);
  }, [asset]);

  return (
    <canvas
      ref={canvasRef}
      width={36}
      height={36}
      className="pixel-art h-9 w-9 shrink-0 rounded border border-[#A991F7]/20 bg-[#140E1D]"
    />
  );
}

function countAssetFrames(asset: AssetManifest): number {
  return asset.animations.reduce((sum, anim) => sum + anim.frameCount, 0);
}

export function AssetExportCenter({
  manifest,
  validation,
  onInspectAsset,
}: AssetExportCenterProps) {
  const [category, setCategory] = useState<'all' | AssetManifest['category']>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(manifest.assets.map((a) => a.assetId))
  );

  // Archive inclusion options
  const [includeManifests, setIncludeManifests] = useState<boolean>(true);
  const [includeEngineAtlases, setIncludeEngineAtlases] = useState<boolean>(true);
  const [includeValidationReport, setIncludeValidationReport] = useState<boolean>(true);
  const [includeRawSources, setIncludeRawSources] = useState<boolean>(false);
  const [includeSlicedFrames, setIncludeSlicedFrames] = useState<boolean>(false);

  // Runtime export state
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ExportReceipt | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const [showSourcesPanel, setShowSourcesPanel] = useState<boolean>(false);

  const validationById = useMemo(() => {
    const map = new Map<string, ValidationItem>();
    for (const item of validation?.results ?? []) {
      map.set(item.assetId, item);
    }
    return map;
  }, [validation]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: manifest.assets.length };
    for (const a of manifest.assets) {
      counts[a.category] = (counts[a.category] ?? 0) + 1;
    }
    return counts;
  }, [manifest.assets]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return manifest.assets.filter((asset) => {
      if (category !== 'all' && asset.category !== category) return false;
      if (!q) return true;
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.assetId.toLowerCase().includes(q) ||
        asset.subtitle.toLowerCase().includes(q)
      );
    });
  }, [manifest.assets, category, searchQuery]);

  const selectedAssets = useMemo(
    () => manifest.assets.filter((a) => selectedIds.has(a.assetId)),
    [manifest.assets, selectedIds]
  );

  const selectedFrameTotal = useMemo(
    () => selectedAssets.reduce((sum, a) => sum + countAssetFrames(a), 0),
    [selectedAssets]
  );

  const selectedTrackTotal = useMemo(
    () => selectedAssets.reduce((sum, a) => sum + a.animations.length, 0),
    [selectedAssets]
  );

  const rawSourceSheets = manifest.sourceSheetsUsed ?? [];
  const totalFramesAll = useMemo(
    () => manifest.assets.reduce((sum, a) => sum + countAssetFrames(a), 0),
    [manifest.assets]
  );

  const toggleAsset = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const selectAll = () => {
    soundEngine.playUiClick();
    setSelectedIds(new Set(manifest.assets.map((a) => a.assetId)));
  };

  const selectFiltered = () => {
    soundEngine.playUiClick();
    setSelectedIds(new Set(filteredAssets.map((a) => a.assetId)));
  };

  const clearSelection = () => {
    soundEngine.playUiClick();
    setSelectedIds(new Set());
  };

  const runExportTask = async (
    taskId: string,
    fn: () => Promise<ExportReceipt>
  ) => {
    if (busyAction) return;
    soundEngine.playUiClick();
    setBusyAction(taskId);
    setErrorMessage(null);
    setInlineMessage(null);
    setProgress({ phase: 'fetching', completed: 0, total: 1, currentFile: 'Initializing...' });
    try {
      const receipt = await fn();
      setLastReceipt(receipt);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Export failed unexpectedly.');
    } finally {
      setBusyAction(null);
      setProgress(null);
    }
  };

  const handleExportFullLibrary = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    void runExportTask('full_library', () =>
      exportLibraryArchive({
        manifest,
        validation,
        assets: manifest.assets,
        archiveName: `archmage_v31_full_library_${stamp}.zip`,
        includeProcessedSheets: true,
        includeManifests: true,
        includeValidationReport: true,
        includeEngineAtlases: true,
        includeRawSources: false,
        includeSlicedFrames: false,
        onProgress: setProgress,
      })
    );
  };

  const handleExportRawSources = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    void runExportTask('raw_sources', () =>
      exportLibraryArchive({
        manifest,
        validation,
        assets: [],
        archiveName: `archmage_4k_source_sheets_${stamp}.zip`,
        includeProcessedSheets: false,
        includeManifests: false,
        includeValidationReport: true,
        includeEngineAtlases: false,
        includeRawSources: true,
        includeSlicedFrames: false,
        onProgress: setProgress,
      })
    );
  };

  const handleExportCustomPack = () => {
    if (selectedAssets.length === 0 && !includeRawSources) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeSlug =
      selectedAssets.length === manifest.assets.length
        ? 'full'
        : category !== 'all' && selectedAssets.length === filteredAssets.length
          ? category
          : `custom_${selectedAssets.length}sheets`;

    void runExportTask('custom_pack', () =>
      exportLibraryArchive({
        manifest,
        validation,
        assets: selectedAssets,
        archiveName: `archmage_v31_${scopeSlug}_${stamp}.zip`,
        includeProcessedSheets: selectedAssets.length > 0,
        includeManifests,
        includeValidationReport,
        includeEngineAtlases,
        includeRawSources,
        includeSlicedFrames,
        onProgress: setProgress,
      })
    );
  };

  const handleExportSingleZip = (asset: AssetManifest) => {
    void runExportTask(`single_${asset.assetId}`, () =>
      exportSingleAssetPack(asset, validationById.get(asset.assetId) ?? null, {
        includeEngineAtlas: true,
        includeValidationAudit: true,
        includeSlicedFrames: false,
        onProgress: setProgress,
      })
    );
  };

  const handleDirectFile = async (url: string, filename: string, mimeType: string) => {
    soundEngine.playUiClick();
    setErrorMessage(null);
    try {
      const size = await downloadCanonicalFile(url, filename, mimeType);
      setInlineMessage(`Downloaded ${filename} (${formatBytes(size)}, lossless canonical file)`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : `Failed to download ${filename}`);
    }
  };

  const progressPct = progress
    ? Math.min(100, Math.round((progress.completed / Math.max(1, progress.total)) * 100))
    : 0;

  return (
    <div className="space-y-5">
      {/* Top Studio Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D9BA72]/20 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#9E93B5]">
            <span className="font-mono text-[#A991F7]">
              {manifest.sourcePipeline ?? 'v3.1-cielab-contour-pivot-pipeline'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[#58D6C2]">
              {validation ? `${validation.passedSheets}/${validation.totalSheets}` : manifest.assetCount} V3.1 verified
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {totalFramesAll.toLocaleString()} frames · {rawSourceSheets.length} raw 4K sheets
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#D9BA72]">
            Asset Export &amp; Archive Center
          </h1>
          <p className="mt-0.5 text-sm text-[#BFB5D4]">
            Download lossless, byte-exact V3.1 sprite sheets, JSON manifests, engine-ready atlases, and original 4K source sheets packaged with SHA-256 verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportFullLibrary}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-[#D9BA72] bg-[#34283F] px-4 py-2 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {busyAction === 'full_library' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderArchive className="h-3.5 w-3.5" />
            )}
            Download Full Library (.zip)
          </button>
          <button
            onClick={handleExportRawSources}
            disabled={busyAction !== null || rawSourceSheets.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-[#A991F7]/40 bg-[#221933] px-3.5 py-2 text-xs font-semibold text-[#E8D6FF] hover:border-[#A991F7] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {busyAction === 'raw_sources' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            Download {rawSourceSheets.length} Raw 4K Sources (.zip)
          </button>
        </div>
      </div>

      {/* Live Progress Banner */}
      {progress && (
        <div className="rounded-xl border border-[#D9BA72]/40 bg-[#181224] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-[#F5E4BC]">
              {progress.phase === 'fetching' && 'Reading lossless canonical assets'}
              {progress.phase === 'slicing' && 'Slicing nearest-neighbor 2× PNG frames'}
              {progress.phase === 'hashing' && 'Computing SHA-256 & verifying PNG IHDR parity'}
              {progress.phase === 'packaging' && 'Writing PKZIP 2.0 STORE archive'}
            </span>
            <span className="font-mono tabular-nums text-[#58D6C2]">
              {progress.completed}/{progress.total} ({progressPct}%)
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#120D1A]">
            <div
              className="h-full bg-[#D9BA72] transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1.5 truncate font-mono text-[11px] text-[#9E93B5]">
            {progress.currentFile}
          </div>
        </div>
      )}

      {/* Error or Direct-File Status */}
      {errorMessage && (
        <div className="rounded-lg border border-[#E96578]/45 bg-[#2A1420] px-4 py-2.5 text-xs text-[#F9B4BE]">
          {errorMessage}
        </div>
      )}
      {inlineMessage && !progress && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#58D6C2]/35 bg-[#142329] px-4 py-2 text-xs text-[#9CF0E2]">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#58D6C2]" />
            {inlineMessage}
          </span>
          <button
            onClick={() => setInlineMessage(null)}
            className="text-[11px] text-[#9E93B5] hover:text-[#EFEAF7] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Post-Export Integrity Receipt */}
      {lastReceipt && !progress && (
        <div className="rounded-xl border border-[#58D6C2]/35 bg-[#161D26] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#58D6C2]/15 pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#58D6C2]" />
              <span className="font-display text-sm font-semibold text-[#EFEAF7]">
                Archive Verified &amp; Downloaded: <span className="font-mono text-[#58D6C2]">{lastReceipt.filename}</span>
              </span>
            </div>
            <span className="font-mono text-xs tabular-nums text-[#9E93B5]">
              {formatBytes(lastReceipt.totalBytes)} · {lastReceipt.elapsedMs} ms
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs tabular-nums">
            <div>
              <div className="font-sans text-[11px] text-[#9E93B5]">Packaged Files</div>
              <div className="mt-0.5 font-semibold text-[#EFEAF7]">
                {lastReceipt.fileCount} files ({lastReceipt.sheetCount} sheets{lastReceipt.rawSourceCount > 0 ? ` + ${lastReceipt.rawSourceCount} raw` : ''})
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#9E93B5]">PNG IHDR Parity</div>
              <div className="mt-0.5 font-semibold text-[#58D6C2]">
                {lastReceipt.verifiedPngCount} PNGs verified (STORE)
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#9E93B5]">V3.1 Contract</div>
              <div className="mt-0.5 font-semibold text-[#D9BA72]">
                {lastReceipt.sheetCount > 0
                  ? `${lastReceipt.v31PassedCount}/${lastReceipt.sheetCount} passed`
                  : '4K Source Archive'}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#9E93B5]">Manifest SHA-256</div>
              <div className="mt-0.5 truncate font-semibold text-[#A991F7]" title={lastReceipt.sha256ManifestHash}>
                {lastReceipt.sha256ManifestHash.slice(0, 16)}…
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main 2-Column Export Workspace */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        {/* Left: High-Density Asset Selection Table */}
        <div className="flex flex-col rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4">
          {/* Category Filter + Search Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#A991F7]/15 pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORY_FILTERS.map((cat) => {
                const active = category === cat.id;
                const count = categoryCounts[cat.id] ?? 0;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      soundEngine.playUiClick();
                      setCategory(cat.id);
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'border border-[#D9BA72]/50 bg-[#34283F] text-[#D9BA72]'
                        : 'border border-transparent bg-[#140E1D] text-[#A89EC0] hover:text-[#EFEAF7]'
                    }`}
                  >
                    {cat.label} <span className="font-mono text-[11px] tabular-nums opacity-75">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#8E82A8]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by name or ID..."
                className="w-full rounded-md border border-[#A991F7]/25 bg-[#140E1D] py-1.5 pr-3 pl-8 text-xs text-[#EFEAF7] placeholder-[#7B6F96] focus:border-[#D9BA72] focus:outline-none"
              />
            </div>
          </div>

          {/* Selection Action Bar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#9E93B5]">
            <span className="font-mono tabular-nums">
              Showing {filteredAssets.length} of {manifest.assets.length} sheets ·{' '}
              <span className="text-[#D9BA72]">{selectedAssets.length} selected</span>
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={selectFiltered}
                className="font-medium text-[#A991F7] hover:text-[#E8D6FF] cursor-pointer whitespace-nowrap"
              >
                Select Filtered
              </button>
              <button
                onClick={selectAll}
                className="font-medium text-[#D9BA72] hover:text-[#F8E7BF] cursor-pointer whitespace-nowrap"
              >
                Select All (30)
              </button>
              <button
                onClick={clearSelection}
                className="font-medium text-[#9E93B5] hover:text-[#EFEAF7] cursor-pointer whitespace-nowrap"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Data Table */}
          {filteredAssets.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-[#A991F7]/20 py-10 text-center">
              <p className="text-sm font-medium text-[#EFEAF7]">No sprite sheets match your filter.</p>
              <p className="mt-1 text-xs text-[#9E93B5]">
                Clear the search query or switch back to All categories to view all 30 integrated sheets.
              </p>
              <button
                onClick={() => {
                  setCategory('all');
                  setSearchQuery('');
                }}
                className="mt-3 rounded-md border border-[#D9BA72]/45 bg-[#2A213A] px-3 py-1.5 text-xs font-semibold text-[#F5E4BC] hover:border-[#D9BA72] cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="mt-3 max-h-[540px] overflow-x-auto overflow-y-auto pr-1">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[#181224]">
                  <tr className="border-b border-[#D9BA72]/20 text-[#9E93B5]">
                    <th className="w-8 py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Toggle all visible sheets"
                        checked={
                          filteredAssets.length > 0 &&
                          filteredAssets.every((a) => selectedIds.has(a.assetId))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              filteredAssets.forEach((a) => next.add(a.assetId));
                              return next;
                            });
                          } else {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              filteredAssets.forEach((a) => next.delete(a.assetId));
                              return next;
                            });
                          }
                        }}
                        className="accent-[#D9BA72] cursor-pointer"
                      />
                    </th>
                    <th className="py-2 pr-3">Sprite Sheet</th>
                    <th className="py-2 pr-3">Grid &amp; Frames</th>
                    <th className="py-2 pr-3">V3.1 Audit</th>
                    <th className="py-2 text-right">Direct Export</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#A991F7]/10">
                  {filteredAssets.map((asset) => {
                    const checked = selectedIds.has(asset.assetId);
                    const val = validationById.get(asset.assetId);
                    const frames = countAssetFrames(asset);
                    const sheetW = asset.columns * asset.frameWidth;
                    const sheetH = asset.rows * asset.frameHeight;
                    const rowBusy = busyAction === `single_${asset.assetId}`;

                    return (
                      <tr
                        key={asset.assetId}
                        className={`transition-colors ${
                          checked ? 'bg-[#221A32]/65' : 'hover:bg-[#1E172C]'
                        }`}
                      >
                        <td className="py-2 pr-2 align-middle">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAsset(asset.assetId)}
                            aria-label={`Select ${asset.name}`}
                            className="accent-[#D9BA72] cursor-pointer"
                          />
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <div className="flex items-center gap-2.5">
                            <AssetThumbnail asset={asset} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => {
                                    soundEngine.playUiClick();
                                    onInspectAsset(asset.assetId);
                                  }}
                                  className="truncate font-display text-sm font-semibold text-[#EFEAF7] hover:text-[#D9BA72] cursor-pointer"
                                  title="Inspect sheet in Animation Inspector"
                                >
                                  {asset.name}
                                </button>
                                <ExternalLink className="h-3 w-3 shrink-0 text-[#7B6F96]" />
                              </div>
                              <div className="truncate font-mono text-[11px] text-[#9E93B5]">
                                {asset.assetId} · {asset.frameWidth}×{asset.frameHeight}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-middle font-mono tabular-nums text-[#C7BED8] whitespace-nowrap">
                          <div>{sheetW}×{sheetH}px</div>
                          <div className="text-[11px] text-[#8E82A8]">
                            {asset.animations.length} tracks · {frames}f
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-middle font-mono tabular-nums whitespace-nowrap">
                          <div className="inline-flex items-center gap-1 text-[#58D6C2]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{val?.passed === false ? 'Review' : 'Pass · 2×'}</span>
                          </div>
                          {val && (
                            <div className="text-[11px] text-[#9E93B5]">
                              {val.meanDeltaE !== undefined ? `ΔE ${val.meanDeltaE.toFixed(1)}` : 'V3.1'} ·{' '}
                              {val.residualHaloPixels ?? 0}px halo
                            </div>
                          )}
                        </td>
                        <td className="py-2 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                void handleDirectFile(
                                  asset.sheetUrl,
                                  `${asset.assetId}.png`,
                                  'image/png'
                                )
                              }
                              className="rounded border border-[#D9BA72]/35 bg-[#261D36] px-2 py-1 font-mono text-[11px] font-medium text-[#F5E4BC] hover:border-[#D9BA72] cursor-pointer"
                              title={`Download canonical ${asset.assetId}.png`}
                            >
                              PNG
                            </button>
                            <button
                              onClick={() =>
                                void handleDirectFile(
                                  asset.manifestUrl,
                                  `${asset.assetId}.json`,
                                  'application/json'
                                )
                              }
                              className="rounded border border-[#A991F7]/30 bg-[#1D162B] px-2 py-1 font-mono text-[11px] font-medium text-[#DFD7F0] hover:border-[#A991F7] cursor-pointer"
                              title={`Download V3.1 manifest ${asset.assetId}.json`}
                            >
                              JSON
                            </button>
                            <button
                              onClick={() => handleExportSingleZip(asset)}
                              disabled={busyAction !== null}
                              className="inline-flex items-center gap-1 rounded border border-[#58D6C2]/40 bg-[#15252B] px-2 py-1 font-mono text-[11px] font-medium text-[#9CF0E2] hover:border-[#58D6C2] disabled:opacity-45 cursor-pointer"
                              title={`Download ${asset.assetId}_v31_pack.zip (PNG + JSON + Atlas + Audit + SHA-256)`}
                            >
                              {rowBusy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Archive className="h-3 w-3" />
                              )}
                              ZIP
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Custom Archive Builder & Provenance Panel */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 space-y-4">
            <div className="border-b border-[#A991F7]/15 pb-3">
              <h2 className="font-display text-sm font-semibold text-[#D9BA72]">
                Custom Archive Builder
              </h2>
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono tabular-nums">
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">Sheets</div>
                  <div className="text-sm font-bold text-[#EFEAF7]">
                    {selectedAssets.length}/{manifest.assets.length}
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">Tracks</div>
                  <div className="text-sm font-bold text-[#D9BA72]">{selectedTrackTotal}</div>
                </div>
                <div>
                  <div className="font-sans text-[11px] text-[#9E93B5]">Frames</div>
                  <div className="text-sm font-bold text-[#58D6C2]">
                    {selectedFrameTotal.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-2 text-[#EFEAF7]">
                <div>
                  <div className="font-medium">Canonical V3.1 Sprite Sheets</div>
                  <div className="text-[11px] text-[#8E82A8]">
                    sprites/*.png · Byte-exact 2× pixel density
                  </div>
                </div>
                <span className="font-mono text-[11px] text-[#58D6C2]">Included</span>
              </div>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-[#D4CCE6]">V3.1 JSON Manifests</div>
                  <div className="text-[11px] text-[#8E82A8]">
                    sprites/*.json + master manifest.json
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeManifests}
                  onChange={(e) => setIncludeManifests(e.target.checked)}
                  className="mt-0.5 accent-[#D9BA72]"
                />
              </label>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-[#D4CCE6]">Engine-Ready Atlas Metadata</div>
                  <div className="text-[11px] text-[#8E82A8]">
                    atlases/*.atlas.json (frame rects, pivots, boxes)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeEngineAtlases}
                  onChange={(e) => setIncludeEngineAtlases(e.target.checked)}
                  className="mt-0.5 accent-[#D9BA72]"
                />
              </label>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-[#D4CCE6]">Validation &amp; Collision Audit</div>
                  <div className="text-[11px] text-[#8E82A8]">
                    validation/validation-report.json
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeValidationReport}
                  onChange={(e) => setIncludeValidationReport(e.target.checked)}
                  className="mt-0.5 accent-[#D9BA72]"
                />
              </label>

              <label className="flex items-start justify-between gap-2 border-t border-[#A991F7]/15 pt-2.5 cursor-pointer">
                <div>
                  <div className="font-medium text-[#D4CCE6]">
                    All {rawSourceSheets.length} Raw 4K Source Sheets
                  </div>
                  <div className="text-[11px] text-[#8E82A8]">
                    sources/*.png · Original high-res source art
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeRawSources}
                  onChange={(e) => setIncludeRawSources(e.target.checked)}
                  className="mt-0.5 accent-[#D9BA72]"
                />
              </label>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-[#D4CCE6]">Lossless Sliced Individual Frames</div>
                  <div className="text-[11px] text-[#8E82A8]">
                    frames/&lt;id&gt;/*.png ({selectedFrameTotal.toLocaleString()} PNGs)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeSlicedFrames}
                  onChange={(e) => setIncludeSlicedFrames(e.target.checked)}
                  className="mt-0.5 accent-[#D9BA72]"
                />
              </label>
            </div>

            {includeSlicedFrames && selectedFrameTotal > 400 && (
              <p className="text-[11px] leading-relaxed text-[#D9BA72]">
                Slicing {selectedFrameTotal.toLocaleString()} individual PNG frames in-browser may take 10–25 seconds. Keep this tab active until the download starts.
              </p>
            )}

            <button
              onClick={handleExportCustomPack}
              disabled={busyAction !== null || (selectedAssets.length === 0 && !includeRawSources)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#D9BA72] bg-[#34283F] px-4 py-2.5 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
            >
              {busyAction === 'custom_pack' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download Selected Pack (.zip)
            </button>

            <div className="space-y-1.5 border-t border-[#A991F7]/15 pt-3 text-[11px] text-[#9E93B5]">
              <div className="flex items-center justify-between">
                <span>Archive Format</span>
                <span className="font-mono text-[#EFEAF7]">PKZIP 2.0 STORE (0% loss)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Checksum Proof</span>
                <span className="font-mono text-[#58D6C2]">SHA-256 + PNG IHDR</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Style Contract</span>
                <span className="font-mono text-[#D9BA72]">V3.1 · 2× · #140E1D</span>
              </div>
            </div>
          </div>

          {/* Direct Master Metadata & Raw 4K Source Downloads */}
          <div className="rounded-xl border border-[#A991F7]/18 bg-[#181224] p-4 space-y-3 text-xs">
            <h3 className="font-display text-sm font-semibold text-[#D9BA72]">
              Master Manifests &amp; 4K Sources
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() =>
                  void handleDirectFile(
                    '/assets/manifest.json',
                    'archmage_v31_manifest.json',
                    'application/json'
                  )
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#A991F7]/30 bg-[#140E1D] px-2.5 py-2 font-medium text-[#DFD7F0] hover:border-[#A991F7] cursor-pointer whitespace-nowrap"
              >
                <FileJson className="h-3.5 w-3.5 text-[#A991F7]" />
                manifest.json
              </button>
              <button
                onClick={() =>
                  void handleDirectFile(
                    '/assets/validation-report.json',
                    'archmage_v31_validation_report.json',
                    'application/json'
                  )
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#58D6C2]/30 bg-[#140E1D] px-2.5 py-2 font-medium text-[#9CF0E2] hover:border-[#58D6C2] cursor-pointer whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5 text-[#58D6C2]" />
                validation.json
              </button>
            </div>

            {rawSourceSheets.length > 0 && (
              <div className="border-t border-[#A991F7]/15 pt-3">
                <button
                  onClick={() => setShowSourcesPanel((v) => !v)}
                  className="flex w-full items-center justify-between text-left text-xs font-medium text-[#EFEAF7] hover:text-[#D9BA72] cursor-pointer"
                >
                  <span>Individual 4K Source Sheets ({rawSourceSheets.length})</span>
                  <span className="font-mono text-[11px] text-[#A991F7]">
                    {showSourcesPanel ? 'Hide' : 'Show'}
                  </span>
                </button>
                {showSourcesPanel && (
                  <div className="mt-2.5 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                    {rawSourceSheets.map((filename) => (
                      <div
                        key={filename}
                        className="flex items-center justify-between gap-2 rounded border border-[#A991F7]/12 bg-[#140E1D] px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[#DFD7F0]">
                            {SOURCE_LABELS[filename] ?? filename}
                          </div>
                          <div className="truncate font-mono text-[10px] text-[#8E82A8]">
                            {filename}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            void handleDirectFile(
                              `/assets/aistudio/${filename}`,
                              filename,
                              'image/png'
                            )
                          }
                          className="shrink-0 rounded border border-[#D9BA72]/35 bg-[#261D36] px-2 py-1 font-mono text-[10px] font-medium text-[#F5E4BC] hover:border-[#D9BA72] cursor-pointer"
                        >
                          PNG
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
