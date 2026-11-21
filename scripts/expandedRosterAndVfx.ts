import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './pixelCanvas.ts';
import { STYLE_CONTRACT } from './styleContract.ts';
import {
  GROUND_SHADOW_RGBA,
  OUTLINE_INK_RGBA,
  RGBA,
  RasterBuffer,
  applyDirectionalShading,
  applyFullBodyArticulation,
  applyHiBitDepthPass,
  applyPostOutlineEffect,
  blitRaster,
  createRaster,
  drawEllipse,
  drawGlow,
  drawRing,
  ensureDistinctFrame,
  hexToRgba,
  injectOutlineInk,
  setPixelBlend,
  setPixelRaw,
  upscaleRaster,
} from '../src/pipeline/raster.ts';
import { quantizeRiftNightLab } from '../src/pipeline/colorQuantizer.ts';

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

export interface ExpandedAssetManifest {
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

const OUT_DIR = path.resolve(process.cwd(), 'public/assets/sprites');
const DIRS: Direction[] = ['down', 'up', 'left', 'right'];

function writeExpandedAsset(manifest: ExpandedAssetManifest, sheet: RasterBuffer): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, `${manifest.assetId}.png`),
    encodePNG(sheet.width, sheet.height, sheet.data)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, `${manifest.assetId}.json`),
    JSON.stringify(manifest, null, 2)
  );
}

// ---------- Low-Level Pixel Art Primitives (Half-Res 1x -> 2x Hi-Bit) ----------

function drawLinePx(
  buf: RasterBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
  thickness = 1
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.5));
  const r = Math.max(0, (thickness - 1) * 0.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    if (r <= 0.25) {
      setPixelBlend(buf, Math.round(px), Math.round(py), color);
    } else {
      drawEllipse(buf, px, py, r + 0.35, r + 0.35, color);
    }
  }
}

function drawRectPx(
  buf: RasterBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGBA
): void {
  const ix0 = Math.round(x);
  const iy0 = Math.round(y);
  const ix1 = Math.round(x + w);
  const iy1 = Math.round(y + h);
  for (let py = iy0; py < iy1; py++) {
    for (let px = ix0; px < ix1; px++) {
      setPixelBlend(buf, px, py, color);
    }
  }
}

function drawPolygonPx(buf: RasterBuffer, pts: [number, number][], color: RGBA): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, py] of pts) {
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(buf.height - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1p] = pts[i];
      const [x2, y2p] = pts[(i + 1) % pts.length];
      if ((y1p <= y && y2p > y) || (y2p <= y && y1p > y)) {
        const t = (y - y1p) / (y2p - y1p);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k < xs.length - 1; k += 2) {
      const sx = Math.max(0, Math.floor(xs[k]));
      const ex = Math.min(buf.width - 1, Math.ceil(xs[k + 1]));
      for (let x = sx; x <= ex; x++) {
        setPixelBlend(buf, x, y, color);
      }
    }
  }
}

// ============================================================================
// 1. FIVE NEW ANIMATED ENEMIES (64x64, 7 V3.1 states x 4 dirs = 28 rows)
// ============================================================================

type NewEnemyKind =
  | 'ember_hound'
  | 'obsidian_golem'
  | 'ash_pyromancer'
  | 'void_stalker'
  | 'starlight_sentinel';

