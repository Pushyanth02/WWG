import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './pixelCanvas.ts';
import { STYLE_CONTRACT } from './styleContract.ts';
import {
  RasterBuffer,
  applyDirectionalShading,
  applyFullBodyArticulation,
  applyHiBitDepthPass,
  applyPostOutlineEffect,
  blitRaster,
  createRaster,
  drawGlow,
  drawRing,
  ensureDistinctFrame,
  flipRasterHorizontal,
  hexToRgba,
  setPixelBlend,
  setPixelRaw,
  upscaleRaster,
} from '../src/pipeline/raster.ts';
import {
  buildAllVfxUpgraded,
  buildNewBosses,
  buildNewBossPortraitsHalf,
  buildNewEnemies,
} from './expandedRosterAndVfx.ts';
import {
  quantizeRiftNightLab,
  recolorBlueMageBuffer,
  remapBufferHue,
} from '../src/pipeline/colorQuantizer.ts';
import { BackdropMode } from '../src/pipeline/alphaCleanup.ts';
import {
  BBox,
  SegmentOptions,
  extractTightSprite,
  segmentBandSprites,
} from '../src/pipeline/segmentation.ts';
import { resampleToCalibratedCell } from '../src/pipeline/pivotCalibrator.ts';

type Direction = 'down' | 'up' | 'left' | 'right';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AnimEvent {
  frame: number;
  name: string;
}

interface AnimationEntry {
  state: string;
  direction: Direction;
  row: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  pivot: { x: number; y: number };
  hitbox: Box;
  hurtbox: Box;
  events: AnimEvent[];
}

export interface AssetManifest {
  assetId: string;
  name: string;
  category: 'mage' | 'enemy' | 'boss' | 'vfx' | 'environment' | 'icons';
  subtitle: string;
  sheetUrl: string;
  manifestUrl: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  animations: AnimationEntry[];
  tags?: string[];
  integratedInDemo: boolean;
}

const SRC_DIR = path.resolve(process.cwd(), 'public/assets/aistudio');
const OUT_DIR = path.resolve(process.cwd(), 'public/assets/sprites');
fs.mkdirSync(OUT_DIR, { recursive: true });

const DIRS: Direction[] = ['down', 'up', 'left', 'right'];

const sourceCache = new Map<string, RasterBuffer>();
const loadedSourceFiles = new Set<string>();
let totalAdaptiveSeamCuts = 0;
let totalCalibratedFrames = 0;

function loadSourceRaster(filename: string): RasterBuffer {
  const fullPath = path.join(SRC_DIR, filename);
  loadedSourceFiles.add(filename);
  const cached = sourceCache.get(fullPath);
  if (cached) return cached;
  const decoded = decodePNG(fs.readFileSync(fullPath));
  const buf: RasterBuffer = {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
  };
  sourceCache.set(fullPath, buf);
  return buf;
}

/** Removes all legacy/stale PNG and JSON sprite outputs prior to fresh ingestion */
function purgeLegacySpriteOutputs(): number {
  let removed = 0;
  if (!fs.existsSync(OUT_DIR)) return 0;
  for (const entry of fs.readdirSync(OUT_DIR)) {
    if (entry.endsWith('.png') || entry.endsWith('.json')) {
      fs.unlinkSync(path.join(OUT_DIR, entry));
      removed++;
    }
  }
  return removed;
}

function writeAsset(manifest: AssetManifest, sheet: RasterBuffer): void {
  const pngPath = path.join(OUT_DIR, `${manifest.assetId}.png`);
  const jsonPath = path.join(OUT_DIR, `${manifest.assetId}.json`);
  fs.writeFileSync(pngPath, encodePNG(sheet.width, sheet.height, sheet.data));
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));
}

function extractBand(
  src: RasterBuffer,
  region: BBox,
  mode: BackdropMode = 'auto',
  options?: SegmentOptions
): RasterBuffer[] {
  const seg = segmentBandSprites(src, region, mode, options);
  totalAdaptiveSeamCuts += seg.seamCuts.length;
  return seg.sprites.map((s) => s.buffer);
}

/** Smoothly samples `needed` frames across a source sequence */
function sampleSequence<T>(frames: T[], needed: number): T[] {
  if (frames.length === 0) throw new Error('Empty source frame array');
  const out: T[] = [];
  for (let i = 0; i < needed; i++) {
    const idx =
      needed === 1
        ? 0
        : Math.min(frames.length - 1, Math.round((i / (needed - 1)) * (frames.length - 1)));
    out.push(frames[idx]);
  }
  return out;
}

// ============================================================================
// 1. SIX PLAYABLE MAGES (image_abe57f87.png + image_fccd2ef6.png)
// ============================================================================

interface MageClassConfig {
  id: string;
  name: string;
  subtitle: string;
  robeHue: number;
  robeSatScale: number;
  robeLumShift: number;
  orbHue: number;
  accentHex: string;
}

const MAGE_CONFIGS: MageClassConfig[] = [
  {
    id: 'mage_pyromancer',
    name: 'Pyromancer',
    subtitle: 'Ember-robed fire archmage',
    robeHue: 356,
    robeSatScale: 1.05,
    robeLumShift: -0.02,
    orbHue: 28,
    accentHex: '#FF7B29',
  },
  {
    id: 'mage_cryomancer',
    name: 'Cryomancer',
    subtitle: 'Glacier-crowned frostweaver',
    robeHue: 222,
    robeSatScale: 0.96,
    robeLumShift: 0.0,
    orbHue: 186,
    accentHex: '#58D6C2',
  },
  {
    id: 'mage_stormcaller',
    name: 'Stormcaller',
    subtitle: 'Tempest-cloaked lightning savant',
    robeHue: 266,
    robeSatScale: 1.0,
    robeLumShift: -0.02,
    orbHue: 50,
    accentHex: '#A991F7',
  },
  {
    id: 'mage_voidweaver',
    name: 'Voidweaver',
    subtitle: 'Rift-hooded entropy channeler',
    robeHue: 284,
    robeSatScale: 0.42,
    robeLumShift: -0.14,
    orbHue: 294,
    accentHex: '#DF8CFF',
  },
  {
    id: 'mage_aethermancer',
    name: 'Aethermancer',
    subtitle: 'Aether-bound arcane scholar',
    robeHue: 174,
    robeSatScale: 0.88,
    robeLumShift: -0.04,
    orbHue: 168,
    accentHex: '#58D6C2',
  },
  {
    id: 'mage_chronomancer',
    name: 'Chronomancer',
    subtitle: 'Haloed keeper of Rift time',
    robeHue: 244,
    robeSatScale: 0.65,
    robeLumShift: -0.06,
    orbHue: 44,
    accentHex: '#D9BA72',
  },
];

