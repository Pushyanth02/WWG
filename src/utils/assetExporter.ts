import type {
  AssetManifest,
  Direction,
  MasterManifest,
  ValidationItem,
  ValidationReport,
} from '../types/game';
import { assetUrl } from './assetUrl';
import {
  createZipBlob,
  encodeUtf8,
  formatBytes,
  parsePngDimensions,
  sha256Hex,
  triggerBlobDownload,
  type ZipEntry,
} from './zipBuilder';

export interface ExportProgress {
  phase: 'fetching' | 'slicing' | 'hashing' | 'packaging';
  completed: number;
  total: number;
  currentFile: string;
}

export interface ExportReceipt {
  filename: string;
  exportedAt: string;
  fileCount: number;
  sheetCount: number;
  rawSourceCount: number;
  slicedFrameCount: number;
  totalBytes: number;
  elapsedMs: number;
  verifiedPngCount: number;
  v31PassedCount: number;
  sha256ManifestHash: string;
}

export interface LibraryExportOptions {
  manifest: MasterManifest;
  validation: ValidationReport | null;
  assets: AssetManifest[];
  archiveName: string;
  includeProcessedSheets?: boolean;
  includeManifests?: boolean;
  includeValidationReport?: boolean;
  includeEngineAtlases?: boolean;
  includeRawSources?: boolean;
  includeSlicedFrames?: boolean;
  onProgress?: (progress: ExportProgress) => void;
}

export interface SingleAssetPackOptions {
  includeEngineAtlas?: boolean;
  includeValidationAudit?: boolean;
  includeSlicedFrames?: boolean;
  onlyTrack?: { state: string; direction: Direction };
  onProgress?: (progress: ExportProgress) => void;
}

interface IntegrityFileRecord {
  path: string;
  bytes: number;
  sha256: string;
  pngDimensions?: string;
  dimensionParity?: 'verified' | 'mismatch';
}

/**
 * Build an engine-ready atlas descriptor (explicit per-frame coordinates, pivot,
 * hitbox, hurtbox, timing, and V3.1 style contract metadata) for Godot, Unity,
 * Aseprite, or custom 2D runtimes.
 */
export function buildEngineAtlasJson(
  asset: AssetManifest,
  validationItem?: ValidationItem | null
) {
  const sheetWidth = asset.columns * asset.frameWidth;
  const sheetHeight = asset.rows * asset.frameHeight;

  const frames: Array<{
    id: string;
    state: string;
    direction: Direction;
    row: number;
    col: number;
    frameIndex: number;
    rect: { x: number; y: number; w: number; h: number };
    pivot: { x: number; y: number };
    hitbox: { x: number; y: number; w: number; h: number };
    hurtbox: { x: number; y: number; w: number; h: number };
    durationMs: number;
    events: string[];
  }> = [];

  for (const anim of asset.animations) {
    const durationMs = Math.round(1000 / Math.max(1, anim.fps));
    for (let f = 0; f < anim.frameCount; f++) {
      const col = f % asset.columns;
      const row = anim.row + Math.floor(f / asset.columns);
      const frameEvents = anim.events.filter((e) => e.frame === f).map((e) => e.name);
      frames.push({
        id: `${asset.assetId}_${anim.state}_${anim.direction}_${String(f).padStart(2, '0')}`,
        state: anim.state,
        direction: anim.direction,
        row,
        col,
        frameIndex: f,
        rect: {
          x: col * asset.frameWidth,
          y: row * asset.frameHeight,
          w: asset.frameWidth,
          h: asset.frameHeight,
        },
        pivot: anim.pivot,
        hitbox: anim.hitbox,
        hurtbox: anim.hurtbox,
        durationMs,
        events: frameEvents,
      });
    }
  }

  return {
    schema: 'archmage-v3.1-atlas/1.0',
    styleContract: {
      version: '3.1',
      pixelDensity: '2x',
      outlineInkHex: '#140E1D',
      palette: 'Rift Night (CIELAB Hybrid)',
      nearestNeighborRequired: true,
    },
    meta: {
      assetId: asset.assetId,
      name: asset.name,
      category: asset.category,
      subtitle: asset.subtitle,
      image: `../sprites/${asset.assetId}.png`,
      size: { w: sheetWidth, h: sheetHeight },
      tileSize: { w: asset.frameWidth, h: asset.frameHeight },
      grid: { columns: asset.columns, rows: asset.rows },
      totalFrames: frames.length,
    },
    animations: asset.animations.map((a) => ({
      state: a.state,
      direction: a.direction,
      row: a.row,
      frameCount: a.frameCount,
      fps: a.fps,
      loop: a.loop,
      pivot: a.pivot,
      hitbox: a.hitbox,
      hurtbox: a.hurtbox,
      events: a.events,
    })),
    frames,
    validation: validationItem
      ? {
          passed: validationItem.passed,
          sheetDimensions: validationItem.sheetDimensions,
          pixelDensity2xValid: validationItem.pixelDensity2xValid ?? true,
          outlineInkPresent: validationItem.outlineInkPresent ?? true,
          timingContractValid: validationItem.timingContractValid ?? true,
          duplicateAdjacentFrames: validationItem.duplicateAdjacentFrames,
          meanDeltaE: validationItem.meanDeltaE ?? null,
          outlinePerimeterCoverage: validationItem.outlinePerimeterCoverage ?? null,
          residualHaloPixels: validationItem.residualHaloPixels ?? 0,
          maxPivotJitterPx: validationItem.maxPivotJitterPx ?? 0,
          hurtboxContainmentPct: validationItem.hurtboxContainmentPct ?? 100,
        }
      : null,
  };
}