function drawNewEnemyFrameHalf(
  kind: NewEnemyKind,
  state: string,
  dir: Direction,
  f: number,
  total: number
): RasterBuffer {
  const buf = createRaster(32, 32);
  const t = total > 1 ? f / (total - 1) : 0;
  const phase = (f / Math.max(1, total)) * Math.PI * 2;
  const facing = dir === 'left' ? -1 : 1;
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';

  const walkSwing = state === 'walk' ? Math.sin(phase) : 0;
  const walkBob = state === 'walk' ? -Math.round(Math.abs(Math.cos(phase)) * 1.3) : 0;
  const idleBob = state === 'idle' ? (Math.sin(phase) > 0.35 ? -1 : 0) : 0;
  const windupPull = state === 'windup' ? Math.sin(t * Math.PI * 0.85) : 0;
  const atkLunge = state === 'attack' ? Math.sin(t * Math.PI) : 0;
  const recEase = state === 'recovery' ? 1 - t : 0;
  const deathDrop = state === 'death' ? t * t : 0;

  const cx = 16 + Math.round((atkLunge * 2.5 - windupPull * 1.5) * facing);
  const baseY = 26 + Math.round(deathDrop * 3) + walkBob + idleBob;

  if (kind === 'ember_hound') {
    // Quadruped volcanic hound with articulated 4-leg gallop, fiery spine & jaw snap
    const furDark = hexToRgba('#2D1C36');
    const furMid = hexToRgba('#4E2840');
    const furLight = hexToRgba('#7D3B46');
    const magma = hexToRgba('#FF6B3D');
    const ember = hexToRgba('#FFD166');
    const hot = hexToRgba('#FFF3C4');

    const gallop = state === 'walk' ? Math.sin(phase) * 3 : state === 'attack' ? atkLunge * 4 : 0;
    const bodyY = baseY - 7 + Math.round(windupPull * 2 - atkLunge * 2);

    // Articulated Tail Flame
    const tailX = cx - (side ? 8 * facing : 5);
    const tailWag = Math.sin(phase * 1.5 + 0.8) * 2.2;
    drawLinePx(buf, cx - (side ? 4 * facing : 0), bodyY, tailX, bodyY - 4 + tailWag, magma, 2);
    setPixelBlend(buf, Math.round(tailX - facing), Math.round(bodyY - 5 + tailWag), ember);

    // 4 Articulated Legs
    const legOffsets = side
      ? [
          { lx: cx - 5 * facing - gallop, ly: baseY - 1, col: furDark },
          { lx: cx - 2 * facing + gallop * 0.8, ly: baseY, col: furMid },
          { lx: cx + 3 * facing - gallop * 0.8, ly: baseY, col: furDark },
          { lx: cx + 5 * facing + gallop, ly: baseY - 1, col: furMid },
        ]
      : [
          { lx: cx - 4, ly: baseY - Math.round(Math.max(0, gallop)), col: furDark },
          { lx: cx + 4, ly: baseY - Math.round(Math.max(0, -gallop)), col: furDark },
          { lx: cx - 2, ly: baseY + Math.round(Math.min(0, -gallop)), col: furMid },
          { lx: cx + 2, ly: baseY + Math.round(Math.min(0, gallop)), col: furMid },
        ];
    for (const lg of legOffsets) {
      drawLinePx(buf, (lg.lx + cx) * 0.5, bodyY + 2, lg.lx, lg.ly, lg.col, 2);
      setPixelBlend(buf, Math.round(lg.lx), Math.round(lg.ly), magma);
    }

    // Muscular Torso
    drawEllipse(buf, cx, bodyY, side ? 7 : 5.5, 4.2, furMid);
    drawEllipse(buf, cx - 1, bodyY - 1, side ? 5 : 4, 2.5, furLight);

    // Molten Ridge Spines along back
    for (let s = -2; s <= 2; s++) {
      const sx = cx + s * 2;
      const sy = bodyY - 4 - ((s + f) % 2 === 0 ? 1 : 0);
      setPixelBlend(buf, sx, sy, s % 2 === 0 ? magma : ember);
    }

    // Articulated Head + Snapping Jaw
    const headX = cx + (side ? 6 * facing : 0);
    const headY = bodyY - (side ? 2 : 3) - Math.round(atkLunge * 1.5);
    drawEllipse(buf, headX, headY, 4, 3.3, furLight);
    // Pointed Ears
    drawLinePx(buf, headX - 2, headY - 2, headX - 3, headY - 6, furDark, 1);
    drawLinePx(buf, headX + 2, headY - 2, headX + 3, headY - 6, furDark, 1);
    if (!back) {
      // Glowing Ember Eyes
      setPixelBlend(buf, headX + (side ? 2 * facing : -2), headY - 1, hot);
      if (!side) setPixelBlend(buf, headX + 2, headY - 1, hot);
      // Jaw flame on windup/attack
      if (state === 'attack' || state === 'windup') {
        drawEllipse(buf, headX + (side ? 4 * facing : 0), headY + 2, 2.5, 1.8, magma);
        setPixelBlend(buf, headX + (side ? 4 * facing : 0), headY + 2, hot);
      }
    }
  } else if (kind === 'obsidian_golem') {
    // Heavy volcanic basalt colossus with glowing magma cracks & seismic fist slam
    const stoneDark = hexToRgba('#231C33');
    const stoneMid = hexToRgba('#3D3454');
    const stoneLight = hexToRgba('#6C608A');
    const lava = hexToRgba('#FF5C35');
    const gold = hexToRgba('#F7C86B');

    const stomp = state === 'walk' ? Math.sin(phase) * 2.2 : 0;
    const armRaise = state === 'windup' ? -windupPull * 6 : state === 'attack' ? atkLunge * 5 : 0;
    const torsoY = baseY - 11 + Math.round(atkLunge * 2 - windupPull * 1.5);

    // Massive Stomping Legs
    drawRectPx(buf, cx - 6, baseY - 6 - Math.max(0, stomp), 4, 6, stoneDark);
    drawRectPx(buf, cx + 2, baseY - 6 - Math.max(0, -stomp), 4, 6, stoneDark);
    drawRectPx(buf, cx - 5, baseY - 5 - Math.max(0, stomp), 2, 4, stoneMid);
    drawRectPx(buf, cx + 3, baseY - 5 - Math.max(0, -stomp), 2, 4, stoneMid);

    // Broad Armored Torso
    drawPolygonPx(
      buf,
      [
        [cx - 8, torsoY - 5],
        [cx + 8, torsoY - 5],
        [cx + 6, torsoY + 6],
        [cx - 6, torsoY + 6],
      ],
      stoneMid
    );
    drawPolygonPx(
      buf,
      [
        [cx - 7, torsoY - 5],
        [cx + 4, torsoY - 5],
        [cx + 2, torsoY + 1],
        [cx - 6, torsoY + 1],
      ],
      stoneLight
    );

    // Molten Rune Core & Cracks
    drawLinePx(buf, cx - 3, torsoY - 2, cx, torsoY + 1, lava, 1);
    drawLinePx(buf, cx + 3, torsoY - 2, cx, torsoY + 1, lava, 1);
    drawEllipse(buf, cx, torsoY, 2.2, 2.2, lava);
    setPixelBlend(buf, cx, torsoY, gold);

    // Articulated Heavy Gauntlet Arms
    const leftArmY = torsoY + 2 + Math.round(armRaise + walkSwing * 2);
    const rightArmY = torsoY + 2 + Math.round(armRaise - walkSwing * 2);
    drawRectPx(buf, cx - 10, leftArmY - 3, 4, 7, stoneDark);
    drawRectPx(buf, cx - 9, leftArmY - 2, 2, 4, stoneLight);
    setPixelBlend(buf, cx - 8, leftArmY + 2, lava);

    drawRectPx(buf, cx + 6, rightArmY - 3, 4, 7, stoneDark);
    drawRectPx(buf, cx + 7, rightArmY - 2, 2, 4, stoneLight);
    setPixelBlend(buf, cx + 8, rightArmY + 2, lava);

    // Recessed Horned Head
    drawRectPx(buf, cx - 4, torsoY - 9, 8, 5, stoneMid);
    drawRectPx(buf, cx - 3, torsoY - 9, 5, 2, stoneLight);
    if (!back) {
      setPixelBlend(buf, cx - 2, torsoY - 7, gold);
      setPixelBlend(buf, cx + 2, torsoY - 7, gold);
    }
  } else if (kind === 'ash_pyromancer') {
    // Hooded ember cultist with charred crimson-violet mantle and flaming brazier staff
    const robeDark = hexToRgba('#2A1629');
    const robeMid = hexToRgba('#54233C');
    const robeTrim = hexToRgba('#D9BA72');
    const flame = hexToRgba('#FF6B3D');
    const flameCore = hexToRgba('#FFF0B8');

    const cloakLag = Math.round(walkSwing * 1.5);
    const bodyY = baseY - 9;

    // Articulated Feet under hem
    drawRectPx(buf, cx - 3 + Math.round(walkSwing * 1.5), baseY - 2, 2, 2, robeDark);
    drawRectPx(buf, cx + 1 - Math.round(walkSwing * 1.5), baseY - 2, 2, 2, robeDark);

    // Flowing Robe Skirt + Gold Trim
    drawPolygonPx(
      buf,
      [
        [cx - 4, bodyY - 3],
        [cx + 4, bodyY - 3],
        [cx + 6 - cloakLag, baseY - 2],
        [cx - 6 - cloakLag, baseY - 2],
      ],
      robeMid
    );
    drawLinePx(buf, cx - 5 - cloakLag, baseY - 3, cx + 5 - cloakLag, baseY - 3, robeTrim, 1);
    drawLinePx(buf, cx, bodyY - 2, cx - cloakLag * 0.5, baseY - 3, robeTrim, 1);

    // Hooded Mantle & Glowing Eyes
    drawEllipse(buf, cx, bodyY - 6, 4.3, 4.5, robeDark);
    drawEllipse(buf, cx - 1, bodyY - 7, 3, 3, robeMid);
    if (!back) {
      drawRectPx(buf, cx - 2, bodyY - 7, 4, 3, OUTLINE_INK_RGBA);
      setPixelBlend(buf, cx - 1, bodyY - 6, flameCore);
      setPixelBlend(buf, cx + 1, bodyY - 6, flameCore);
    }

    // Articulated Brazier Staff
    const staffX = cx + (side ? 6 * facing : 6);
    const staffLift = Math.round(-windupPull * 3 - atkLunge * 2 + recEase * 1);
    drawLinePx(buf, cx + 3, bodyY - 1, staffX, bodyY - 9 + staffLift, hexToRgba('#8B6B32'), 1);
    drawLinePx(buf, staffX, bodyY - 9 + staffLift, staffX, baseY - 2 + staffLift, hexToRgba('#5B4126'), 1);
    drawEllipse(buf, staffX, bodyY - 10 + staffLift, 2.3 + atkLunge, 2.6 + atkLunge, flame);
    setPixelBlend(buf, staffX, bodyY - 11 + staffLift, flameCore);
  } else if (kind === 'void_stalker') {
    // Agile astral-shadow assassin with twin glowing crescent blades and scarf tail
    const suitDark = hexToRgba('#1E1533');
    const suitMid = hexToRgba('#3F2A6E');
    const scarf = hexToRgba('#8F5CE8');
    const blade = hexToRgba('#E8D6FF');
    const bladeEdge = hexToRgba('#C06CFF');

    const crouch = state === 'windup' ? 2 : state === 'walk' ? 1 : 0;
    const bodyY = baseY - 8 + crouch;

    // Flowing Ethereal Scarf
    const scarfWave = Math.sin(phase + 1.2) * 2.5;
    drawLinePx(buf, cx - facing, bodyY - 4, cx - 7 * facing, bodyY - 5 + scarfWave, scarf, 2);

    // Articulated Sprint Legs
    const legA = Math.round(walkSwing * 3);
    drawLinePx(buf, cx - 1, bodyY + 2, cx - 3 + legA, baseY, suitDark, 2);
    drawLinePx(buf, cx + 1, bodyY + 2, cx + 3 - legA, baseY, suitMid, 2);

    // Lean Armored Torso & Masked Head
    drawEllipse(buf, cx, bodyY - 1, 3.8, 4.5, suitMid);
    drawEllipse(buf, cx, bodyY - 6, 3.4, 3.4, suitDark);
    drawLinePx(buf, cx - 3, bodyY - 7, cx + 3, bodyY - 7, scarf, 1);
    if (!back) {
      setPixelBlend(buf, cx - 1, bodyY - 6, blade);
      setPixelBlend(buf, cx + 2, bodyY - 6, blade);
    }

    // Twin Crescent Void Daggers (cross-slash sweep on attack)
    const slashAng = state === 'attack' ? (t - 0.3) * 2.4 : state === 'windup' ? -0.9 : walkSwing * 0.4;
    const bx1 = cx + Math.round(Math.cos(slashAng) * 7 * facing);
    const by1 = bodyY + Math.round(Math.sin(slashAng) * 5);
    const bx2 = cx - Math.round(Math.cos(slashAng) * 5 * facing);
    const by2 = bodyY + Math.round(Math.sin(slashAng + 1.2) * 4);
    drawLinePx(buf, cx + 2 * facing, bodyY - 1, bx1, by1, bladeEdge, 2);
    drawLinePx(buf, cx + 2 * facing, bodyY - 1, bx1, by1, blade, 1);
    drawLinePx(buf, cx - 2 * facing, bodyY, bx2, by2, bladeEdge, 1);
  } else {
    // Starlight Sentinel — hovering celestial prism construct with orbiting rune halo & crystal wings
    const crystalDark = hexToRgba('#2B285C');
    const crystalMid = hexToRgba('#5B6EE1');
    const crystalBright = hexToRgba('#A7D8FF');
    const gold = hexToRgba('#F7E3A6');
    const starCore = hexToRgba('#FFFFFF');

    const hover = Math.round(Math.sin(phase) * 1.8) - Math.round(windupPull * 2);
    const cy = baseY - 12 + hover;

    // Orbiting Celestial Ring Shards
    for (let i = 0; i < 4; i++) {
      const ang = phase + (i * Math.PI) / 2 + (state === 'attack' ? t * 2.2 : 0);
      const rx = cx + Math.round(Math.cos(ang) * (8 + atkLunge * 2));
      const ry = cy + Math.round(Math.sin(ang) * 4.5);
      drawEllipse(buf, rx, ry, 1.5, 1.5, gold);
      setPixelBlend(buf, rx, ry, starCore);
    }

    // Articulated Wing Blades
    const wingSpread = 6 + Math.round(Math.sin(phase) * 1.5 + windupPull * 2.5 + atkLunge * 2);
    drawPolygonPx(
      buf,
      [
        [cx - 3, cy - 2],
        [cx - wingSpread - 3, cy - 5],
        [cx - wingSpread, cy + 2],
        [cx - 3, cy + 3],
      ],
      crystalMid
    );
    drawPolygonPx(
      buf,
      [
        [cx + 3, cy - 2],
        [cx + wingSpread + 3, cy - 5],
        [cx + wingSpread, cy + 2],
        [cx + 3, cy + 3],
      ],
      crystalMid
    );

    // Core Diamond Monolith
    drawPolygonPx(
      buf,
      [
        [cx, cy - 8],
        [cx + 5, cy],
        [cx, cy + 8],
        [cx - 5, cy],
      ],
      crystalDark
    );
    drawPolygonPx(
      buf,
      [
        [cx, cy - 6],
        [cx + 3, cy],
        [cx, cy + 6],
        [cx - 3, cy],
      ],
      crystalBright
    );
    // Glowing Eye / Star Prism Core
    drawEllipse(buf, cx, cy, 2 + atkLunge, 2 + atkLunge, gold);
    setPixelBlend(buf, cx, cy, starCore);
  }

  return buf;
}

