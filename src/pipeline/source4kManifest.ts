import type { BackdropMode } from './alphaCleanup.ts';
import { validateSheetBuffer, type HighPrecisionValidationItem } from './frameValidator.ts';
import type { RasterBuffer } from './raster.ts';
import type { BBox } from './segmentation.ts';

export type AlphaSourceClassification =
  | 'illustrated_opaque_composite'
  | 'true_alpha'
  | 'studio_white_baked'
  | 'mixed_alpha_or_baked_backdrop'
  | 'dark_obsidian_baked';

export interface PipelineImportAssetRaw {
  id: string;
  displayName: string;
  sourcePNG: string;
  assetFamily: string;
  format: string;
  resolution: [number, number];
  alphaSourceClassification: AlphaSourceClassification;
  stage1: {
    operation: string;
    requires_review: boolean;
    reviewCandidate: string | null;
  };
  stage2: {
    useHints: string;
    mode: string;
    contours: string;
    dpSeam: string;
  };
  stage3: {
    protectHighSaturation: boolean;
    inkColor: string;
    palette: string;
    rawColorsUnmodified: boolean;
  };
  stage4: {
    status: string;
    playerCell: [number, number];
    playerPivot: [number, number];
    tyrantCell: [number, number];
    tyrantPivot: [number, number];
  };
  stage5: {
    status: string;
    audit: string;
  };
  licensePreset: string;
  isFullSheetSpriteAtlas: boolean;
  requiresFrameExtraction: boolean;
}

export interface PipelineStudioImportDoc {
  file_version: string;
  content_type: string;
  compatibility_note: string;
  root: string;
  source_archive: string;
  do_not_auto_export_baked_composite_frames: boolean;
  pipeline_contract: string;
  audit_index: string;
  source_license_preset: string;
  assets: PipelineImportAssetRaw[];
}

export interface AssetManifestFileRaw {
  image_number: number;
  asset_id: string;
  source_file: string;
  path: string;
  role: string;
  source_kind: string;
  resolution: [number, number];
  pixel_format: string;
  backdrop_classification: AlphaSourceClassification;
  confidence: string;
  transparency_action: string;
  edge_samples: {
    white_fraction: number;
    dark_fraction: number;
    red_fraction: number;
    median_chroma: number;
  };
  sample_alpha_zero_fraction: number;
  sample_alpha_soft_fraction: number;
  segmentation: string;
  frame_layout: string;
  pivot_contract: string;
  v31_validation: string;
  license_scope: string;
  sha256: string;
  bytes: number;
}

export interface AssetManifestDoc {
  manifest_version: string;
  pack: string;
  total_images: number;
  nominal_long_edge: number;
  intended_stages: string[];
  import_semantics: string;
  authoritative_sources: string;
  destructive_processing_requires_review: boolean;
  animation_frames_validated: number;
  v31_validated_animations: number;
  files: AssetManifestFileRaw[];
}

export interface RegionHintEntryRaw {
  asset_id: string;
  sheet_file: string;
  hint_type: string;
  frame_regions: BBox[];
  automatic_row_candidates: {
    y_px: number;
    confidence: string;
    relative_y: number;
  }[];
  notes: string;
}

export interface RegionHintsDoc {
  version: number;
  entries: RegionHintEntryRaw[];
}

export interface V31ContractDoc {
  format_version: string;
  description: string;
  pipeline_stages: {
    stage: number;
    name: string;
    [key: string]: unknown;
  }[];
  texture_filter: string;
  color_space: string;
  asset_backgrounds: string;
  no_automatic_unsafe_cutting: boolean;
  pixel_snap_warning: string;
}

export interface ExternalPackLicensePresetsDoc {
  notice: string;
  packs: {
    name: string;
    url: string;
    status: string;
    license: string;
    raw_redistribution: string;
    ai_training: string;
  }[];
}

export interface Stage1AlphaPolicy {
  alphaClass: AlphaSourceClassification;
  backdropMode: BackdropMode;
  bypassGlobalKeying: boolean;
  isUnapprovedCandidate: boolean;
  policyLabel: string;
  policyExplanation: string;
}