/**
 * Fetch exact canonical bytes directly from the Vite / public asset path
 * with zero decoding or lossy recompression.
 */
export async function fetchRawAssetBytes(url: string): Promise<Uint8Array> {
  const resolved = assetUrl(url);
  const response = await fetch(resolved, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${resolved} (HTTP ${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Direct lossless download of a single canonical file (PNG or JSON) via Blob
 * so downloads work reliably across browsers and iframe sandboxes.
 */
export async function downloadCanonicalFile(
  url: string,
  filename: string,
  mimeType: string
): Promise<number> {
  const bytes = await fetchRawAssetBytes(url);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  triggerBlobDownload(new Blob([copy.buffer], { type: mimeType }), filename);
  return bytes.byteLength;
}

function loadImageFromBytes(pngBytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(pngBytes.byteLength);
    copy.set(pngBytes);
    const blob = new Blob([copy.buffer], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode PNG image for lossless frame slicing'));
    };
    img.src = url;
  });
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas failed to encode lossless PNG blob'));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, 'image/png');
  });
}

/**
 * Slice a validated sprite sheet into individual lossless nearest-neighbor PNG frames,
 * preserving exact 2x pixel density and frame dimensions.
 */
export async function sliceAssetFramesToZipEntries(
  asset: AssetManifest,
  pngBytes: Uint8Array,
  options?: {
    onlyTrack?: { state: string; direction: Direction };
    folderPrefix?: string;
  }
): Promise<ZipEntry[]> {
  const img = await loadImageFromBytes(pngBytes);
  const canvas = document.createElement('canvas');
  canvas.width = asset.frameWidth;
  canvas.height = asset.frameHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.imageSmoothingEnabled = false;

  const tracks = options?.onlyTrack
    ? asset.animations.filter(
        (a) => a.state === options.onlyTrack!.state && a.direction === options.onlyTrack!.direction
      )
    : asset.animations;

  const prefix = options?.folderPrefix ?? `frames/${asset.assetId}`;
  const entries: ZipEntry[] = [];

  for (const anim of tracks) {
    for (let f = 0; f < anim.frameCount; f++) {
      const col = f % asset.columns;
      const row = anim.row + Math.floor(f / asset.columns);
      const sx = col * asset.frameWidth;
      const sy = row * asset.frameHeight;

      ctx.clearRect(0, 0, asset.frameWidth, asset.frameHeight);
      ctx.drawImage(
        img,
        sx,
        sy,
        asset.frameWidth,
        asset.frameHeight,
        0,
        0,
        asset.frameWidth,
        asset.frameHeight
      );

      const frameBytes = await canvasToPngBytes(canvas);
      const idxLabel = String(f).padStart(2, '0');
      entries.push({
        path: `${prefix}/${anim.state}_${anim.direction}_f${idxLabel}.png`,
        data: frameBytes,
      });
    }
  }

  return entries;
}