export function buildNewEnemies(): ExpandedAssetManifest[] {
  const specs: {
    id: string;
    kind: NewEnemyKind;
    name: string;
    subtitle: string;
    accentHex: string;
    biomeTag: string;
    events: { attack: string; death: string };
  }[] = [
    {
      id: 'enemy_ember_hound',
      kind: 'ember_hound',
      name: 'Ember Hound',
      subtitle: 'Ashen Citadel — Feral magma beast with fiery leap lunge',
      accentHex: '#FF6B3D',
      biomeTag: 'ashen-citadel',
      events: { attack: 'ember_lunge', death: 'ash_burst' },
    },
    {
      id: 'enemy_obsidian_golem',
      kind: 'obsidian_golem',
      name: 'Obsidian Golem',
      subtitle: 'Ashen Citadel — Heavy basalt sentinel with seismic shockwave slam',
      accentHex: '#FF8A3D',
      biomeTag: 'ashen-citadel',
      events: { attack: 'seismic_slam', death: 'basalt_shatter' },
    },
    {
      id: 'enemy_ash_pyromancer',
      kind: 'ash_pyromancer',
      name: 'Ash Pyromancer',
      subtitle: 'Ashen Citadel — Cinder hexer casting splitting flame orbs',
      accentHex: '#F7C86B',
      biomeTag: 'ashen-citadel',
      events: { attack: 'cinder_volley', death: 'pyre_collapse' },
    },
    {
      id: 'enemy_void_stalker',
      kind: 'void_stalker',
      name: 'Void Stalker',
      subtitle: 'Astral Abyss — Phasing rift assassin with crescent ambush slash',
      accentHex: '#C06CFF',
      biomeTag: 'astral-abyss',
      events: { attack: 'rift_slash', death: 'void_vanish' },
    },
    {
      id: 'enemy_starlight_sentinel',
      kind: 'starlight_sentinel',
      name: 'Starlight Sentinel',
      subtitle: 'Astral Abyss — Levitating prism construct firing 4-way starlight',
      accentHex: '#7C9BFF',
      biomeTag: 'astral-abyss',
      events: { attack: 'prism_pulse', death: 'crystal_fracture' },
    },
  ];

  const manifests: ExpandedAssetManifest[] = [];
  const enemyTiming = STYLE_CONTRACT.timing.enemy;
  const maxCols = Math.max(...enemyTiming.map((t) => t.frames));
  const totalRows = enemyTiming.length * DIRS.length;

  for (const spec of specs) {
    const sheet = createRaster(maxCols * 64, totalRows * 64);
    const animations: AnimationEntry[] = [];
    let row = 0;

    for (const st of enemyTiming) {
      const events: AnimEvent[] =
        st.state === 'attack'
          ? [{ frame: 2, name: spec.events.attack }]
          : st.state === 'death'
            ? [{ frame: 3, name: spec.events.death }]
            : st.state === 'walk'
              ? [
                  { frame: 1, name: 'step_l' },
                  { frame: 4, name: 'step_r' },
                ]
              : [];

      for (const dir of DIRS) {
        let prevHash: string | null = null;

        for (let f = 0; f < st.frames; f++) {
          let half = drawNewEnemyFrameHalf(spec.kind, st.state, dir, f, st.frames);
          half = applyDirectionalShading(half, dir);
          half = applyHiBitDepthPass(half, {
            rimStrength: 0.28,
            aoStrength: 0.24,
            rimTint: hexToRgba('#F7E3A6'),
          });

          let styled = quantizeRiftNightLab(half, {
            mode: 'hybrid_lab',
            cohesionStrength: 0.34,
            addOutline: true,
            addGroundShadow: st.state !== 'death' || f < 3,
            shadowY: 28,
            shadowRx: spec.kind === 'obsidian_golem' ? 9 : 7,
            shadowRy: 2.3,
          }).buffer;

          if (st.state === 'windup') {
            styled = applyPostOutlineEffect(styled, 'windup_aura', f, st.frames, spec.accentHex);
          } else if (st.state === 'attack' && f >= 1 && f <= 3) {
            styled = applyPostOutlineEffect(styled, 'attack_slash', f, st.frames, spec.accentHex);
          } else if (st.state === 'hit') {
            styled = applyPostOutlineEffect(styled, 'hit_flash', f, st.frames, spec.accentHex);
          } else if (st.state === 'death' && f >= 2) {
            styled = applyPostOutlineEffect(styled, 'death_dissolve', f, st.frames, spec.accentHex);
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
          events,
        });
        row++;
      }
    }

    const manifest: ExpandedAssetManifest = {
      assetId: spec.id,
      name: spec.name,
      category: 'enemy',
      subtitle: spec.subtitle,
      sheetUrl: `/assets/sprites/${spec.id}.png`,
      manifestUrl: `/assets/sprites/${spec.id}.json`,
      frameWidth: 64,
      frameHeight: 64,
      columns: maxCols,
      rows: totalRows,
      animations,
      tags: ['enemy', 'batch-3', 'hi-bit-2x', '64x64', spec.biomeTag],
      integratedInDemo: true,
    };
    writeExpandedAsset(manifest, sheet);
    manifests.push(manifest);
  }

  return manifests;
}

// ============================================================================
// 2. TWO NEW TWO-PHASE TYRANT BOSSES (128x128, 8 V3.1 states x 4 dirs = 32 rows)
// ============================================================================

type NewBossKind = 'cinder_archon' | 'astral_sovereign';