function buildAllMages(): AssetManifest[] {
  const sheetRaw = loadSourceRaster('image_abe57f87.png');
  const sheetCast = loadSourceRaster('image_fccd2ef6.png');
  const sheetRef = loadSourceRaster('image_d7db875b.png');
  const sheetStrips = loadSourceRaster('image_dfe3c9c6.png');

  // Hybrid band segmentation + autonomous checkerboard/white/alpha decontamination
  const idleDown = extractBand(sheetRaw, { x: 0, y: 0, w: 1199, h: 134 }, 'checker', { mergeGap: 4 });
  const walkDown = extractBand(sheetRaw, { x: 0, y: 134, w: 1199, h: 130 }, 'checker', { mergeGap: 4 });
  const walkUp = extractBand(sheetRaw, { x: 0, y: 264, w: 1199, h: 128 }, 'checker', { mergeGap: 4 });
  const walkLeft = extractBand(sheetRaw, { x: 0, y: 392, w: 1199, h: 120 }, 'checker', { mergeGap: 4 });
  const walkRight = extractBand(sheetRaw, { x: 0, y: 512, w: 1199, h: 118 }, 'checker', { mergeGap: 4 });
  const castRightRaw = extractBand(sheetRaw, { x: 0, y: 630, w: 1199, h: 130 }, 'checker', { mergeGap: 4 });
  const hitRow = extractBand(sheetRaw, { x: 0, y: 765, w: 1199, h: 125 }, 'checker', { mergeGap: 4 });
  const deathRow = extractBand(sheetRaw, { x: 0, y: 892, w: 1199, h: 112 }, 'checker', { mergeGap: 4 });
  const blinkRow = extractBand(sheetRaw, { x: 0, y: 1008, w: 1199, h: 134 }, 'checker', { mergeGap: 6 });
  const victoryRow = extractBand(sheetRaw, { x: 0, y: 1142, w: 1199, h: 165 }, 'checker', { mergeGap: 6 });

  const castDown = extractBand(sheetCast, { x: 1006, y: 240, w: 524, h: 78 }, 'checker', { mergeGap: 3, expectedCount: 6 });
  const castUp = extractBand(sheetCast, { x: 1006, y: 344, w: 524, h: 86 }, 'checker', { mergeGap: 3, expectedCount: 6 });
  const castLeft = extractBand(sheetCast, { x: 1006, y: 454, w: 524, h: 86 }, 'checker', { mergeGap: 3, expectedCount: 6 });
  const castRight = extractBand(sheetCast, { x: 1006, y: 560, w: 524, h: 80 }, 'checker', { mergeGap: 3, expectedCount: 6 });

  // Authentic 6-frame Revive/Respawn sequence from image_d7db875b.png
  const reviveRow = extractBand(sheetRef, { x: 500, y: 904, w: 685, h: 80 }, 'white', { mergeGap: 8 });
  // Authentic high-res Cast VFX & Soul-Flame Death finale from image_dfe3c9c6.png
  const castVfxStrip = extractBand(sheetStrips, { x: 200, y: 20, w: 1150, h: 120 }, 'alpha', { mergeGap: 4 });
  const soulFlameDeath = extractTightSprite(sheetStrips, { x: 965, y: 874, w: 125, h: 122 }, 'alpha');

  const mageStates: { state: string; frames: number; fps: number; loop: boolean; events: AnimEvent[] }[] = [
    { state: 'idle', frames: 4, fps: 6, loop: true, events: [] },
    { state: 'walk', frames: 6, fps: 10, loop: true, events: [{ frame: 1, name: 'footstep_l' }, { frame: 4, name: 'footstep_r' }] },
    { state: 'cast', frames: 5, fps: 12, loop: false, events: [{ frame: 2, name: 'cast_release' }] },
    { state: 'attack', frames: 5, fps: 12, loop: false, events: [{ frame: 2, name: 'spell_impact' }] },
    { state: 'hit', frames: 3, fps: 10, loop: false, events: [{ frame: 0, name: 'stagger_start' }] },
    { state: 'blink', frames: 4, fps: 14, loop: false, events: [{ frame: 1, name: 'phase_out' }, { frame: 3, name: 'phase_in' }] },
    { state: 'downed', frames: 3, fps: 4, loop: true, events: [] },
    { state: 'revive', frames: 4, fps: 8, loop: false, events: [{ frame: 3, name: 'revive_complete' }] },
    { state: 'death', frames: 5, fps: 8, loop: false, events: [{ frame: 3, name: 'soul_release' }] },
  ];

  const getMageBaseSource = (state: string, dir: Direction, count: number): RasterBuffer[] => {
    if (state === 'idle') {
      if (dir === 'down') return sampleSequence(idleDown, count);
      if (dir === 'up') return sampleSequence([walkUp[0], walkUp[3], walkUp[4], walkUp[7]], count);
      if (dir === 'left') return sampleSequence([walkLeft[0], walkLeft[3], walkLeft[4], walkLeft[7]], count);
      return sampleSequence([walkRight[0], walkRight[3], walkRight[4], walkRight[7]], count);
    }
    if (state === 'walk') {
      if (dir === 'down') return sampleSequence(walkDown, count);
      if (dir === 'up') return sampleSequence(walkUp, count);
      if (dir === 'left') return sampleSequence(walkLeft, count);
      return sampleSequence(walkRight, count);
    }
    if (state === 'cast') {
      if (dir === 'down') return sampleSequence(castDown, count);
      if (dir === 'up') return sampleSequence(castUp, count);
      if (dir === 'left') return sampleSequence(castLeft, count);
      return sampleSequence(castRight, count);
    }
    if (state === 'attack') {
      const atkSeq = castVfxStrip.length >= 5 ? castVfxStrip.slice(2) : castRightRaw.slice(2);
      if (dir === 'right') return sampleSequence(atkSeq, count);
      if (dir === 'left') return sampleSequence(atkSeq, count).map(flipRasterHorizontal);
      if (dir === 'up') return sampleSequence(castUp.slice(1), count);
      return sampleSequence(victoryRow.slice(1, 6), count);
    }
    if (state === 'hit') {
      const seq = sampleSequence(hitRow.slice(1, 4), count);
      return dir === 'left' ? seq.map(flipRasterHorizontal) : seq;
    }
    if (state === 'blink') {
      const seq = sampleSequence([blinkRow[0], blinkRow[1], blinkRow[3], blinkRow[5]], count);
      return dir === 'left' ? seq.map(flipRasterHorizontal) : seq;
    }
    if (state === 'downed') {
      const fallen = deathRow[deathRow.length - 1];
      const seq = [fallen, fallen, fallen];
      return dir === 'left' ? seq.map(flipRasterHorizontal) : seq;
    }
    if (state === 'revive') {
      const seq =
        reviveRow.length >= 4
          ? sampleSequence(reviveRow, count)
          : sampleSequence([blinkRow[3], blinkRow[4], victoryRow[3], idleDown[0]], count);
      return dir === 'left' ? seq.map(flipRasterHorizontal) : seq;
    }
    const deathSeq =
      deathRow.length >= 4
        ? [deathRow[0], deathRow[1], deathRow[3], deathRow[deathRow.length - 1], soulFlameDeath]
        : sampleSequence(deathRow, count);
    return dir === 'left' ? deathSeq.map(flipRasterHorizontal) : deathSeq;
  };

  const manifests: AssetManifest[] = [];

  for (const cfg of MAGE_CONFIGS) {
    const maxCols = Math.max(...mageStates.map((s) => s.frames));
    const totalRows = mageStates.length * DIRS.length;
    const sheet = createRaster(maxCols * 64, totalRows * 64);
    const animations: AnimationEntry[] = [];
    let row = 0;

    for (const st of mageStates) {
      for (const dir of DIRS) {
        const srcFrames = getMageBaseSource(st.state, dir, st.frames);
        let prevHash: string | null = null;

        for (let f = 0; f < st.frames; f++) {
          const rawSprite = srcFrames[f];
          const isLowPose = st.state === 'downed' || (st.state === 'death' && f >= 3);

          // Stage 3: Dynamic feet-centroid pivot calibration locked onto V3.1 half-res pivot (16, 27)
          const cal = resampleToCalibratedCell(rawSprite, 32, 32, {
            anchor: isLowPose ? 'bottom' : 'feet_pivot',
            maxW: isLowPose ? 26 : 24,
            maxH: isLowPose ? 15 : 24,
            targetPivotX: 16,
            targetPivotY: 27,
            offsetY: st.state === 'idle' && f % 2 === 1 ? -1 : 0,
            preserveSoftAlpha: st.state === 'blink' && (f === 1 || f === 2),
          });
          totalCalibratedFrames++;

          // Stage 4: Selective class hue mapping + full-body articulation + hi-bit 2x depth + CIELAB Rift Night quantization
          let colored = recolorBlueMageBuffer(
            cal.buffer,
            cfg.robeHue,
            cfg.robeSatScale,
            cfg.robeLumShift,
            cfg.orbHue
          );
          colored = applyFullBodyArticulation(colored, st.state, f, st.frames, dir);
          colored = applyHiBitDepthPass(colored, {
            rimStrength: 0.24,
            aoStrength: 0.2,
            rimTint: hexToRgba('#F7E3A6'),
          });

          let styled = quantizeRiftNightLab(colored, {
            mode: 'hybrid_lab',
            cohesionStrength: 0.36,
            addOutline: !(st.state === 'blink' && f === 2),
            addGroundShadow: st.state !== 'death' && st.state !== 'blink',
            shadowY: 28,
            shadowRx: 7,
            shadowRy: 2.2,
          }).buffer;

          // Stage 5: Post-outline translucent state VFX
          if (st.state === 'hit') {
            styled = applyPostOutlineEffect(styled, 'hit_flash', f, st.frames, cfg.accentHex);
          } else if (st.state === 'revive') {
            styled = applyPostOutlineEffect(styled, 'revive_glow', f, st.frames, cfg.accentHex);
          } else if (st.state === 'downed') {
            styled = applyPostOutlineEffect(styled, 'downed_pulse', f, st.frames, cfg.accentHex);
          }

          const deduped = ensureDistinctFrame(styled, prevHash, f);
          prevHash = deduped.hash;

          blitRaster(sheet, upscaleRaster(deduped.buffer, 2), f * 64, row * 64);
        }

        animations.push({
          state: st.state,
          direction: dir,
          row,
          frameCount: st.frames,
          fps: st.fps,
          loop: st.loop,
          pivot: { ...STYLE_CONTRACT.boxes.mage.pivot },
          hitbox: { ...STYLE_CONTRACT.boxes.mage.hitbox },
          hurtbox: { ...STYLE_CONTRACT.boxes.mage.hurtbox },
          events: st.events,
        });
        row++;
      }
    }

    const manifest: AssetManifest = {
      assetId: cfg.id,
      name: cfg.name,
      category: 'mage',
      subtitle: cfg.subtitle,
      sheetUrl: `/assets/sprites/${cfg.id}.png`,
      manifestUrl: `/assets/sprites/${cfg.id}.json`,
      frameWidth: 64,
      frameHeight: 64,
      columns: maxCols,
      rows: totalRows,
      animations,
      tags: ['playable', '64x64', '4-dir', '9-states', 'cielab-v3.1'],
      integratedInDemo: true,
    };
    writeAsset(manifest, sheet);
    manifests.push(manifest);
  }

  return manifests;
}

// ============================================================================
// 2. EIGHT ACTIVE ENEMIES (image_7c0891e3.png + image_050e7303.png)
// ============================================================================

interface EnemySpriteBank {
  id: string;
  name: string;
  subtitle: string;
  accentHex: string;
  integratedInDemo: boolean;
  tags: string[];
  idle: RasterBuffer[];
  walk: RasterBuffer[];
  windup: RasterBuffer[];
  attack: RasterBuffer[];
  recovery: RasterBuffer[];
  hit: RasterBuffer[];
  death: RasterBuffer[];
  tintHue?: number;
  tintSatScale?: number;
  tintLumShift?: number;
}