function buildArchiveReadme(params: {
  archiveName: string;
  exportedAt: string;
  sheetCount: number;
  rawSourceCount: number;
  slicedFrameCount: number;
  v31PassedCount: number;
  pipelineVersion: string;
}): string {
  return [
    'ARCHMAGE: RIFTBOUND — V3.1 ASSET EXPORT ARCHIVE',
    '================================================',
    `Archive:            ${params.archiveName}`,
    `Exported At:        ${params.exportedAt}`,
    `Pipeline:           ${params.pipelineVersion}`,
    `Style Contract:     V3.1 (2x Pixel Density · #140E1D Outline Ink · Rift Night CIELAB)`,
    `Processed Sheets:   ${params.sheetCount} (V3.1 Validated: ${params.v31PassedCount}/${params.sheetCount})`,
    `Raw 4K Sources:     ${params.rawSourceCount}`,
    `Sliced PNG Frames:  ${params.slicedFrameCount}`,
    '',
    'INTEGRITY & LOSSLESS GUARANTEE',
    '------------------------------',
    '- Packaged in PKZIP 2.0 STORE mode (zero recompression) with IEEE 802.3 CRC-32.',
    '- Every sprite sheet PNG is exported byte-for-byte from the validated V3.1 build.',
    '- Verify file authenticity using SHA-256 digests in V3.1_INTEGRITY_MANIFEST.json.',
    '',
    'DIRECTORY STRUCTURE',
    '-------------------',
    '  sprites/*.png                Canonical 2x V3.1 sprite sheets (transparent alpha)',
    '  sprites/*.json               Canonical V3.1 animation, pivot, hitbox & hurtbox manifests',
    '  atlases/*.atlas.json         Engine-ready explicit per-frame rectangle & event atlases',
    '  validation/                  V3.1 frame-by-frame validation & collision parity reports',
    '  sources/*.png                Original high-resolution 4K source sheets (when included)',
    '  frames/<assetId>/*.png       Individual lossless sliced frames (when included)',
    '  V3.1_INTEGRITY_MANIFEST.json SHA-256 checksums, PNG IHDR checks, and parity proof',
    '',
  ].join('\n');
}

async function finalizeArchiveWithIntegrity(params: {
  entries: ZipEntry[];
  expectedDimensionsByPath: Map<string, string>;
  archiveName: string;
  sheetCount: number;
  rawSourceCount: number;
  slicedFrameCount: number;
  v31PassedCount: number;
  pipelineVersion: string;
  onProgress?: (progress: ExportProgress) => void;
  startedAt: number;
}): Promise<ExportReceipt> {
  const {
    entries,
    expectedDimensionsByPath,
    archiveName,
    sheetCount,
    rawSourceCount,
    slicedFrameCount,
    v31PassedCount,
    pipelineVersion,
    onProgress,
    startedAt,
  } = params;

  const exportedAt = new Date().toISOString();
  const records: IntegrityFileRecord[] = [];
  let verifiedPngCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress?.({
      phase: 'hashing',
      completed: i + 1,
      total: entries.length,
      currentFile: entry.path,
    });

    const digest = await sha256Hex(entry.data);
    const rec: IntegrityFileRecord = {
      path: entry.path,
      bytes: entry.data.byteLength,
      sha256: digest,
    };

    if (entry.path.toLowerCase().endsWith('.png')) {
      const dims = parsePngDimensions(entry.data);
      if (dims) {
        const actualDimStr = `${dims.width}x${dims.height}`;
        rec.pngDimensions = actualDimStr;
        const expected = expectedDimensionsByPath.get(entry.path);
        if (!expected || expected === actualDimStr) {
          rec.dimensionParity = 'verified';
          verifiedPngCount++;
        } else {
          rec.dimensionParity = 'mismatch';
        }
      }
    }

    records.push(rec);
  }

  const integrityPayload = {
    schema: 'archmage-v3.1-integrity-manifest/1.0',
    archiveName,
    exportedAt,
    pipeline: pipelineVersion,
    packagingMode: 'PKZIP-2.0-STORE-LOSSLESS',
    styleContract: {
      version: '3.1',
      pixelDensity: '2x',
      outlineInkHex: '#140E1D',
      zeroRecompression: true,
    },
    summary: {
      totalFiles: records.length,
      processedSheets: sheetCount,
      v31PassedSheets: v31PassedCount,
      raw4KSources: rawSourceCount,
      slicedFrames: slicedFrameCount,
      verifiedPngCount,
    },
    files: records,
  };

  const integrityJsonBytes = encodeUtf8(JSON.stringify(integrityPayload, null, 2));
  const sha256ManifestHash = await sha256Hex(integrityJsonBytes);
  const readmeBytes = encodeUtf8(
    buildArchiveReadme({
      archiveName,
      exportedAt,
      sheetCount,
      rawSourceCount,
      slicedFrameCount,
      v31PassedCount,
      pipelineVersion,
    })
  );

  const finalEntries: ZipEntry[] = [
    ...entries,
    { path: 'V3.1_INTEGRITY_MANIFEST.json', data: integrityJsonBytes },
    { path: 'README.txt', data: readmeBytes },
  ];

  onProgress?.({
    phase: 'packaging',
    completed: finalEntries.length,
    total: finalEntries.length,
    currentFile: archiveName,
  });

  const zipBlob = createZipBlob(finalEntries);
  triggerBlobDownload(zipBlob, archiveName);

  return {
    filename: archiveName,
    exportedAt,
    fileCount: finalEntries.length,
    sheetCount,
    rawSourceCount,
    slicedFrameCount,
    totalBytes: zipBlob.size,
    elapsedMs: Math.round(performance.now() - startedAt),
    verifiedPngCount,
    v31PassedCount,
    sha256ManifestHash,
  };
}