export interface ResolvedSource4kAsset {
  imageNumber: number;
  id: string;
  displayName: string;
  archivePath: string;
  workspaceUrl: string;
  workspaceFilename: string;
  assetFamily: string;
  resolution: [number, number];
  pixelFormat: string;
  bytes: number;
  sha256: string;
  alphaClass: AlphaSourceClassification;
  stage1Policy: Stage1AlphaPolicy;
  stage1Operation: string;
  requiresReview: boolean;
  reviewCandidatePath: string | null;
  requiresFrameExtraction: boolean;
  isFullSheetSpriteAtlas: boolean;
  edgeSamples: AssetManifestFileRaw['edge_samples'];
  alphaZeroFraction: number;
  alphaSoftFraction: number;
  v31InitialStatus: string;
  hintType: string;
  verifiedFrameRegions: BBox[];
  unverifiedRowCandidates: { y_px: number; confidence: string; relative_y: number }[];
  regionNotes: string;
  recommendedEntityKind: 'player' | 'tyrant';
  sourceImmutable: true;
}

export interface SchemaMappingIssue {
  code: string;
  severity: 'error' | 'warning';
  manifestFile: string;
  sourceField: string;
  expectedStudioField: string;
  affectedCount: number;
  summary: string;
  requiredAdjustment: string;
}

export interface SchemaAuditReport {
  schemaParityReady: boolean;
  errorCount: number;
  warningCount: number;
  issues: SchemaMappingIssue[];
  auditedAt: string;
}

export interface Loaded4kBundle {
  importDoc: PipelineStudioImportDoc;
  manifestDoc: AssetManifestDoc;
  contractDoc: V31ContractDoc;
  regionHintsDoc: RegionHintsDoc;
  licensePresetsDoc: ExternalPackLicensePresetsDoc;
  assets: ResolvedSource4kAsset[];
  schemaAudit: SchemaAuditReport;
}

export interface ManualFrameRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  source: 'manual_drag' | 'manual_roi_component';
}

export type V31TrackEntityClass = 'player' | 'enemy' | 'boss' | 'vfx';

export interface V31TrackAuthoringMeta {
  entityClass: V31TrackEntityClass;
  targetKind: 'player' | 'tyrant';
  state: string;
  direction: 'down' | 'up' | 'left' | 'right';
  fps: number;
  loop: boolean;
  hitbox: { x: number; y: number; w: number; h: number };
  hurtbox: { x: number; y: number; w: number; h: number };
}

export type V31ValidationVerdict =
  | 'BLOCKED_PENDING_FRAME_EXTRACTION'
  | 'UNAPPROVED_CANDIDATE'
  | 'FAIL'
  | 'PASS_VERIFIED';

export interface V31ContractCheckResult {
  testId: string;
  label: string;
  status: 'pass' | 'fail' | 'blocked';
  detail: string;
}

export interface V31RealFrameValidationResult {
  verdict: V31ValidationVerdict;
  checks: V31ContractCheckResult[];
  sheetValidation: HighPrecisionValidationItem | null;
  blockingReasons: string[];
  meanBeforeAfterDeltaE: number;
  p95BeforeAfterDeltaE: number;
  twoByTwoUniformity: number;
  maxPivotDeviationPx: number;
}

export const BUNDLE_MANIFEST_URLS = {
  pipelineImport: '/assets/aistudio/PIPELINE_STUDIO_IMPORT_37fa0e42.json',
  assetManifest: '/assets/aistudio/ASSET_MANIFEST_a5fbddb9.json',
  v31Contract: '/assets/aistudio/PIPELINE_STUDIO_V31_CONTRACT_f116fbe1.json',
  regionHints: '/assets/aistudio/REGION_HINTS_d990a445.json',
  licensePresets: '/assets/aistudio/EXTERNAL_PACK_LICENSE_PRESETS_fd5f099a.json',
} as const;

export const STUDIO_WHITE_CANDIDATE_IDS = new Set([
  'archmage_15',
  'archmage_16',
  'archmage_24',
  'archmage_25',
]);

export const V31_STATE_TIMING_SPECS: Record<
  V31TrackEntityClass,
  { state: string; frames: number; fps: number }[]
> = {
  player: [
    { state: 'idle', frames: 6, fps: 7 },
    { state: 'walk', frames: 8, fps: 10 },
    { state: 'cast', frames: 6, fps: 12 },
    { state: 'blink', frames: 6, fps: 14 },
    { state: 'hit', frames: 4, fps: 10 },
    { state: 'death', frames: 6, fps: 8 },
    { state: 'victory', frames: 6, fps: 8 },
  ],
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
  vfx: [
    { state: 'projectile', frames: 6, fps: 14 },
    { state: 'impact', frames: 6, fps: 14 },
    { state: 'burst', frames: 6, fps: 12 },
    { state: 'cast_ring', frames: 6, fps: 10 },
  ],
};

