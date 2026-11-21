import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './pixelCanvas.ts';
import { STYLE_CONTRACT } from './styleContract.ts';
import {
  HighPrecisionValidationItem,
  validateSheetBuffer,
} from '../src/pipeline/frameValidator.ts';

function validateAll(): void {
  const masterPath = path.resolve(process.cwd(), 'public/assets/manifest.json');
  const master = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const results: HighPrecisionValidationItem[] = [];

  for (const asset of master.assets) {
    const pngPath = path.resolve(process.cwd(), 'public', asset.sheetUrl.replace(/^\//, ''));
    const buf = fs.readFileSync(pngPath);
    const png = decodePNG(buf);
    const item = validateSheetBuffer(
      { width: png.width, height: png.height, data: png.data },
      asset,
      STYLE_CONTRACT.timing
    );
    results.push(item);
  }

  const avgMeanDeltaE =
    results.length > 0
      ? Number((results.reduce((sum, r) => sum + r.meanDeltaE, 0) / results.length).toFixed(2))
      : 0;

  const outlineTracked = results.filter((r) => r.category !== 'vfx');
  const avgOutlineCoverage =
    outlineTracked.length > 0
      ? Number(
          (
            outlineTracked.reduce((sum, r) => sum + r.outlinePerimeterCoverage, 0) /
            outlineTracked.length
          ).toFixed(1)
        )
      : 100;

  const totalResidualHaloPixels = results.reduce((sum, r) => sum + r.residualHaloPixels, 0);

  const report = {
    styleContractVersion: STYLE_CONTRACT.version,
    pipelineVersion: 'v3.1-cielab-contour-pivot-pipeline',
    validatedAt: new Date().toISOString(),
    totalSheets: results.length,
    passedSheets: results.filter((r) => r.passed).length,
    totalFramesValidated: results.reduce((sum, r) => sum + r.totalFrames, 0),
    totalDuplicateAdjacentFrames: results.reduce((sum, r) => sum + r.duplicateAdjacentFrames, 0),
    pixelDensity2xPassed: results.filter((r) => r.pixelDensity2xValid).length,
    outlineInkPassed: results.filter((r) => r.outlineInkPresent).length,
    timingContractPassed: results.filter((r) => r.timingContractValid).length,
    avgMeanDeltaE,
    avgOutlineCoverage,
    totalResidualHaloPixels,
    results,
  };

  const reportPath = path.resolve(process.cwd(), 'public/assets/validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(
    `Validated ${report.passedSheets}/${report.totalSheets} sheets (${report.totalFramesValidated} frames, ${report.totalDuplicateAdjacentFrames} adjacent duplicates, ${report.pixelDensity2xPassed}/${report.totalSheets} 2x-density, ${report.timingContractPassed}/${report.totalSheets} timing-contract, avg Mean ΔE=${report.avgMeanDeltaE}, avg Outline=${report.avgOutlineCoverage}%, halos=${report.totalResidualHaloPixels}px).`
  );
  for (const r of results) {
    if (!r.passed || r.notes.length > 0) {
      const marker = r.passed ? ' [~]' : ' [!]';
      console.log(`${marker} ${r.assetId}: ${r.notes.join('; ')}`);
    }
  }
}

validateAll();