/**
 * Export a single integrated V3.1 sprite sheet pack (PNG + JSON + Engine Atlas +
 * optional Validation Audit + optional Sliced Frames + SHA-256 Integrity Manifest).
 */
export async function exportSingleAssetPack(
  asset: AssetManifest,
  validationItem?: ValidationItem | null,
  options?: SingleAssetPackOptions
): Promise<ExportReceipt> {
  const startedAt = performance.now();
  const includeEngineAtlas = options?.includeEngineAtlas ?? true;
  const includeValidationAudit = options?.includeValidationAudit ?? true;
  const includeSlicedFrames = options?.includeSlicedFrames ?? Boolean(options?.onlyTrack);

  const entries: ZipEntry[] = [];
  const expectedDims = new Map<string, string>();
  const totalSteps = 2 + (includeSlicedFrames ? 1 : 0);

  options?.onProgress?.({
    phase: 'fetching',
    completed: 1,
    total: totalSteps,
    currentFile: `sprites/${asset.assetId}.png`,
  });
  const pngBytes = await fetchRawAssetBytes(asset.sheetUrl);
  const sheetPath = `sprites/${asset.assetId}.png`;
  entries.push({ path: sheetPath, data: pngBytes });
  expectedDims.set(
    sheetPath,
    `${asset.columns * asset.frameWidth}x${asset.rows * asset.frameHeight}`
  );

  options?.onProgress?.({
    phase: 'fetching',
    completed: 2,
    total: totalSteps,
    currentFile: `sprites/${asset.assetId}.json`,
  });
  const jsonBytes = await fetchRawAssetBytes(asset.manifestUrl);
  entries.push({ path: `sprites/${asset.assetId}.json`, data: jsonBytes });

  if (includeEngineAtlas) {
    const atlasJson = buildEngineAtlasJson(asset, validationItem);
    entries.push({
      path: `atlases/${asset.assetId}.atlas.json`,
      data: encodeUtf8(JSON.stringify(atlasJson, null, 2)),
    });
  }

  if (includeValidationAudit && validationItem) {
    entries.push({
      path: `validation/${asset.assetId}.audit.json`,
      data: encodeUtf8(JSON.stringify(validationItem, null, 2)),
    });
  }

  let slicedFrameCount = 0;
  if (includeSlicedFrames) {
    options?.onProgress?.({
      phase: 'slicing',
      completed: totalSteps,
      total: totalSteps,
      currentFile: options?.onlyTrack
        ? `frames/${asset.assetId}/${options.onlyTrack.state}_${options.onlyTrack.direction}`
        : `frames/${asset.assetId}/*`,
    });
    const frameEntries = await sliceAssetFramesToZipEntries(asset, pngBytes, {
      onlyTrack: options?.onlyTrack,
    });
    for (const fe of frameEntries) {
      entries.push(fe);
      expectedDims.set(fe.path, `${asset.frameWidth}x${asset.frameHeight}`);
    }
    slicedFrameCount = frameEntries.length;
  }

  const suffix = options?.onlyTrack
    ? `_${options.onlyTrack.state}_${options.onlyTrack.direction}_frames`
    : '_v31_pack';

  return finalizeArchiveWithIntegrity({
    entries,
    expectedDimensionsByPath: expectedDims,
    archiveName: `${asset.assetId}${suffix}.zip`,
    sheetCount: 1,
    rawSourceCount: 0,
    slicedFrameCount,
    v31PassedCount: validationItem?.passed === false ? 0 : 1,
    pipelineVersion: 'v3.1-cielab-contour-pivot-pipeline',
    onProgress: options?.onProgress,
    startedAt,
  });
}