function buildAllEnemies(): AssetManifest[] {
  const sheetEnemies = loadSourceRaster('image_7c0891e3.png');
  const sheetMaster = loadSourceRaster('image_050e7303.png');

  // Adaptive minimum-energy vertical seam splitting cleanly separates touching frames (e.g., Skeleton Warrior)
  const skelWarrior = extractBand(sheetEnemies, { x: 15, y: 215, w: 745, h: 65 }, 'alpha', {
    mergeGap: 2,
    maxSpriteWidth: 68,
    expectedCount: 13,
  });
  const goblinShaman = extractBand(sheetEnemies, { x: 780, y: 75, w: 750, h: 62 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 13,
  });
  const wraith = extractBand(sheetEnemies, { x: 15, y: 345, w: 745, h: 92 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 13,
  });
  const skelArcher = extractBand(sheetEnemies, { x: 780, y: 215, w: 750, h: 65 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 13,
  });
  const goblinRaider = extractBand(sheetEnemies, { x: 20, y: 75, w: 740, h: 62 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 13,
  });

  const shieldKnight = extractBand(sheetMaster, { x: 610, y: 35, w: 360, h: 52 }, 'dark', {
    mergeGap: 2,
    expectedCount: 5,
  });
  const warlock = extractBand(sheetMaster, { x: 610, y: 140, w: 360, h: 50 }, 'dark', {
    mergeGap: 2,
    expectedCount: 5,
  });
  const golem = extractBand(sheetMaster, { x: 610, y: 190, w: 360, h: 52 }, 'dark', {
    mergeGap: 2,
    expectedCount: 5,
  });

  const from13 = (arr: RasterBuffer[]) => ({
    idle: [arr[0], arr[1], arr[0], arr[1]],
    walk: [arr[2], arr[3], arr[4], arr[2], arr[3], arr[4]],
    windup: [arr[4], arr[5], arr[5], arr[6]],
    attack: [arr[5], arr[6], arr[7], arr[7], arr[6]],
    recovery: [arr[6], arr[1], arr[0]],
    hit: [arr[8], arr[9], arr[8]],
    death: [arr[9], arr[10], arr[10], arr[11], arr[12]],
  });

  const from5 = (arr: RasterBuffer[]) => ({
    idle: [arr[0], arr[1], arr[0], arr[1]],
    walk: [arr[0], arr[1], arr[2], arr[1], arr[0], arr[2]],
    windup: [arr[0], arr[1], arr[2], arr[2]],
    attack: [arr[2], arr[3], arr[3], arr[2], arr[1]],
    recovery: [arr[2], arr[1], arr[0]],
    hit: [arr[4], arr[1], arr[0]],
    death: [arr[1], arr[4], arr[4], arr[4], arr[4]],
  });

  const banks: EnemySpriteBank[] = [
    {
      id: 'enemy_skeleton_warrior',
      name: 'Skeleton Warrior',
      subtitle: 'Armored bone-blade rusher',
      accentHex: '#D9BA72',
      integratedInDemo: true,
      tags: ['enemy', '64x64', '4-dir', '7-states'],
      ...from13(skelWarrior),
    },
    {
      id: 'enemy_cultist_acolyte',
      name: 'Cultist Acolyte',
      subtitle: 'Crimson-hooded rift caster',
      accentHex: '#E96578',
      integratedInDemo: true,
      tags: ['enemy', '64x64', '4-dir', '7-states'],
      ...from13(goblinShaman),
    },
    {
      id: 'enemy_shieldbone_knight',
      name: 'Shieldbone Knight',
      subtitle: 'Tower-shielded undead vanguard',
      accentHex: '#D9BA72',
      integratedInDemo: true,
      tags: ['enemy', '64x64', '4-dir', '7-states'],
      ...from5(shieldKnight),
    },
    {
      id: 'enemy_necromancer',
      name: 'Necromancer',
      subtitle: 'Arcane-cloaked soul summoner',
      accentHex: '#A991F7',
      integratedInDemo: true,
      tags: ['enemy', '64x64', '4-dir', '7-states'],
      ...from5(warlock),
    },
    {
      id: 'enemy_wraith',
      name: 'Wraith',
      subtitle: 'Phasing rift spectre',
      accentHex: '#DF8CFF',
      integratedInDemo: true,
      tags: ['enemy', '64x64', '4-dir', '7-states'],
      ...from13(wraith),
    },
    {
      id: 'enemy_bone_archer',
      name: 'Bone Archer',
      subtitle: 'Undead Crypt sniper with telegraphed bolt volley',
      accentHex: '#58D6C2',
      integratedInDemo: true,
      tags: ['enemy', 'batch-2', '64x64', '4-dir', '7-states', 'undead-crypt'],
      ...from13(skelArcher),
    },
    {
      id: 'enemy_plaguebearer',
      name: 'Plaguebearer',
      subtitle: 'Blighted Marsh toxic rusher',
      accentHex: '#9BE870',
      integratedInDemo: true,
      tags: ['enemy', 'batch-2', '64x64', '4-dir', '7-states', 'blighted-marsh'],
      tintHue: 132,
      tintSatScale: 1.05,
      tintLumShift: 0.02,
      ...from13(goblinRaider),
    },
    {
      id: 'enemy_flesh_construct',
      name: 'Flesh Construct',
      subtitle: 'Armored bone-flesh juggernaut brute',
      accentHex: '#E96578',
      integratedInDemo: true,
      tags: ['enemy', 'batch-2', '64x64', '4-dir', '7-states', 'heavy'],
      tintHue: 342,
      tintSatScale: 0.72,
      tintLumShift: -0.05,
      ...from5(golem),
    },
  ];

  const enemyStates: { state: string; frames: number; fps: number; loop: boolean; events: AnimEvent[] }[] = [
    { state: 'idle', frames: 4, fps: 6, loop: true, events: [] },
    { state: 'walk', frames: 6, fps: 9, loop: true, events: [{ frame: 1, name: 'step' }, { frame: 4, name: 'step' }] },
    { state: 'windup', frames: 4, fps: 10, loop: false, events: [{ frame: 0, name: 'telegraph_start' }] },
    { state: 'attack', frames: 5, fps: 12, loop: false, events: [{ frame: 2, name: 'strike_hit' }] },
    { state: 'recovery', frames: 3, fps: 8, loop: false, events: [] },
    { state: 'hit', frames: 3, fps: 10, loop: false, events: [{ frame: 0, name: 'hit_flash' }] },
    { state: 'death', frames: 5, fps: 8, loop: false, events: [{ frame: 3, name: 'drop_loot' }] },
  ];

  const manifests: AssetManifest[] = [];

  for (const bank of banks) {
    const maxCols = Math.max(...enemyStates.map((s) => s.frames));
    const totalRows = enemyStates.length * DIRS.length;
    const sheet = createRaster(maxCols * 64, totalRows * 64);
    const animations: AnimationEntry[] = [];
    let row = 0;

    for (const st of enemyStates) {
      const seq = (bank as unknown as Record<string, RasterBuffer[]>)[st.state];

      for (const dir of DIRS) {
        let prevHash: string | null = null;
        for (let f = 0; f < st.frames; f++) {
          const raw = seq[Math.min(f, seq.length - 1)];
          const isFallen = st.state === 'death' && f >= 2;

          const cal = resampleToCalibratedCell(raw, 32, 32, {
            anchor: isFallen ? 'bottom' : 'feet_pivot',
            maxW: isFallen ? 26 : 25,
            maxH: isFallen ? 16 : 25,
            targetPivotX: 16,
            targetPivotY: 27,
            offsetX: st.state === 'attack' && f === 2 ? (dir === 'left' ? -2 : 2) : 0,
            offsetY:
              st.state === 'walk'
                ? f % 2 === 0
                  ? 0
                  : -1
                : st.state === 'idle' && f % 2 === 1
                  ? -1
                  : 0,
          });
          totalCalibratedFrames++;

          let half = cal.buffer;
          if (bank.tintHue !== undefined) {
            half = remapBufferHue(half, bank.tintHue, {
              satScale: bank.tintSatScale ?? 1,
              lumShift: bank.tintLumShift ?? 0,
              minSat: 0.12,
            });
          }

          half = applyFullBodyArticulation(half, st.state, f, st.frames, dir);
          half = applyDirectionalShading(half, dir);
          half = applyHiBitDepthPass(half, {
            rimStrength: 0.26,
            aoStrength: 0.22,
            rimTint: hexToRgba('#F7E3A6'),
          });

          let styled = quantizeRiftNightLab(half, {
            mode: 'hybrid_lab',
            cohesionStrength: 0.42,
            addOutline: true,
            addGroundShadow: st.state !== 'death' || f < 3,
            shadowY: 28,
            shadowRx: 8,
            shadowRy: 2.3,
          }).buffer;

          if (st.state === 'windup') {
            styled = applyPostOutlineEffect(styled, 'windup_aura', f, st.frames, bank.accentHex);
          } else if (st.state === 'attack' && f >= 1 && f <= 3) {
            styled = applyPostOutlineEffect(styled, 'attack_slash', f, st.frames, bank.accentHex);
          } else if (st.state === 'hit') {
            styled = applyPostOutlineEffect(styled, 'hit_flash', f, st.frames, bank.accentHex);
          } else if (st.state === 'death' && f >= 2) {
            styled = applyPostOutlineEffect(styled, 'death_dissolve', f, st.frames, bank.accentHex);
          }

          const deduped = ensureDistinctFrame(styled, prevHash, f);
          prevHash = deduped.hash;

          blitRaster(sheet, upscaleRaster(deduped.buffer, 2), f * 64, row * 64);
        }

        animations.push({
          state: st.state,
          direction: dir,
          row,
          frameCount: st.frames,
          fps: st.fps,
          loop: st.loop,
          pivot: { ...STYLE_CONTRACT.boxes.enemy.pivot },
          hitbox: { ...STYLE_CONTRACT.boxes.enemy.hitbox },
          hurtbox: { ...STYLE_CONTRACT.boxes.enemy.hurtbox },
          events: st.events,
        });
        row++;
      }
    }

    const manifest: AssetManifest = {
      assetId: bank.id,
      name: bank.name,
      category: 'enemy',
      subtitle: bank.subtitle,
      sheetUrl: `/assets/sprites/${bank.id}.png`,
      manifestUrl: `/assets/sprites/${bank.id}.json`,
      frameWidth: 64,
      frameHeight: 64,
      columns: maxCols,
      rows: totalRows,
      animations,
      tags: bank.tags,
      integratedInDemo: bank.integratedInDemo,
    };
    writeAsset(manifest, sheet);
    manifests.push(manifest);
  }

  return manifests;
}

// ============================================================================
// 3. THREE TWO-PHASE TYRANT BOSSES (128x128)
// ============================================================================