function drawNewBossFrameHalf(
  kind: NewBossKind,
  state: string,
  dir: Direction,
  f: number,
  total: number
): RasterBuffer {
  const buf = createRaster(64, 64);
  const t = total > 1 ? f / (total - 1) : 0;
  const phase = (f / Math.max(1, total)) * Math.PI * 2;
  const facing = dir === 'left' ? -1 : 1;
  const back = dir === 'up';

  const walkSwing = state === 'walk' ? Math.sin(phase) : 0;
  const hoverBob = Math.round(Math.sin(phase) * (state === 'idle' ? 1.5 : 2.2));
  const windupPull = state === 'windup' ? Math.sin(t * Math.PI * 0.85) : 0;
  const atkLunge = state === 'attack' || state === 'signature' ? Math.sin(t * Math.PI) : 0;
  const phaseLift = state === 'phase_transition' ? -Math.round(Math.sin(t * Math.PI) * 5) : 0;
  const deathSink = state === 'death' ? Math.round(t * t * 9) : 0;

  const cx = 32 + Math.round((atkLunge * 4 - windupPull * 2.5) * facing);
  const footY = 53 + deathSink;

  if (kind === 'cinder_archon') {
    // Crowned Obsidian-Armor Spellblade with floating molten pauldrons & colossal flame greatsword
    const armorDark = hexToRgba('#22162A');
    const armorMid = hexToRgba('#452940');
    const armorRim = hexToRgba('#7D4B59');
    const gold = hexToRgba('#D9BA72');
    const magma = hexToRgba('#FF5E2B');
    const core = hexToRgba('#FFE8A3');
    const capeDark = hexToRgba('#381426');
    const capeMid = hexToRgba('#6E1F34');

    const torsoY = footY - 22 + hoverBob + phaseLift;

    // Articulated Tattered Volcanic Mantle / Cape
    const capeSway = Math.round(Math.sin(phase + 0.6) * 3);
    drawPolygonPx(
      buf,
      [
        [cx - 12, torsoY - 6],
        [cx + 12, torsoY - 6],
        [cx + 16 - capeSway, footY - 2],
        [cx - 16 - capeSway, footY - 2],
      ],
      capeDark
    );
    drawPolygonPx(
      buf,
      [
        [cx - 9, torsoY - 4],
        [cx + 9, torsoY - 4],
        [cx + 12 - capeSway, footY - 4],
        [cx - 12 - capeSway, footY - 4],
      ],
      capeMid
    );

    // Armored Greaves with alternating stride
    const stride = Math.round(walkSwing * 3.5);
    drawRectPx(buf, cx - 8, footY - 12 - Math.max(0, stride), 5, 11, armorDark);
    drawRectPx(buf, cx - 7, footY - 11 - Math.max(0, stride), 3, 8, armorMid);
    drawRectPx(buf, cx + 3, footY - 12 - Math.max(0, -stride), 5, 11, armorDark);
    drawRectPx(buf, cx + 4, footY - 11 - Math.max(0, -stride), 3, 8, armorMid);

    // Sculpted Breastplate + Furnace Core
    drawPolygonPx(
      buf,
      [
        [cx - 11, torsoY - 8],
        [cx + 11, torsoY - 8],
        [cx + 8, torsoY + 9],
        [cx - 8, torsoY + 9],
      ],
      armorMid
    );
    drawPolygonPx(
      buf,
      [
        [cx - 9, torsoY - 7],
        [cx + 5, torsoY - 7],
        [cx + 3, torsoY + 3],
        [cx - 8, torsoY + 3],
      ],
      armorRim
    );
    // Gold Trim & Burning Core
    drawLinePx(buf, cx - 8, torsoY + 6, cx + 8, torsoY + 6, gold, 2);
    drawEllipse(buf, cx, torsoY - 1, 3.8, 4.2, magma);
    drawEllipse(buf, cx, torsoY - 1, 1.8, 2.2, core);

    // Floating Molten Pauldrons (lift during phase_transition / windup)
    const pLift = Math.round(Math.sin(phase + 1.1) * 1.5 - windupPull * 3 - (state === 'phase_transition' ? 3 : 0));
    drawPolygonPx(
      buf,
      [
        [cx - 18, torsoY - 10 + pLift],
        [cx - 9, torsoY - 12 + pLift],
        [cx - 10, torsoY - 3 + pLift],
        [cx - 16, torsoY - 4 + pLift],
      ],
      armorMid
    );
    drawLinePx(buf, cx - 17, torsoY - 10 + pLift, cx - 10, torsoY - 12 + pLift, gold, 1);
    drawEllipse(buf, cx - 13, torsoY - 7 + pLift, 2, 2, magma);

    drawPolygonPx(
      buf,
      [
        [cx + 18, torsoY - 10 + pLift],
        [cx + 9, torsoY - 12 + pLift],
        [cx + 10, torsoY - 3 + pLift],
        [cx + 16, torsoY - 4 + pLift],
      ],
      armorMid
    );
    drawLinePx(buf, cx + 17, torsoY - 10 + pLift, cx + 10, torsoY - 12 + pLift, gold, 1);
    drawEllipse(buf, cx + 13, torsoY - 7 + pLift, 2, 2, magma);

    // Crowned Obsidian Helm
    const headY = torsoY - 14;
    drawEllipse(buf, cx, headY, 6, 6.2, armorDark);
    drawEllipse(buf, cx - 1, headY - 1, 4.2, 4.4, armorMid);
    // 3-Spike Ember Crown
    drawLinePx(buf, cx - 5, headY - 4, cx - 7, headY - 11, gold, 2);
    drawLinePx(buf, cx, headY - 5, cx, headY - 13, gold, 2);
    drawLinePx(buf, cx + 5, headY - 4, cx + 7, headY - 11, gold, 2);
    setPixelBlend(buf, cx, headY - 13, core);
    if (!back) {
      drawRectPx(buf, cx - 4, headY - 1, 8, 2, OUTLINE_INK_RGBA);
      setPixelBlend(buf, cx - 2, headY - 1, core);
      setPixelBlend(buf, cx + 2, headY - 1, core);
    }

    // Colossal Flaming Greatsword (sweeps wildly on attack / signature)
    const swingAngle =
      state === 'attack'
        ? -1.4 + t * 3.0
        : state === 'signature'
          ? -2.0 + t * 4.2
          : state === 'windup'
            ? -1.8 - windupPull * 0.5
            : -0.5 + walkSwing * 0.25;
    const hiltX = cx + 11 * facing;
    const hiltY = torsoY + 1;
    const tipX = hiltX + Math.cos(swingAngle) * 18 * facing;
    const tipY = hiltY + Math.sin(swingAngle) * 16;
    drawLinePx(buf, hiltX, hiltY, tipX, tipY, magma, 4);
    drawLinePx(buf, hiltX, hiltY, tipX, tipY, core, 2);
    drawLinePx(buf, hiltX - 3, hiltY - 2, hiltX + 3, hiltY + 2, gold, 2);
  } else {
    // Astral Sovereign — Levitating Celestial Monarch with 4 Orbiting Star-Prisms & Chronal Halo
    const robeDark = hexToRgba('#1A1638');
    const robeMid = hexToRgba('#342C70');
    const robeLight = hexToRgba('#5B53A8');
    const gold = hexToRgba('#F7E3A6');
    const starBlue = hexToRgba('#7C9BFF');
    const riftViolet = hexToRgba('#C06CFF');
    const white = hexToRgba('#FFFFFF');

    const torsoY = footY - 25 + hoverBob + phaseLift;

    // Celestial Astrolabe Halo Ring behind Sovereign
    const haloR = 15 + (state === 'phase_transition' || state === 'signature' ? 3 : 0);
    drawRing(buf, cx, torsoY - 4, haloR, haloR - 1.8, { ...gold, a: 215 });
    for (let i = 0; i < 6; i++) {
      const ang = phase * 0.8 + (i * Math.PI) / 3;
      const hx = cx + Math.round(Math.cos(ang) * haloR);
      const hy = torsoY - 4 + Math.round(Math.sin(ang) * haloR);
      setPixelBlend(buf, hx, hy, white);
    }

    // Floating Star-Drape Vestments (articulated wave tail)
    const hemWave = Math.sin(phase) * 3.5;
    drawPolygonPx(
      buf,
      [
        [cx - 10, torsoY - 6],
        [cx + 10, torsoY - 6],
        [cx + 14 + hemWave, footY - 4],
        [cx + 4, footY - 1],
        [cx - 4, footY - 2],
        [cx - 14 + hemWave, footY - 4],
      ],
      robeDark
    );
    drawPolygonPx(
      buf,
      [
        [cx - 8, torsoY - 5],
        [cx + 8, torsoY - 5],
        [cx + 9 + hemWave * 0.6, footY - 6],
        [cx - 9 + hemWave * 0.6, footY - 6],
      ],
      robeMid
    );
    // Starlight Stole & Gold Embroidery
    drawLinePx(buf, cx - 3, torsoY - 5, cx - 4 + hemWave * 0.5, footY - 6, gold, 1);
    drawLinePx(buf, cx + 3, torsoY - 5, cx + 4 + hemWave * 0.5, footY - 6, gold, 1);
    // Constellation speckles on lower robe
    for (let k = 0; k < 5; k++) {
      const sx = cx - 6 + ((k * 5 + f) % 13);
      const sy = torsoY + 3 + (k * 3);
      setPixelBlend(buf, sx, sy, k % 2 === 0 ? starBlue : gold);
    }

    // Upper Torso & Articulated Casting Arms
    drawEllipse(buf, cx, torsoY - 3, 8.5, 6.5, robeLight);
    drawEllipse(buf, cx, torsoY - 2, 3.2, 3.2, riftViolet);
    setPixelBlend(buf, cx, torsoY - 2, white);

    const armRaise = state === 'windup' || state === 'phase_transition' ? -6 : state === 'attack' || state === 'signature' ? -2 : 0;
    const armOut = 12 + Math.round(atkLunge * 5 + Math.sin(phase) * 1.5);
    drawLinePx(buf, cx - 6, torsoY - 4, cx - armOut, torsoY - 2 + armRaise, robeLight, 3);
    drawLinePx(buf, cx + 6, torsoY - 4, cx + armOut, torsoY - 2 + armRaise, robeLight, 3);
    drawEllipse(buf, cx - armOut, torsoY - 2 + armRaise, 2.2, 2.2, starBlue);
    drawEllipse(buf, cx + armOut, torsoY - 2 + armRaise, 2.2, 2.2, starBlue);

    // Sovereign Crowned Visage
    const headY = torsoY - 13;
    drawEllipse(buf, cx, headY, 5.5, 6, robeDark);
    drawPolygonPx(
      buf,
      [
        [cx - 6, headY - 4],
        [cx - 8, headY - 12],
        [cx - 2, headY - 8],
        [cx, headY - 15],
        [cx + 2, headY - 8],
        [cx + 8, headY - 12],
        [cx + 6, headY - 4],
      ],
      gold
    );
    if (!back) {
      setPixelBlend(buf, cx - 2, headY - 1, white);
      setPixelBlend(buf, cx + 2, headY - 1, white);
      setPixelBlend(buf, cx, headY - 4, starBlue);
    }

    // 4 Orbiting Celestial Prisms
    for (let i = 0; i < 4; i++) {
      const ang = phase + (i * Math.PI) / 2 + (state === 'signature' ? t * 3 : 0);
      const px = cx + Math.round(Math.cos(ang) * (18 + atkLunge * 4));
      const py = torsoY - 2 + Math.round(Math.sin(ang) * 9);
      drawPolygonPx(
        buf,
        [
          [px, py - 4],
          [px + 2.5, py],
          [px, py + 4],
          [px - 2.5, py],
        ],
        i % 2 === 0 ? starBlue : riftViolet
      );
      setPixelBlend(buf, px, py, white);
    }
  }

  return buf;
}