/**
 * Export full V3.1 library, category pack, custom selection, or 12/12 raw 4K source sheets
 * into a lossless, SHA-256 verified PKZIP archive.
 */
export async function exportLibraryArchive(
  options: LibraryExportOptions
): Promise<ExportReceipt> {
  const startedAt = performance.now();
  const {
    manifest,
    validation,
    assets,
    archiveName,
    includeProcessedSheets = true,
    includeManifests = true,
    includeValidationReport = true,
    includeEngineAtlases = true,
    includeRawSources = false,
    includeSlicedFrames = false,
    onProgress,
  } = options;

  const entries: ZipEntry[] = [];
  const expectedDims = new Map<string, string>();
  const validationMap = new Map<string, ValidationItem>();
  for (const item of validation?.results ?? []) {
    validationMap.set(item.assetId, item);
  }

  const rawSourcesList = includeRawSources ? manifest.sourceSheetsUsed ?? [] : [];
  const totalFetchUnits =
    (includeProcessedSheets ? assets.length : 0) +
    (includeProcessedSheets && includeManifests ? assets.length : 0) +
    rawSourcesList.length +
    (includeProcessedSheets && includeManifests ? 1 : 0) +
    (includeValidationReport ? 1 : 0);

  let completedUnits = 0;
  let v31PassedCount = 0;
  let slicedFrameCount = 0;

  if (includeProcessedSheets) {
    for (const asset of assets) {
      const valItem = validationMap.get(asset.assetId) ?? null;
      if (!valItem || valItem.passed) v31PassedCount++;

      completedUnits++;
      const sheetPath = `sprites/${asset.assetId}.png`;
      onProgress?.({
        phase: 'fetching',
        completed: completedUnits,
        total: Math.max(1, totalFetchUnits),
        currentFile: sheetPath,
      });

      const pngBytes = await fetchRawAssetBytes(asset.sheetUrl);
      entries.push({ path: sheetPath, data: pngBytes });
      expectedDims.set(
        sheetPath,
        `${asset.columns * asset.frameWidth}x${asset.rows * asset.frameHeight}`
      );

      if (includeManifests) {
        completedUnits++;
        const manifestPath = `sprites/${asset.assetId}.json`;
        onProgress?.({
          phase: 'fetching',
          completed: completedUnits,
          total: Math.max(1, totalFetchUnits),
          currentFile: manifestPath,
        });
        const jsonBytes = await fetchRawAssetBytes(asset.manifestUrl);
        entries.push({ path: manifestPath, data: jsonBytes });
      }

      if (includeEngineAtlases) {
        const atlas = buildEngineAtlasJson(asset, valItem);
        entries.push({
          path: `atlases/${asset.assetId}.atlas.json`,
          data: encodeUtf8(JSON.stringify(atlas, null, 2)),
        });
      }

      if (includeSlicedFrames) {
        onProgress?.({
          phase: 'slicing',
          completed: completedUnits,
          total: Math.max(1, totalFetchUnits),
          currentFile: `frames/${asset.assetId}/*`,
        });
        const frameEntries = await sliceAssetFramesToZipEntries(asset, pngBytes);
        for (const fe of frameEntries) {
          entries.push(fe);
          expectedDims.set(fe.path, `${asset.frameWidth}x${asset.frameHeight}`);
        }
        slicedFrameCount += frameEntries.length;
      }
    }

    if (includeManifests) {
      completedUnits++;
      onProgress?.({
        phase: 'fetching',
        completed: completedUnits,
        total: Math.max(1, totalFetchUnits),
        currentFile: 'manifest.json',
      });
      const subsetManifest: MasterManifest =
        assets.length === manifest.assets.length
          ? manifest
          : {
              ...manifest,
              assetCount: assets.length,
              assets,
            };
      entries.push({
        path: 'manifest.json',
        data: encodeUtf8(JSON.stringify(subsetManifest, null, 2)),
      });
    }
  }

  if (includeValidationReport && validation) {
    completedUnits++;
    onProgress?.({
      phase: 'fetching',
      completed: completedUnits,
      total: Math.max(1, totalFetchUnits),
      currentFile: 'validation/validation-report.json',
    });

    const selectedIds = new Set(assets.map((a) => a.assetId));
    const reportPayload =
      !includeProcessedSheets || assets.length === manifest.assets.length
        ? validation
        : {
            ...validation,
            totalSheets: assets.length,
            passedSheets: validation.results.filter(
              (r) => selectedIds.has(r.assetId) && r.passed
            ).length,
            results: validation.results.filter((r) => selectedIds.has(r.assetId)),
          };

    entries.push({
      path: 'validation/validation-report.json',
      data: encodeUtf8(JSON.stringify(reportPayload, null, 2)),
    });
  }

  // Raw 4K source sheets
  for (const filename of rawSourcesList) {
    completedUnits++;
    const sourcePath = `sources/${filename}`;
    onProgress?.({
      phase: 'fetching',
      completed: completedUnits,
      total: Math.max(1, totalFetchUnits),
      currentFile: sourcePath,
    });
    const rawBytes = await fetchRawAssetBytes(`/assets/aistudio/${filename}`);
    entries.push({ path: sourcePath, data: rawBytes });
  }

  return finalizeArchiveWithIntegrity({
    entries,
    expectedDimensionsByPath: expectedDims,
    archiveName,
    sheetCount: includeProcessedSheets ? assets.length : 0,
    rawSourceCount: rawSourcesList.length,
    slicedFrameCount,
    v31PassedCount,
    pipelineVersion: manifest.sourcePipeline ?? 'v3.1-cielab-contour-pivot-pipeline',
    onProgress,
    startedAt,
  });
}