function buildAllBosses(): AssetManifest[] {
  const sheetEnemies = loadSourceRaster('image_7c0891e3.png');
  const sheetMaster = loadSourceRaster('image_050e7303.png');
  const sheetVerticalSlice = loadSourceRaster('image_743550f4.png');

  // Hybrid band segmentation + DP minimum-energy seam splitting across touching Bone Regent cloaks!
  const brHero = extractTightSprite(sheetEnemies, { x: 15, y: 524, w: 215, h: 214 }, 'alpha');
  const brIdle = extractBand(sheetEnemies, { x: 238, y: 508, w: 572, h: 92 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 5,
  });
  const brMove = extractBand(sheetEnemies, { x: 862, y: 506, w: 580, h: 96 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 5,
  });
  const brAtk1 = extractBand(sheetEnemies, { x: 280, y: 648, w: 298, h: 96 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 3,
  });
  const brAtk2 = extractBand(sheetEnemies, { x: 590, y: 640, w: 356, h: 106 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 3,
  });
  const brHit = extractBand(sheetEnemies, { x: 948, y: 642, w: 218, h: 96 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 3,
  });
  const brDeath = extractBand(sheetEnemies, { x: 1172, y: 644, w: 350, h: 94 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 4,
  });

  // Authentic Tyrants from vertical slice atlas image_743550f4.png: [Bone Regent, Blight Colossus, Rift Leviathan]
  const vsTyrants = extractBand(sheetVerticalSlice, { x: 434, y: 686, w: 288, h: 90 }, 'dark', {
    mergeGap: 6,
    expectedCount: 3,
  });
  const blightColossusHero = vsTyrants[1] ?? extractTightSprite(sheetMaster, { x: 610, y: 190, w: 72, h: 52 }, 'dark');
  const riftLeviathanHero = vsTyrants[2] ?? extractTightSprite(sheetMaster, { x: 1178, y: 36, w: 185, h: 152 }, 'dark');

  const abyssalHydra = extractTightSprite(sheetMaster, { x: 1178, y: 36, w: 185, h: 152 }, 'dark');
  const golemFrames = extractBand(sheetMaster, { x: 610, y: 190, w: 360, h: 52 }, 'dark', {
    mergeGap: 2,
    expectedCount: 5,
  });

  interface BossSpec {
    id: string;
    name: string;
    subtitle: string;
    accentHex: string;
    tags: string[];
    events: { attack: string; phase: string; sig: string; death: string };
    getRaw: (state: string, f: number, total: number) => RasterBuffer;
    tintHue?: number;
    tintSat?: number;
    tintLum?: number;
  }

  const bossSpecs: BossSpec[] = [
    {
      id: 'boss_bone_regent',
      name: 'Bone Regent',
      subtitle: 'Cursed Grove Tyrant — 2-phase Rift Sovereign',
      accentHex: '#A991F7',
      tags: ['tyrant', '128x128', 'phase-transition', 'telegraphed'],
      events: {
        attack: 'bone_barrage',
        phase: 'rift_ascension',
        sig: 'necrotic_nova_detonate',
        death: 'crown_shatter',
      },
      getRaw: (state, f, total) => {
        if (state === 'idle') return brIdle[f % brIdle.length];
        if (state === 'walk') return brMove[f % brMove.length];
        if (state === 'windup') return brAtk1[Math.min(f, brAtk1.length - 1)];
        if (state === 'attack') return brAtk2[Math.min(Math.floor((f / total) * brAtk2.length), brAtk2.length - 1)];
        if (state === 'phase_transition') return f >= 2 ? brHero : brAtk1[f % brAtk1.length];
        if (state === 'signature') return f >= 2 && f <= 4 ? brHero : brAtk2[f % brAtk2.length];
        if (state === 'hit') return brHit[f % brHit.length];
        return brDeath[Math.min(Math.floor((f / total) * brDeath.length), brDeath.length - 1)];
      },
    },
    {
      id: 'boss_rift_leviathan',
      name: 'Rift Leviathan',
      subtitle: 'Undead Crypt Tyrant — Tentacled Void Eye Sovereign',
      accentHex: '#58D6C2',
      tags: ['tyrant', 'batch-2', '128x128', 'phase-transition', 'undead-crypt'],
      events: {
        attack: 'void_breath',
        phase: 'abyssal_surge',
        sig: 'singularity_collapse',
        death: 'leviathan_shatter',
      },
      getRaw: () => riftLeviathanHero,
    },
    {
      id: 'boss_blight_colossus',
      name: 'Blight Colossus',
      subtitle: 'Blighted Marsh Tyrant — Moss-Armored Colossus',
      accentHex: '#9BE870',
      tags: ['tyrant', 'batch-2', '128x128', 'phase-transition', 'blighted-marsh'],
      events: {
        attack: 'fissure_slam',
        phase: 'blight_overgrowth',
        sig: 'spore_cataclysm',
        death: 'colossus_crumble',
      },
      tintHue: 124,
      tintSat: 1.08,
      tintLum: 0.02,
      getRaw: (state, f) => {
        if (state === 'hit' || state === 'death') return golemFrames[4];
        return blightColossusHero;
      },
    },
  ];

  const manifests: AssetManifest[] = [];

  for (const spec of bossSpecs) {
    const bossStates: { state: string; frames: number; fps: number; loop: boolean; events: AnimEvent[] }[] = [
      { state: 'idle', frames: 4, fps: 6, loop: true, events: [] },
      { state: 'walk', frames: 6, fps: 8, loop: true, events: [{ frame: 2, name: 'hover_pulse' }] },
      { state: 'windup', frames: 4, fps: 9, loop: false, events: [{ frame: 0, name: 'telegraph_rune' }] },
      { state: 'attack', frames: 5, fps: 11, loop: false, events: [{ frame: 2, name: spec.events.attack }] },
      { state: 'phase_transition', frames: 6, fps: 8, loop: false, events: [{ frame: 2, name: spec.events.phase }, { frame: 5, name: 'phase2_active' }] },
      { state: 'signature', frames: 6, fps: 10, loop: false, events: [{ frame: 3, name: spec.events.sig }] },
      { state: 'hit', frames: 3, fps: 10, loop: false, events: [] },
      { state: 'death', frames: 6, fps: 7, loop: false, events: [{ frame: 4, name: spec.events.death }] },
    ];

    const maxCols = Math.max(...bossStates.map((s) => s.frames));
    const totalRows = bossStates.length * DIRS.length;
    const sheet = createRaster(maxCols * 128, totalRows * 128);
    const animations: AnimationEntry[] = [];
    let row = 0;

    for (const st of bossStates) {
      for (const dir of DIRS) {
        let prevHash: string | null = null;
        for (let f = 0; f < st.frames; f++) {
          const raw = spec.getRaw(st.state, f, st.frames);
          const bobY =
            st.state === 'idle'
              ? Math.round(Math.sin((f / st.frames) * Math.PI * 2) * 1.5)
              : st.state === 'walk'
                ? Math.round(Math.sin((f / st.frames) * Math.PI * 2) * 2.0)
                : st.state === 'windup'
                  ? -Math.min(3, f)
                  : 0;
          const lungeX =
            st.state === 'attack' && (f === 2 || f === 3)
              ? dir === 'left'
                ? -3
                : 3
              : st.state === 'walk'
                ? (f % 3) - 1
                : 0;

          // Feet-centroid calibration locked to V3.1 boss half-res pivot (32, 54) -> (64, 108) full-res
          const cal = resampleToCalibratedCell(raw, 64, 64, {
            anchor: 'feet_pivot',
            maxW: 54,
            maxH: 52,
            targetPivotX: 32,
            targetPivotY: 54,
            offsetX: lungeX,
            offsetY: bobY,
          });
          totalCalibratedFrames++;

          let half = cal.buffer;
          if (spec.tintHue !== undefined) {
            half = remapBufferHue(half, spec.tintHue, {
              satScale: spec.tintSat ?? 1,
              lumShift: spec.tintLum ?? 0,
              minSat: 0.14,
            });
          }

          half = applyFullBodyArticulation(half, st.state, f, st.frames, dir);
          half = applyDirectionalShading(half, dir);
          half = applyHiBitDepthPass(half, {
            rimStrength: 0.28,
            aoStrength: 0.24,
            rimTint: hexToRgba('#F7E3A6'),
          });

          let styled = quantizeRiftNightLab(half, {
            mode: 'hybrid_lab',
            cohesionStrength: 0.4,
            addOutline: true,
            addGroundShadow: st.state !== 'death' || f < 4,
            shadowY: 55,
            shadowRx: 20,
            shadowRy: 5,
          }).buffer;

          if (st.state === 'windup') {
            styled = applyPostOutlineEffect(styled, 'windup_aura', f, st.frames, spec.accentHex);
          } else if (st.state === 'attack' && f >= 1 && f <= 3) {
            styled = applyPostOutlineEffect(styled, 'attack_slash', f, st.frames, spec.accentHex);
          } else if (st.state === 'phase_transition' || st.state === 'signature') {
            styled = applyPostOutlineEffect(styled, 'phase_glow', f, st.frames, spec.accentHex);
          } else if (st.state === 'hit') {
            styled = applyPostOutlineEffect(styled, 'hit_flash', f, st.frames, spec.accentHex);
          } else if (st.state === 'death') {
            styled = applyPostOutlineEffect(styled, 'death_dissolve', f, st.frames, spec.accentHex);
          }

          const deduped = ensureDistinctFrame(styled, prevHash, f);
          prevHash = deduped.hash;

          blitRaster(sheet, upscaleRaster(deduped.buffer, 2), f * 128, row * 128);
        }

        animations.push({
          state: st.state,
          direction: dir,
          row,
          frameCount: st.frames,
          fps: st.fps,
          loop: st.loop,
          pivot: { ...STYLE_CONTRACT.boxes.boss.pivot },
          hitbox: { ...STYLE_CONTRACT.boxes.boss.hitbox },
          hurtbox: { ...STYLE_CONTRACT.boxes.boss.hurtbox },
          events: st.events,
        });
        row++;
      }
    }

    const manifest: AssetManifest = {
      assetId: spec.id,
      name: spec.name,
      category: 'boss',
      subtitle: spec.subtitle,
      sheetUrl: `/assets/sprites/${spec.id}.png`,
      manifestUrl: `/assets/sprites/${spec.id}.json`,
      frameWidth: 128,
      frameHeight: 128,
      columns: maxCols,
      rows: totalRows,
      animations,
      tags: spec.tags,
      integratedInDemo: true,
    };
    writeAsset(manifest, sheet);
    manifests.push(manifest);
  }

  return manifests;
}

// ============================================================================
// 4. THREE BIOME TILESETS (image_891f543c.png + image_050e7303.png)
// ============================================================================

