import type { ValidationItem, ValidationReport } from '../types/game';

export type CsvGranularity = 'track' | 'sheet';

export interface QaExportMeta {
  styleContractVersion?: string;
  pipelineVersion?: string;
  validatedAt?: string;
  scopeLabel?: string;
}

/** Escapes a single field according to RFC-4180 CSV rules */
function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a full or filtered set of validation results as a structured, pretty-printed
 * JSON QA review log with aggregate metrics and per-track frame diagnostics.
 */
export function formatValidationReportJson(
  items: ValidationItem[],
  meta?: QaExportMeta
): string {
  const passedSheets = items.filter((r) => r.passed).length;
  const totalFramesValidated = items.reduce((sum, r) => sum + r.totalFrames, 0);
  const totalDuplicateAdjacentFrames = items.reduce(
    (sum, r) => sum + r.duplicateAdjacentFrames,
    0
  );
  const totalResidualHaloPixels = items.reduce(
    (sum, r) => sum + (r.residualHaloPixels ?? 0),
    0
  );
  const deTracked = items.filter((r) => r.meanDeltaE !== undefined);
  const avgMeanDeltaE =
    deTracked.length > 0
      ? Number(
          (
            deTracked.reduce((sum, r) => sum + (r.meanDeltaE ?? 0), 0) /
            deTracked.length
          ).toFixed(2)
        )
      : 0;
  const outlineTracked = items.filter(
    (r) => r.category !== 'vfx' && r.outlinePerimeterCoverage !== undefined
  );
  const avgOutlineCoverage =
    outlineTracked.length > 0
      ? Number(
          (
            outlineTracked.reduce(
              (sum, r) => sum + (r.outlinePerimeterCoverage ?? 0),
              0
            ) / outlineTracked.length
          ).toFixed(1)
        )
      : 100;

  const payload = {
    reportType: 'archmage_riftbound_qa_validation_log',
    exportedAt: new Date().toISOString(),
    validatedAt: meta?.validatedAt ?? new Date().toISOString(),
    styleContractVersion: meta?.styleContractVersion ?? '3.1',
    pipelineVersion: meta?.pipelineVersion ?? 'v3.1-cielab-contour-pivot-pipeline',
    scope: meta?.scopeLabel ?? 'all_sheets',
    summary: {
      totalSheets: items.length,
      passedSheets,
      failedSheets: items.length - passedSheets,
      totalFramesValidated,
      totalDuplicateAdjacentFrames,
      pixelDensity2xPassed: items.filter((r) => r.pixelDensity2xValid !== false).length,
      outlineInkPassed: items.filter((r) => r.outlineInkPresent !== false).length,
      timingContractPassed: items.filter((r) => r.timingContractValid !== false).length,
      avgMeanDeltaE,
      avgOutlineCoverage,
      totalResidualHaloPixels,
    },
    sheets: items,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Formats validation items as an RFC-4180 CSV log file for spreadsheet or external QA ingestion.
 * - `track` granularity: one row per animation track with frame count, FPS, CIEDE2000 ΔE,
 *   outline perimeter coverage, halos, temporal pivot jitter, and hurtbox/hitbox containment.
 * - `sheet` granularity: one summary row per sprite sheet.
 */
export function formatValidationReportCsv(
  items: ValidationItem[],
  meta?: QaExportMeta,
  granularity: CsvGranularity = 'track'
): string {
  const validatedAt = meta?.validatedAt ?? new Date().toISOString();
  const pipelineVersion = meta?.pipelineVersion ?? 'v3.1-cielab-contour-pivot-pipeline';

  if (granularity === 'sheet') {
    const headers = [
      'asset_id',
      'asset_name',
      'category',
      'sheet_dimensions',
      'expected_dimensions',
      'dimensions_valid',
      'transparent_bg',
      'density_2x_valid',
      'outline_ink_present',
      'timing_contract_valid',
      'non_empty_frames',
      'total_frames',
      'duplicate_adjacent_frames',
      'mean_delta_e',
      'p95_delta_e',
      'outline_coverage_pct',
      'residual_halo_px',
      'max_pivot_jitter_px',
      'hurtbox_containment_pct',
      'hitbox_overflow_pct',
      'track_count',
      'passed',
      'notes',
      'pipeline_version',
      'validated_at',
    ];

    const rows = items.map((r) =>
      [
        r.assetId,
        r.name,
        r.category,
        r.sheetDimensions,
        r.expectedDimensions,
        r.dimensionsValid,
        r.transparentBackground,
        r.pixelDensity2xValid ?? true,
        r.outlineInkPresent ?? true,
        r.timingContractValid ?? true,
        r.nonEmptyFrames,
        r.totalFrames,
        r.duplicateAdjacentFrames,
        r.meanDeltaE ?? '',
        r.p95DeltaE ?? '',
        r.outlinePerimeterCoverage ?? '',
        r.residualHaloPixels ?? 0,
        r.maxPivotJitterPx ?? '',
        r.hurtboxContainmentPct ?? '',
        r.hitboxOverflowPct ?? '',
        r.trackDiagnostics?.length ?? 0,
        r.passed ? 'PASS' : 'REVIEW',
        r.notes.join(' | '),
        pipelineVersion,
        validatedAt,
      ]
        .map(csvEscape)
        .join(',')
    );

    return [headers.join(','), ...rows].join('\r\n');
  }

  // Per-track frame-by-frame audit CSV
  const headers = [
    'asset_id',
    'asset_name',
    'category',
    'sheet_dimensions',
    'track_row',
    'state',
    'direction',
    'frame_count',
    'fps',
    'track_mean_delta_e',
    'sheet_p95_delta_e',
    'outline_coverage_pct',
    'residual_halo_px',
    'max_pivot_jitter_px',
    'hurtbox_containment_pct',
    'hitbox_overflow_pct',
    'duplicate_adjacent_frames',
    'density_2x_valid',
    'timing_contract_valid',
    'sheet_passed',
    'notes',
    'pipeline_version',
    'validated_at',
  ];

  const rows: string[] = [];
  for (const r of items) {
    const tracks = r.trackDiagnostics ?? [];
    if (tracks.length === 0) {
      rows.push(
        [
          r.assetId,
          r.name,
          r.category,
          r.sheetDimensions,
          0,
          'sheet_summary',
          'down',
          r.totalFrames,
          '',
          r.meanDeltaE ?? '',
          r.p95DeltaE ?? '',
          r.outlinePerimeterCoverage ?? '',
          r.residualHaloPixels ?? 0,
          r.maxPivotJitterPx ?? '',
          r.hurtboxContainmentPct ?? '',
          r.hitboxOverflowPct ?? '',
          r.duplicateAdjacentFrames,
          r.pixelDensity2xValid ?? true,
          r.timingContractValid ?? true,
          r.passed ? 'PASS' : 'REVIEW',
          r.notes.join(' | '),
          pipelineVersion,
          validatedAt,
        ]
          .map(csvEscape)
          .join(',')
      );
      continue;
    }

    for (const td of tracks) {
      rows.push(
        [
          r.assetId,
          r.name,
          r.category,
          r.sheetDimensions,
          td.row,
          td.state,
          td.direction,
          td.frameCount,
          td.fps,
          td.meanDeltaE,
          r.p95DeltaE ?? '',
          td.outlinePerimeterCoverage,
          td.residualHaloPixels,
          td.maxPivotJitterPx,
          td.hurtboxContainmentPct,
          td.hitboxOverflowPct,
          td.duplicateAdjacentFrames,
          r.pixelDensity2xValid ?? true,
          r.timingContractValid ?? true,
          r.passed ? 'PASS' : 'REVIEW',
          r.notes.join(' | '),
          pipelineVersion,
          validatedAt,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }

  return [headers.join(','), ...rows].join('\r\n');
}

export function buildExportTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function triggerTextDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportValidationReportFile(
  items: ValidationItem[],
  format: 'json' | 'csv',
  options?: {
    granularity?: CsvGranularity;
    reportMeta?: Partial<ValidationReport>;
    scopeLabel?: string;
    filenamePrefix?: string;
  }
): void {
  const granularity = options?.granularity ?? 'track';
  const meta: QaExportMeta = {
    styleContractVersion: options?.reportMeta?.styleContractVersion ?? '3.1',
    pipelineVersion:
      options?.reportMeta?.pipelineVersion ?? 'v3.1-cielab-contour-pivot-pipeline',
    validatedAt: options?.reportMeta?.validatedAt ?? new Date().toISOString(),
    scopeLabel: options?.scopeLabel ?? 'all_sheets',
  };
  const prefix = options?.filenamePrefix ?? 'archmage_qa_validation';
  const stamp = buildExportTimestamp();

  if (format === 'json') {
    const json = formatValidationReportJson(items, meta);
    triggerTextDownload(json, `${prefix}_${stamp}.json`, 'application/json;charset=utf-8');
  } else {
    const csv = formatValidationReportCsv(items, meta, granularity);
    triggerTextDownload(
      csv,
      `${prefix}_${granularity}_${stamp}.csv`,
      'text/csv;charset=utf-8'
    );
  }
}