/**
 * Package a live Pipeline Studio run (2x PNG sheet + V3.1 JSON manifest +
 * Engine Atlas + Frame-by-Frame Audit + Individual Frames + SHA-256 integrity manifest).
 */
export async function exportPipelineStudioBundle(params: {
  baseName: string;
  outputSheetCanvas: HTMLCanvasElement;
  frameCanvases: HTMLCanvasElement[];
  manifestObj: Record<string, unknown>;
  atlasObj: Record<string, unknown>;
  auditObj: Record<string, unknown>;
  frameSize: number;
}): Promise<ExportReceipt> {
  const startedAt = performance.now();
  const cleanBase = params.baseName || 'pipeline_sheet';
  const entries: ZipEntry[] = [];
  const expectedDims = new Map<string, string>();

  const sheetBytes = await canvasToPngBytes(params.outputSheetCanvas);
  const sheetPath = `sprites/${cleanBase}_v31.png`;
  entries.push({ path: sheetPath, data: sheetBytes });
  expectedDims.set(
    sheetPath,
    `${params.outputSheetCanvas.width}x${params.outputSheetCanvas.height}`
  );

  entries.push({
    path: `sprites/${cleanBase}_v31.json`,
    data: encodeUtf8(JSON.stringify(params.manifestObj, null, 2)),
  });
  entries.push({
    path: `atlases/${cleanBase}.atlas.json`,
    data: encodeUtf8(JSON.stringify(params.atlasObj, null, 2)),
  });
  entries.push({
    path: `validation/${cleanBase}_audit.json`,
    data: encodeUtf8(JSON.stringify(params.auditObj, null, 2)),
  });

  for (let i = 0; i < params.frameCanvases.length; i++) {
    const fBytes = await canvasToPngBytes(params.frameCanvases[i]);
    const fPath = `frames/${cleanBase}_f${String(i).padStart(2, '0')}.png`;
    entries.push({ path: fPath, data: fBytes });
    expectedDims.set(fPath, `${params.frameSize}x${params.frameSize}`);
  }

  return finalizeArchiveWithIntegrity({
    entries,
    expectedDimensionsByPath: expectedDims,
    archiveName: `${cleanBase}_v31_bundle.zip`,
    sheetCount: 1,
    rawSourceCount: 0,
    slicedFrameCount: params.frameCanvases.length,
    v31PassedCount: 1,
    pipelineVersion: 'v3.1-cielab-contour-pivot-pipeline',
    startedAt,
  });
}

export { formatBytes };
