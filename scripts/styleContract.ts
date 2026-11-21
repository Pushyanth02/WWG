import { hex, type RGBA } from './pixelCanvas.ts';

/**
 * Audited V3.1 Style Constraint Contract extracted from Cursed Grove & Bone Regent.
 * Every procedural generator batch and automated validator enforces these baselines.
 */
export const STYLE_CONTRACT = {
  version: '3.1.0',
  pixelUpscaleFactor: 2,
  outlineHex: '#140E1D',
  outlineMinAlpha: 170,
  ramps: {
    night: ['#140E1D', '#171224', '#171321', '#241C33'],
    obsidianStone: ['#281F3B', '#342A47', '#3D3152', '#52436E', '#7A669C'],
    boneIvory: ['#9B91A6', '#E8E1D5', '#FAF6EE'],
    arcaneViolet: ['#2D1259', '#5B3AA8', '#A991F7', '#DF8CFF', '#E8D6FF'],
    antiqueGold: ['#8B6B32', '#D9BA72', '#F7E3A6'],
    aetherTeal: ['#1D6D7A', '#3FA6A0', '#58D6C2', '#D8FFFF'],
    dangerCrimson: ['#7D1E34', '#B8324F', '#E96578', '#FFB8C4'],
    cursedGroveFlora: ['#6E1958', '#C43592', '#EC57B4', '#FF8AD4'],
    undeadCryptAccent: ['#262338', '#464163', '#58D6C2', '#F2A849'],
    blightedMarshAccent: ['#1E332C', '#2E5947', '#43B874', '#9BE870'],
  },
  boxes: {
    mage: {
      frameWidth: 64,
      frameHeight: 64,
      pivot: { x: 32, y: 54 },
      hitbox: { x: 20, y: 18, w: 24, h: 36 },
      hurtbox: { x: 22, y: 20, w: 20, h: 34 },
    },
    enemy: {
      frameWidth: 64,
      frameHeight: 64,
      pivot: { x: 32, y: 54 },
      hitbox: { x: 18, y: 16, w: 28, h: 38 },
      hurtbox: { x: 20, y: 18, w: 24, h: 36 },
    },
    boss: {
      frameWidth: 128,
      frameHeight: 128,
      pivot: { x: 64, y: 104 },
      hitbox: { x: 30, y: 24, w: 68, h: 82 },
      hurtbox: { x: 34, y: 28, w: 60, h: 76 },
    },
  },
  timing: {
    enemy: [
      { state: 'idle', frames: 4, fps: 6, loop: true },
      { state: 'walk', frames: 6, fps: 9, loop: true },
      { state: 'windup', frames: 4, fps: 10, loop: false },
      { state: 'attack', frames: 5, fps: 12, loop: false },
      { state: 'recovery', frames: 3, fps: 8, loop: false },
      { state: 'hit', frames: 3, fps: 10, loop: false },
      { state: 'death', frames: 5, fps: 8, loop: false },
    ],
    boss: [
      { state: 'idle', frames: 4, fps: 6, loop: true },
      { state: 'walk', frames: 6, fps: 8, loop: true },
      { state: 'windup', frames: 4, fps: 9, loop: false },
      { state: 'attack', frames: 5, fps: 11, loop: false },
      { state: 'phase_transition', frames: 6, fps: 8, loop: false },
      { state: 'signature', frames: 6, fps: 10, loop: false },
      { state: 'hit', frames: 3, fps: 10, loop: false },
      { state: 'death', frames: 6, fps: 7, loop: false },
    ],
  },
} as const;

export const OUTLINE_INK: RGBA = hex(STYLE_CONTRACT.outlineHex);
export const GROUND_SHADOW: RGBA = { r: 10, g: 6, b: 18, a: 112 };