/**
 * Resolves a sheet's Stage 1 alpha policy strictly honoring PIPELINE_STUDIO_V31_CONTRACT.json.
 * Bypasses destructive global keying for opaque composites, baked-alpha boards, true-alpha sheets,
 * and dark obsidian boards. Treats sheets 15, 16, 24, 25 (studio_white_baked) as unapproved candidates.
 */
export function resolveStage1Policy(
  assetId: string,
  alphaClass: AlphaSourceClassification
): Stage1AlphaPolicy {
  const isStudioWhiteCandidate =
    alphaClass === 'studio_white_baked' || STUDIO_WHITE_CANDIDATE_IDS.has(assetId);

  if (isStudioWhiteCandidate) {
    return {
      alphaClass: 'studio_white_baked',
      backdropMode: 'studio_white_preview',
      bypassGlobalKeying: false,
      isUnapprovedCandidate: true,
      policyLabel: 'Unapproved Candidate · Border White Preview',
      policyExplanation:
        'Studio-white baked sheet (15/16/24/25). Border-connected flood-fill preview (ΔE00 ≤ 13, 2px halo decontaminate, ≤5px orphan prune). Enclosed whites preserved; manual recovery & sign-off required.',
    };
  }

  switch (alphaClass) {
    case 'illustrated_opaque_composite':
      return {
        alphaClass,
        backdropMode: 'preserve_opaque',
        bypassGlobalKeying: true,
        isUnapprovedCandidate: false,
        policyLabel: 'Keep Opaque · Global Key Bypassed',
        policyExplanation:
          'Full-scene UI/concept composite. Destructive global keying is disabled; preserve opaque pixels intact.',
      };
    case 'true_alpha':
      return {
        alphaClass,
        backdropMode: 'alpha',
        bypassGlobalKeying: true,
        isUnapprovedCandidate: false,
        policyLabel: 'True Alpha · No Global Key',
        policyExplanation:
          'Existing RGBA alpha preserved without global background flood-fill. Manual contiguous frame regions required before extraction.',
      };
    case 'mixed_alpha_or_baked_backdrop':
      return {
        alphaClass,
        backdropMode: 'preserve_opaque',
        bypassGlobalKeying: true,
        isUnapprovedCandidate: false,
        policyLabel: 'Mixed / Baked Backdrop · Global Key Bypassed',
        policyExplanation:
          'Contains mixed alpha panels, UI labels, or baked backdrops. Global keying disabled; manually crop clean contiguous regions first.',
      };
    case 'dark_obsidian_baked':
      return {
        alphaClass,
        backdropMode: 'preserve_opaque',
        bypassGlobalKeying: true,
        isUnapprovedCandidate: false,
        policyLabel: 'Dark Obsidian Baked · Manual / Additive Only',
        policyExplanation:
          'Dark obsidian backdrop shares luminance with #140E1D outline ink. Global dark keying bypassed to prevent destroying sprite outlines.',
      };
  }
}

/** Deterministic read-only path mapping from archive relative path + SHA256 -> workspace immutable PNG */
export function resolveWorkspaceAssetPath(sourceFile: string, sha256: string): {
  filename: string;
  url: string;
} {
  const baseName = sourceFile.split('/').pop() ?? sourceFile;
  const stem = baseName.replace(/\.png$/i, '');
  const hash8 = sha256.slice(0, 8);
  const filename = `${stem}_${hash8}.png`;
  return {
    filename,
    url: `/assets/aistudio/${filename}`,
  };
}

/**
 * Audits PIPELINE_STUDIO_IMPORT.json, ASSET_MANIFEST.json, and REGION_HINTS.json against
 * the Archmage Pipeline Studio V3.1 runtime schema and returns explicit field mapping errors/adjustments.
 */