export function buildNewBosses(): ExpandedAssetManifest[] {
  const specs: {
    id: string;
    kind: NewBossKind;
    name: string;
    subtitle: string;
    accentHex: string;
    biomeTag: string;
    events: { attack: string; phase: string; sig: string; death: string };
  }[] = [
    {
      id: 'boss_cinder_archon',
      kind: 'cinder_archon',
      name: 'Cinder Archon',
      subtitle: 'Ashen Citadel Tyrant — Volcanic Spellblade of the Molten Forge',
      accentHex: '#FF6B3D',
      biomeTag: 'ashen-citadel',
      events: {
        attack: 'magma_cleave',
        phase: 'volcanic_ignition',
        sig: 'meteor_cataclysm',
        death: 'forge_collapse',
      },
    },
    {
      id: 'boss_astral_sovereign',
      kind: 'astral_sovereign',
      name: 'Astral Sovereign',
      subtitle: 'Astral Abyss Tyrant — Celestial Architect of the Shattered Rift',
      accentHex: '#7C9BFF',
      biomeTag: 'astral-abyss',
      events: {
        attack: 'starlight_barrage',
        phase: 'astral_eclipse',
        sig: 'chronal_beam_convergence',
        death: 'constellation_shatter',
      },
    },
  ];

  const manifests: ExpandedAssetManifest[] = [];
  const bossTiming = STYLE_CONTRACT.timing.boss;
  const maxCols = Math.max(...bossTiming.map((t) => t.frames));
  const totalRows = bossTiming.length * DIRS.length;

  for (const spec of specs) {
    const sheet = createRaster(maxCols * 128, totalRows * 128);
    const animations: AnimationEntry[] = [];
    let row = 0;

    for (const st of bossTiming) {
      const events: AnimEvent[] =
        st.state === 'walk'
          ? [{ frame: 2, name: 'hover_pulse' }]
          : st.state === 'windup'
            ? [{ frame: 0, name: 'telegraph_rune' }]
            : st.state === 'attack'
              ? [{ frame: 2, name: spec.events.attack }]
              : st.state === 'phase_transition'
                ? [
                    { frame: 2, name: spec.events.phase },
                    { frame: 5, name: 'phase2_active' },
                  ]
                : st.state === 'signature'
                  ? [{ frame: 3, name: spec.events.sig }]
                  : st.state === 'death'
                    ? [{ frame: 4, name: spec.events.death }]
                    : [];

      for (const dir of DIRS) {
        let prevHash: string | null = null;
        for (let f = 0; f < st.frames; f++) {
          let half = drawNewBossFrameHalf(spec.kind, st.state, dir, f, st.frames);
          half = applyDirectionalShading(half, dir);
          half = applyHiBitDepthPass(half, {
            rimStrength: 0.28,
            aoStrength: 0.24,
            rimTint: hexToRgba('#F7E3A6'),
          });

          let styled = quantizeRiftNightLab(half, {
            mode: 'hybrid_lab',
            cohesionStrength: 0.36,
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
          events,
        });
        row++;
      }
    }

    const manifest: ExpandedAssetManifest = {
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
      tags: ['tyrant', 'batch-3', 'hi-bit-2x', '128x128', 'phase-transition', spec.biomeTag],
      integratedInDemo: true,
    };
    writeExpandedAsset(manifest, sheet);
    manifests.push(manifest);
  }

  return manifests;
}

/** Generate crisp 32x32 half-res bust portraits for Cinder Archon (tile 10) & Astral Sovereign (tile 11) */
export function buildNewBossPortraitsHalf(): [RasterBuffer, RasterBuffer] {
  const cinderFull = drawNewBossFrameHalf('cinder_archon', 'idle', 'down', 0, 4);
  const astralFull = drawNewBossFrameHalf('astral_sovereign', 'idle', 'down', 0, 4);

  const cropBust = (src: RasterBuffer): RasterBuffer => {
    const bust = createRaster(32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const sx = 16 + x;
        const sy = 6 + y;
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const off = (sy * src.width + sx) * 4;
        if (src.data[off + 3] > 0) {
          setPixelRaw(bust, x, y, {
            r: src.data[off],
            g: src.data[off + 1],
            b: src.data[off + 2],
            a: src.data[off + 3],
          });
        }
      }
    }
    return applyHiBitDepthPass(bust, { rimStrength: 0.28, aoStrength: 0.22 });
  };

  return [cropBust(cinderFull), cropBust(astralFull)];
}

// ============================================================================
// 3. TWO NEW BIOME TILESETS (32x32, 4x3 = 12 tiles each)
// ============================================================================

export function buildNewBiomeTilesets(): ExpandedAssetManifest[] {
  const makeTileset = (
    assetId: string,
    name: string,
    subtitle: string,
    palette: {
      base: string;
      mid: string;
      light: string;
      crack: string;
      accent: string;
      glow: string;
    },
    tag: string
  ): ExpandedAssetManifest => {
    const cols = 4;
    const rows = 3;
    const sheet = createRaster(cols * 32, rows * 32);
    const base = hexToRgba(palette.base);
    const mid = hexToRgba(palette.mid);
    const light = hexToRgba(palette.light);
    const crack = hexToRgba(palette.crack);
    const accent = hexToRgba(palette.accent);
    const glow = hexToRgba(palette.glow);

    for (let idx = 0; idx < 12; idx++) {
      const tile = createRaster(16, 16);
      const isDecor = idx >= 8;

      if (!isDecor) {
        // Solid stone / floor / wall flagstones with hi-bit bevel & mortar depth
        drawRectPx(tile, 0, 0, 16, 16, base);
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const hash = (x * 31 + y * 57 + idx * 19) % 17;
            if (hash < 4) setPixelBlend(tile, x, y, mid);
            if (hash === 0 && y < 12) setPixelBlend(tile, x, y, light);
          }
        }
        // Mortar seams
        const seamY = idx % 2 === 0 ? 7 : 9;
        drawLinePx(tile, 0, seamY, 15, seamY, OUTLINE_INK_RGBA, 1);
        drawLinePx(tile, 0, seamY + 1, 15, seamY + 1, light, 1);
        const seamX = (idx * 5 + 4) % 12 + 2;
        drawLinePx(tile, seamX, 0, seamX, seamY, OUTLINE_INK_RGBA, 1);
        drawLinePx(tile, (seamX + 7) % 14 + 1, seamY, (seamX + 7) % 14 + 1, 15, OUTLINE_INK_RGBA, 1);

        // Tile 3, 5, 6, 7: Cracks, rune inlays, magma / astral veins
        if (idx === 2 || idx === 5) {
          drawLinePx(tile, 2, 3, 12, 12, crack, 1);
          drawLinePx(tile, 4, 5, 10, 10, accent, 1);
          setPixelBlend(tile, 7, 8, glow);
        } else if (idx === 3 || idx === 6) {
          // Carved wall block / parapet
          drawRectPx(tile, 1, 1, 14, 10, mid);
          drawLinePx(tile, 1, 1, 14, 1, light, 1);
          drawLinePx(tile, 1, 11, 14, 11, OUTLINE_INK_RGBA, 1);
          drawRectPx(tile, 6, 4, 4, 4, accent);
          setPixelBlend(tile, 7, 5, glow);
        } else if (idx === 4 || idx === 7) {
          // Glowing glyph inlay tile
          drawRing(tile, 8, 8, 5, 3.5, accent);
          setPixelBlend(tile, 8, 8, glow);
        }
      } else {
        // Transparent props: pillars, braziers, crystals, rift totems (indices 8..11)
        if (idx === 8) {
          // Broken gothic pillar
          drawEllipse(tile, 8, 13, 6, 2.2, GROUND_SHADOW_RGBA);
          drawRectPx(tile, 4, 3, 8, 10, mid);
          drawRectPx(tile, 4, 3, 3, 10, light);
          drawRectPx(tile, 3, 2, 10, 3, light);
          drawLinePx(tile, 6, 6, 10, 9, accent, 1);
          injectOutlineInk(tile, OUTLINE_INK_RGBA, 150);
        } else if (idx === 9) {
          // Glowing biome brazier / astral spire
          drawEllipse(tile, 8, 13, 5, 2, GROUND_SHADOW_RGBA);
          drawRectPx(tile, 5, 7, 6, 6, mid);
          drawRectPx(tile, 4, 6, 8, 2, light);
          drawEllipse(tile, 8, 5, 3.2, 3.2, accent);
          drawEllipse(tile, 8, 4, 1.5, 1.8, glow);
          injectOutlineInk(tile, OUTLINE_INK_RGBA, 150);
        } else if (idx === 10) {
          // Crystal / magma cluster
          drawEllipse(tile, 8, 13, 5, 2, GROUND_SHADOW_RGBA);
          drawPolygonPx(tile, [[8, 2], [11, 11], [5, 11]], accent);
          drawPolygonPx(tile, [[5, 6], [7, 12], [3, 12]], mid);
          drawPolygonPx(tile, [[11, 5], [13, 12], [9, 12]], light);
          setPixelBlend(tile, 8, 4, glow);
          injectOutlineInk(tile, OUTLINE_INK_RGBA, 150);
        } else {
          // Ground sigil / runic altar stone
          drawRing(tile, 8, 8, 6.2, 4.4, accent);
          drawRing(tile, 8, 8, 3.5, 2.2, glow);
          setPixelBlend(tile, 8, 8, hexToRgba('#FFFFFF'));
          injectOutlineInk(tile, OUTLINE_INK_RGBA, 150);
        }
      }

      const stylized = quantizeRiftNightLab(tile, {
        mode: 'hybrid_lab',
        cohesionStrength: 0.3,
        addOutline: false,
        ensureCornerTransparent: isDecor,
      }).buffer;

      blitRaster(
        sheet,
        upscaleRaster(stylized, 2),
        (idx % cols) * 32,
        Math.floor(idx / cols) * 32
      );
    }

    const manifest: ExpandedAssetManifest = {
      assetId,
      name,
      category: 'environment',
      subtitle,
      sheetUrl: `/assets/sprites/${assetId}.png`,
      manifestUrl: `/assets/sprites/${assetId}.json`,
      frameWidth: 32,
      frameHeight: 32,
      columns: cols,
      rows,
      animations: [
        { state: 'floor_tiles', direction: 'down', row: 0, frameCount: 4, fps: 4, loop: true, pivot: { x: 16, y: 16 }, hitbox: { x: 0, y: 0, w: 32, h: 32 }, hurtbox: { x: 0, y: 0, w: 32, h: 32 }, events: [] },
        { state: 'walls_and_cracks', direction: 'down', row: 1, frameCount: 4, fps: 4, loop: true, pivot: { x: 16, y: 16 }, hitbox: { x: 0, y: 0, w: 32, h: 32 }, hurtbox: { x: 0, y: 0, w: 32, h: 32 }, events: [] },
        { state: 'props_and_pillars', direction: 'down', row: 2, frameCount: 4, fps: 4, loop: true, pivot: { x: 16, y: 24 }, hitbox: { x: 4, y: 4, w: 24, h: 24 }, hurtbox: { x: 4, y: 4, w: 24, h: 24 }, events: [] },
      ],
      tags: ['tileset', 'batch-3', '32x32', tag],
      integratedInDemo: true,
    };
    writeExpandedAsset(manifest, sheet);
    return manifest;
  };

  return [
    makeTileset(
      'tileset_ashen_citadel',
      'Ashen Citadel Tileset',
      'Scorched basalt flagstones, molten forge veins, obsidian braziers & rune walls',
      {
        base: '#201521',
        mid: '#3A2332',
        light: '#6D4353',
        crack: '#7D1E34',
        accent: '#FF6B3D',
        glow: '#FFE49E',
      },
      'ashen-citadel'
    ),
    makeTileset(
      'tileset_astral_abyss',
      'Astral Abyss Tileset',
      'Star-flecked indigo marble, gilded astrolabe inlays, floating prisms & void pillars',
      {
        base: '#15142B',
        mid: '#2A2857',
        light: '#5A589E',
        crack: '#462A80',
        accent: '#7C9BFF',
        glow: '#F7E3A6',
      },
      'astral-abyss'
    ),
  ];
}