function buildAllTilesets(): AssetManifest[] {
  const sheetEnv = loadSourceRaster('image_891f543c.png');
  const sheetMaster = loadSourceRaster('image_050e7303.png');

  const stoneTiles = [
    extractTightSprite(sheetEnv, { x: 13, y: 220, w: 88, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 108, y: 220, w: 88, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 204, y: 220, w: 88, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 300, y: 220, w: 88, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 397, y: 220, w: 90, h: 92 }, 'alpha'),
  ];
  const grassTiles = [
    extractTightSprite(sheetEnv, { x: 12, y: 15, w: 90, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 108, y: 15, w: 90, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 202, y: 15, w: 92, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 298, y: 15, w: 92, h: 92 }, 'alpha'),
    extractTightSprite(sheetEnv, { x: 395, y: 15, w: 92, h: 92 }, 'alpha'),
  ];
  const mossyStone = extractTightSprite(sheetEnv, { x: 12, y: 320, w: 88, h: 94 }, 'alpha');
  const cryptFloorTiles = [
    extractTightSprite(sheetMaster, { x: 285, y: 564, w: 46, h: 42 }, 'dark'),
    extractTightSprite(sheetMaster, { x: 333, y: 564, w: 43, h: 42 }, 'dark'),
    extractTightSprite(sheetMaster, { x: 381, y: 565, w: 40, h: 40 }, 'dark'),
    extractTightSprite(sheetMaster, { x: 286, y: 608, w: 45, h: 44 }, 'dark'),
    extractTightSprite(sheetMaster, { x: 333, y: 608, w: 43, h: 44 }, 'dark'),
  ];

  const ruinWall = extractTightSprite(sheetEnv, { x: 1360, y: 10, w: 164, h: 155 }, 'alpha');
  const pillar1 = extractTightSprite(sheetEnv, { x: 1218, y: 172, w: 82, h: 142 }, 'alpha');
  const pillar2 = extractTightSprite(sheetEnv, { x: 1304, y: 188, w: 70, h: 122 }, 'alpha');
  const gothicArch = extractTightSprite(sheetEnv, { x: 1200, y: 6, w: 162, h: 160 }, 'alpha');
  const treeMagenta = extractTightSprite(sheetEnv, { x: 668, y: 8, w: 158, h: 178 }, 'alpha');
  const treeGreen = extractTightSprite(sheetEnv, { x: 495, y: 8, w: 174, h: 184 }, 'alpha');
  const treePurplePine = extractTightSprite(sheetEnv, { x: 990, y: 8, w: 108, h: 162 }, 'alpha');
  const crystalPurple = extractTightSprite(sheetEnv, { x: 1006, y: 498, w: 86, h: 94 }, 'alpha');
  const crystalTeal = extractTightSprite(sheetEnv, { x: 1102, y: 478, w: 98, h: 90 }, 'alpha');
  const gravestone = extractTightSprite(sheetMaster, { x: 428, y: 560, w: 46, h: 48 }, 'dark');
  const brazierFire = extractTightSprite(sheetMaster, { x: 960, y: 285, w: 58, h: 82 }, 'dark');
  const brazierVoid = extractTightSprite(sheetMaster, { x: 1032, y: 288, w: 58, h: 80 }, 'dark');
  const riftPortal = extractTightSprite(sheetEnv, { x: 548, y: 488, w: 294, h: 284 }, 'alpha');
  const obelisk = extractTightSprite(sheetEnv, { x: 900, y: 495, w: 108, h: 192 }, 'alpha');
  const banner = extractTightSprite(sheetEnv, { x: 1280, y: 318, w: 78, h: 158 }, 'alpha');

  interface BiomeTilesetSpec {
    id: string;
    name: string;
    subtitle: string;
    tags: string[];
    floors: RasterBuffer[];
    floorTint?: { hue: number; sat: number; lum: number };
    wall: RasterBuffer;
    pillar: RasterBuffer;
    arch: RasterBuffer;
    tree: RasterBuffer;
    crystal: RasterBuffer;
    crystalTintHue?: number;
    grave: RasterBuffer;
    brazier: RasterBuffer;
    brazierPulseHex: string;
    portalAccentHex: string;
    portalHue?: number;
    obelisk: RasterBuffer;
    banner: RasterBuffer;
  }

  const specs: BiomeTilesetSpec[] = [
    {
      id: 'tileset_cursed_grove',
      name: 'Cursed Grove Tileset & Props',
      subtitle: 'Cobblestones, gothic arches, blossom trees, crystals, braziers & Rift Portal',
      tags: ['environment', '64x64', 'cursed-grove'],
      floors: stoneTiles,
      wall: ruinWall,
      pillar: pillar1,
      arch: gothicArch,
      tree: treeMagenta,
      crystal: crystalPurple,
      grave: gravestone,
      brazier: brazierFire,
      brazierPulseHex: '#FF9A2E',
      portalAccentHex: '#A991F7',
      obelisk,
      banner,
    },
    {
      id: 'tileset_undead_crypt',
      name: 'Undead Crypt Tileset & Props',
      subtitle: 'Slate flagstones, crypt pillars, teal crystal clusters, soul braziers & Rift Portal',
      tags: ['environment', 'batch-2', '64x64', 'undead-crypt'],
      floors: cryptFloorTiles,
      wall: ruinWall,
      pillar: pillar2,
      arch: gothicArch,
      tree: treePurplePine,
      crystal: crystalTeal,
      grave: gravestone,
      brazier: brazierVoid,
      brazierPulseHex: '#DF8CFF',
      portalAccentHex: '#58D6C2',
      portalHue: 178,
      obelisk,
      banner,
    },
    {
      id: 'tileset_blighted_marsh',
      name: 'Blighted Marsh Tileset & Props',
      subtitle: 'Overgrown mossy ruins, viridian marsh trees, spore crystals & Rift Portal',
      tags: ['environment', 'batch-2', '64x64', 'blighted-marsh'],
      floors: grassTiles,
      floorTint: { hue: 146, sat: 0.65, lum: -0.07 },
      wall: ruinWall,
      pillar: pillar1,
      arch: gothicArch,
      tree: treeGreen,
      crystal: crystalTeal,
      crystalTintHue: 130,
      grave: gravestone,
      brazier: brazierFire,
      brazierPulseHex: '#FF9A2E',
      portalAccentHex: '#9BE870',
      portalHue: 128,
      obelisk,
      banner,
    },
    {
      id: 'tileset_ashen_citadel',
      name: 'Ashen Citadel Tileset & Props',
      subtitle: 'Scorched basalt flagstones, volcanic pillars, ember crystals, forge braziers & Rift Portal',
      tags: ['environment', 'batch-3', 'hi-bit-2x', '64x64', 'ashen-citadel'],
      floors: stoneTiles,
      floorTint: { hue: 14, sat: 0.72, lum: -0.09 },
      wall: ruinWall,
      pillar: pillar2,
      arch: gothicArch,
      tree: treeMagenta,
      crystal: crystalPurple,
      crystalTintHue: 18,
      grave: gravestone,
      brazier: brazierFire,
      brazierPulseHex: '#FF6B3D',
      portalAccentHex: '#FF8A3D',
      portalHue: 16,
      obelisk,
      banner,
    },
    {
      id: 'tileset_astral_abyss',
      name: 'Astral Abyss Tileset & Props',
      subtitle: 'Celestial obsidian marble, starlight spires, sapphire prism crystals & Astral Rift Portal',
      tags: ['environment', 'batch-3', 'hi-bit-2x', '64x64', 'astral-abyss'],
      floors: cryptFloorTiles,
      floorTint: { hue: 234, sat: 0.85, lum: -0.06 },
      wall: ruinWall,
      pillar: pillar1,
      arch: gothicArch,
      tree: treePurplePine,
      crystal: crystalTeal,
      crystalTintHue: 224,
      grave: gravestone,
      brazier: brazierVoid,
      brazierPulseHex: '#7C9BFF',
      portalAccentHex: '#7C9BFF',
      portalHue: 228,
      obelisk,
      banner,
    },
  ];

  const manifests: AssetManifest[] = [];

  for (const spec of specs) {
    const cols = 5;
    const rows = 4;
    const sheet = createRaster(cols * 64, rows * 64);

    const makeFloorTile = (raw: RasterBuffer, idx: number): RasterBuffer => {
      let half = resampleToCalibratedCell(raw, 32, 32, { anchor: 'fill' }).buffer;
      if (spec.floorTint) {
        half = remapBufferHue(half, spec.floorTint.hue, {
          satScale: spec.floorTint.sat,
          lumShift: spec.floorTint.lum,
          minSat: 0.08,
        });
      }
      half = applyHiBitDepthPass(half, { rimStrength: 0.16, aoStrength: 0.18 });
      half = quantizeRiftNightLab(half, {
        mode: 'hybrid_lab',
        cohesionStrength: 0.45,
        addOutline: false,
        snapDarkToInk: false,
        ensureCornerTransparent: false,
      }).buffer;
      setPixelBlend(half, 4 + idx * 4, 6 + (idx % 3) * 6, hexToRgba('#140E1D'));
      return upscaleRaster(half, 2);
    };

    const makePropTile = (
      raw: RasterBuffer,
      opts?: { maxW?: number; maxH?: number; hue?: number; pulse?: number; pulseHex?: string }
    ): RasterBuffer => {
      let half = resampleToCalibratedCell(raw, 32, 32, {
        anchor: 'bottom',
        maxW: opts?.maxW ?? 28,
        maxH: opts?.maxH ?? 28,
        targetPivotY: 30,
      }).buffer;
      if (opts?.hue !== undefined) {
        half = remapBufferHue(half, opts.hue, { satScale: 1.05, minSat: 0.16 });
      }
      half = applyHiBitDepthPass(half, { rimStrength: 0.22, aoStrength: 0.2 });
      half = quantizeRiftNightLab(half, {
        mode: 'hybrid_lab',
        cohesionStrength: 0.42,
        addOutline: true,
        ensureCornerTransparent: false,
      }).buffer;
      if (opts?.pulse && opts.pulseHex) {
        drawGlow(half, 16, 15, 6 + opts.pulse, hexToRgba(opts.pulseHex), 75 + opts.pulse * 22);
      }
      return upscaleRaster(half, 2);
    };

    const tiles: RasterBuffer[] = [
      makeFloorTile(spec.floors[0], 0),
      makeFloorTile(spec.floors[1], 1),
      makeFloorTile(spec.floors[2], 2),
      makeFloorTile(spec.floors[3], 3),
      makeFloorTile(spec.floors[4], 4),
      makeFloorTile(mossyStone, 5),
      makePropTile(spec.wall, { maxW: 30, maxH: 28 }),
      makePropTile(spec.pillar, { maxW: 24, maxH: 29 }),
      makePropTile(spec.arch, { maxW: 30, maxH: 29 }),
      makePropTile(spec.tree, { maxW: 30, maxH: 30 }),
      makePropTile(spec.crystal, { maxW: 26, maxH: 27, hue: spec.crystalTintHue }),
      makePropTile(spec.grave, { maxW: 24, maxH: 26 }),
      makePropTile(spec.brazier, { maxW: 24, maxH: 28 }),
      makePropTile(spec.brazier, { maxW: 24, maxH: 28, pulse: 1, pulseHex: spec.brazierPulseHex }),
      makePropTile(riftPortal, { maxW: 30, maxH: 30, hue: spec.portalHue }),
      makePropTile(riftPortal, { maxW: 30, maxH: 30, hue: spec.portalHue, pulse: 1, pulseHex: spec.portalAccentHex }),
      makePropTile(riftPortal, { maxW: 30, maxH: 30, hue: spec.portalHue, pulse: 2, pulseHex: spec.portalAccentHex }),
      makePropTile(riftPortal, { maxW: 30, maxH: 30, hue: spec.portalHue, pulse: 3, pulseHex: spec.portalAccentHex }),
      makePropTile(spec.obelisk, { maxW: 24, maxH: 29 }),
      makePropTile(spec.banner, { maxW: 22, maxH: 29 }),
    ];

    tiles.forEach((tile, idx) => {
      blitRaster(sheet, tile, (idx % cols) * 64, Math.floor(idx / cols) * 64);
    });

    const manifest: AssetManifest = {
      assetId: spec.id,
      name: spec.name,
      category: 'environment',
      subtitle: spec.subtitle,
      sheetUrl: `/assets/sprites/${spec.id}.png`,
      manifestUrl: `/assets/sprites/${spec.id}.json`,
      frameWidth: 64,
      frameHeight: 64,
      columns: cols,
      rows,
      animations: [
        { state: 'floor_tiles', direction: 'down', row: 0, frameCount: 5, fps: 2, loop: true, pivot: { x: 32, y: 32 }, hitbox: { x: 0, y: 0, w: 64, h: 64 }, hurtbox: { x: 0, y: 0, w: 64, h: 64 }, events: [] },
        { state: 'ruins_and_flora', direction: 'down', row: 1, frameCount: 5, fps: 2, loop: true, pivot: { x: 32, y: 54 }, hitbox: { x: 8, y: 20, w: 48, h: 38 }, hurtbox: { x: 8, y: 20, w: 48, h: 38 }, events: [] },
        { state: 'crystals_braziers_portal', direction: 'down', row: 2, frameCount: 5, fps: 5, loop: true, pivot: { x: 32, y: 54 }, hitbox: { x: 10, y: 18, w: 44, h: 40 }, hurtbox: { x: 10, y: 18, w: 44, h: 40 }, events: [] },
        { state: 'portal_statue_banner', direction: 'down', row: 3, frameCount: 5, fps: 6, loop: true, pivot: { x: 32, y: 56 }, hitbox: { x: 10, y: 12, w: 44, h: 48 }, hurtbox: { x: 10, y: 12, w: 44, h: 48 }, events: [] },
      ],
      tags: spec.tags,
      integratedInDemo: true,
    };
    writeAsset(manifest, sheet);
    manifests.push(manifest);
  }

  return manifests;
}

// ============================================================================
// 5. SEVEN VFX SHEETS (image_5f9076f6 + image_050e7303 + image_7c0891e3)
// ============================================================================