export function auditManifestSchema(
  importDoc: PipelineStudioImportDoc,
  manifestDoc: AssetManifestDoc,
  regionHintsDoc: RegionHintsDoc
): SchemaAuditReport {
  const issues: SchemaMappingIssue[] = [];
  const total = importDoc.assets.length;

  // 1. Archive path vs workspace immutable path remapping
  const nonWorkspacePaths = importDoc.assets.filter(
    (a) => !a.sourcePNG.startsWith('/assets/')
  ).length;
  if (nonWorkspacePaths > 0) {
    issues.push({
      code: 'SCHEMA_PATH_MAPPING_REQUIRED',
      severity: 'error',
      manifestFile: 'PIPELINE_STUDIO_IMPORT.json & ASSET_MANIFEST.json',
      sourceField: 'assets[].sourcePNG ("01_SOURCE_4K/...") + files[].sha256',
      expectedStudioField: 'AssetManifest.sheetUrl ("/assets/aistudio/<stem>_<sha8>.png")',
      affectedCount: nonWorkspacePaths,
      summary: `${nonWorkspacePaths}/${total} entries reference archive-relative 01_SOURCE_4K paths instead of workspace-mounted read-only URLs.`,
      requiredAdjustment:
        'Adapter maps basename(sourcePNG) + sha256[0..8] -> /assets/aistudio/<stem>_<sha8>.png while preserving source immutability. Add `workspaceUrl` or mount 01_SOURCE_4K directly.',
    });
  }

  // 2. External artifact references not present in workspace bundle
  const missingReviewCandidates = importDoc.assets.filter(
    (a) => a.stage1.reviewCandidate !== null
  ).length;
  issues.push({
    code: 'SCHEMA_UNBUNDLED_AUXILIARY_REFS',
    severity: 'warning',
    manifestFile: 'PIPELINE_STUDIO_IMPORT.json',
    sourceField: 'stage1.reviewCandidate ("03_CLEANUP_REVIEW_CANDIDATES/...") & stage5.audit ("04_QA_AND_AUDIT/FULL_TRACK_AUDIT.csv")',
    expectedStudioField: 'In-memory Stage 1 candidate buffer + exported QA CSV/JSON',
    affectedCount: missingReviewCandidates,
    summary: `${missingReviewCandidates} sheets reference pre-rendered 03_CLEANUP_REVIEW_CANDIDATES PNGs and 04_QA_AND_AUDIT/FULL_TRACK_AUDIT.csv which were not included in the uploaded bundle.`,
    requiredAdjustment:
      'Pipeline Studio synthesizes non-destructive Stage 1 candidate buffers live in memory without modifying 01_SOURCE_4K sources, and exports fresh FULL_TRACK_AUDIT CSV/JSON after real frame recovery.',
  });

  // 3. Empty frame_regions in REGION_HINTS.json (only unverified row heuristics present)
  const emptyRegionsCount = regionHintsDoc.entries.filter(
    (e) => !e.frame_regions || e.frame_regions.length === 0
  ).length;
  const extractionRequiredCount = importDoc.assets.filter((a) => a.requiresFrameExtraction).length;
  if (emptyRegionsCount > 0) {
    issues.push({
      code: 'SCHEMA_MISSING_FRAME_REGIONS',
      severity: 'error',
      manifestFile: 'REGION_HINTS.json',
      sourceField: 'entries[].frame_regions (currently [] on all 36 sheets)',
      expectedStudioField: 'entries[].frame_regions: Array<{ x, y, w, h, trackState, direction, frameIndex }>',
      affectedCount: extractionRequiredCount,
      summary: `0/${total} sheets have verified frame_regions (${extractionRequiredCount} sprite/VFX/atlas sheets require manual contiguous frame recovery; automatic_row_candidates are UNVERIFIED_HEURISTIC only).`,
      requiredAdjustment:
        'Populate entries[].frame_regions with manually verified contiguous crop rects in 4K pixel coordinates (excluding intersecting magic VFX & UI captions) via the Stage 2 Manual Recovery Canvas.',
    });
  }

  // 4. Missing animation track timing definitions
  issues.push({
    code: 'SCHEMA_MISSING_ANIMATION_TRACKS',
    severity: 'error',
    manifestFile: 'PIPELINE_STUDIO_IMPORT.json',
    sourceField: 'assets[].stage5 (missing animations[] array)',
    expectedStudioField: 'AssetManifest.animations: Array<{ state, direction, row, frameCount, fps, loop, pivot, events }>',
    affectedCount: extractionRequiredCount,
    summary: `Manifests omit per-track animation timing fields (state, direction, frameCount, fps, loop, events) required for Stage 5 V3.1 timing parity.`,
    requiredAdjustment:
      'Add an `animations[]` array per sheet (or author track timing in Stage 5) declaring exact V3.1 state names, FPS, and frame counts (e.g. enemy 7-state / boss 8-state / player directional specs).',
  });

  // 5. Missing authored hitbox & hurtbox geometry
  issues.push({
    code: 'SCHEMA_MISSING_COLLISION_BOXES',
    severity: 'error',
    manifestFile: 'PIPELINE_STUDIO_IMPORT.json',
    sourceField: 'assets[].stage4 (provides playerCell/playerPivot & tyrantCell/tyrantPivot only)',
    expectedStudioField: 'AnimationEntry.hitbox { x, y, w, h } & AnimationEntry.hurtbox { x, y, w, h }',
    affectedCount: extractionRequiredCount,
    summary: `stage4 specifies 64×64 pivot (32,54) and 128×128 pivot (64,104), but provides no authored hitbox or hurtbox rectangles.`,
    requiredAdjustment:
      'Add `hitbox` and `hurtbox` `{ x, y, w, h }` fields to each animation track (or use the V3.1 Stage 5 collision authoring controls) before running hurtbox containment & hitbox overflow checks.',
  });

  // 6. Unapproved studio-white candidates (sheets 15, 16, 24, 25)
  const studioWhiteCount = importDoc.assets.filter(
    (a) => a.alphaSourceClassification === 'studio_white_baked'
  ).length;
  if (studioWhiteCount > 0) {
    issues.push({
      code: 'CONTRACT_UNAPPROVED_STUDIO_WHITE_CANDIDATES',
      severity: 'warning',
      manifestFile: 'PIPELINE_STUDIO_IMPORT.json & ASSET_MANIFEST.json',
      sourceField: 'assets[archmage_15, archmage_16, archmage_24, archmage_25].stage1.requires_review',
      expectedStudioField: 'Explicit manual visual sign-off (`candidateApproved: true`) after halo inspection',
      affectedCount: studioWhiteCount,
      summary: `Sheets 15, 16, 24, and 25 are studio_white_baked and locked as unapproved review candidates (automatic approval disabled).`,
      requiredAdjustment:
        'Inspect non-destructive Stage 1 border flood-fill previews for sheets 15, 16, 24, and 25, recover contiguous frames manually around intersecting captions/VFX, and explicitly approve each candidate.',
    });
  }

  return {
    schemaParityReady: false,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    issues,
    auditedAt: new Date().toISOString(),
  };
}