// ============================================================================
// 4. PVFX FOUNDRY (LIT + STRICT) & PIXEL BURST 5-STAGE ELEMENTAL VFX OVERHAUL
// ============================================================================

type VfxStage = 'cast_charge' | 'projectile' | 'impact' | 'aoe_burst' | 'ground_linger';
type VfxStyleTier = 'lit' | 'strict';

interface ElementalRamp {
  dark: RGBA;
  mid: RGBA;
  bright: RGBA;
  core: RGBA;
  accent: RGBA;
}

function makeRamp(dark: string, mid: string, bright: string, core: string, accent?: string): ElementalRamp {
  return {
    dark: hexToRgba(dark),
    mid: hexToRgba(mid),
    bright: hexToRgba(bright),
    core: hexToRgba(core),
    accent: hexToRgba(accent ?? bright),
  };
}

/** Post-process half-res VFX frame into PVFX Foundry Lit (soft additive bloom) or Strict (banded binary alpha + outline) */
function finalizeVfxTier(buf: RasterBuffer, tier: VfxStyleTier): RasterBuffer {
  const out = createRaster(buf.width, buf.height);
  out.data.set(buf.data);

  if (tier === 'strict') {
    // PVFX Foundry Strict Tier: binary alpha quantization + crisp #140E1D outer silhouette
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3];
      if (a < 88) {
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 0;
      } else {
        out.data[i + 3] = 255;
      }
    }
    injectOutlineInk(out, OUTLINE_INK_RGBA, 200);
  } else {
    // PVFX Foundry Lit Tier: crisp hot core with clean luminous fringe (zero dirty halo noise)
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] > 0 && out.data[i + 3] < 24) {
        out.data[i + 3] = 0;
      }
    }
  }

  // Ensure corner pixel stays transparent for V3.1 transparentBackground invariant
  setPixelRaw(out, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
  return out;
}

/**
 * Renders a 32x32 half-res (upscaled to 64x64 2x) frame for any of the 5 Pixel Burst
 * Elemental Spell stages (cast_charge, projectile, impact, aoe_burst, ground_linger)
 * tailored to each elemental silhouette and Lit/Strict tier.
 */
function renderFiveStageVfxHalf(
  stage: VfxStage,
  ramp: ElementalRamp,
  variant: 'flame' | 'crystal' | 'bolt' | 'vortex' | 'slash' | 'beam' | 'spore' | 'ring',
  f: number,
  total: number,
  tier: VfxStyleTier
): RasterBuffer {
  const buf = createRaster(32, 32);
  const cx = 16;
  const cy = 16;
  const t = total > 1 ? f / (total - 1) : 0;
  const phase = (f / Math.max(1, total)) * Math.PI * 2;
  const lit = tier === 'lit';

  if (stage === 'cast_charge') {
    // Stage 1: Gathering arcane rune circle + inward spiraling elemental sparks
    const rOuter = 6 + Math.sin(phase) * 1.5;
    if (lit) drawGlow(buf, cx, cy, rOuter + 4.5, ramp.mid, 120);
    drawRing(buf, cx, cy, rOuter + 1.5, rOuter - 0.5, ramp.dark);
    drawRing(buf, cx, cy, rOuter, rOuter - 1.4, ramp.bright);

    // 6 inward-pulling sparks
    for (let i = 0; i < 6; i++) {
      const ang = phase + (i * Math.PI) / 3;
      const dist = 12 - ((t + i * 0.17) % 1) * 9;
      const sx = cx + Math.cos(ang) * dist;
      const sy = cy + Math.sin(ang) * dist;
      drawLinePx(buf, sx, sy, cx + Math.cos(ang) * Math.max(1, dist - 2.5), cy + Math.sin(ang) * Math.max(1, dist - 2.5), ramp.bright, 1);
      setPixelBlend(buf, Math.round(sx), Math.round(sy), ramp.core);
    }

    drawEllipse(buf, cx, cy, 2.5 + Math.sin(phase) * 0.8, 2.5 + Math.sin(phase) * 0.8, ramp.mid);
    drawEllipse(buf, cx, cy, 1.4, 1.4, ramp.core);
  } else if (stage === 'projectile') {
    // Stage 2: High-velocity directional spell projectile with animated tail slipstream
    const wobble = Math.sin(phase) * 1.4;
    if (lit) drawGlow(buf, cx + 2, cy, 10, ramp.mid, 130);

    if (variant === 'crystal' || variant === 'beam') {
      // Piercing lance / spearhead silhouette
      drawPolygonPx(
        buf,
        [
          [cx + 12, cy],
          [cx + 2, cy - 4.5],
          [cx - 11, cy - 1.5 + wobble * 0.4],
          [cx - 8, cy],
          [cx - 11, cy + 1.5 - wobble * 0.4],
          [cx + 2, cy + 4.5],
        ],
        ramp.dark
      );
      drawPolygonPx(
        buf,
        [
          [cx + 11, cy],
          [cx + 2, cy - 3],
          [cx - 7, cy],
          [cx + 2, cy + 3],
        ],
        ramp.bright
      );
      drawLinePx(buf, cx - 5, cy, cx + 10, cy, ramp.core, 2);
    } else if (variant === 'bolt') {
      // Forking lightning spear + crackling arc forks
      let prevX = cx - 11;
      let prevY = cy;
      for (let s = 1; s <= 5; s++) {
        const nx = cx - 11 + s * 4.4;
        const ny = cy + Math.sin(phase + s * 2.1) * (s === 5 ? 0 : 4.2);
        drawLinePx(buf, prevX, prevY, nx, ny, ramp.mid, 3);
        drawLinePx(buf, prevX, prevY, nx, ny, ramp.core, 1);
        prevX = nx;
        prevY = ny;
      }
      drawEllipse(buf, cx + 9, cy, 3, 3, ramp.bright);
      setPixelBlend(buf, cx + 9, cy, ramp.core);
    } else if (variant === 'slash') {
      // Spinning umbral / wind crescent
      const rot = phase;
      for (let a = -1.2; a <= 1.2; a += 0.16) {
        const ang = rot + a;
        const r = 8.5 - Math.abs(a) * 1.2;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        drawEllipse(buf, px, py, 2.1, 2.1, ramp.mid);
        setPixelBlend(buf, Math.round(px), Math.round(py), ramp.core);
      }
    } else {
      // Comet orb + turbulent Pixel Burst plasma tail
      for (let k = 0; k < 5; k++) {
        const tx = cx - 2 - k * 2.4;
        const ty = cy + Math.sin(phase + k * 1.3) * (1.2 + k * 0.35);
        const tr = Math.max(1.2, 4.4 - k * 0.65);
        drawEllipse(buf, tx, ty, tr, tr * 0.85, k < 2 ? ramp.mid : ramp.dark);
        if (k < 3) drawEllipse(buf, tx + 1, ty, tr * 0.55, tr * 0.5, ramp.bright);
      }
      drawEllipse(buf, cx + 4, cy, 5.2, 4.4, ramp.mid);
      drawEllipse(buf, cx + 5, cy, 3.6, 3.0, ramp.bright);
      drawEllipse(buf, cx + 6, cy, 2.0, 1.8, ramp.core);
      // Trailing pixel embers
      setPixelBlend(buf, cx - 10 + (f % 3), cy - 4 + Math.round(wobble), ramp.accent);
      setPixelBlend(buf, cx - 8 - (f % 2), cy + 4 - Math.round(wobble), ramp.bright);
    }
  } else if (stage === 'impact') {
    // Stage 3: Crisp radial burst flash + star spikes + flying pixel debris
    const expand = 3 + t * 10;
    const fade = Math.max(0.25, 1 - t * 0.7);
    if (lit) drawGlow(buf, cx, cy, expand + 4, ramp.bright, Math.round(160 * fade));

    if (t < 0.72) {
      drawRing(buf, cx, cy, expand, Math.max(0.5, expand - 2.6 * fade), ramp.mid);
      drawRing(buf, cx, cy, Math.max(1, expand - 1), Math.max(0, expand - 2.4), ramp.bright);
    }

    // 8 radiating Pixel Burst impact spikes
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4 + (variant === 'crystal' ? 0.2 : 0.4);
      const inner = 2 + t * 5;
      const outer = (i % 2 === 0 ? 12.5 : 8.5) * (0.45 + t * 0.65);
      drawLinePx(
        buf,
        cx + Math.cos(ang) * inner,
        cy + Math.sin(ang) * inner,
        cx + Math.cos(ang) * outer,
        cy + Math.sin(ang) * outer,
        i % 2 === 0 ? ramp.bright : ramp.mid,
        t < 0.4 ? 2 : 1
      );
      if (t >= 0.35) {
        setPixelBlend(
          buf,
          Math.round(cx + Math.cos(ang) * (outer + 1.5)),
          Math.round(cy + Math.sin(ang) * (outer + 1.5)),
          ramp.core
        );
      }
    }

    if (t < 0.55) {
      drawEllipse(buf, cx, cy, 4.5 * (1 - t), 4.5 * (1 - t), ramp.core);
    }
  } else if (stage === 'aoe_burst') {
    // Stage 4: Full-cell expanding AoE explosion / detonation shockwave
    const r = 4 + t * 10.5;
    const thickness = Math.max(1.4, 4.5 * (1 - t * 0.65));
    if (lit) drawGlow(buf, cx, cy, Math.min(15, r + 3), ramp.mid, Math.round(155 * (1 - t * 0.55)));

    // Outer dark-banded flame/shockwave crown + bright inner crest
    drawRing(buf, cx, cy, Math.min(14.5, r + 1.2), Math.max(0, r - thickness), ramp.dark);
    drawRing(buf, cx, cy, Math.min(14, r), Math.max(0, r - thickness * 0.72), ramp.mid);
    drawRing(buf, cx, cy, Math.min(13, r - 0.8), Math.max(0, r - thickness * 0.4), ramp.bright);

    // Sculpted billowing clouds / shards around perimeter
    const lobes = variant === 'vortex' ? 6 : 8;
    for (let i = 0; i < lobes; i++) {
      const ang = (i * Math.PI * 2) / lobes + (variant === 'vortex' ? t * 2.4 : 0.3);
      const lr = r * 0.82;
      const lx = cx + Math.cos(ang) * lr;
      const ly = cy + Math.sin(ang) * lr;
      const rad = Math.max(1.3, 3.8 * (1 - t * 0.55));
      drawEllipse(buf, lx, ly, rad, rad, i % 2 === 0 ? ramp.bright : ramp.accent);
      if (t < 0.65) setPixelBlend(buf, Math.round(lx), Math.round(ly), ramp.core);
    }

    if (t < 0.45) {
      drawEllipse(buf, cx, cy, 6 * (1 - t * 1.4), 6 * (1 - t * 1.4), ramp.core);
    }
  } else {
    // Stage 5: Looping lingering ground hazard (perspective-squashed 3/4 arcane/elemental field)
    const rx = 11.5 + Math.sin(phase) * 0.9;
    const ry = 6.2 + Math.sin(phase) * 0.5;
    if (lit) drawGlow(buf, cx, cy + 2, 11, ramp.dark, 110);

    // Squashed floor ring
    for (let a = 0; a < Math.PI * 2; a += 0.14) {
      const px = cx + Math.cos(a) * rx;
      const py = cy + 3 + Math.sin(a) * ry;
      drawEllipse(buf, px, py, 1.5, 1.1, ramp.dark);
      setPixelBlend(buf, Math.round(px), Math.round(py), ramp.mid);
    }
    drawEllipse(buf, cx, cy + 3, rx * 0.75, ry * 0.65, { ...ramp.mid, a: lit ? 115 : 190 });
    drawEllipse(buf, cx, cy + 3, rx * 0.42, ry * 0.36, { ...ramp.bright, a: lit ? 150 : 220 });

    // Rising flickering wisps / shards / sparks
    for (let k = 0; k < 5; k++) {
      const rise = ((t + k * 0.21) % 1);
      const wx = cx - 7 + k * 3.5 + Math.sin(phase + k) * 1.2;
      const wy = cy + 4 - rise * 11;
      drawLinePx(buf, wx, wy, wx, wy + 2.5, k % 2 === 0 ? ramp.bright : ramp.accent, 1);
      setPixelBlend(buf, Math.round(wx), Math.round(wy), ramp.core);
    }
  }

  return finalizeVfxTier(buf, tier);
}