function buildVfxFrame(
  raw: RasterBuffer,
  opts?: {
    hue?: number;
    satScale?: number;
    lumShift?: number;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    extraRingHex?: string;
    ringR?: number;
  }
): RasterBuffer {
  let half = resampleToCalibratedCell(raw, 32, 32, {
    anchor: 'center',
    maxW: opts?.scale ?? 28,
    maxH: opts?.scale ?? 28,
    offsetX: opts?.offsetX ?? 0,
    offsetY: opts?.offsetY ?? 0,
    preserveSoftAlpha: true,
  }).buffer;
  if (opts?.hue !== undefined) {
    half = remapBufferHue(half, opts.hue, {
      satScale: opts.satScale ?? 1.05,
      lumShift: opts.lumShift ?? 0,
      minSat: 0.1,
      preserveWhiteCore: true,
    });
  }
  if (opts?.extraRingHex && opts.ringR) {
    const c = hexToRgba(opts.extraRingHex);
    drawRing(half, 16, 16, opts.ringR, Math.max(1, opts.ringR - 1.5), { ...c, a: 195 });
  }
  setPixelRaw(half, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
  return half;
}

function buildAllVfx(): AssetManifest[] {
  const sheetVfx = loadSourceRaster('image_5f9076f6.png');
  const sheetMaster = loadSourceRaster('image_050e7303.png');
  const sheetAlpha = loadSourceRaster('image_7c0891e3.png');
  const sheetStrips = loadSourceRaster('image_dfe3c9c6.png');
  const sheetEffects = loadSourceRaster('image_287c1c89.png');
  const sheetAtlas30 = loadSourceRaster('image_30cd6dea.png');
  const sheetAtlasE5 = loadSourceRaster('image_e5369a8c.png');

  // Core projectile & impact strips across all VFX source sheets
  const fireMaster = extractBand(sheetMaster, { x: 120, y: 740, w: 325, h: 52 }, 'dark_additive', { mergeGap: 2 });
  const fireProjAlpha = extractBand(sheetAlpha, { x: 295, y: 840, w: 382, h: 56 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 6,
  });
  const iceProjAlpha = extractBand(sheetAlpha, { x: 295, y: 898, w: 385, h: 50 }, 'alpha', { mergeGap: 2 });
  const voidProjAlpha = extractBand(sheetAlpha, { x: 295, y: 950, w: 380, h: 56 }, 'alpha', {
    mergeGap: 2,
    expectedCount: 6,
  });

  const majorIce = extractBand(sheetVfx, { x: 1095, y: 844, w: 425, h: 62 }, 'checker', { mergeGap: 2 });
  const majorLight = extractBand(sheetVfx, { x: 1095, y: 922, w: 425, h: 72 }, 'checker', { mergeGap: 2 });
  const castCircles = extractBand(sheetVfx, { x: 18, y: 354, w: 508, h: 112 }, 'checker', {
    mergeGap: 2,
    expectedCount: 6,
  });
  const impactRing = extractBand(sheetVfx, { x: 395, y: 122, w: 345, h: 64 }, 'checker', { mergeGap: 3 });
  const impactIce = extractBand(sheetVfx, { x: 395, y: 186, w: 345, h: 58 }, 'checker', { mergeGap: 3 });
  const blinkPillar = extractBand(sheetVfx, { x: 1130, y: 144, w: 394, h: 108 }, 'checker', {
    mergeGap: 3,
    expectedCount: 5,
  });
  const healPillar = extractBand(sheetVfx, { x: 550, y: 412, w: 420, h: 86 }, 'checker', { mergeGap: 3 });
  const aoeCrown = extractBand(sheetVfx, { x: 20, y: 606, w: 515, h: 88 }, 'checker', { mergeGap: 3 });
  const projBlueSwirl = extractBand(sheetVfx, { x: 15, y: 176, w: 360, h: 66 }, 'checker', { mergeGap: 3 });
  const lightMaster = extractBand(sheetMaster, { x: 120, y: 838, w: 325, h: 52 }, 'dark_additive', { mergeGap: 2 });

  // Newly integrated high-res alpha strips from image_dfe3c9c6.png
  const dfBurst = extractBand(sheetStrips, { x: 200, y: 250, w: 1320, h: 115 }, 'alpha', { mergeGap: 4, minArea: 80 });
  const dfIce = extractBand(sheetStrips, { x: 200, y: 375, w: 1320, h: 110 }, 'alpha', { mergeGap: 4, minArea: 80 });

  // Newly integrated Blue Mage Effects Sheet strips from image_287c1c89.png
  const fx28Lightning = extractBand(sheetEffects, { x: 20, y: 392, w: 560, h: 72 }, 'checker', { mergeGap: 4, minArea: 60 });
  const fx28Nova = extractBand(sheetEffects, { x: 595, y: 392, w: 590, h: 72 }, 'checker', { mergeGap: 4, minArea: 60 });
  const fx28Crit = extractBand(sheetEffects, { x: 595, y: 660, w: 590, h: 78 }, 'checker', { mergeGap: 4, minArea: 60 });
  const fx28Blink = extractBand(sheetEffects, { x: 20, y: 938, w: 560, h: 76 }, 'checker', { mergeGap: 4, minArea: 60 });
  const fx28Buff = extractBand(sheetEffects, { x: 595, y: 800, w: 590, h: 78 }, 'checker', {
    mergeGap: 4,
    expectedCount: 6,
    minArea: 50,
  });
  const fx28BossRing = extractBand(sheetEffects, { x: 25, y: 1196, w: 660, h: 90 }, 'dark_additive', {
    mergeGap: 5,
    expectedCount: 6,
    minArea: 60,
  });
  const fx28BossPillar = extractBand(sheetEffects, { x: 715, y: 1180, w: 460, h: 108 }, 'dark_additive', {
    mergeGap: 5,
    expectedCount: 6,
    minArea: 80,
  });

  // Authentic Spell VFX from Key-Art Atlas image_30cd6dea.png [FireRing, IceSpikes, LightPillar, EarthCrystals, WindTornado, VoidCircle]
  const fx30Spells = extractBand(sheetAtlas30, { x: 785, y: 622, w: 458, h: 66 }, 'dark_additive', {
    mergeGap: 3,
    expectedCount: 6,
  });

  // Authentic 9 Spell & Impact Effects from Magic Atlas image_e5369a8c.png
  // [0:Fireball, 1:FireRing, 2:IceSpikes, 3:Lightning, 4:VoidVortex, 5:ArcanePillar, 6:NatureBurst, 7:TimeWeb, 8:CrimsonSlash]
  const fxE5Spells = extractBand(sheetAtlasE5, { x: 825, y: 660, w: 685, h: 56 }, 'dark_additive', {
    mergeGap: 5,
    expectedCount: 9,
  });

  const manifests: AssetManifest[] = [];

  const writeVfxSheet = (
    id: string,
    name: string,
    subtitle: string,
    tags: string[],
    rowsSpec: { state: string; fps: number; loop: boolean; frames: RasterBuffer[]; eventPeak?: boolean }[]
  ) => {
    const maxCols = Math.max(...rowsSpec.map((r) => r.frames.length));
    const sheet = createRaster(maxCols * 64, rowsSpec.length * 64);
    const animations: AnimationEntry[] = [];

    rowsSpec.forEach((r, rowIdx) => {
      let prevHash: string | null = null;
      r.frames.forEach((half, f) => {
        const deduped = ensureDistinctFrame(half, prevHash, f);
        prevHash = deduped.hash;
        blitRaster(sheet, upscaleRaster(deduped.buffer, 2), f * 64, rowIdx * 64);
      });
      animations.push({
        state: r.state,
        direction: 'down',
        row: rowIdx,
        frameCount: r.frames.length,
        fps: r.fps,
        loop: r.loop,
        pivot: { x: 32, y: 32 },
        hitbox: { x: 10, y: 10, w: 44, h: 44 },
        hurtbox: { x: 14, y: 14, w: 36, h: 36 },
        events: r.eventPeak ? [{ frame: 1, name: 'vfx_peak' }] : [],
      });
    });

    const manifest: AssetManifest = {
      assetId: id,
      name,
      category: 'vfx',
      subtitle,
      sheetUrl: `/assets/sprites/${id}.png`,
      manifestUrl: `/assets/sprites/${id}.json`,
      frameWidth: 64,
      frameHeight: 64,
      columns: maxCols,
      rows: rowsSpec.length,
      animations,
      tags,
      integratedInDemo: true,
    };
    writeAsset(manifest, sheet);
    manifests.push(manifest);
  };

  writeVfxSheet('vfx_fire', 'Fire Spell VFX', 'Pyre Bolt cast, projectile, explosion & fire ring embers', ['vfx', '64x64', 'transparent'], [
    { state: 'cast', fps: 12, loop: false, frames: sampleSequence(castCircles, 4).map((c, i) => buildVfxFrame(c, { hue: 24, scale: 20 + i * 2 })) },
    { state: 'projectile', fps: 12, loop: true, frames: sampleSequence(fireProjAlpha.slice(0, 4), 4).map((c, i) => buildVfxFrame(c, { scale: 24 + (i % 2) * 2 })) },
    { state: 'impact', fps: 14, loop: false, eventPeak: true, frames: sampleSequence([fireProjAlpha[3], fxE5Spells[0] ?? fireMaster[2], fxE5Spells[1] ?? fireMaster[3], fx30Spells[0] ?? fireMaster[4], fireMaster[fireMaster.length - 1]], 5).map((c, i) => buildVfxFrame(c, { scale: 22 + i * 2 })) },
    { state: 'linger', fps: 8, loop: true, frames: sampleSequence([...fireMaster.slice(2), fxE5Spells[1] ?? fireMaster[3]], 4).map((c, i) => buildVfxFrame(c, { scale: 22 + (i % 2) * 3, offsetY: -i })) },
  ]);

  writeVfxSheet('vfx_ice', 'Ice Spell VFX', 'Frost Lance cast, shard projectile, crystal spike & chill ring', ['vfx', '64x64', 'transparent'], [
    { state: 'cast', fps: 12, loop: false, frames: sampleSequence(castCircles, 4).map((c, i) => buildVfxFrame(c, { hue: 192, scale: 20 + i * 2 })) },
    { state: 'projectile', fps: 12, loop: true, frames: sampleSequence(iceProjAlpha.slice(0, 4), 4).map((c, i) => buildVfxFrame(c, { scale: 24 + (i % 2) * 2 })) },
    { state: 'impact', fps: 14, loop: false, eventPeak: true, frames: sampleSequence(dfIce.length >= 5 ? dfIce : [...majorIce, iceProjAlpha[iceProjAlpha.length - 1]], 5).map((c, i) => buildVfxFrame(c, { scale: 22 + i * 2 })) },
    { state: 'linger', fps: 8, loop: true, frames: sampleSequence(impactIce, 4).map((c, i) => buildVfxFrame(c, { scale: 24 + (i % 2) * 2 })) },
  ]);

  writeVfxSheet('vfx_lightning', 'Lightning Spell VFX', 'Storm Arc chain bolt, zigzag flash & shock burst', ['vfx', '64x64', 'transparent'], [
    { state: 'cast', fps: 14, loop: false, frames: sampleSequence(castCircles, 4).map((c, i) => buildVfxFrame(c, { hue: 268, scale: 20 + i * 2 })) },
    { state: 'projectile', fps: 16, loop: true, frames: sampleSequence(fx28Lightning.length >= 4 ? fx28Lightning : majorLight, 4).map((c, i) => buildVfxFrame(c, { hue: 262, scale: 25 + (i % 2) * 2 })) },
    { state: 'impact', fps: 15, loop: false, eventPeak: true, frames: sampleSequence([...lightMaster, fxE5Spells[3] ?? majorLight[majorLight.length - 1]], 5).map((c, i) => buildVfxFrame(c, { scale: 22 + i * 2 })) },
    { state: 'linger', fps: 10, loop: true, frames: sampleSequence(impactRing, 4).map((c, i) => buildVfxFrame(c, { hue: 268, scale: 24 + (i % 2) * 2 })) },
  ]);

  writeVfxSheet('vfx_thermal_shatter', 'Thermal Shatter Resonance VFX', 'Fire + Ice resonance detonation & vapor shockwave', ['vfx', '64x64', 'transparent'], [
    {
      state: 'impact',
      fps: 14,
      loop: false,
      eventPeak: true,
      frames: sampleSequence([...(dfBurst.length >= 3 ? dfBurst.slice(2, 6) : impactRing), ...(fx28Nova.length >= 3 ? fx28Nova.slice(2, 5) : majorIce.slice(2))], 6).map((c, i) =>
        buildVfxFrame(c, {
          hue: i % 2 === 0 ? 22 : 194,
          scale: 20 + i * 2,
          extraRingHex: i % 2 === 0 ? '#6EE7FF' : '#FF7B29',
          ringR: 6 + i * 1.6,
        })
      ),
    },
    {
      state: 'linger',
      fps: 9,
      loop: true,
      frames: sampleSequence(castCircles.slice(2), 4).map((c, i) =>
        buildVfxFrame(c, { hue: 274, scale: 24 + (i % 2) * 2, extraRingHex: '#58D6C2', ringR: 9 + (i % 2) * 2 })
      ),
    },
  ]);

  writeVfxSheet('vfx_arcane_utility', 'Blink, Surge & Boss Rift VFX', 'Blink sigil, Aether Surge, Crimson Boss Warning & Cultist Orb', ['vfx', '64x64', 'transparent'], [
    { state: 'blink', fps: 14, loop: false, frames: sampleSequence(fx28Blink.length >= 5 ? fx28Blink : blinkPillar, 5).map((c, i) => buildVfxFrame(c, { scale: 24 + i })) },
    { state: 'surge', fps: 14, loop: false, frames: sampleSequence(fx28Buff.length >= 4 ? [...fx28Buff, healPillar[2], healPillar[3]] : [...healPillar, healPillar[3], healPillar[2]], 6).map((c, i) => buildVfxFrame(c, { hue: 168, scale: 22 + i })) },
    {
      state: 'boss_nova',
      fps: 12,
      loop: false,
      frames: sampleSequence(
        fx28BossRing.length >= 4 && fx28BossPillar.length >= 3
          ? [fx28BossRing[1], fx28BossRing[3], fx28BossRing[5], fx28BossPillar[2], fx28BossPillar[4], fx28BossPillar[5]]
          : [...aoeCrown, aoeCrown[aoeCrown.length - 1]],
        6
      ).map((c, i) => buildVfxFrame(c, { scale: 20 + i * 2, extraRingHex: '#E96578', ringR: 6 + i * 1.5 })),
    },
    { state: 'cultist_orb', fps: 12, loop: true, frames: sampleSequence(voidProjAlpha.slice(0, 4), 4).map((c, i) => buildVfxFrame(c, { scale: 22 + (i % 2) * 3 })) },
  ]);

  const extSchools: { state: string; hue?: number; src: RasterBuffer[] }[] = [
    { state: 'earth', hue: 36, src: [fx30Spells[3] ?? impactIce[0], impactIce[1] ?? impactIce[0], fx30Spells[3] ?? impactIce[2], impactIce[impactIce.length - 1]] },
    { state: 'shadow', hue: 278, src: voidProjAlpha },
    { state: 'light', hue: 48, src: fx28Crit.length >= 4 ? fx28Crit : castCircles.slice(2) },
    { state: 'time', hue: 40, src: [castCircles[1], fxE5Spells[7] ?? castCircles[2], fxE5Spells[7] ?? castCircles[3], castCircles[4]] },
    { state: 'void', hue: 284, src: [projBlueSwirl[0], fxE5Spells[4] ?? projBlueSwirl[1], fxE5Spells[4] ?? projBlueSwirl[2], projBlueSwirl[3] ?? projBlueSwirl[1]] },
    { state: 'arcane', hue: 268, src: [blinkPillar[0], fxE5Spells[5] ?? blinkPillar[2], fx28Buff[3] ?? blinkPillar[3], fxE5Spells[5] ?? blinkPillar[4]] },
    { state: 'blood', hue: 350, src: [fxE5Spells[8] ?? projBlueSwirl[0], fxE5Spells[8] ?? projBlueSwirl[1], fx28Crit[3] ?? projBlueSwirl[2], fxE5Spells[8] ?? projBlueSwirl[3]] },
    { state: 'nature', hue: 126, src: [healPillar[0], fxE5Spells[6] ?? healPillar[1], fxE5Spells[6] ?? healPillar[2], healPillar[healPillar.length - 1]] },
    { state: 'wind', hue: 162, src: [fx30Spells[4] ?? projBlueSwirl[0], fx30Spells[4] ?? projBlueSwirl[1], projBlueSwirl[2] ?? projBlueSwirl[0], fx30Spells[4] ?? projBlueSwirl[3]] },
    { state: 'sonic', hue: 214, src: dfBurst.length >= 4 ? [dfBurst[2], dfBurst[4], dfBurst[5], dfBurst[6] ?? dfBurst[4]] : impactRing },
  ];
  writeVfxSheet(
    'vfx_schools_extended',
    'Extended 10 Elemental Schools VFX',
    'Earth, Shadow, Light, Time, Void, Arcane, Blood, Nature, Wind & Sonic spell casts',
    ['vfx', 'batch-2', '64x64', '10-schools', 'transparent'],
    extSchools.map((sc) => ({
      state: sc.state,
      fps: 12,
      loop: false,
      frames: sampleSequence(sc.src, 4).map((c, i) => buildVfxFrame(c, { hue: sc.hue, scale: 20 + i * 2.5 })),
    }))
  );

  const resArchetypes: { state: string; hue?: number; ringHex: string; src: RasterBuffer[] }[] = [
    { state: 'nova', hue: 24, ringHex: '#A991F7', src: fx28Nova.length >= 5 ? fx28Nova : aoeCrown },
    { state: 'vortex', ringHex: '#58D6C2', src: [projBlueSwirl[0], fxE5Spells[4] ?? projBlueSwirl[1], fx30Spells[4] ?? projBlueSwirl[2], fxE5Spells[4] ?? projBlueSwirl[3], fx30Spells[5] ?? projBlueSwirl[0], projBlueSwirl[2]] },
    { state: 'chain', hue: 264, ringHex: '#FFE46B', src: fx28Lightning.length >= 5 ? [...fx28Lightning, fxE5Spells[3] ?? fx28Lightning[4]] : majorLight },
    { state: 'chrono', hue: 46, ringHex: '#A991F7', src: [castCircles[0], castCircles[2], fxE5Spells[7] ?? castCircles[3], castCircles[4], fxE5Spells[7] ?? castCircles[5], castCircles[5]] },
    { state: 'siphon', hue: 348, ringHex: '#DF8CFF', src: [...voidProjAlpha.slice(0, 4), fxE5Spells[8] ?? voidProjAlpha[4], voidProjAlpha[5]] },
    { state: 'hazard', hue: 128, ringHex: '#9BE870', src: [...healPillar.slice(0, 3), fxE5Spells[6] ?? healPillar[3], fxE5Spells[6] ?? healPillar[2], healPillar[1]] },
    { state: 'shrapnel', hue: 194, ringHex: '#FF8A3D', src: dfIce.length >= 5 ? dfIce : majorIce },
    { state: 'fracture', hue: 294, ringHex: '#E96578', src: fx28BossPillar.length >= 5 ? fx28BossPillar : impactRing },
  ];
  writeVfxSheet(
    'vfx_resonances_arcane',
    'Arcane Resonance Detonations (8 Archetypes)',
    'Nova, Vortex, Chain, Chrono, Siphon, Hazard, Shrapnel & Fracture VFX',
    ['vfx', 'batch-2', '64x64', '78-resonances', 'transparent'],
    resArchetypes.map((ra) => ({
      state: ra.state,
      fps: 14,
      loop: false,
      eventPeak: true,
      frames: sampleSequence(ra.src, 6).map((c, i) =>
        buildVfxFrame(c, {
          hue: ra.hue,
          scale: 20 + i * 2,
          extraRingHex: ra.ringHex,
          ringR: 5 + i * 1.7,
        })
      ),
    }))
  );

  return manifests;
}

// ============================================================================
// 6. ICONS SHEET (32x32, 6x3 = 18 icons — Pickups + 13 Elemental Schools)
// ============================================================================

function buildIconsSheet(): AssetManifest {
  const sheetMaster = loadSourceRaster('image_050e7303.png');
  const sheetEnv = loadSourceRaster('image_891f543c.png');
  const sheetVfx = loadSourceRaster('image_5f9076f6.png');
  const sheetVerticalSlice = loadSourceRaster('image_743550f4.png');
  const sheetAtlas30 = loadSourceRaster('image_30cd6dea.png');

  const iconHealth = extractTightSprite(sheetMaster, { x: 248, y: 324, w: 50, h: 44 }, 'dark');
  const iconMana = extractTightSprite(sheetMaster, { x: 256, y: 368, w: 44, h: 42 }, 'dark');
  const iconAether = extractTightSprite(sheetMaster, { x: 255, y: 403, w: 50, h: 48 }, 'dark');
  const iconCoin = extractTightSprite(sheetMaster, { x: 244, y: 455, w: 56, h: 36 }, 'dark');
  const iconChest = extractTightSprite(sheetEnv, { x: 1022, y: 822, w: 90, h: 74 }, 'alpha');

  // Authentic hexagonal 13 Elemental School Crests from image_743550f4.png
  // R1 (7): [0:Fire, 1:Ice, 2:Lightning, 3:Arcane, 4:Earth, 5:Wind, 6:Water]
  // R2 (6): [0:Nature, 1:Light, 2:Shadow, 3:Void, 4:Aether, 5:Time]
  const hexR1 = extractBand(sheetVerticalSlice, { x: 770, y: 514, w: 400, h: 46 }, 'dark', { mergeGap: 2, expectedCount: 7 });
  const hexR2 = extractBand(sheetVerticalSlice, { x: 794, y: 578, w: 365, h: 46 }, 'dark', { mergeGap: 2, expectedCount: 6 });
  // Authentic Blood Crimson Drop icon from image_30cd6dea.png + Sonic glyph from image_5f9076f6.png
  const iconBlood = extractTightSprite(sheetAtlas30, { x: 1148, y: 547, w: 36, h: 32 }, 'dark');
  const glyphsR1 = extractBand(sheetVfx, { x: 1015, y: 622, w: 500, h: 65 }, 'checker', { mergeGap: 3 });

  // Exact index mapping expected by src/data/resonances.ts (5..17 = Fire..Sonic):
  // 0:Health, 1:Mana, 2:Aether, 3:Coin, 4:Chest,
  // 5:Fire, 6:Ice, 7:Lightning, 8:Earth, 9:Shadow, 10:Light,
  // 11:Time, 12:Void, 13:Arcane, 14:Blood, 15:Nature, 16:Wind, 17:Sonic
  const rawIcons: { sprite: RasterBuffer; tintHue?: number }[] = [
    { sprite: iconHealth },
    { sprite: iconMana },
    { sprite: iconAether },
    { sprite: iconCoin },
    { sprite: iconChest },
    { sprite: hexR1[0] }, // 5: Fire
    { sprite: hexR1[1] }, // 6: Ice
    { sprite: hexR1[2] }, // 7: Lightning
    { sprite: hexR1[4] }, // 8: Earth
    { sprite: hexR2[2] }, // 9: Shadow
    { sprite: hexR2[1] }, // 10: Light
    { sprite: hexR2[5] }, // 11: Time
    { sprite: hexR2[3] }, // 12: Void
    { sprite: hexR1[3] }, // 13: Arcane
    { sprite: iconBlood }, // 14: Blood
    { sprite: hexR2[0] }, // 15: Nature
    { sprite: hexR1[5] }, // 16: Wind
    { sprite: glyphsR1[6] ?? hexR2[4], tintHue: 212 }, // 17: Sonic
  ];

  const cols = 6;
  const rows = 3;
  const sheet = createRaster(cols * 32, rows * 32);

  rawIcons.forEach((item, idx) => {
    let half = resampleToCalibratedCell(item.sprite, 16, 16, {
      anchor: 'center',
      maxW: 14,
      maxH: 14,
    }).buffer;
    if (item.tintHue !== undefined) {
      half = remapBufferHue(half, item.tintHue, { satScale: 1.05, minSat: 0.14 });
    }
    const styled = quantizeRiftNightLab(half, {
      mode: 'hybrid_lab',
      cohesionStrength: 0.28,
      addOutline: true,
      ensureCornerTransparent: true,
    }).buffer;
    blitRaster(sheet, upscaleRaster(styled, 2), (idx % cols) * 32, Math.floor(idx / cols) * 32);
  });

  const manifest: AssetManifest = {
    assetId: 'icons_pickups_schools',
    name: 'Pickups & 13 Elemental Schools',
    category: 'icons',
    subtitle: 'Vials, Arcane Shards, Gold, Relic Chest & all 13 hexagonal elemental school crests',
    sheetUrl: '/assets/sprites/icons_pickups_schools.png',
    manifestUrl: '/assets/sprites/icons_pickups_schools.json',
    frameWidth: 32,
    frameHeight: 32,
    columns: cols,
    rows,
    animations: [
      { state: 'pickups_and_fire', direction: 'down', row: 0, frameCount: 6, fps: 3, loop: true, pivot: { x: 16, y: 16 }, hitbox: { x: 4, y: 4, w: 24, h: 24 }, hurtbox: { x: 4, y: 4, w: 24, h: 24 }, events: [] },
      { state: 'elemental_schools_a', direction: 'down', row: 1, frameCount: 6, fps: 3, loop: true, pivot: { x: 16, y: 16 }, hitbox: { x: 4, y: 4, w: 24, h: 24 }, hurtbox: { x: 4, y: 4, w: 24, h: 24 }, events: [] },
      { state: 'elemental_schools_b', direction: 'down', row: 2, frameCount: 6, fps: 3, loop: true, pivot: { x: 16, y: 16 }, hitbox: { x: 4, y: 4, w: 24, h: 24 }, hurtbox: { x: 4, y: 4, w: 24, h: 24 }, events: [] },
    ],
    tags: ['icons', 'pickups', '13-schools', '32x32'],
    integratedInDemo: true,
  };
  writeAsset(manifest, sheet);
  return manifest;
}

// ============================================================================
// 7. CLASS & TYRANT PORTRAITS (64x64, 5x2 = 10 tiles)
//    Sources: image_743550f4.png (6 Mages + 3 Tyrants) + image_d7db875b.png (Hero Bust)
// ============================================================================

function buildPortraitsSheet(): AssetManifest {
  const sheetVerticalSlice = loadSourceRaster('image_743550f4.png');
  const sheetRef = loadSourceRaster('image_d7db875b.png');

  const vsMages = extractBand(sheetVerticalSlice, { x: 20, y: 518, w: 438, h: 82 }, 'dark', {
    mergeGap: 4,
    expectedCount: 6,
  });
  const vsTyrants = extractBand(sheetVerticalSlice, { x: 434, y: 686, w: 288, h: 90 }, 'dark', {
    mergeGap: 6,
    expectedCount: 3,
  });
  const heroBust = extractTightSprite(sheetRef, { x: 8, y: 6, w: 300, h: 274 }, 'white');

  // Tile Order (6 cols × 2 rows = 12 tiles):
  // 0:Pyromancer, 1:Cryomancer, 2:Stormcaller, 3:Voidweaver, 4:Aethermancer,
  // 5:Chronomancer, 6:Bone Regent, 7:Blight Colossus, 8:Rift Leviathan, 9:Archmage Hero Crest,
  // 10:Cinder Archon, 11:Astral Sovereign
  const [cinderBust, astralBust] = buildNewBossPortraitsHalf();
  const rawPortraits: { buf: RasterBuffer; preHalf?: boolean }[] = [
    { buf: vsMages[0] },
    { buf: vsMages[1] },
    { buf: vsMages[2] },
    { buf: vsMages[3] },
    { buf: vsMages[4] },
    { buf: vsMages[5] },
    { buf: vsTyrants[0] },
    { buf: vsTyrants[1] },
    { buf: vsTyrants[2] },
    { buf: heroBust },
    { buf: cinderBust, preHalf: true },
    { buf: astralBust, preHalf: true },
  ];

  const cols = 6;
  const rows = 2;
  const sheet = createRaster(cols * 64, rows * 64);

  rawPortraits.forEach((entry, idx) => {
    let half = entry.preHalf
      ? entry.buf
      : resampleToCalibratedCell(entry.buf, 32, 32, {
          anchor: 'center',
          maxW: 28,
          maxH: 28,
        }).buffer;
    half = applyHiBitDepthPass(half, { rimStrength: 0.24, aoStrength: 0.2 });
    const styled = quantizeRiftNightLab(half, {
      mode: 'hybrid_lab',
      cohesionStrength: 0.34,
      addOutline: true,
      ensureCornerTransparent: true,
    }).buffer;
    blitRaster(sheet, upscaleRaster(styled, 2), (idx % cols) * 64, Math.floor(idx / cols) * 64);
  });

  const manifest: AssetManifest = {
    assetId: 'portraits_classes_tyrants',
    name: 'Archmage & Tyrant Portraits',
    category: 'icons',
    subtitle: '6 Playable Archmage classes, 5 Active Tyrants & Archmage Hero portrait',
    sheetUrl: '/assets/sprites/portraits_classes_tyrants.png',
    manifestUrl: '/assets/sprites/portraits_classes_tyrants.json',
    frameWidth: 64,
    frameHeight: 64,
    columns: cols,
    rows,
    animations: [
      { state: 'archmage_classes', direction: 'down', row: 0, frameCount: 6, fps: 2, loop: true, pivot: { x: 32, y: 32 }, hitbox: { x: 6, y: 6, w: 52, h: 52 }, hurtbox: { x: 6, y: 6, w: 52, h: 52 }, events: [] },
      { state: 'tyrants_and_crest', direction: 'down', row: 1, frameCount: 6, fps: 2, loop: true, pivot: { x: 32, y: 32 }, hitbox: { x: 6, y: 6, w: 52, h: 52 }, hurtbox: { x: 6, y: 6, w: 52, h: 52 }, events: [] },
    ],
    tags: ['portraits', 'classes', 'tyrants', 'hi-bit-2x', '64x64'],
    integratedInDemo: true,
  };
  writeAsset(manifest, sheet);
  return manifest;
}

// ============================================================================
// 8. RELIC STAVES & ARTIFACTS (64x64, 6x2 = 12 tiles)
//    Sources: image_30cd6dea.png + image_e5369a8c.png
// ============================================================================

function buildRelicsSheet(): AssetManifest {
  const sheetAtlas30 = loadSourceRaster('image_30cd6dea.png');
  const sheetAtlasE5 = loadSourceRaster('image_e5369a8c.png');

  const staves30 = extractBand(sheetAtlas30, { x: 20, y: 842, w: 266, h: 70 }, 'dark', { mergeGap: 3, expectedCount: 6 });
  const relics30 = extractBand(sheetAtlas30, { x: 20, y: 928, w: 266, h: 52 }, 'dark', { mergeGap: 4, expectedCount: 4 });
  const stavesE5 = extractBand(sheetAtlasE5, { x: 825, y: 752, w: 300, h: 58 }, 'dark', { mergeGap: 3, expectedCount: 6 });
  const artifactsE5 = extractBand(sheetAtlasE5, { x: 830, y: 824, w: 290, h: 36 }, 'dark', { mergeGap: 4, minArea: 120 });

  const rawRelics: RasterBuffer[] = [
    staves30[0],
    staves30[1],
    staves30[2],
    stavesE5[2] ?? staves30[3],
    stavesE5[3] ?? staves30[4],
    stavesE5[4] ?? staves30[5],
    relics30[0], // Spellbook
    relics30[1], // Gold Ring
    relics30[2], // Arcane Amulet
    relics30[3], // Archmage Robe
    artifactsE5[2] ?? relics30[1], // Sapphire Ring
    artifactsE5[artifactsE5.length - 1] ?? relics30[2], // Golden Tyrant Crown
  ];

  const cols = 6;
  const rows = 2;
  const sheet = createRaster(cols * 64, rows * 64);

  rawRelics.forEach((raw, idx) => {
    const half = resampleToCalibratedCell(raw, 32, 32, {
      anchor: 'center',
      maxW: 28,
      maxH: 28,
    }).buffer;
    const styled = quantizeRiftNightLab(half, {
      mode: 'hybrid_lab',
      cohesionStrength: 0.34,
      addOutline: true,
      ensureCornerTransparent: true,
    }).buffer;
    blitRaster(sheet, upscaleRaster(styled, 2), (idx % cols) * 64, Math.floor(idx / cols) * 64);
  });

  const manifest: AssetManifest = {
    assetId: 'ui_relics_artifacts',
    name: 'Archmage Staves & Rift Relics',
    category: 'icons',
    subtitle: '6 Elemental Staves, Grimoire, Rings, Arcane Amulet, Robe & Tyrant Crown',
    sheetUrl: '/assets/sprites/ui_relics_artifacts.png',
    manifestUrl: '/assets/sprites/ui_relics_artifacts.json',
    frameWidth: 64,
    frameHeight: 64,
    columns: cols,
    rows,
    animations: [
      { state: 'elemental_staves', direction: 'down', row: 0, frameCount: 6, fps: 3, loop: true, pivot: { x: 32, y: 32 }, hitbox: { x: 6, y: 6, w: 52, h: 52 }, hurtbox: { x: 6, y: 6, w: 52, h: 52 }, events: [] },
      { state: 'grimoires_and_relics', direction: 'down', row: 1, frameCount: 6, fps: 3, loop: true, pivot: { x: 32, y: 32 }, hitbox: { x: 6, y: 6, w: 52, h: 52 }, hurtbox: { x: 6, y: 6, w: 52, h: 52 }, events: [] },
    ],
    tags: ['relics', 'staves', 'artifacts', '64x64'],
    integratedInDemo: true,
  };
  writeAsset(manifest, sheet);
  return manifest;
}

export function buildAllUploadedAssets(): AssetManifest[] {
  totalAdaptiveSeamCuts = 0;
  totalCalibratedFrames = 0;
  loadedSourceFiles.clear();

  const purgedCount = purgeLegacySpriteOutputs();
  // Ensure reference VFX source sheet remains indexed in raw 4K archive manifest
  loadSourceRaster('image_287c1c89.png');
  loadSourceRaster('image_dfe3c9c6.png');

  const manifests: AssetManifest[] = [];
  manifests.push(...buildAllMages());
  manifests.push(...buildAllEnemies());
  manifests.push(...(buildNewEnemies() as unknown as AssetManifest[]));
  manifests.push(...buildAllBosses());
  manifests.push(...(buildNewBosses() as unknown as AssetManifest[]));
  manifests.push(...(buildAllVfxUpgraded() as unknown as AssetManifest[]));
  manifests.push(...buildAllTilesets());
  manifests.push(buildIconsSheet());
  manifests.push(buildPortraitsSheet());
  manifests.push(buildRelicsSheet());

  const allAvailableSources = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const sourceSheetsUsed = [...loadedSourceFiles].sort();

  const masterPath = path.resolve(process.cwd(), 'public/assets/manifest.json');
  fs.writeFileSync(
    masterPath,
    JSON.stringify(
      {
        version: STYLE_CONTRACT.version,
        generatedAt: new Date().toISOString(),
        sourcePipeline: 'v3.1-hi-bit-pvfx-pixel-burst-pipeline',
        purgedLegacyFiles: purgedCount,
        sourceSheetCount: sourceSheetsUsed.length,
        availableSourceCount: allAvailableSources.length,
        sourceSheetsUsed,
        assetCount: manifests.length,
        assets: manifests,
      },
      null,
      2
    )
  );
  return manifests;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = buildAllUploadedAssets();
  const allAvailable = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.png')).length;
  console.log(
    `Purged legacy sprites & ingested ${result.length} V3.1 sheets using ${loadedSourceFiles.size}/${allAvailable} source sheets (${totalAdaptiveSeamCuts} adaptive DP seam cuts, ${totalCalibratedFrames} feet-centroid calibrated frames).`
  );
}