/** Merges all uploaded JSON manifests into an immutable 36-asset inventory + schema audit */
export function build4kBundleModel(
  importDoc: PipelineStudioImportDoc,
  manifestDoc: AssetManifestDoc,
  contractDoc: V31ContractDoc,
  regionHintsDoc: RegionHintsDoc,
  licensePresetsDoc: ExternalPackLicensePresetsDoc
): Loaded4kBundle {
  const manifestById = new Map<string, AssetManifestFileRaw>();
  for (const f of manifestDoc.files) {
    manifestById.set(f.asset_id, f);
  }
  const hintsById = new Map<string, RegionHintEntryRaw>();
  for (const h of regionHintsDoc.entries) {
    hintsById.set(h.asset_id, h);
  }

  const assets: ResolvedSource4kAsset[] = importDoc.assets.map((raw, idx) => {
    const mf = manifestById.get(raw.id);
    const hint = hintsById.get(raw.id);
    const sha = mf?.sha256 ?? '';
    const resolved = resolveWorkspaceAssetPath(raw.sourcePNG, sha);
    const alphaClass = raw.alphaSourceClassification;
    const stage1Policy = resolveStage1Policy(raw.id, alphaClass);
    const isBossBoard =
      raw.assetFamily === 'enemy_boss_animation_atlas' &&
      (raw.id === 'archmage_20' || raw.id === 'archmage_21' || raw.id === 'archmage_22');

    return {
      imageNumber: mf?.image_number ?? idx + 1,
      id: raw.id,
      displayName: raw.displayName,
      archivePath: raw.sourcePNG,
      workspaceUrl: resolved.url,
      workspaceFilename: resolved.filename,
      assetFamily: raw.assetFamily,
      resolution: raw.resolution,
      pixelFormat: mf?.pixel_format ?? 'RGB',
      bytes: mf?.bytes ?? 0,
      sha256: sha,
      alphaClass,
      stage1Policy,
      stage1Operation: raw.stage1.operation,
      requiresReview: raw.stage1.requires_review,
      reviewCandidatePath: raw.stage1.reviewCandidate,
      requiresFrameExtraction: raw.requiresFrameExtraction,
      isFullSheetSpriteAtlas: raw.isFullSheetSpriteAtlas,
      edgeSamples: mf?.edge_samples ?? {
        white_fraction: 0,
        dark_fraction: 0,
        red_fraction: 0,
        median_chroma: 0,
      },
      alphaZeroFraction: mf?.sample_alpha_zero_fraction ?? 0,
      alphaSoftFraction: mf?.sample_alpha_soft_fraction ?? 0,
      v31InitialStatus: mf?.v31_validation ?? 'PENDING_FRAME_EXTRACTION',
      hintType: hint?.hint_type ?? 'none',
      verifiedFrameRegions: hint?.frame_regions ?? [],
      unverifiedRowCandidates: hint?.automatic_row_candidates ?? [],
      regionNotes: hint?.notes ?? '',
      recommendedEntityKind: isBossBoard ? 'tyrant' : 'player',
      sourceImmutable: true,
    };
  });

  const schemaAudit = auditManifestSchema(importDoc, manifestDoc, regionHintsDoc);

  return {
    importDoc,
    manifestDoc,
    contractDoc,
    regionHintsDoc,
    licensePresetsDoc,
    assets,
    schemaAudit,
  };
}