export function buildAllVfxUpgraded(): ExpandedAssetManifest[] {
  const manifests: ExpandedAssetManifest[] = [];

  const writeVfxPack = (
    assetId: string,
    name: string,
    subtitle: string,
    tags: string[],
    rowsSpec: {
      state: string;
      fps: number;
      loop: boolean;
      eventPeak?: boolean;
      frames: RasterBuffer[];
    }[]
  ) => {
    const maxCols = Math.max(...rowsSpec.map((r) => r.frames.length));
    const sheet = createRaster(maxCols * 64, rowsSpec.length * 64);
    const animations: AnimationEntry[] = [];

    rowsSpec.forEach((rowDef, row) => {
      let prevHash: string | null = null;
      rowDef.frames.forEach((half, f) => {
        const deduped = ensureDistinctFrame(half, prevHash, f);
        prevHash = deduped.hash;
        blitRaster(sheet, upscaleRaster(deduped.buffer, 2), f * 64, row * 64);
      });

      animations.push({
        state: rowDef.state,
        direction: 'down',
        row,
        frameCount: rowDef.frames.length,
        fps: rowDef.fps,
        loop: rowDef.loop,
        pivot: { x: 32, y: 32 },
        hitbox: { x: 10, y: 10, w: 44, h: 44 },
        hurtbox: { x: 10, y: 10, w: 44, h: 44 },
        events: rowDef.eventPeak
          ? [{ frame: Math.min(2, rowDef.frames.length - 1), name: `${rowDef.state}_peak` }]
          : [],
      });
    });

    const manifest: ExpandedAssetManifest = {
      assetId,
      name,
      category: 'vfx',
      subtitle,
      sheetUrl: `/assets/sprites/${assetId}.png`,
      manifestUrl: `/assets/sprites/${assetId}.json`,
      frameWidth: 64,
      frameHeight: 64,
      columns: maxCols,
      rows: rowsSpec.length,
      animations,
      tags,
      integratedInDemo: true,
    };
    writeExpandedAsset(manifest, sheet);
    manifests.push(manifest);
  };

  const buildElemental5StageSheet = (
    tier: VfxStyleTier,
    baseId: string,
    label: string,
    ramp: ElementalRamp,
    variant: 'flame' | 'crystal' | 'bolt',
    extraAlias?: { aliasState: string; sourceStage: VfxStage }
  ) => {
    const tierSuffix = tier === 'strict' ? '_strict' : '';
    const tierTag = tier === 'strict' ? 'pvfx-strict' : 'pvfx-lit';
    const tierLabel = tier === 'strict' ? 'Strict Banded Tier' : 'Lit Additive Tier';

    const stages: { state: VfxStage; frames: number; fps: number; loop: boolean; peak: boolean }[] = [
      { state: 'cast_charge', frames: 6, fps: 12, loop: true, peak: false },
      { state: 'projectile', frames: 6, fps: 14, loop: true, peak: false },
      { state: 'impact', frames: 6, fps: 16, loop: false, peak: true },
      { state: 'aoe_burst', frames: 6, fps: 14, loop: false, peak: true },
      { state: 'ground_linger', frames: 6, fps: 10, loop: true, peak: false },
    ];

    const rows: {
      state: string;
      fps: number;
      loop: boolean;
      eventPeak: boolean;
      frames: RasterBuffer[];
    }[] = stages.map((st) => ({
      state: st.state,
      fps: st.fps,
      loop: st.loop,
      eventPeak: st.peak,
      frames: Array.from({ length: st.frames }, (_, f) =>
        renderFiveStageVfxHalf(st.state, ramp, variant, f, st.frames, tier)
      ),
    }));

    if (extraAlias) {
      rows.push({
        state: extraAlias.aliasState,
        fps: 16,
        loop: false,
        eventPeak: true,
        frames: Array.from({ length: 6 }, (_, f) =>
          renderFiveStageVfxHalf(extraAlias.sourceStage, ramp, variant, f, 6, tier)
        ),
      });
    }

    writeVfxPack(
      `${baseId}${tierSuffix}`,
      `${label} (${tierLabel})`,
      `5-Stage Pixel Burst & PVFX Foundry (${tierLabel}): Cast, Projectile, Impact, AoE Burst & Ground Linger`,
      ['vfx', '5-stage', tierTag, '64x64', 'transparent'],
      rows
    );
  };

  const fireRamp = makeRamp('#7D1E34', '#E9562A', '#FFA238', '#FFF3C4', '#FF6B3D');
  const iceRamp = makeRamp('#1B4D6B', '#2F95A8', '#58D6C2', '#E8FFFF', '#9CEEFF');
  const boltRamp = makeRamp('#3A1E7A', '#7E5BF5', '#C4A8FF', '#FFFFFF', '#FFE875');

  // Lit & Strict 5-stage core schools (Fire, Ice, Lightning)
  for (const tier of ['lit', 'strict'] as const) {
    buildElemental5StageSheet(tier, 'vfx_fire', 'Fire Spell VFX — 5 Stages', fireRamp, 'flame');
    buildElemental5StageSheet(tier, 'vfx_ice', 'Ice Spell VFX — 5 Stages', iceRamp, 'crystal');
    buildElemental5StageSheet(tier, 'vfx_lightning', 'Lightning Spell VFX — 5 Stages', boltRamp, 'bolt');
  }

  // Thermal Shatter Resonance (Fire + Ice) in Lit & Strict tiers
  const shatterRamp = makeRamp('#5C1B44', '#E96550', '#6EE7FF', '#FFFFFF', '#FF944D');
  for (const tier of ['lit', 'strict'] as const) {
    const suffix = tier === 'strict' ? '_strict' : '';
    const tierTag = tier === 'strict' ? 'pvfx-strict' : 'pvfx-lit';
    const tierLabel = tier === 'strict' ? 'Strict Banded Tier' : 'Lit Additive Tier';
    writeVfxPack(
      `vfx_thermal_shatter${suffix}`,
      `Thermal Shatter Resonance VFX (${tierLabel})`,
      `PVFX Foundry & Pixel Burst (${tierLabel}) Fire + Ice dual shockwave detonation & vapor field`,
      ['vfx', '5-stage', tierTag, '64x64', 'transparent'],
      [
        { state: 'impact', fps: 16, loop: false, eventPeak: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('impact', shatterRamp, 'crystal', f, 6, tier)) },
        { state: 'aoe_burst', fps: 14, loop: false, eventPeak: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('aoe_burst', shatterRamp, 'flame', f, 6, tier)) },
        { state: 'ground_linger', fps: 10, loop: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('ground_linger', shatterRamp, 'ring', f, 6, tier)) },
      ]
    );
  }

  // Arcane Utility, Blink, Aether Surge & Boss Rift/Cinder/Astral VFX in Lit & Strict tiers
  const arcaneRamp = makeRamp('#2D1259', '#6A42C2', '#A991F7', '#F2E8FF', '#58D6C2');
  const goldRamp = makeRamp('#6B4C1E', '#B8893A', '#D9BA72', '#FFF5D1', '#F7E3A6');
  const voidBossRamp = makeRamp('#2E1059', '#9E2B6B', '#E96578', '#FFE4EB', '#C06CFF');
  const astralBossRamp = makeRamp('#1E215E', '#5265D6', '#7C9BFF', '#FFFFFF', '#F7E3A6');

  for (const tier of ['lit', 'strict'] as const) {
    const suffix = tier === 'strict' ? '_strict' : '';
    const tierTag = tier === 'strict' ? 'pvfx-strict' : 'pvfx-lit';
    const tierLabel = tier === 'strict' ? 'Strict Banded Tier' : 'Lit Additive Tier';
    writeVfxPack(
      `vfx_arcane_utility${suffix}`,
      `Blink, Surge & Tyrant Rift VFX (${tierLabel})`,
      `PVFX Foundry (${tierLabel}) Blink ring, Aether Surge nova, Boss Rift, Cultist Orb, Cinder Meteor & Astral Lance`,
      ['vfx', '5-stage', 'boss', tierTag, '64x64', 'transparent'],
      [
        { state: 'blink', fps: 14, loop: false, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('cast_charge', iceRamp, 'ring', f, 6, tier)) },
        { state: 'surge', fps: 14, loop: false, eventPeak: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('aoe_burst', goldRamp, 'vortex', f, 6, tier)) },
        { state: 'boss_nova', fps: 14, loop: false, eventPeak: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('aoe_burst', voidBossRamp, 'vortex', f, 6, tier)) },
        { state: 'cultist_orb', fps: 12, loop: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('projectile', voidBossRamp, 'vortex', f, 6, tier)) },
        { state: 'cinder_meteor', fps: 14, loop: false, eventPeak: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('aoe_burst', fireRamp, 'flame', f, 6, tier)) },
        { state: 'astral_lance', fps: 14, loop: true, frames: Array.from({ length: 6 }, (_, f) => renderFiveStageVfxHalf('projectile', astralBossRamp, 'beam', f, 6, tier)) },
      ]
    );
  }

  // Extended 10 Elemental Schools (both Lit and Strict tiers!)
  const extendedSchools: {
    state: string;
    ramp: ElementalRamp;
    variant: 'flame' | 'crystal' | 'bolt' | 'vortex' | 'slash' | 'beam' | 'spore' | 'ring';
  }[] = [
    { state: 'earth', ramp: makeRamp('#4D321B', '#9E6E38', '#D9A760', '#FFF1D0'), variant: 'crystal' },
    { state: 'shadow', ramp: makeRamp('#1E1038', '#563196', '#9B6EE8', '#E8D6FF'), variant: 'slash' },
    { state: 'light', ramp: makeRamp('#7A561E', '#D9A841', '#F7DA78', '#FFFFFF'), variant: 'beam' },
    { state: 'time', ramp: makeRamp('#1F366B', '#4B74C9', '#8AB4FF', '#EBF4FF'), variant: 'ring' },
    { state: 'void', ramp: makeRamp('#290D4F', '#7B2CBF', '#C06CFF', '#F3DBFF'), variant: 'vortex' },
    { state: 'arcane', ramp: arcaneRamp, variant: 'flame' },
    { state: 'blood', ramp: makeRamp('#5C1124', '#B52444', '#E96578', '#FFD4DC'), variant: 'slash' },
    { state: 'nature', ramp: makeRamp('#1A4732', '#3A9462', '#8CE06C', '#EEFFD6'), variant: 'spore' },
    { state: 'wind', ramp: makeRamp('#21575C', '#56B5AE', '#A7F0E4', '#FFFFFF'), variant: 'slash' },
    { state: 'sonic', ramp: makeRamp('#2A397A', '#5F7BE8', '#A5C4FF', '#FFFFFF'), variant: 'ring' },
  ];

  for (const tier of ['lit', 'strict'] as const) {
    const suffix = tier === 'strict' ? '_strict' : '';
    const tierName = tier === 'strict' ? 'Strict Tier' : 'Lit Tier';
    writeVfxPack(
      `vfx_schools_extended${suffix}`,
      `Extended 10 Elemental Schools (${tierName})`,
      `Pixel Burst & PVFX Foundry (${tierName}) projectiles & impacts for Earth through Sonic`,
      ['vfx', '5-stage', tier === 'strict' ? 'pvfx-strict' : 'pvfx-lit', '13-schools', '64x64', 'transparent'],
      extendedSchools.map((sc) => ({
        state: sc.state,
        fps: 14,
        loop: true,
        frames: Array.from({ length: 6 }, (_, f) =>
          renderFiveStageVfxHalf('projectile', sc.ramp, sc.variant, f, 6, tier)
        ),
      }))
    );
  }

  // 8 Arcane Resonance Detonation Archetypes (both Lit and Strict tiers!)
  const resonanceSpecs: {
    state: string;
    ramp: ElementalRamp;
    variant: 'flame' | 'crystal' | 'bolt' | 'vortex' | 'slash' | 'beam' | 'spore' | 'ring';
  }[] = [
    { state: 'nova', ramp: fireRamp, variant: 'flame' },
    { state: 'vortex', ramp: makeRamp('#1E1045', '#6B34BA', '#A991F7', '#F2E6FF', '#58D6C2'), variant: 'vortex' },
    { state: 'chain', ramp: boltRamp, variant: 'bolt' },
    { state: 'chrono', ramp: goldRamp, variant: 'ring' },
    { state: 'siphon', ramp: makeRamp('#4E1133', '#B52B5C', '#FF7AA2', '#FFE8F0', '#C06CFF'), variant: 'vortex' },
    { state: 'hazard', ramp: makeRamp('#1C4A34', '#3CA66B', '#9BE870', '#EEFFD6'), variant: 'spore' },
    { state: 'shrapnel', ramp: iceRamp, variant: 'crystal' },
    { state: 'fracture', ramp: voidBossRamp, variant: 'slash' },
  ];

  for (const tier of ['lit', 'strict'] as const) {
    const suffix = tier === 'strict' ? '_strict' : '';
    const tierName = tier === 'strict' ? 'Strict Tier' : 'Lit Tier';
    writeVfxPack(
      `vfx_resonances_arcane${suffix}`,
      `Arcane Resonance Detonations (${tierName})`,
      `PVFX Foundry & Pixel Burst (${tierName}) 8-Archetype Resonance AoE explosions`,
      ['vfx', '5-stage', tier === 'strict' ? 'pvfx-strict' : 'pvfx-lit', '78-resonances', '64x64', 'transparent'],
      resonanceSpecs.map((rs) => ({
        state: rs.state,
        fps: 14,
        loop: false,
        eventPeak: true,
        frames: Array.from({ length: 6 }, (_, f) =>
          renderFiveStageVfxHalf('aoe_burst', rs.ramp, rs.variant, f, 6, tier)
        ),
      }))
    );
  }

  return manifests;
}
