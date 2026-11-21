import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AssetManifestDoc,
  ExternalPackLicensePresetsDoc,
  PipelineStudioImportDoc,
  RegionHintsDoc,
  V31ContractDoc,
  build4kBundleModel,
} from '../src/pipeline/source4kManifest.ts';

const PUBLIC_ASSETS_DIR = path.resolve(process.cwd(), 'public/assets/aistudio');

function readJson<T>(filename: string): T {
  const fullPath = path.join(PUBLIC_ASSETS_DIR, filename);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T;
}

function sha256File(fullPath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(fullPath));
  return hash.digest('hex');
}

function main() {
  const importDoc = readJson<PipelineStudioImportDoc>('PIPELINE_STUDIO_IMPORT_37fa0e42.json');
  const manifestDoc = readJson<AssetManifestDoc>('ASSET_MANIFEST_a5fbddb9.json');
  const contractDoc = readJson<V31ContractDoc>('PIPELINE_STUDIO_V31_CONTRACT_f116fbe1.json');
  const regionHintsDoc = readJson<RegionHintsDoc>('REGION_HINTS_d990a445.json');
  const licensePresetsDoc = readJson<ExternalPackLicensePresetsDoc>(
    'EXTERNAL_PACK_LICENSE_PRESETS_fd5f099a.json'
  );

  const bundle = build4kBundleModel(
    importDoc,
    manifestDoc,
    contractDoc,
    regionHintsDoc,
    licensePresetsDoc
  );

  let verifiedShaCount = 0;
  const missingFiles: string[] = [];
  const shaMismatches: string[] = [];
  const byAlphaClass: Record<string, number> = {};
  const studioWhiteCandidates: string[] = [];
  let globalKeyBypassedCount = 0;

  for (const asset of bundle.assets) {
    byAlphaClass[asset.alphaClass] = (byAlphaClass[asset.alphaClass] ?? 0) + 1;
    if (asset.stage1Policy.bypassGlobalKeying) globalKeyBypassedCount += 1;
    if (asset.stage1Policy.isUnapprovedCandidate) {
      studioWhiteCandidates.push(`#${asset.imageNumber} (${asset.id})`);
    }

    const diskPath = path.join(PUBLIC_ASSETS_DIR, asset.workspaceFilename);
    if (!fs.existsSync(diskPath)) {
      missingFiles.push(asset.workspaceFilename);
      continue;
    }

    const actualHash = sha256File(diskPath);
    if (actualHash === asset.sha256) {
      verifiedShaCount += 1;
    } else {
      shaMismatches.push(`${asset.id}: expected ${asset.sha256.slice(0, 12)}, got ${actualHash.slice(0, 12)}`);
    }
  }

  const report = {
    sourceImmutable: true,
    totalDeclaredAssets: bundle.assets.length,
    verifiedSha256Files: verifiedShaCount,
    missingFiles,
    shaMismatches,
    byAlphaClass,
    globalKeyBypassedCount,
    unapprovedStudioWhiteCandidates: studioWhiteCandidates,
    verifiedPassSheets: 0,
    failClosedNote:
      '0/36 sheets pass V3.1 validation prior to manual contiguous frame extraction, normalization, and visual sign-off.',
    schemaAudit: bundle.schemaAudit,
  };

  console.log(JSON.stringify(report, null, 2));

  if (missingFiles.length > 0 || shaMismatches.length > 0) {
    process.exitCode = 1;
  }
}

main();