/** Browser async loader for the 36-file 4K bundle manifests */
export async function fetch4kBundleManifests(): Promise<Loaded4kBundle> {
  const [importDoc, manifestDoc, contractDoc, regionHintsDoc, licensePresetsDoc] =
    await Promise.all([
      fetch(BUNDLE_MANIFEST_URLS.pipelineImport).then((r) => {
        if (!r.ok) throw new Error(`Failed to load PIPELINE_STUDIO_IMPORT.json (${r.status})`);
        return r.json() as Promise<PipelineStudioImportDoc>;
      }),
      fetch(BUNDLE_MANIFEST_URLS.assetManifest).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ASSET_MANIFEST.json (${r.status})`);
        return r.json() as Promise<AssetManifestDoc>;
      }),
      fetch(BUNDLE_MANIFEST_URLS.v31Contract).then((r) => {
        if (!r.ok) throw new Error(`Failed to load PIPELINE_STUDIO_V31_CONTRACT.json (${r.status})`);
        return r.json() as Promise<V31ContractDoc>;
      }),
      fetch(BUNDLE_MANIFEST_URLS.regionHints).then((r) => {
        if (!r.ok) throw new Error(`Failed to load REGION_HINTS.json (${r.status})`);
        return r.json() as Promise<RegionHintsDoc>;
      }),
      fetch(BUNDLE_MANIFEST_URLS.licensePresets).then((r) => {
        if (!r.ok) throw new Error(`Failed to load EXTERNAL_PACK_LICENSE_PRESETS.json (${r.status})`);
        return r.json() as Promise<ExternalPackLicensePresetsDoc>;
      }),
    ]);

  return build4kBundleModel(
    importDoc,
    manifestDoc,
    contractDoc,
    regionHintsDoc,
    licensePresetsDoc
  );
}

/**
 * Stage 5 Fail-Closed Real-Frame Validator per PIPELINE_STUDIO_V31_CONTRACT.json.
 * - Never assumes pass status based on 4K input resolution.
 * - Blocks if 0 contiguous frames have been manually recovered (`fail_closed_if_frames_not_extracted: true`).
 * - Blocks studio-white candidates (15, 16, 24, 25) until explicitly approved.
 * - Executes all 9 contract tests on real normalized 64x64 / 128x128 frames.
 */
export function validateExtractedTrackV31(params: {
  asset: ResolvedSource4kAsset;
  outputSheet: RasterBuffer | null;
  frameCount: number;
  meta: V31TrackAuthoringMeta;
  candidateApproved: boolean;
  meanBeforeAfterDeltaE: number;
  p95BeforeAfterDeltaE: number;
  twoByTwoUniformity: number;
  maxPivotDeviationPx: number;
}): V31RealFrameValidationResult {
  const {
    asset,
    outputSheet,
    frameCount,
    meta,
    candidateApproved,
    meanBeforeAfterDeltaE,
    p95BeforeAfterDeltaE,
    twoByTwoUniformity,
    maxPivotDeviationPx,
  } = params;

  const targetCell = meta.targetKind === 'tyrant' ? 128 : 64;
  const targetPivot = meta.targetKind === 'tyrant' ? { x: 64, y: 104 } : { x: 32, y: 54 };

  // Fail-closed gate: zero extracted frames -> BLOCKED (never pass on raw 4K board resolution)
  if (!outputSheet || frameCount === 0) {
    const blockedTests: V31ContractCheckResult[] = [
      'exact_sheet_dimensions',
      '2x2_block_uniformity',
      'ink_perimeter_coverage',
      'mean_and_p95_CIEDE2000',
      'residual_halo_count',
      'feet_centroid_jitter',
      'hurtbox_containment_and_hitbox_overflow',
      'nonduplicate_adjacent_frames',
      'animation_timing_contract',
    ].map((testId) => ({
      testId,
      label: testId.replace(/_/g, ' '),
      status: 'blocked',
      detail: 'Blocked: extract contiguous frames in Stage 2 first (fail_closed_if_frames_not_extracted).',
    }));

    return {
      verdict: asset.stage1Policy.isUnapprovedCandidate
        ? 'UNAPPROVED_CANDIDATE'
        : 'BLOCKED_PENDING_FRAME_EXTRACTION',
      checks: blockedTests,
      sheetValidation: null,
      blockingReasons: [
        asset.requiresFrameExtraction
          ? 'No isolated contiguous frames extracted yet. Raw 4K concept/reference boards cannot pass V3.1 validation.'
          : 'Flattened opaque UI/scene composite (`requiresFrameExtraction: false`). Must remain un-keyed unless a specific UI sub-element is manually cropped.',
        ...(asset.stage1Policy.isUnapprovedCandidate && !candidateApproved
          ? ['Studio-white candidate (sheets 15, 16, 24, 25) requires manual visual approval.']
          : []),
      ],
      meanBeforeAfterDeltaE: 0,
      p95BeforeAfterDeltaE: 0,
      twoByTwoUniformity: 0,
      maxPivotDeviationPx: 0,
    };
  }

  // Run isomorphic high-precision pixel validator on the real extracted & normalized strip
  const sheetVal = validateSheetBuffer(outputSheet, {
    assetId: `${asset.id}_${meta.state}_${meta.direction}`,
    name: `${asset.displayName} (${meta.state})`,
    category: meta.entityClass === 'player' ? 'mage' : meta.entityClass,
    frameWidth: targetCell,
    frameHeight: targetCell,
    columns: frameCount,
    rows: 1,
    animations: [
      {
        state: meta.state,
        direction: meta.direction,
        row: 0,
        frameCount,
        fps: meta.fps,
        loop: meta.loop,
        pivot: targetPivot,
        hitbox: meta.hitbox,
        hurtbox: meta.hurtbox,
      },
    ],
  });

  // Check single-track V3.1 timing parity against the entity class spec
  const classSpecs = V31_STATE_TIMING_SPECS[meta.entityClass];
  const matchedSpec = classSpecs.find((s) => s.state === meta.state);
  const timingPassed = matchedSpec
    ? frameCount === matchedSpec.frames && meta.fps === matchedSpec.fps
    : frameCount >= 2 && meta.fps >= 4 && meta.fps <= 20;

  const uniformityPassed = twoByTwoUniformity >= 0.98 && sheetVal.pixelDensity2xValid;
  const inkPassed =
    meta.entityClass === 'vfx' ? true : sheetVal.outlineInkPresent && sheetVal.outlinePerimeterCoverage >= 55;
  const deltaEPassed = p95BeforeAfterDeltaE <= 9.0;
  const haloPassed = meta.entityClass === 'vfx' ? true : sheetVal.residualHaloPixels === 0;
  const jitterPassed =
    meta.entityClass === 'vfx' ? true : sheetVal.maxPivotJitterPx <= 4.0 && maxPivotDeviationPx <= 6.0;
  const collisionPassed =
    meta.entityClass === 'vfx'
      ? true
      : sheetVal.pivotsAndBoxesValid &&
        sheetVal.hurtboxContainmentPct >= 45 &&
        sheetVal.hitboxOverflowPct <= 35;
  const nonDupPassed = sheetVal.duplicateAdjacentFrames === 0 && sheetVal.nonEmptyFrames === frameCount;

  const checks: V31ContractCheckResult[] = [
    {
      testId: 'exact_sheet_dimensions',
      label: 'Exact sheet dimensions',
      status: sheetVal.dimensionsValid ? 'pass' : 'fail',
      detail: `${sheetVal.sheetDimensions} (expected ${frameCount * targetCell}×${targetCell})`,
    },
    {
      testId: '2x2_block_uniformity',
      label: '2×2 block uniformity',
      status: uniformityPassed ? 'pass' : 'fail',
      detail: `${(twoByTwoUniformity * 100).toFixed(1)}% uniform (threshold ≥ 98%)`,
    },
    {
      testId: 'ink_perimeter_coverage',
      label: '#140E1D ink perimeter coverage',
      status: inkPassed ? 'pass' : 'fail',
      detail:
        meta.entityClass === 'vfx'
          ? 'Soft-alpha VFX track (outline exempt)'
          : `${sheetVal.outlinePerimeterCoverage}% perimeter coverage`,
    },
    {
      testId: 'mean_and_p95_CIEDE2000',
      label: 'Mean & P95 CIEDE2000 ΔE',
      status: deltaEPassed ? 'pass' : 'fail',
      detail: `Shift Mean ${meanBeforeAfterDeltaE} / P95 ${p95BeforeAfterDeltaE} (snap max ≤ 9.0) · Rift ΔE ${sheetVal.meanDeltaE}`,
    },
    {
      testId: 'residual_halo_count',
      label: 'Residual halo count',
      status: haloPassed ? 'pass' : 'fail',
      detail: `${sheetVal.residualHaloPixels} light-neutral edge halo px`,
    },
    {
      testId: 'feet_centroid_jitter',
      label: 'Feet-centroid jitter & pivot lock',
      status: jitterPassed ? 'pass' : 'fail',
      detail: `Jitter ${sheetVal.maxPivotJitterPx}px (≤ 4px) · Pivot dev ${maxPivotDeviationPx}px to (${targetPivot.x},${targetPivot.y})`,
    },
    {
      testId: 'hurtbox_containment_and_hitbox_overflow',
      label: 'Hurtbox containment & hitbox overflow',
      status: collisionPassed ? 'pass' : 'fail',
      detail: `Hurtbox fit ${sheetVal.hurtboxContainmentPct}% · Hitbox overflow ${sheetVal.hitboxOverflowPct}%`,
    },
    {
      testId: 'nonduplicate_adjacent_frames',
      label: 'Non-duplicate adjacent frames',
      status: nonDupPassed ? 'pass' : 'fail',
      detail: `${sheetVal.nonEmptyFrames}/${frameCount} non-empty · ${sheetVal.duplicateAdjacentFrames} adjacent duplicates`,
    },
    {
      testId: 'animation_timing_contract',
      label: 'V3.1 animation timing contract',
      status: timingPassed ? 'pass' : 'fail',
      detail: matchedSpec
        ? `${meta.state}: ${frameCount}f @ ${meta.fps} FPS (V3.1 requires ${matchedSpec.frames}f @ ${matchedSpec.fps} FPS)`
        : `${meta.state}: ${frameCount}f @ ${meta.fps} FPS (custom state)`,
    },
  ];

  const blockingReasons: string[] = [];
  if (asset.stage1Policy.isUnapprovedCandidate && !candidateApproved) {
    blockingReasons.push(
      'Studio-white candidate (15/16/24/25) has not been manually approved in Stage 1.'
    );
  }
  for (const c of checks) {
    if (c.status === 'fail') {
      blockingReasons.push(`${c.label}: ${c.detail}`);
    }
  }

  let verdict: V31ValidationVerdict;
  if (asset.stage1Policy.isUnapprovedCandidate && !candidateApproved) {
    verdict = 'UNAPPROVED_CANDIDATE';
  } else if (checks.some((c) => c.status === 'fail')) {
    verdict = 'FAIL';
  } else {
    verdict = 'PASS_VERIFIED';
  }

  return {
    verdict,
    checks,
    sheetValidation: {
      ...sheetVal,
      passed: verdict === 'PASS_VERIFIED',
      timingContractValid: timingPassed,
      notes: blockingReasons,
    },
    blockingReasons,
    meanBeforeAfterDeltaE,
    p95BeforeAfterDeltaE,
    twoByTwoUniformity,
    maxPivotDeviationPx,
  };
}
