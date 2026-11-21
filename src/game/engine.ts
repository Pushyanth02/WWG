import { soundEngine } from '../audio/soundEngine';
import { BIOMES, getNextGauntletBiome } from '../data/biomes';
import { createDefaultModifiers } from '../data/gameData';
import {
  buildUpgradePool,
  getResonance,
  SCHOOL_DEFS,
} from '../data/resonances';
import type {
  BiomeId,
  BossId,
  Direction,
  EnemyArchetypeId,
  GameSettings,
  HudSnapshot,
  MageClassDef,
  PlayerModifiers,
  ResonanceDef,
  RunMode,
  RunSummary,
  SchoolId,
  SpellCombatEvent,
  UpgradeCardDef,
} from '../types/game';
import { SeededRNG } from '../utils/prng';
import { generateBiomeArena, type BiomeArena } from './arenaGenerator';
import { drawAtlasTile, drawSpriteFrame, resolveVfxAssetId, spriteRegistry } from './spriteLoader';

type ProjectileKind =
  | SchoolId
  | 'cultist'
  | 'bone_spear'
  | 'arrow'
  | 'void_orb'
  | 'spore_glob'
  | 'cinder_orb'
  | 'astral_lance'
  | 'shrapnel';

interface Projectile {
  id: number;
  owner: 'player' | 'enemy';
  school: ProjectileKind;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  pierce: number;
  homing: boolean;
  hitIds: Set<number>;
  animTimer: number;
}

interface EnemyEntity {
  id: number;
  kind: EnemyArchetypeId | 'boss';
  bossId?: BossId;
  assetId: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  dir: Direction;
  state: string;
  animTime: number;
  aiTimer: number;
  attackCooldown: number;
  windupTimer: number;
  aimDirX: number;
  aimDirY: number;
  chargeTime: number;
  // Universal 13-school elemental priming & statuses
  primedSchool: SchoolId | null;
  primedTimer: number;
  dotTimer: number;
  dotTickAccum: number;
  dotColor: string;
  slowTimer: number;
  fractureTimer: number;
  staggerTimer: number;
  hitFlash: number;
  dead: boolean;
  deathTimer: number;
  // Boss-specific state
  bossPhase: 1 | 2;
  bossTransitioning: boolean;
  bossTransitionTimer: number;
  bossPatternIndex: number;
}

interface TelegraphZone {
  id: number;
  x: number;
  y: number;
  radius: number;
  elapsed: number;
  duration: number;
  damage: number;
  kind: 'boss_nova' | 'rift_pillar' | 'summon' | 'construct_slam' | 'spore_mortar' | 'cinder_meteor';
  summonKind?: EnemyArchetypeId;
  triggered: boolean;
}

interface HazardZone {
  id: number;
  kind: 'hazard' | 'chrono';
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  tickAccum: number;
  dps: number;
  color: string;
  secondaryColor: string;
}

interface VfxEffect {
  assetId: string;
  state: string;
  x: number;
  y: number;
  scale: number;
  frame: number;
  fps: number;
  frameCount: number;
  rotation: number;
}

interface LightningBolt {
  points: { x: number; y: number }[];
  color: string;
  coreColor: string;
  life: number;
  maxLife: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

interface PickupEntity {
  id: number;
  kind: 'health' | 'aether' | 'shard' | 'gold';
  x: number;
  y: number;
  bobPhase: number;
  value: number;
}

interface BlinkGhost {
  x: number;
  y: number;
  dir: Direction;
  life: number;
  maxLife: number;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onUpgradePrompt: (waveJustCleared: number, choices: UpgradeCardDef[]) => void;
  onGauntletBiomeCleared: (
    clearedBiome: BiomeId,
    nextBiome: BiomeId,
    nextTier: number,
    choices: UpgradeCardDef[]
  ) => void;
  onRunFinished: (summary: RunSummary) => void;
  onSpellEvent?: (event: SpellCombatEvent) => void;
}

export interface EngineInitOptions {
  mageClass: MageClassDef;
  biomeId: BiomeId;
  mode: RunMode;
  equippedSchools: [SchoolId, SchoolId, SchoolId];
  seed: string;
  settings: GameSettings;
}

const ENEMY_CONFIGS: Record<
  EnemyArchetypeId,
  { assetId: string; name: string; hp: number; speed: number; damage: number; radius: number; score: number }
> = {
  skeleton: {
    assetId: 'enemy_skeleton_warrior',
    name: 'Skeleton Warrior',
    hp: 76,
    speed: 124,
    damage: 16,
    radius: 17,
    score: 100,
  },
  cultist: {
    assetId: 'enemy_cultist_acolyte',
    name: 'Cultist Acolyte',
    hp: 68,
    speed: 96,
    damage: 18,
    radius: 17,
    score: 115,
  },
  shieldbone: {
    assetId: 'enemy_shieldbone_knight',
    name: 'Shieldbone Knight',
    hp: 142,
    speed: 94,
    damage: 24,
    radius: 20,
    score: 180,
  },
  necromancer: {
    assetId: 'enemy_necromancer',
    name: 'Rift Necromancer',
    hp: 94,
    speed: 88,
    damage: 20,
    radius: 18,
    score: 175,
  },
  wraith: {
    assetId: 'enemy_wraith',
    name: 'Aether Wraith',
    hp: 74,
    speed: 142,
    damage: 19,
    radius: 17,
    score: 145,
  },
  bone_archer: {
    assetId: 'enemy_bone_archer',
    name: 'Bone Archer',
    hp: 66,
    speed: 104,
    damage: 19,
    radius: 17,
    score: 135,
  },
  plaguebearer: {
    assetId: 'enemy_plaguebearer',
    name: 'Plaguebearer',
    hp: 118,
    speed: 92,
    damage: 21,
    radius: 20,
    score: 160,
  },
  flesh_construct: {
    assetId: 'enemy_flesh_construct',
    name: 'Flesh Construct',
    hp: 192,
    speed: 78,
    damage: 28,
    radius: 23,
    score: 220,
  },
  ember_hound: {
    assetId: 'enemy_ember_hound',
    name: 'Ember Hound',
    hp: 84,
    speed: 162,
    damage: 20,
    radius: 17,
    score: 155,
  },
  obsidian_golem: {
    assetId: 'enemy_obsidian_golem',
    name: 'Obsidian Golem',
    hp: 215,
    speed: 74,
    damage: 30,
    radius: 24,
    score: 240,
  },
  ash_pyromancer: {
    assetId: 'enemy_ash_pyromancer',
    name: 'Ash Pyromancer',
    hp: 96,
    speed: 96,
    damage: 22,
    radius: 18,
    score: 185,
  },
  void_stalker: {
    assetId: 'enemy_void_stalker',
    name: 'Void Stalker',
    hp: 92,
    speed: 154,
    damage: 24,
    radius: 17,
    score: 195,
  },
  starlight_sentinel: {
    assetId: 'enemy_starlight_sentinel',
    name: 'Starlight Sentinel',
    hp: 112,
    speed: 108,
    damage: 22,
    radius: 19,
    score: 205,
  },
};

export class RiftboundEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mageClass: MageClassDef;
  private biomeId: BiomeId;
  private mode: RunMode;
  private equippedSchools: [SchoolId, SchoolId, SchoolId];
  private seed: string;
  private rng: SeededRNG;
  private arena: BiomeArena;
  private settings: GameSettings;
  private callbacks: EngineCallbacks;
  private modifiers: PlayerModifiers = createDefaultModifiers();
  private upgradePool: UpgradeCardDef[];
  private chosenUpgrades: { id: string; name: string; category: string }[] = [];

  private rafId = 0;
  private lastTs = 0;
  private running = false;
  private paused = false;
  private destroyed = false;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private measuredFps = 60;
  private hudEmitAccum = 0;

  // Input state
  private keys = new Set<string>();
  private mouseScreen = { x: 640, y: 360 };
  private mouseWorld = { x: 800, y: 500 };
  private mouseDown = false;
  private camera = { x: 0, y: 0 };
  private shakeTime = 0;
  private shakeIntensity = 0;

  // Player state
  private player = {
    x: 0,
    y: 0,
    radius: 17,
    hp: 220,
    maxHp: 220,
    aether: 120,
    maxAether: 120,
    surgeCharge: 35,
    dir: 'down' as Direction,
    state: 'idle',
    animTime: 0,
    stateLockTimer: 0,
    invulnTimer: 0,
    hitFlash: 0,
    activeSlotIndex: 0 as 0 | 1 | 2,
    potions: 2,
    dead: false,
    deathTimer: 0,
    slotCooldowns: [0, 0, 0] as [number, number, number],
    blinkCooldown: 0,
    surgeCooldown: 0,
  };

  // Run progression & Gauntlet state
  private wave = 1;
  private readonly maxWaves = 3;
  private gauntletTier = 1;
  private biomesCleared = 0;
  private totalWavesCleared = 0;
  private pendingBiomeTransition = false;
  private waveSpawnQueue: { kind: EnemyArchetypeId; delay: number }[] = [];
  private waveTransitionDelay = 0;
  private bossSpawned = false;
  private elapsedSec = 0;
  private kills = 0;
  private shards = 0;
  private gold = 0;
  private score = 0;
  private damageDealt = 0;
  private resonanceCount = 0;
  private lastResonanceName: string | null = null;
  private resonanceBreakdown = new Map<string, number>();
  private bannerText: string | null = null;
  private bannerTimer = 0;
  private runEnded = false;

  // Entities
  private nextId = 1;
  private enemies: EnemyEntity[] = [];
  private projectiles: Projectile[] = [];
  private telegraphs: TelegraphZone[] = [];
  private hazards: HazardZone[] = [];
  private vfx: VfxEffect[] = [];
  private bolts: LightningBolt[] = [];
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  private pickups: PickupEntity[] = [];
  private blinkGhosts: BlinkGhost[] = [];
  private worldTime = 0;

  // Bound event listeners
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: () => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundResize: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    options: EngineInitOptions,
    callbacks: EngineCallbacks
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire 2D canvas context');
    this.ctx = context;

    this.mageClass = options.mageClass;
    this.biomeId = options.biomeId;
    this.mode = options.mode;
    this.equippedSchools = [...options.equippedSchools] as [SchoolId, SchoolId, SchoolId];
    this.seed = options.seed;
    this.rng = new SeededRNG(`${options.seed}:${options.biomeId}`);
    this.arena = generateBiomeArena(options.biomeId, options.seed);
    this.settings = { ...options.settings };
    this.callbacks = callbacks;
    this.upgradePool = buildUpgradePool(this.equippedSchools);

    this.player.x = this.arena.playerStart.x;
    this.player.y = this.arena.playerStart.y;
    this.player.hp = this.mageClass.baseHp;
    this.player.maxHp = this.mageClass.baseHp;
    this.player.aether = this.mageClass.baseAether;
    this.player.maxAether = this.mageClass.baseAether;
    this.player.activeSlotIndex = 0;

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundContextMenu = (e: MouseEvent) => e.preventDefault();
    this.boundResize = this.resizeCanvas.bind(this);

    this.attachEvents();
    this.resizeCanvas();
    this.snapCamera();
    this.startWave(1);
  }

  private attachEvents(): void {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    this.canvas.addEventListener('contextmenu', this.boundContextMenu);
    window.addEventListener('resize', this.boundResize);
  }

  destroy(): void {
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    this.canvas.removeEventListener('mousemove', this.boundMouseMove);
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    this.canvas.removeEventListener('contextmenu', this.boundContextMenu);
    window.removeEventListener('resize', this.boundResize);
  }

  updateSettings(settings: GameSettings): void {
    this.settings = { ...settings };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.mouseDown = false;
    } else {
      this.lastTs = performance.now();
    }
  }

  selectSlot(slotIndex: 0 | 1 | 2): void {
    this.player.activeSlotIndex = slotIndex;
    if (this.settings.quickCastHotkeys && !this.paused && !this.player.dead) {
      this.tryCastSlot(slotIndex);
    }
  }

  triggerBlink(): void {
    if (!this.paused && !this.player.dead) this.tryBlink();
  }

  triggerSurge(): void {
    if (!this.paused && !this.player.dead) this.trySurge();
  }

  triggerPotion(): void {
    if (!this.paused && !this.player.dead) this.tryDrinkPotion();
  }

  applyUpgrade(card: UpgradeCardDef): void {
    this.applyUpgradeEffects(card);
    this.paused = false;
    this.lastTs = performance.now();
    this.startWave(this.wave + 1);
  }

  advanceGauntletBiome(card: UpgradeCardDef): void {
    this.applyUpgradeEffects(card);
    this.gauntletTier++;
    this.biomeId = getNextGauntletBiome(this.biomeId);
    this.arena = generateBiomeArena(this.biomeId, `${this.seed}-T${this.gauntletTier}`);
    this.rng = new SeededRNG(`${this.seed}-T${this.gauntletTier}:${this.biomeId}`);

    // Reset arena entities cleanly while keeping mage build, score, shards, gold & potions
    this.enemies = [];
    this.projectiles = [];
    this.telegraphs = [];
    this.hazards = [];
    this.vfx = [];
    this.bolts = [];
    this.particles = [];
    this.pickups = [];
    this.blinkGhosts = [];

    this.player.x = this.arena.playerStart.x;
    this.player.y = this.arena.playerStart.y;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(this.player.maxHp * 0.45));
    this.player.aether = this.player.maxAether;
    this.player.potions = Math.min(5, this.player.potions + 1);

    this.bossSpawned = false;
    this.pendingBiomeTransition = false;
    this.snapCamera();
    this.paused = false;
    this.lastTs = performance.now();
    this.startWave(1);
  }

  endGauntletEarly(): void {
    if (!this.runEnded) {
      this.finishRun(true);
    }
  }

  private applyUpgradeEffects(card: UpgradeCardDef): void {
    const prevMaxHp = this.player.maxHp;
    const prevMaxAether = this.player.maxAether;

    card.apply(this.modifiers);
    this.chosenUpgrades.push({ id: card.id, name: card.name, category: card.category });

    this.player.maxHp = this.mageClass.baseHp + this.modifiers.maxHpBonus;
    this.player.maxAether = this.mageClass.baseAether + this.modifiers.maxAetherBonus;
    const hpGain = Math.max(0, this.player.maxHp - prevMaxHp);
    const aetherGain = Math.max(0, this.player.maxAether - prevMaxAether);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + hpGain + Math.round(this.player.maxHp * 0.25));
    this.player.aether = Math.min(this.player.maxAether, this.player.aether + aetherGain + 45);

    soundEngine.playUpgradePick();
    this.spawnText(this.player.x, this.player.y - 44, card.name, card.accentColor, 15);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    const tick = (ts: number) => {
      if (this.destroyed) return;
      const rawDt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      this.fpsAccum += rawDt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.measuredFps = Math.round(this.fpsFrames / this.fpsAccum);
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }

      if (!this.paused) {
        this.update(dt);
      }
      this.render();

      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.075) {
        this.hudEmitAccum = 0;
        this.emitHud();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(240, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private getViewportSize(): { vw: number; vh: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      vw: this.canvas.width / dpr,
      vh: this.canvas.height / dpr,
    };
  }

  private snapCamera(): void {
    const { vw, vh } = this.getViewportSize();
    this.camera.x = Math.max(0, Math.min(this.arena.width - vw, this.player.x - vw / 2));
    this.camera.y = Math.max(0, Math.min(this.arena.height - vh, this.player.y - vh / 2));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.paused || this.player.dead) return;
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
      e.preventDefault();
    }
    this.keys.add(code);

    if (code === 'Digit1') this.selectSlot(0);
    else if (code === 'Digit2') this.selectSlot(1);
    else if (code === 'Digit3') this.selectSlot(2);
    else if (code === 'Space') this.tryBlink();
    else if (code === 'KeyF') this.trySurge();
    else if (code === 'KeyQ') this.tryDrinkPotion();
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreen.x = e.clientX - rect.left;
    this.mouseScreen.y = e.clientY - rect.top;
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.paused || this.player.dead) return;
    if (e.button === 0) {
      this.mouseDown = true;
      this.updateMouseWorld();
      this.tryCastSlot(this.player.activeSlotIndex);
    } else if (e.button === 2) {
      // Right-click casts the next equipped school to effortlessly trigger any of the 3 active resonances
      this.updateMouseWorld();
      const altSlot = ((this.player.activeSlotIndex + 1) % 3) as 0 | 1 | 2;
      this.tryCastSlot(altSlot);
    }
  }

  private handleMouseUp(): void {
    this.mouseDown = false;
  }

  private updateMouseWorld(): void {
    this.mouseWorld.x = this.mouseScreen.x + this.camera.x;
    this.mouseWorld.y = this.mouseScreen.y + this.camera.y;
  }

  private showBanner(text: string, duration = 2.6): void {
    this.bannerText = text;
    this.bannerTimer = duration;
  }

  private addShake(intensity: number, duration: number): void {
    if (this.settings.reducedMotion || this.settings.screenShake === 'off') return;
    const mult = this.settings.screenShake === 'low' ? 0.4 : 1;
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity * mult);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  private getTierHpScale(): number {
    return 1 + (this.gauntletTier - 1) * 0.34;
  }

  private getTierDmgScale(): number {
    return 1 + (this.gauntletTier - 1) * 0.16;
  }

  private getTierCadenceScale(): number {
    return Math.max(0.68, 1 - (this.gauntletTier - 1) * 0.08);
  }

  private startWave(waveNum: number): void {
    const biome = BIOMES[this.biomeId];
    const tierTag = this.mode === 'gauntlet' ? ` · RIFT TIER ${this.gauntletTier}` : '';
    this.wave = waveNum;
    this.waveSpawnQueue = [];
    this.waveTransitionDelay = 0;

    if (waveNum === 1) {
      this.showBanner(`WAVE 1 — ${biome.name.toUpperCase()}${tierTag}`, 2.6);
      const count = 6 + Math.min(3, this.gauntletTier - 1);
      for (let i = 0; i < count; i++) {
        this.waveSpawnQueue.push({
          kind: biome.wave1Pool[i % biome.wave1Pool.length],
          delay: 0.25 + i * 0.62,
        });
      }
    } else if (waveNum === 2) {
      this.showBanner(`WAVE 2 — ${biome.name.toUpperCase()} VANGUARD${tierTag}`, 2.6);
      const count = 8 + Math.min(4, this.gauntletTier - 1);
      for (let i = 0; i < count; i++) {
        this.waveSpawnQueue.push({
          kind: biome.wave2Pool[i % biome.wave2Pool.length],
          delay: 0.3 + i * 0.58,
        });
      }
    } else {
      this.showBanner(`WAVE 3 — ${biome.bossName.toUpperCase()} RISES${tierTag}`, 3.4);
      soundEngine.playBossPhase();
      this.addShake(9, 0.45);
      this.spawnBoss();
      this.bossSpawned = true;
      this.waveSpawnQueue = [
        { kind: biome.wave3Adds[0], delay: 1.5 },
        { kind: biome.wave3Adds[1 % biome.wave3Adds.length], delay: 3.0 },
      ];
    }
  }

  private queueSummonEnemy(kind: EnemyArchetypeId, nearBoss = false): void {
    const pt = nearBoss
      ? {
          x: Math.max(120, Math.min(this.arena.width - 120, this.arena.portalPos.x + this.rng.range(-230, 230))),
          y: Math.max(150, Math.min(this.arena.height - 150, this.arena.portalPos.y + this.rng.range(90, 220))),
        }
      : this.rng.pick(this.arena.spawnPoints);

    const jitterX = pt.x + this.rng.range(-36, 36);
    const jitterY = pt.y + this.rng.range(-24, 24);
    this.telegraphs.push({
      id: this.nextId++,
      x: Math.max(96, Math.min(this.arena.width - 96, jitterX)),
      y: Math.max(96, Math.min(this.arena.height - 96, jitterY)),
      radius: 30,
      elapsed: 0,
      duration: 0.78,
      damage: 0,
      kind: 'summon',
      summonKind: kind,
      triggered: false,
    });
  }

  private spawnEnemyImmediate(kind: EnemyArchetypeId, x: number, y: number): void {
    const cfg = ENEMY_CONFIGS[kind];
    const scaledHp = Math.round(cfg.hp * this.getTierHpScale());
    const scaledDmg = Math.round(cfg.damage * this.getTierDmgScale());
    this.enemies.push({
      id: this.nextId++,
      kind,
      assetId: cfg.assetId,
      name: cfg.name,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: cfg.radius,
      hp: scaledHp,
      maxHp: scaledHp,
      speed: cfg.speed,
      damage: scaledDmg,
      dir: 'down',
      state: 'idle',
      animTime: 0,
      aiTimer: this.rng.range(0.2, 0.7),
      attackCooldown: this.rng.range(0.6, 1.25),
      windupTimer: 0,
      aimDirX: 0,
      aimDirY: 1,
      chargeTime: 0,
      primedSchool: null,
      primedTimer: 0,
      dotTimer: 0,
      dotTickAccum: 0,
      dotColor: '#FF7B29',
      slowTimer: 0,
      fractureTimer: 0,
      staggerTimer: 0,
      hitFlash: 0,
      dead: false,
      deathTimer: 0,
      bossPhase: 1,
      bossTransitioning: false,
      bossTransitionTimer: 0,
      bossPatternIndex: 0,
    });
    this.spawnVfx('vfx_arcane_utility', 'blink', x, y, 1.0);
  }

  private spawnBoss(): void {
    const biome = BIOMES[this.biomeId];
    const x = this.arena.portalPos.x;
    const y = this.arena.portalPos.y + 115;
    const baseHp =
      biome.bossId === 'astral_sovereign'
        ? 1240
        : biome.bossId === 'cinder_archon'
          ? 1180
          : biome.bossId === 'blight_colossus'
            ? 1120
            : biome.bossId === 'rift_leviathan'
              ? 1040
              : 960;
    const scaledHp = Math.round(baseHp * this.getTierHpScale());
    const baseSpeed =
      biome.bossId === 'astral_sovereign'
        ? 92
        : biome.bossId === 'cinder_archon'
          ? 84
          : biome.bossId === 'rift_leviathan'
            ? 86
            : biome.bossId === 'blight_colossus'
              ? 68
              : 78;

    this.enemies.push({
      id: this.nextId++,
      kind: 'boss',
      bossId: biome.bossId,
      assetId: biome.bossAssetId,
      name: biome.bossName,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 38,
      hp: scaledHp,
      maxHp: scaledHp,
      speed: baseSpeed,
      damage: Math.round(28 * this.getTierDmgScale()),
      dir: 'down',
      state: 'idle',
      animTime: 0,
      aiTimer: 1.1,
      attackCooldown: 1.4,
      windupTimer: 0,
      aimDirX: 0,
      aimDirY: 1,
      chargeTime: 0,
      primedSchool: null,
      primedTimer: 0,
      dotTimer: 0,
      dotTickAccum: 0,
      dotColor: '#FF7B29',
      slowTimer: 0,
      fractureTimer: 0,
      staggerTimer: 0,
      hitFlash: 0,
      dead: false,
      deathTimer: 0,
      bossPhase: 1,
      bossTransitioning: false,
      bossTransitionTimer: 0,
      bossPatternIndex: 0,
    });
    this.spawnVfx('vfx_arcane_utility', 'boss_nova', x, y, 2.3);
  }

  private getDirectionFromVector(dx: number, dy: number): Direction {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx >= 0 ? 'right' : 'left';
    }
    return dy >= 0 ? 'down' : 'up';
  }

  private tryCastSlot(slotIndex: 0 | 1 | 2): void {
    const schoolId = this.equippedSchools[slotIndex];
    const def = SCHOOL_DEFS[schoolId];
    if (this.player.slotCooldowns[slotIndex] > 0) return;
    if (this.player.aether < def.cost) {
      this.spawnText(this.player.x, this.player.y - 36, 'Low Aether', '#58D6C2', 11);
      return;
    }

    const haste = this.mageClass.cooldownHaste / this.modifiers.cooldownMult;
    this.player.slotCooldowns[slotIndex] = Math.max(0.14, def.cooldown / haste);
    this.player.aether -= def.cost;

    const dx = this.mouseWorld.x - this.player.x;
    const dy = this.mouseWorld.y - this.player.y;
    const angle = Math.atan2(dy, dx);
    this.player.dir = this.getDirectionFromVector(dx, dy);
    this.player.state = 'cast';
    this.player.animTime = 0;
    this.player.stateLockTimer = 0.22;

    const schoolMult = (this.modifiers.schoolDamageMult[schoolId] ?? 1) * this.modifiers.allSpellDamageMult;
    const dmg = Math.round(def.baseDamage * this.mageClass.spellPower * schoolMult);

    if (def.delivery === 'chain') {
      soundEngine.playLightningCast();
      this.castChainSpell(schoolId, angle, dmg);
      return;
    }

    if (schoolId === 'fire' || schoolId === 'blood' || schoolId === 'earth') {
      soundEngine.playFireCast();
    } else if (schoolId === 'ice' || schoolId === 'wind' || schoolId === 'time') {
      soundEngine.playIceCast();
    } else {
      soundEngine.playLightningCast();
    }

    const castX = this.player.x + Math.cos(angle) * 24;
    const castY = this.player.y - 10 + Math.sin(angle) * 24;
    if (schoolId === 'fire' || schoolId === 'ice') {
      this.spawnVfx(def.vfxSheet, 'cast_charge', castX, castY, 0.85);
    } else {
      this.spawnParticleBurst(castX, castY, def.color, 7, 105);
    }
    this.emitSpellFxEvent({
      type: 'cast',
      school: schoolId,
      worldX: castX,
      worldY: castY,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      intensityTier: 1,
      primaryColor: def.color,
      secondaryColor: def.secondaryColor,
    });

    const count = 1 + this.modifiers.extraProjectiles;
    const spreadStep = 0.16;
    const pierce = def.delivery === 'pierce' ? 2 : def.delivery === 'pulse' ? 3 : 1;
    const radius = def.delivery === 'pulse' ? 20 : def.delivery === 'heavy' ? 15 : 13;

    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * spreadStep;
      const a = angle + offset;
      this.projectiles.push({
        id: this.nextId++,
        owner: 'player',
        school: schoolId,
        color: def.color,
        x: this.player.x + Math.cos(a) * 24,
        y: this.player.y - 8 + Math.sin(a) * 24,
        vx: Math.cos(a) * def.projectileSpeed,
        vy: Math.sin(a) * def.projectileSpeed,
        radius,
        damage: dmg,
        life: def.delivery === 'pulse' ? 0.78 : 1.45,
        pierce,
        homing: def.delivery === 'homing',
        hitIds: new Set(),
        animTimer: 0,
      });
    }
  }

  private castChainSpell(schoolId: SchoolId, aimAngle: number, baseDmg: number): void {
    const def = SCHOOL_DEFS[schoolId];
    const startX = this.player.x + Math.cos(aimAngle) * 22;
    const startY = this.player.y - 12 + Math.sin(aimAngle) * 22;
    this.spawnVfx('vfx_lightning', 'cast_charge', startX, startY, 0.88);
    this.emitSpellFxEvent({
      type: 'cast',
      school: schoolId,
      worldX: startX,
      worldY: startY,
      dirX: Math.cos(aimAngle),
      dirY: Math.sin(aimAngle),
      intensityTier: 1,
      primaryColor: def.color,
      secondaryColor: def.secondaryColor,
    });

    const alive = this.enemies.filter((e) => !e.dead && !e.bossTransitioning);
    let primary: EnemyEntity | null = null;
    let bestScore = Infinity;

    for (const enemy of alive) {
      const distPlayer = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (distPlayer > 490) continue;
      const toEnemy = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x);
      let diff = Math.abs(toEnemy - aimAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < 0.48) {
        const score = diff * 360 + distPlayer * 0.45;
        if (score < bestScore) {
          bestScore = score;
          primary = enemy;
        }
      }
    }

    if (!primary) {
      const dist = Math.min(340, Math.hypot(this.mouseWorld.x - this.player.x, this.mouseWorld.y - this.player.y));
      const tx = this.player.x + Math.cos(aimAngle) * dist;
      const ty = this.player.y + Math.sin(aimAngle) * dist;
      this.addLightningSegment(startX, startY, tx, ty, def.color, def.secondaryColor);
      this.spawnVfx('vfx_lightning', 'impact', tx, ty, 0.95);
      return;
    }

    const hitSet = new Set<number>([primary.id]);
    const chainTargets: EnemyEntity[] = [primary];
    const maxChains = 2 + this.modifiers.chainBonus;

    let curr = primary;
    for (let jump = 0; jump < maxChains; jump++) {
      let nextTarget: EnemyEntity | null = null;
      let nearestDist = 235;
      for (const candidate of alive) {
        if (hitSet.has(candidate.id)) continue;
        const d = Math.hypot(candidate.x - curr.x, candidate.y - curr.y);
        if (d < nearestDist) {
          nearestDist = d;
          nextTarget = candidate;
        }
      }
      if (!nextTarget) break;
      hitSet.add(nextTarget.id);
      chainTargets.push(nextTarget);
      curr = nextTarget;
    }

    let prevX = startX;
    let prevY = startY;
    chainTargets.forEach((target, idx) => {
      const dmg = Math.round(baseDmg * Math.pow(0.86, idx));
      this.addLightningSegment(prevX, prevY, target.x, target.y - 12, def.color, def.secondaryColor);
      this.spawnVfx('vfx_lightning', idx === 0 ? 'aoe_burst' : 'impact', target.x, target.y - 10, 0.98);
      this.emitSpellFxEvent({
        type: target.kind === 'boss' ? 'boss_impact' : idx === 0 ? 'crit' : 'hit',
        school: schoolId,
        worldX: target.x,
        worldY: target.y - 10,
        dirX: target.x - prevX,
        dirY: target.y - prevY,
        intensityTier: target.kind === 'boss' || idx === 0 ? 2 : 1,
        primaryColor: def.color,
        secondaryColor: def.secondaryColor,
      });
      this.damageEnemy(target, dmg, schoolId, false);
      if (target.kind !== 'boss') {
        target.staggerTimer = Math.max(target.staggerTimer, 0.22);
      }
      prevX = target.x;
      prevY = target.y - 12;
    });
    this.addShake(3.5, 0.1);
  }

  private addLightningSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color = '#A991F7',
    coreColor = '#FFF7B2'
  ): void {
    const pts: { x: number; y: number }[] = [{ x: x1, y: y1 }];
    const steps = 6;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const perpX = -dy;
    const perpY = dx;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const jitter = (Math.random() - 0.5) * 28;
      pts.push({
        x: x1 + dx * t + (perpX / len) * jitter,
        y: y1 + dy * t + (perpY / len) * jitter,
      });
    }
    pts.push({ x: x2, y: y2 });
    this.bolts.push({ points: pts, color, coreColor, life: 0.22, maxLife: 0.22 });
  }

  private tryBlink(): void {
    if (this.player.blinkCooldown > 0) return;
    const haste = this.mageClass.cooldownHaste / this.modifiers.cooldownMult;
    this.player.blinkCooldown = Math.max(1.15, 2.45 / haste);

    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;

    if (dx === 0 && dy === 0) {
      dx = this.mouseWorld.x - this.player.x;
      dy = this.mouseWorld.y - this.player.y;
    }
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    soundEngine.playBlink();
    this.spawnVfx('vfx_arcane_utility', 'blink', this.player.x, this.player.y - 8, 1.1);

    const startX = this.player.x;
    const startY = this.player.y;
    const steps = 8;
    const totalDist = 178;
    for (let s = 1; s <= steps; s++) {
      const nextX = this.player.x + (nx * totalDist) / steps;
      const nextY = this.player.y + (ny * totalDist) / steps;
      const resolved = this.resolveArenaCollision(nextX, nextY, this.player.radius);
      this.player.x = resolved.x;
      this.player.y = resolved.y;
      if (s === 2 || s === 5) {
        this.blinkGhosts.push({
          x: startX + (this.player.x - startX) * (s / steps),
          y: startY + (this.player.y - startY) * (s / steps),
          dir: this.player.dir,
          life: 0.24,
          maxLife: 0.24,
        });
      }
    }

    this.player.dir = this.getDirectionFromVector(nx, ny);
    this.player.state = 'blink';
    this.player.animTime = 0;
    this.player.stateLockTimer = 0.26;
    this.player.invulnTimer = Math.max(this.player.invulnTimer, 0.36);

    this.spawnVfx('vfx_arcane_utility', 'blink', this.player.x, this.player.y - 8, 1.2);
    this.spawnParticleBurst(this.player.x, this.player.y - 10, '#58D6C2', 14, 130);

    if (this.modifiers.blinkShockwave) {
      this.spawnVfx('vfx_arcane_utility', 'surge', this.player.x, this.player.y - 6, 1.5);
      for (const e of this.enemies) {
        if (e.dead || e.bossTransitioning) continue;
        if (Math.hypot(e.x - this.player.x, e.y - this.player.y) <= 135) {
          this.damageEnemy(e, Math.round(46 * this.mageClass.spellPower), 'utility', false);
        }
      }
      this.addShake(4, 0.14);
    }
  }

  private trySurge(): void {
    if (this.player.surgeCharge < 100 || this.player.surgeCooldown > 0) {
      this.spawnText(this.player.x, this.player.y - 40, `Surge ${Math.floor(this.player.surgeCharge)}%`, '#A991F7', 11);
      return;
    }
    this.player.surgeCharge = 0;
    this.player.surgeCooldown = 4.0;
    this.player.aether = Math.min(this.player.maxAether, this.player.aether + 55);
    this.player.invulnTimer = Math.max(this.player.invulnTimer, 0.45);
    this.player.state = 'attack';
    this.player.animTime = 0;
    this.player.stateLockTimer = 0.3;

    soundEngine.playSurge();
    this.addShake(8, 0.28);
    this.spawnVfx('vfx_arcane_utility', 'surge', this.player.x, this.player.y - 8, 2.8);
    this.spawnParticleBurst(this.player.x, this.player.y - 8, '#A991F7', 26, 230);
    this.spawnText(this.player.x, this.player.y - 48, 'AETHER SURGE!', '#D9BA72', 16);
    this.emitSpellFxEvent({
      type: 'surge',
      school: 'arcane',
      worldX: this.player.x,
      worldY: this.player.y - 8,
      dirX: 0,
      dirY: -1,
      intensityTier: 3,
      primaryColor: '#D9BA72',
      secondaryColor: '#A991F7',
    });

    this.projectiles = this.projectiles.filter(
      (p) => p.owner === 'player' || Math.hypot(p.x - this.player.x, p.y - this.player.y) > 270
    );

    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.bossTransitioning) continue;
      const d = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (d <= 225) {
        this.damageEnemy(enemy, Math.round(84 * this.mageClass.spellPower), 'utility', true);
        if (enemy.kind !== 'boss' && d > 1) {
          enemy.vx += ((enemy.x - this.player.x) / d) * 320;
          enemy.vy += ((enemy.y - this.player.y) / d) * 320;
        }
      }
    }
  }

  private tryDrinkPotion(): void {
    if (this.player.potions <= 0 || this.player.hp >= this.player.maxHp) return;
    this.player.potions--;
    const heal = Math.round(this.player.maxHp * 0.4);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    soundEngine.playPotion();
    this.spawnParticleBurst(this.player.x, this.player.y - 12, '#E96578', 14, 110);
    this.spawnText(this.player.x, this.player.y - 42, `+${heal} HP`, '#58D6C2', 14);
  }

  private triggerResonance(
    res: ResonanceDef,
    originX: number,
    originY: number,
    primaryTarget: EnemyEntity
  ): void {
    this.resonanceCount++;
    this.lastResonanceName = res.name;
    this.resonanceBreakdown.set(res.name, (this.resonanceBreakdown.get(res.name) ?? 0) + 1);

    this.score += 190;
    this.shards += 4;
    this.player.aether = Math.min(this.player.maxAether, this.player.aether + 14);
    this.player.surgeCharge = Math.min(100, this.player.surgeCharge + 16);

    const schoolA = SCHOOL_DEFS[res.schools[0]];
    const schoolB = SCHOOL_DEFS[res.schools[1]];
    const radius = res.radius + this.modifiers.resonanceRadiusBonus;
    const baseResDmg = Math.round(
      46 * res.damageMultiplier * this.mageClass.spellPower * this.modifiers.resonanceDamageMult
    );

    soundEngine.playThermalShatter();
    this.addShake(7.5, 0.22);

    // Signature 5-stage Pixel Burst / PVFX Foundry resonance detonation + lingering ground pulse
    if (res.key === 'fire+ice') {
      this.spawnVfx(
        'vfx_thermal_shatter',
        'aoe_burst',
        originX,
        originY - 8,
        this.modifiers.resonanceMasteryUnlocked ? 2.4 : 1.95
      );
      this.spawnVfx('vfx_thermal_shatter', 'ground_linger', originX, originY + 2, 1.55);
    } else {
      this.spawnVfx(
        'vfx_resonances_arcane',
        res.vfxRowState,
        originX,
        originY - 8,
        this.modifiers.resonanceMasteryUnlocked ? 2.45 : 2.0
      );
    }
    this.emitSpellFxEvent({
      type: 'resonance',
      school: res.schools[0],
      worldX: originX,
      worldY: originY - 8,
      dirX: originX - this.player.x,
      dirY: originY - this.player.y,
      intensityTier: 3,
      primaryColor: schoolA.color,
      secondaryColor: schoolB.color,
    });
    this.spawnParticleBurst(originX, originY - 8, schoolA.color, 13, 210);
    this.spawnParticleBurst(originX, originY - 8, schoolB.color, 13, 210);
    this.spawnParticleBurst(originX, originY - 8, '#A991F7', 10, 160);
    this.spawnText(originX, originY - 54, `${res.name.toUpperCase()}!`, '#D9BA72', 15);

    // Consume prime on primary target
    primaryTarget.primedSchool = null;
    primaryTarget.primedTimer = 0;

    // Execute archetype-specific gameplay payoff
    switch (res.archetype) {
      case 'nova': {
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.bossTransitioning) continue;
          const dist = Math.hypot(enemy.x - originX, enemy.y - originY);
          if (dist <= radius) {
            this.damageEnemy(enemy, baseResDmg, 'resonance', true);
            if (enemy.kind !== 'boss' && dist > 1) {
              enemy.vx += ((enemy.x - originX) / dist) * 250;
              enemy.vy += ((enemy.y - originY) / dist) * 250;
            }
          }
        }
        break;
      }
      case 'vortex': {
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.bossTransitioning) continue;
          const dist = Math.hypot(enemy.x - originX, enemy.y - originY);
          if (dist <= radius) {
            this.damageEnemy(enemy, Math.round(baseResDmg * 0.9), 'resonance', true);
            if (enemy.kind !== 'boss' && dist > 10) {
              enemy.vx += ((originX - enemy.x) / dist) * 310;
              enemy.vy += ((originY - enemy.y) / dist) * 310;
              enemy.staggerTimer = Math.max(enemy.staggerTimer, 0.28);
            }
          }
        }
        break;
      }
      case 'chain': {
        const targets = this.enemies
          .filter((e) => !e.dead && !e.bossTransitioning && Math.hypot(e.x - originX, e.y - originY) <= radius + 65)
          .sort((a, b) => Math.hypot(a.x - originX, a.y - originY) - Math.hypot(b.x - originX, b.y - originY))
          .slice(0, 4 + this.modifiers.chainBonus);
        let px = originX;
        let py = originY - 10;
        targets.forEach((t, idx) => {
          this.addLightningSegment(px, py, t.x, t.y - 10, schoolA.color, '#E8D6FF');
          this.damageEnemy(t, Math.round(baseResDmg * Math.pow(0.88, idx)), 'resonance', true);
          px = t.x;
          py = t.y - 10;
        });
        break;
      }
      case 'chrono': {
        this.hazards.push({
          id: this.nextId++,
          kind: 'chrono',
          x: originX,
          y: originY,
          radius: radius * 0.85,
          life: 3.6,
          maxLife: 3.6,
          tickAccum: 0,
          dps: Math.round(baseResDmg * 0.25),
          color: schoolA.color,
          secondaryColor: schoolB.color,
        });
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.bossTransitioning) continue;
          if (Math.hypot(enemy.x - originX, enemy.y - originY) <= radius) {
            this.damageEnemy(enemy, Math.round(baseResDmg * 0.82), 'resonance', true);
            enemy.slowTimer = Math.max(enemy.slowTimer, 4.2);
          }
        }
        break;
      }
      case 'siphon': {
        let hits = 0;
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.bossTransitioning) continue;
          if (Math.hypot(enemy.x - originX, enemy.y - originY) <= radius) {
            this.damageEnemy(enemy, Math.round(baseResDmg * 0.92), 'resonance', true);
            hits++;
          }
        }
        const healAmt = Math.min(36, 12 + hits * 6);
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + healAmt);
        this.player.aether = Math.min(this.player.maxAether, this.player.aether + 18);
        this.spawnText(this.player.x, this.player.y - 42, `+${healAmt} HP`, '#58D6C2', 13);
        break;
      }
      case 'hazard': {
        this.hazards.push({
          id: this.nextId++,
          kind: 'hazard',
          x: originX,
          y: originY,
          radius: radius * 0.78,
          life: 4.4,
          maxLife: 4.4,
          tickAccum: 0,
          dps: Math.round(baseResDmg * 0.42),
          color: schoolA.color,
          secondaryColor: schoolB.color,
        });
        this.damageEnemy(primaryTarget, Math.round(baseResDmg * 0.75), 'resonance', true);
        break;
      }
      case 'shrapnel': {
        this.damageEnemy(primaryTarget, Math.round(baseResDmg * 0.75), 'resonance', true);
        const shardCount = this.modifiers.resonanceMasteryUnlocked ? 8 : 6;
        for (let i = 0; i < shardCount; i++) {
          const a = (i / shardCount) * Math.PI * 2 + this.worldTime;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'player',
            school: 'shrapnel',
            color: i % 2 === 0 ? schoolA.color : schoolB.color,
            x: originX + Math.cos(a) * 14,
            y: originY + Math.sin(a) * 14,
            vx: Math.cos(a) * 520,
            vy: Math.sin(a) * 520,
            radius: 10,
            damage: Math.round(baseResDmg * 0.45),
            life: 0.65,
            pierce: 2,
            homing: false,
            hitIds: new Set([primaryTarget.id]),
            animTimer: 0,
          });
        }
        break;
      }
      case 'fracture': {
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.bossTransitioning) continue;
          const dist = Math.hypot(enemy.x - originX, enemy.y - originY);
          if (dist <= radius) {
            enemy.fractureTimer = 5.0;
            this.damageEnemy(enemy, baseResDmg, 'resonance', true);
            if (enemy.kind !== 'boss') {
              enemy.staggerTimer = Math.max(enemy.staggerTimer, 0.35);
            }
          }
        }
        break;
      }
    }
  }

  private damageEnemy(
    enemy: EnemyEntity,
    amount: number,
    source: SchoolId | 'dot' | 'resonance' | 'utility',
    isCritStyle: boolean
  ): void {
    if (enemy.dead || enemy.bossTransitioning) return;

    let finalDmg = amount;
    if (enemy.kind === 'shieldbone' && source !== 'resonance' && source !== 'dot' && enemy.chargeTime <= 0) {
      finalDmg = Math.round(finalDmg * 0.82);
    }
    if (enemy.fractureTimer > 0) {
      finalDmg = Math.round(finalDmg * 1.28);
    }

    enemy.hp -= finalDmg;
    enemy.hitFlash = 0.14;
    this.damageDealt += finalDmg;
    this.player.surgeCharge = Math.min(
      100,
      this.player.surgeCharge + (source === 'dot' ? 0.8 : source === 'arcane' ? 6.5 : 4.4)
    );

    if (this.settings.showDamageNumbers) {
      const col =
        source === 'resonance'
          ? '#D9BA72'
          : source === 'dot'
            ? enemy.dotColor
            : source === 'utility'
              ? '#E8D6FF'
              : SCHOOL_DEFS[source].color;
      this.spawnText(
        enemy.x + (Math.random() - 0.5) * 18,
        enemy.y - (enemy.kind === 'boss' ? 72 : 34),
        `${finalDmg}`,
        col,
        isCritStyle ? 15 : 12
      );
    }

    if (source !== 'dot') {
      soundEngine.playEnemyHit();
    }

    // Apply school-specific micro-perks + universal 78-Resonance Prime/Trigger check!
    if (source !== 'dot' && source !== 'resonance' && source !== 'utility') {
      if (source === 'fire' || source === 'blood' || source === 'nature') {
        enemy.dotTimer = 4.0;
        enemy.dotColor = SCHOOL_DEFS[source].color;
      }
      if (source === 'ice' || source === 'time' || source === 'nature') {
        enemy.slowTimer = Math.max(enemy.slowTimer, 4.2);
      }
      if (source === 'earth' || source === 'sonic') {
        enemy.fractureTimer = Math.max(enemy.fractureTimer, 3.5);
        if (enemy.kind !== 'boss') enemy.staggerTimer = Math.max(enemy.staggerTimer, 0.18);
      }
      if (source === 'blood') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 3);
      }
      if (source === 'void' && enemy.kind !== 'boss') {
        // Gentle micro-pull toward hit impact
        enemy.staggerTimer = Math.max(enemy.staggerTimer, 0.12);
      }

      if (enemy.primedSchool && enemy.primedSchool !== source) {
        const res = getResonance(enemy.primedSchool, source);
        if (res) {
          this.triggerResonance(res, enemy.x, enemy.y, enemy);
        }
      } else {
        enemy.primedSchool = source;
        enemy.primedTimer = 5.0;
      }
    }

    // Tyrant Phase 2 transition at 50% HP
    if (enemy.kind === 'boss' && enemy.bossPhase === 1 && enemy.hp > 0 && enemy.hp <= enemy.maxHp * 0.5) {
      enemy.bossPhase = 2;
      enemy.bossTransitioning = true;
      enemy.bossTransitionTimer = 1.65;
      enemy.state = 'phase_transition';
      enemy.animTime = 0;
      enemy.windupTimer = 0;
      const phaseTitle =
        enemy.bossId === 'cinder_archon'
          ? 'CINDER ARCHON — PHASE II: CATACLYSMIC FORGE'
          : enemy.bossId === 'astral_sovereign'
            ? 'ASTRAL SOVEREIGN — PHASE II: FRACTURED FIRMAMENT'
            : enemy.bossId === 'rift_leviathan'
              ? 'RIFT LEVIATHAN — PHASE II: ABYSSAL GAZE'
              : enemy.bossId === 'blight_colossus'
                ? 'BLIGHT COLOSSUS — PHASE II: CATACLYSMIC MIRE'
                : 'BONE REGENT — PHASE II: RIFT ASCENSION';
      const phaseColor =
        enemy.bossId === 'cinder_archon'
          ? '#FF6B3D'
          : enemy.bossId === 'astral_sovereign'
            ? '#7C9BFF'
            : '#A991F7';
      this.showBanner(phaseTitle, 3.0);
      soundEngine.playBossPhase();
      this.addShake(11, 0.5);
      this.spawnVfx(
        'vfx_arcane_utility',
        enemy.bossId === 'cinder_archon' ? 'cinder_meteor' : 'boss_nova',
        enemy.x,
        enemy.y - 10,
        2.8
      );
      this.emitSpellFxEvent({
        type: 'boss_impact',
        school: enemy.bossId === 'cinder_archon' ? 'fire' : 'void',
        worldX: enemy.x,
        worldY: enemy.y - 14,
        dirX: 0,
        dirY: -1,
        intensityTier: 3,
        primaryColor: phaseColor,
        secondaryColor: '#D9BA72',
      });
      this.spawnParticleBurst(enemy.x, enemy.y - 20, phaseColor, 30, 240);
      return;
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
  }

  private killEnemy(enemy: EnemyEntity): void {
    enemy.dead = true;
    enemy.hp = 0;
    enemy.state = 'death';
    enemy.animTime = 0;
    enemy.deathTimer = enemy.kind === 'boss' ? 1.5 : 0.72;
    this.kills++;

    const rewardScore = enemy.kind === 'boss' ? 1600 : ENEMY_CONFIGS[enemy.kind].score;
    this.score += rewardScore;
    soundEngine.playEnemyDeath();

    // Plaguebearer toxic death eruption telegraph!
    if (enemy.kind === 'plaguebearer') {
      this.telegraphs.push({
        id: this.nextId++,
        x: enemy.x,
        y: enemy.y,
        radius: 68,
        elapsed: 0,
        duration: 0.72,
        damage: Math.round(20 * this.getTierDmgScale()),
        kind: 'spore_mortar',
        triggered: false,
      });
      this.spawnParticleBurst(enemy.x, enemy.y - 10, '#9BE870', 18, 160);
    } else {
      this.spawnParticleBurst(
        enemy.x,
        enemy.y - 12,
        enemy.kind === 'boss' ? '#D9BA72' : '#A991F7',
        enemy.kind === 'boss' ? 36 : 14,
        175
      );
    }

    const dropCount = enemy.kind === 'boss' ? 8 : 2;
    for (let i = 0; i < dropCount; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(10, enemy.kind === 'boss' ? 74 : 28);
      const roll = this.rng.next();
      const kind: PickupEntity['kind'] =
        roll < 0.45 ? 'shard' : roll < 0.78 ? 'gold' : roll < 0.9 ? 'aether' : 'health';
      this.pickups.push({
        id: this.nextId++,
        kind,
        x: Math.max(84, Math.min(this.arena.width - 84, enemy.x + Math.cos(a) * dist)),
        y: Math.max(84, Math.min(this.arena.height - 84, enemy.y + Math.sin(a) * dist)),
        bobPhase: this.rng.range(0, Math.PI * 2),
        value: kind === 'shard' ? 5 : kind === 'gold' ? 25 : kind === 'aether' ? 30 : 35,
      });
    }

    if (enemy.kind === 'boss') {
      const biome = BIOMES[this.biomeId];
      this.addShake(12, 0.55);
      this.showBanner(`${biome.bossName.toUpperCase()} VANQUISHED — ${biome.name.toUpperCase()} CLEARED`, 3.0);
      soundEngine.playVictory();
    }
  }

  private damagePlayer(amount: number): void {
    if (this.player.dead || this.player.invulnTimer > 0) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.player.invulnTimer = 0.65;
    this.player.hitFlash = 0.22;
    this.player.state = 'hit';
    this.player.animTime = 0;
    this.player.stateLockTimer = 0.22;

    soundEngine.playPlayerHit();
    this.addShake(6, 0.2);
    this.spawnText(this.player.x, this.player.y - 38, `-${amount}`, '#E96578', 14);
    this.spawnParticleBurst(this.player.x, this.player.y - 10, '#E96578', 10, 140);

    if (this.player.hp <= 0) {
      this.player.dead = true;
      this.player.state = 'death';
      this.player.animTime = 0;
      this.player.deathTimer = 1.25;
      soundEngine.playDefeat();
      this.showBanner('THE RIFT CLAIMS ANOTHER ARCHMAGE', 3.0);
    }
  }

  private resolveArenaCollision(x: number, y: number, radius: number): { x: number; y: number; hitWall: boolean } {
    const pad = this.arena.tileSize + radius;
    let nx = x;
    let ny = y;
    let hitWall = false;

    if (nx < pad) {
      nx = pad;
      hitWall = true;
    } else if (nx > this.arena.width - pad) {
      nx = this.arena.width - pad;
      hitWall = true;
    }
    if (ny < pad + 18) {
      ny = pad + 18;
      hitWall = true;
    } else if (ny > this.arena.height - pad) {
      ny = this.arena.height - pad;
      hitWall = true;
    }

    for (const obs of this.arena.obstacles) {
      const dx = nx - obs.x;
      const dy = ny - obs.y;
      const minDist = radius + obs.radius;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist && dist > 0.001) {
        const push = minDist - dist;
        nx += (dx / dist) * push;
        ny += (dy / dist) * push;
        hitWall = true;
      }
    }

    return { x: nx, y: ny, hitWall };
  }

  private emitSpellFxEvent(params: {
    type: SpellCombatEvent['type'];
    school: SchoolId | 'utility';
    worldX: number;
    worldY: number;
    dirX: number;
    dirY: number;
    intensityTier: 1 | 2 | 3;
    primaryColor: string;
    secondaryColor?: string;
    radius?: number;
  }): void {
    if (!this.callbacks.onSpellEvent) return;
    const defaultRadius =
      params.intensityTier === 3 ? 112 : params.intensityTier === 2 ? 68 : 38;
    this.callbacks.onSpellEvent({
      type: params.type,
      schoolId: params.school === 'utility' ? undefined : params.school,
      screenX: params.worldX - this.camera.x,
      screenY: params.worldY - this.camera.y,
      dirX: params.dirX,
      dirY: params.dirY,
      intensityTier: params.intensityTier,
      primaryColor: params.primaryColor,
      secondaryColor: params.secondaryColor ?? params.primaryColor,
      radius: params.radius ?? defaultRadius,
    });
  }

  private spawnVfx(assetId: string, state: string, x: number, y: number, scale = 1, rotation = 0): void {
    const resolvedId = resolveVfxAssetId(assetId, this.settings.vfxStyleTier);
    const asset = spriteRegistry.get(resolvedId);
    const mappedState = state === 'cast' ? 'cast_charge' : state === 'linger' ? 'ground_linger' : state;
    const anim =
      asset?.animMap.get(`${mappedState}:down`) ||
      asset?.animMap.get(`${state}:down`) ||
      asset?.manifest.animations[0];
    this.vfx.push({
      assetId: resolvedId,
      state: anim?.state ?? mappedState,
      x,
      y,
      scale,
      frame: 0,
      fps: anim?.fps ?? 12,
      frameCount: anim?.frameCount ?? 6,
      rotation,
    });
  }

  private spawnParticleBurst(x: number, y: number, color: string, baseCount: number, speed: number): void {
    const mult =
      this.settings.particleDensity === 'low' ? 0.35 : this.settings.particleDensity === 'normal' ? 0.7 : 1;
    const count = Math.max(2, Math.round(baseCount * mult));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.35 + Math.random() * 0.8) * speed;
      const life = 0.25 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        size: 2 + Math.floor(Math.random() * 3),
        color,
        life,
        maxLife: life,
      });
    }
  }

  private spawnText(x: number, y: number, text: string, color: string, size = 12): void {
    this.texts.push({
      x,
      y,
      vy: -36,
      text,
      color,
      size,
      life: 0.92,
      maxLife: 0.92,
    });
  }

  private update(dt: number): void {
    this.worldTime += dt;
    if (!this.runEnded) {
      this.elapsedSec += dt;
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerText = null;
    }

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) this.shakeIntensity = 0;
    }

    this.updateMouseWorld();
    this.updatePlayer(dt);
    this.updateWaveSpawns(dt);
    this.updateTelegraphs(dt);
    this.updateHazards(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateVfxAndParticles(dt);
    this.updateCamera(dt);
    this.checkEndConditions();
  }

  private updatePlayer(dt: number): void {
    if (this.player.dead) {
      this.player.animTime += dt;
      this.player.deathTimer -= dt;
      if (this.player.deathTimer <= 0 && !this.runEnded) {
        this.finishRun(false);
      }
      return;
    }

    for (let i = 0; i < 3; i++) {
      this.player.slotCooldowns[i] = Math.max(0, this.player.slotCooldowns[i] - dt);
    }
    this.player.blinkCooldown = Math.max(0, this.player.blinkCooldown - dt);
    this.player.surgeCooldown = Math.max(0, this.player.surgeCooldown - dt);
    this.player.invulnTimer = Math.max(0, this.player.invulnTimer - dt);
    this.player.hitFlash = Math.max(0, this.player.hitFlash - dt);
    this.player.stateLockTimer = Math.max(0, this.player.stateLockTimer - dt);

    const aetherRegen = 16 + this.modifiers.aetherRegenBonus;
    this.player.aether = Math.min(this.player.maxAether, this.player.aether + aetherRegen * dt);

    if (this.mouseDown) {
      this.tryCastSlot(this.player.activeSlotIndex);
    }

    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;

    const moving = mx !== 0 || my !== 0;
    if (moving) {
      const len = Math.hypot(mx, my);
      const speed = this.mageClass.moveSpeed * this.modifiers.moveSpeedMult;
      const nextX = this.player.x + (mx / len) * speed * dt;
      const nextY = this.player.y + (my / len) * speed * dt;
      const resolved = this.resolveArenaCollision(nextX, nextY, this.player.radius);
      this.player.x = resolved.x;
      this.player.y = resolved.y;

      if (this.player.stateLockTimer <= 0) {
        this.player.dir = this.getDirectionFromVector(mx, my);
        this.player.state = 'walk';
      }
    } else if (this.player.stateLockTimer <= 0) {
      this.player.state = 'idle';
      this.player.dir = this.getDirectionFromVector(
        this.mouseWorld.x - this.player.x,
        this.mouseWorld.y - this.player.y
      );
    }

    this.player.animTime += dt;
  }

  private updateWaveSpawns(dt: number): void {
    if (this.waveSpawnQueue.length > 0) {
      for (let i = this.waveSpawnQueue.length - 1; i >= 0; i--) {
        this.waveSpawnQueue[i].delay -= dt;
        if (this.waveSpawnQueue[i].delay <= 0) {
          const item = this.waveSpawnQueue.splice(i, 1)[0];
          this.queueSummonEnemy(item.kind);
        }
      }
    }

    const activeSummons = this.telegraphs.some((t) => t.kind === 'summon');
    const aliveEnemies = this.enemies.filter((e) => !e.dead).length;

    if (this.wave < this.maxWaves && this.waveSpawnQueue.length === 0 && !activeSummons && aliveEnemies === 0) {
      this.waveTransitionDelay += dt;
      if (this.waveTransitionDelay >= 1.1) {
        this.waveTransitionDelay = 0;
        this.totalWavesCleared++;
        this.paused = true;
        const choices = this.rollUpgradeChoices();
        this.callbacks.onUpgradePrompt(this.wave, choices);
      }
    }
  }

  private rollUpgradeChoices(): UpgradeCardDef[] {
    const taken = new Set(this.chosenUpgrades.map((u) => u.id));
    let available = this.upgradePool.filter((c) => !taken.has(c.id));
    if (available.length < 3) {
      // In deep Endless Gauntlet tiers, allow stacking upgrades cleanly
      available = [...this.upgradePool];
    }

    const selected: UpgradeCardDef[] = [];
    const mastery = available.find((c) => c.id === 'resonance_mastery' && !taken.has('resonance_mastery'));
    if (mastery) {
      selected.push(mastery);
    }

    const rest = available.filter((c) => c.id !== mastery?.id);
    while (selected.length < 3 && rest.length > 0) {
      const idx = Math.floor(this.rng.next() * rest.length);
      selected.push(rest.splice(idx, 1)[0]);
    }
    return selected;
  }

  private updateTelegraphs(dt: number): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const tz = this.telegraphs[i];
      tz.elapsed += dt;
      if (tz.elapsed >= tz.duration && !tz.triggered) {
        tz.triggered = true;
        if (tz.kind === 'summon' && tz.summonKind) {
          this.spawnEnemyImmediate(tz.summonKind, tz.x, tz.y);
        } else {
          soundEngine.playBossNova();
          this.addShake(tz.kind === 'boss_nova' || tz.kind === 'cinder_meteor' ? 7 : 5, 0.2);
          this.spawnVfx(
            'vfx_arcane_utility',
            tz.kind === 'cinder_meteor' ? 'cinder_meteor' : 'boss_nova',
            tz.x,
            tz.y,
            tz.radius / 38
          );
          const burstColor =
            tz.kind === 'spore_mortar'
              ? '#9BE870'
              : tz.kind === 'cinder_meteor'
                ? '#FF6B3D'
                : '#E96578';
          this.spawnParticleBurst(tz.x, tz.y, burstColor, 16, 175);
          if (!this.player.dead) {
            const dist = Math.hypot(this.player.x - tz.x, this.player.y - tz.y);
            if (dist <= tz.radius + this.player.radius * 0.6) {
              this.damagePlayer(tz.damage);
            }
          }
        }
        this.telegraphs.splice(i, 1);
      }
    }
  }

  private updateHazards(dt: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      hz.life -= dt;
      hz.tickAccum += dt;
      if (hz.tickAccum >= 0.45) {
        hz.tickAccum = 0;
        for (const e of this.enemies) {
          if (e.dead || e.bossTransitioning) continue;
          if (Math.hypot(e.x - hz.x, e.y - hz.y) <= hz.radius + e.radius) {
            if (hz.kind === 'chrono') {
              e.slowTimer = Math.max(e.slowTimer, 1.0);
            }
            this.damageEnemy(e, Math.max(8, Math.round(hz.dps * 0.45)), 'dot', false);
          }
        }
      }
      if (hz.life <= 0) {
        this.hazards.splice(i, 1);
      }
    }
  }

  private updateEnemies(dt: number): void {
    const cadence = this.getTierCadenceScale();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.animTime += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt);

      if (e.dead) {
        e.deathTimer -= dt;
        if (e.deathTimer <= 0) {
          this.enemies.splice(i, 1);
        }
        continue;
      }

      if (e.primedTimer > 0) {
        e.primedTimer -= dt;
        if (e.primedTimer <= 0) e.primedSchool = null;
      }
      if (e.dotTimer > 0) {
        e.dotTimer -= dt;
        e.dotTickAccum += dt;
        if (e.dotTickAccum >= 0.55) {
          e.dotTickAccum = 0;
          const tickDmg = Math.round((11 + this.modifiers.dotDpsBonus * 0.55) * this.mageClass.spellPower);
          this.damageEnemy(e, tickDmg, 'dot', false);
          this.spawnParticleBurst(e.x, e.y - 16, e.dotColor, 3, 55);
          if (e.dead) continue;
        }
      }
      if (e.slowTimer > 0) e.slowTimer -= dt;
      if (e.fractureTimer > 0) e.fractureTimer -= dt;

      if (Math.abs(e.vx) > 2 || Math.abs(e.vy) > 2) {
        const res = this.resolveArenaCollision(e.x + e.vx * dt, e.y + e.vy * dt, e.radius);
        e.x = res.x;
        e.y = res.y;
        e.vx *= Math.pow(0.05, dt);
        e.vy *= Math.pow(0.05, dt);
      }

      if (e.staggerTimer > 0) {
        e.staggerTimer -= dt;
        e.state = 'hit';
        continue;
      }

      if (e.bossTransitioning) {
        e.bossTransitionTimer -= dt;
        e.state = 'phase_transition';
        if (e.bossTransitionTimer <= 0) {
          e.bossTransitioning = false;
          e.attackCooldown = 0.75;
        }
        continue;
      }

      if (this.player.dead) {
        e.state = 'idle';
        continue;
      }

      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      e.dir = this.getDirectionFromVector(dx, dy);

      const slowMult = e.slowTimer > 0 ? Math.max(0.4, 0.64 - this.modifiers.slowBonus) : 1;
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);

      switch (e.kind) {
        case 'boss':
          this.updateBossAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'cultist':
          this.updateCultistAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'shieldbone':
          this.updateShieldboneAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'necromancer':
          this.updateNecromancerAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'wraith':
          this.updateWraithAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'bone_archer':
          this.updateBoneArcherAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'flesh_construct':
        case 'obsidian_golem':
          this.updateFleshConstructAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'ember_hound':
          this.updateEmberHoundAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'ash_pyromancer':
          this.updateAshPyromancerAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'void_stalker':
          this.updateVoidStalkerAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'starlight_sentinel':
          this.updateStarlightSentinelAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
        case 'plaguebearer':
        case 'skeleton':
        default:
          this.updateMeleeChaserAI(e, dx, dy, dist, slowMult, cadence, dt);
          break;
      }
    }

    // Soft enemy separation
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius;
        if (d < min && d > 0.01) {
          const push = (min - d) * 0.35;
          const nx = dx / d;
          const ny = dy / d;
          if (a.kind !== 'boss') {
            a.x -= nx * push;
            a.y -= ny * push;
          }
          if (b.kind !== 'boss') {
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }
  }

  private updateMeleeChaserAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 1.2 * cadence;
        if (dist <= e.radius + this.player.radius + 36) {
          this.damagePlayer(e.damage);
        }
      }
      return;
    }

    if (dist <= 50 && e.attackCooldown <= 0) {
      e.windupTimer = 0.36;
      e.animTime = 0;
      return;
    }

    if (dist > 34) {
      const spd = e.speed * slowMult;
      const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else {
      e.state = 'idle';
    }
  }

  private updateCultistAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 2.05 * cadence;
        const a = Math.atan2(dy, dx);
        this.projectiles.push({
          id: this.nextId++,
          owner: 'enemy',
          school: 'cultist',
          color: '#E96578',
          x: e.x + Math.cos(a) * 18,
          y: e.y - 10 + Math.sin(a) * 18,
          vx: Math.cos(a) * 265,
          vy: Math.sin(a) * 265,
          radius: 9,
          damage: e.damage,
          life: 2.5,
          pierce: 1,
          homing: false,
          hitIds: new Set(),
          animTimer: 0,
        });
      }
      return;
    }

    if (dist < 340 && e.attackCooldown <= 0) {
      e.windupTimer = 0.52;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * slowMult;
    if (dist > 260) {
      const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else if (dist < 145) {
      const res = this.resolveArenaCollision(e.x - (dx / dist) * spd * 0.7 * dt, e.y - (dy / dist) * spd * 0.7 * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else {
      e.state = 'idle';
    }
  }

  private updateShieldboneAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.chargeTime > 0) {
      e.chargeTime -= dt;
      e.state = 'attack';
      const chargeSpeed = 315 * slowMult;
      const res = this.resolveArenaCollision(
        e.x + e.aimDirX * chargeSpeed * dt,
        e.y + e.aimDirY * chargeSpeed * dt,
        e.radius
      );
      e.x = res.x;
      e.y = res.y;
      if (Math.hypot(this.player.x - e.x, this.player.y - e.y) <= e.radius + this.player.radius + 8) {
        this.damagePlayer(e.damage);
        e.chargeTime = 0;
      }
      if (res.hitWall) e.chargeTime = 0;
      return;
    }

    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.chargeTime = 0.45;
        e.attackCooldown = 2.35 * cadence;
        e.animTime = 0;
      }
      return;
    }

    if (dist < 225 && e.attackCooldown <= 0) {
      e.windupTimer = 0.55;
      e.aimDirX = dx / dist;
      e.aimDirY = dy / dist;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * slowMult;
    const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
    e.x = res.x;
    e.y = res.y;
    e.state = 'walk';
  }

  private updateNecromancerAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 2.6 * cadence;
        const aliveMinions = this.enemies.filter((m) => !m.dead && m.kind !== 'boss').length;
        if (aliveMinions < 6 && this.rng.next() < 0.45) {
          this.queueSummonEnemy('skeleton', false);
          this.spawnText(e.x, e.y - 36, 'SUMMON', '#A991F7', 10);
        } else {
          const base = Math.atan2(dy, dx);
          for (const offset of [-0.18, 0.18]) {
            const a = base + offset;
            this.projectiles.push({
              id: this.nextId++,
              owner: 'enemy',
              school: 'void_orb',
              color: '#A991F7',
              x: e.x + Math.cos(a) * 18,
              y: e.y - 10 + Math.sin(a) * 18,
              vx: Math.cos(a) * 245,
              vy: Math.sin(a) * 245,
              radius: 9,
              damage: e.damage,
              life: 2.6,
              pierce: 1,
              homing: false,
              hitIds: new Set(),
              animTimer: 0,
            });
          }
        }
      }
      return;
    }

    if (dist < 380 && e.attackCooldown <= 0) {
      e.windupTimer = 0.58;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * slowMult;
    if (dist > 290) {
      const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else if (dist < 165) {
      const res = this.resolveArenaCollision(e.x - (dx / dist) * spd * 0.7 * dt, e.y - (dy / dist) * spd * 0.7 * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else {
      e.state = 'idle';
    }
  }

  private updateWraithAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    e.aiTimer -= dt;
    if (e.aiTimer <= 0 && dist > 130 && dist < 340) {
      // Phase-blink closer to flank the mage
      e.aiTimer = 3.2 * cadence;
      this.spawnVfx('vfx_arcane_utility', 'blink', e.x, e.y - 8, 0.8);
      const jumpDist = Math.min(130, dist - 55);
      const side = (Math.random() < 0.5 ? 1 : -1) * 0.4;
      const a = Math.atan2(dy, dx) + side;
      const res = this.resolveArenaCollision(e.x + Math.cos(a) * jumpDist, e.y + Math.sin(a) * jumpDist, e.radius);
      e.x = res.x;
      e.y = res.y;
      this.spawnVfx('vfx_arcane_utility', 'blink', e.x, e.y - 8, 0.85);
    }

    this.updateMeleeChaserAI(e, dx, dy, dist, slowMult, cadence, dt);
  }

  private updateBoneArcherAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 2.0 * cadence;
        const a = Math.atan2(e.aimDirY, e.aimDirX);
        this.projectiles.push({
          id: this.nextId++,
          owner: 'enemy',
          school: 'arrow',
          color: '#E8E1D5',
          x: e.x + Math.cos(a) * 18,
          y: e.y - 10 + Math.sin(a) * 18,
          vx: Math.cos(a) * 385,
          vy: Math.sin(a) * 385,
          radius: 7,
          damage: e.damage,
          life: 2.2,
          pierce: 1,
          homing: false,
          hitIds: new Set(),
          animTimer: 0,
        });
      }
      return;
    }

    if (dist < 420 && e.attackCooldown <= 0) {
      e.windupTimer = 0.62;
      e.aimDirX = dx / dist;
      e.aimDirY = dy / dist;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * slowMult;
    if (dist > 310) {
      const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else if (dist < 170) {
      const res = this.resolveArenaCollision(e.x - (dx / dist) * spd * 0.78 * dt, e.y - (dy / dist) * spd * 0.78 * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else {
      e.state = 'idle';
    }
  }

  private updateFleshConstructAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 2.45 * cadence;
        this.telegraphs.push({
          id: this.nextId++,
          x: e.x,
          y: e.y,
          radius: e.kind === 'obsidian_golem' ? 92 : 82,
          elapsed: 0,
          duration: 0.55,
          damage: e.damage,
          kind: e.kind === 'obsidian_golem' ? 'cinder_meteor' : 'construct_slam',
          triggered: false,
        });
      }
      return;
    }

    if (dist < 95 && e.attackCooldown <= 0) {
      e.windupTimer = 0.45;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * slowMult;
    const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
    e.x = res.x;
    e.y = res.y;
    e.state = 'walk';
  }

  private updateEmberHoundAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 1.65 * cadence;
        // Fiery forward pounce along locked aim vector
        e.vx += e.aimDirX * 420;
        e.vy += e.aimDirY * 420;
        this.spawnParticleBurst(e.x, e.y - 6, '#FF6B3D', 10, 140);
        if (dist <= e.radius + this.player.radius + 54) {
          this.damagePlayer(e.damage);
        }
      }
      return;
    }

    if (dist < 155 && e.attackCooldown <= 0) {
      e.windupTimer = 0.34;
      e.aimDirX = dx / dist;
      e.aimDirY = dy / dist;
      e.animTime = 0;
      return;
    }

    // Agile flanking sprint
    const flankAngle = Math.atan2(dy, dx) + Math.sin(this.worldTime * 3 + e.id) * 0.35;
    const spd = e.speed * slowMult;
    const res = this.resolveArenaCollision(
      e.x + Math.cos(flankAngle) * spd * dt,
      e.y + Math.sin(flankAngle) * spd * dt,
      e.radius
    );
    e.x = res.x;
    e.y = res.y;
    e.state = 'walk';
  }

  private updateAshPyromancerAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 2.35 * cadence;
        const base = Math.atan2(dy, dx);
        for (const offset of [-0.24, 0, 0.24]) {
          const a = base + offset;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'enemy',
            school: 'cinder_orb',
            color: '#FF6B3D',
            x: e.x + Math.cos(a) * 18,
            y: e.y - 10 + Math.sin(a) * 18,
            vx: Math.cos(a) * 265,
            vy: Math.sin(a) * 265,
            radius: 9,
            damage: e.damage,
            life: 2.4,
            pierce: 1,
            homing: false,
            hitIds: new Set(),
            animTimer: 0,
          });
        }
        this.spawnVfx('vfx_fire', 'cast_charge', e.x, e.y - 10, 0.72);
      }
      return;
    }

    if (dist < 380 && e.attackCooldown <= 0) {
      e.windupTimer = 0.56;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * slowMult;
    if (dist > 280) {
      const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else if (dist < 170) {
      const res = this.resolveArenaCollision(e.x - (dx / dist) * spd * 0.75 * dt, e.y - (dy / dist) * spd * 0.75 * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else {
      e.state = 'idle';
    }
  }

  private updateVoidStalkerAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    e.aiTimer -= dt;
    if (e.aiTimer <= 0 && dist > 110 && dist < 390) {
      // Phase-blink ambush behind the player
      e.aiTimer = 2.8 * cadence;
      this.spawnVfx('vfx_arcane_utility', 'blink', e.x, e.y - 8, 0.85);
      const behindAngle = Math.atan2(dy, dx) + Math.PI * 0.08 * (e.id % 2 === 0 ? 1 : -1);
      const targetX = this.player.x + Math.cos(behindAngle) * 62;
      const targetY = this.player.y + Math.sin(behindAngle) * 62;
      const res = this.resolveArenaCollision(targetX, targetY, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.windupTimer = 0.28;
      e.animTime = 0;
      this.spawnVfx('vfx_arcane_utility', 'blink', e.x, e.y - 8, 0.9);
      return;
    }

    this.updateMeleeChaserAI(e, dx, dy, dist, slowMult, cadence, dt);
  }

  private updateStarlightSentinelAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        e.state = 'attack';
        e.animTime = 0;
        e.attackCooldown = 2.2 * cadence;
        const base = Math.atan2(dy, dx);
        for (let i = 0; i < 4; i++) {
          const a = base + (i * Math.PI) / 2;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'enemy',
            school: 'astral_lance',
            color: '#7C9BFF',
            x: e.x + Math.cos(a) * 18,
            y: e.y - 10 + Math.sin(a) * 18,
            vx: Math.cos(a) * 290,
            vy: Math.sin(a) * 290,
            radius: 8,
            damage: e.damage,
            life: 2.5,
            pierce: 1,
            homing: false,
            hitIds: new Set(),
            animTimer: 0,
          });
        }
        this.spawnParticleBurst(e.x, e.y - 10, '#7C9BFF', 10, 125);
      }
      return;
    }

    if (dist < 410 && e.attackCooldown <= 0) {
      e.windupTimer = 0.52;
      e.animTime = 0;
      return;
    }

    // Floating orbital strafe around the mage
    const orbitAngle = Math.atan2(dy, dx) + (e.id % 2 === 0 ? Math.PI * 0.44 : -Math.PI * 0.44);
    const radialBias = dist > 265 ? 0.55 : dist < 175 ? -0.55 : 0;
    const spd = e.speed * slowMult;
    const vx = (Math.cos(orbitAngle) + (dx / dist) * radialBias) * spd;
    const vy = (Math.sin(orbitAngle) + (dy / dist) * radialBias) * spd;
    const res = this.resolveArenaCollision(e.x + vx * dt, e.y + vy * dt, e.radius);
    e.x = res.x;
    e.y = res.y;
    e.state = 'walk';
  }

  private updateBossAI(
    e: EnemyEntity,
    dx: number,
    dy: number,
    dist: number,
    slowMult: number,
    cadence: number,
    dt: number
  ): void {
    const phase2 = e.bossPhase === 2;
    if (e.windupTimer > 0) {
      e.windupTimer -= dt;
      e.state = 'windup';
      if (e.windupTimer <= 0) {
        this.executeBossAttack(e, dx, dy, cadence);
      }
      return;
    }

    if (e.attackCooldown <= 0) {
      e.windupTimer = (phase2 ? 0.5 : 0.66) * cadence;
      e.animTime = 0;
      return;
    }

    const spd = e.speed * (phase2 ? 1.24 : 1) * slowMult;
    if (dist > 205) {
      const res = this.resolveArenaCollision(e.x + (dx / dist) * spd * dt, e.y + (dy / dist) * spd * dt, e.radius);
      e.x = res.x;
      e.y = res.y;
      e.state = 'walk';
    } else {
      e.state = 'idle';
    }
  }

  private executeBossAttack(e: EnemyEntity, dx: number, dy: number, cadence: number): void {
    const phase2 = e.bossPhase === 2;
    const pattern = e.bossPatternIndex % 3;
    e.bossPatternIndex++;
    e.animTime = 0;

    const biome = BIOMES[this.biomeId];
    const bossId = e.bossId ?? 'bone_regent';

    if (pattern === 0) {
      // Signature Barrage (Bone Spears / Void Spiral / Spore Volley / Cinder Fan / Astral Starlight Ring)
      e.state = 'attack';
      e.attackCooldown = (phase2 ? 1.45 : 2.0) * cadence;
      const baseAngle = Math.atan2(dy, dx);
      const isRadial = bossId === 'rift_leviathan' || bossId === 'astral_sovereign';
      const count =
        bossId === 'astral_sovereign'
          ? phase2
            ? 12
            : 8
          : bossId === 'cinder_archon'
            ? phase2
              ? 9
              : 6
            : bossId === 'rift_leviathan'
              ? phase2
                ? 9
                : 6
              : phase2
                ? 7
                : 5;
      const spread = isRadial ? (Math.PI * 2) / count : bossId === 'cinder_archon' ? 0.2 : 0.23;
      const projKind: ProjectileKind =
        bossId === 'cinder_archon'
          ? 'cinder_orb'
          : bossId === 'astral_sovereign'
            ? 'astral_lance'
            : bossId === 'rift_leviathan'
              ? 'void_orb'
              : bossId === 'blight_colossus'
                ? 'spore_glob'
                : 'bone_spear';
      const projColor =
        bossId === 'cinder_archon'
          ? '#FF6B3D'
          : bossId === 'astral_sovereign'
            ? '#7C9BFF'
            : bossId === 'rift_leviathan'
              ? '#58D6C2'
              : bossId === 'blight_colossus'
                ? '#9BE870'
                : '#FAF6EE';

      for (let i = 0; i < count; i++) {
        const a = isRadial
          ? baseAngle + i * spread
          : baseAngle + (i - (count - 1) / 2) * spread;
        const speed =
          bossId === 'astral_sovereign'
            ? phase2
              ? 345
              : 295
            : bossId === 'blight_colossus'
              ? 255
              : phase2
                ? 325
                : 275;
        this.projectiles.push({
          id: this.nextId++,
          owner: 'enemy',
          school: projKind,
          color: projColor,
          x: e.x + Math.cos(a) * 34,
          y: e.y - 14 + Math.sin(a) * 34,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          radius: 10,
          damage: Math.round((phase2 ? 25 : 20) * this.getTierDmgScale()),
          life: 2.9,
          pierce: 1,
          homing: false,
          hitIds: new Set(),
          animTimer: 0,
        });
      }
      soundEngine.playFireCast();
    } else if (pattern === 1) {
      // Telegraphed Tyrant Nova + Phase 2 Targeted Pillars / Meteors / Chronal Wells
      e.state = 'signature';
      e.attackCooldown = (phase2 ? 1.75 : 2.3) * cadence;

      if (bossId === 'rift_leviathan' || bossId === 'astral_sovereign') {
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 400 && dist > 90) {
          const pullStrength = bossId === 'astral_sovereign' ? 62 : 52;
          const pull = this.resolveArenaCollision(
            this.player.x - (dx / dist) * pullStrength,
            this.player.y - (dy / dist) * pullStrength,
            this.player.radius
          );
          this.player.x = pull.x;
          this.player.y = pull.y;
          this.spawnText(
            this.player.x,
            this.player.y - 36,
            bossId === 'astral_sovereign' ? 'GRAVITY WELL!' : 'VOID PULL!',
            bossId === 'astral_sovereign' ? '#7C9BFF' : '#58D6C2',
            12
          );
        }
      }

      this.telegraphs.push({
        id: this.nextId++,
        x: e.x,
        y: e.y,
        radius:
          bossId === 'cinder_archon'
            ? phase2
              ? 190
              : 158
            : bossId === 'blight_colossus'
              ? phase2
                ? 185
                : 155
              : phase2
                ? 165
                : 140,
        elapsed: 0,
        duration: phase2 ? 0.92 : 1.12,
        damage: Math.round((phase2 ? 34 : 28) * this.getTierDmgScale()),
        kind:
          bossId === 'cinder_archon'
            ? 'cinder_meteor'
            : bossId === 'blight_colossus'
              ? 'spore_mortar'
              : 'boss_nova',
        triggered: false,
      });

      const pillarCount =
        bossId === 'cinder_archon'
          ? phase2
            ? 4
            : 2
          : phase2
            ? 3
            : bossId === 'blight_colossus' || bossId === 'astral_sovereign'
              ? 2
              : 0;
      for (let k = 0; k < pillarCount; k++) {
        const offsetAngle = (k / Math.max(1, pillarCount)) * Math.PI * 2 + this.worldTime;
        const dist = k === 0 ? 0 : 106;
        const tx = Math.max(100, Math.min(this.arena.width - 100, this.player.x + Math.cos(offsetAngle) * dist));
        const ty = Math.max(100, Math.min(this.arena.height - 100, this.player.y + Math.sin(offsetAngle) * dist));
        this.telegraphs.push({
          id: this.nextId++,
          x: tx,
          y: ty,
          radius: 70,
          elapsed: 0,
          duration: 0.98 + k * 0.14,
          damage: Math.round(26 * this.getTierDmgScale()),
          kind:
            bossId === 'cinder_archon'
              ? 'cinder_meteor'
              : bossId === 'blight_colossus'
                ? 'spore_mortar'
                : 'rift_pillar',
          triggered: false,
        });
      }
    } else {
      // Summon biome-native minions or drop targeted Rift / Meteor Pillar
      e.state = 'signature';
      e.attackCooldown = (phase2 ? 1.75 : 2.3) * cadence;
      const minionCount = this.enemies.filter((m) => !m.dead && m.kind !== 'boss').length;
      if (minionCount < (phase2 ? 4 : 3)) {
        this.queueSummonEnemy(biome.wave3Adds[0], true);
        this.queueSummonEnemy(biome.wave3Adds[phase2 ? 1 : 0], true);
        const callout =
          bossId === 'cinder_archon'
            ? 'BURN IN THE FOUNDRY!'
            : bossId === 'astral_sovereign'
              ? 'SHATTER THE STARS!'
              : bossId === 'rift_leviathan'
                ? 'THE VOID ANSWERS!'
                : bossId === 'blight_colossus'
                  ? 'BLOOM, ROTSPAWN!'
                  : 'RISE, MY LEGION!';
        this.spawnText(e.x, e.y - 78, callout, biome.accentColor, 14);
      } else {
        this.telegraphs.push({
          id: this.nextId++,
          x: this.player.x,
          y: this.player.y,
          radius: 80,
          elapsed: 0,
          duration: 0.9,
          damage: Math.round(26 * this.getTierDmgScale()),
          kind: bossId === 'cinder_archon' ? 'cinder_meteor' : 'rift_pillar',
          triggered: false,
        });
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.animTimer += dt;

      // Gentle homing steering for Arcane / Time homing projectiles
      if (p.homing && p.owner === 'player') {
        let nearest: EnemyEntity | null = null;
        let bestDist = 260;
        for (const e of this.enemies) {
          if (e.dead || e.bossTransitioning || p.hitIds.has(e.id)) continue;
          const d = Math.hypot(e.x - p.x, e.y - 12 - p.y);
          if (d < bestDist) {
            bestDist = d;
            nearest = e;
          }
        }
        if (nearest) {
          const speed = Math.hypot(p.vx, p.vy) || 550;
          const desired = Math.atan2(nearest.y - 12 - p.y, nearest.x - p.x);
          const current = Math.atan2(p.vy, p.vx);
          let diff = desired - current;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const nextAngle = current + Math.max(-4.8 * dt, Math.min(4.8 * dt, diff));
          p.vx = Math.cos(nextAngle) * speed;
          p.vy = Math.sin(nextAngle) * speed;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      let hitSolid =
        p.x < this.arena.tileSize ||
        p.x > this.arena.width - this.arena.tileSize ||
        p.y < this.arena.tileSize ||
        p.y > this.arena.height - this.arena.tileSize;

      if (!hitSolid) {
        for (const obs of this.arena.obstacles) {
          if (!obs.blocksProjectiles) continue;
          if (Math.hypot(p.x - obs.x, p.y - obs.y) <= obs.radius + p.radius * 0.6) {
            hitSolid = true;
            break;
          }
        }
      }

      if (hitSolid) {
        if (p.school === 'fire') this.spawnVfx('vfx_fire', 'impact', p.x, p.y, 0.85);
        else if (p.school === 'ice') this.spawnVfx('vfx_ice', 'impact', p.x, p.y, 0.85);
        else this.spawnParticleBurst(p.x, p.y, p.color, 6, 95);
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.owner === 'player') {
        let destroyed = false;
        for (const e of this.enemies) {
          if (e.dead || e.bossTransitioning || p.hitIds.has(e.id)) continue;
          if (Math.hypot(p.x - e.x, p.y - (e.y - 12)) <= e.radius + p.radius) {
            p.hitIds.add(e.id);
            p.pierce--;
            if (p.school === 'fire') {
              this.spawnVfx('vfx_fire', e.kind === 'boss' ? 'aoe_burst' : 'impact', p.x, p.y, 1.08);
            } else if (p.school === 'ice') {
              this.spawnVfx('vfx_ice', e.kind === 'boss' ? 'aoe_burst' : 'impact', p.x, p.y, 1.04);
            } else {
              this.spawnVfx('vfx_fire', 'impact', p.x, p.y, 0.78);
            }
            this.spawnParticleBurst(p.x, p.y, p.color, 9, 130);

            const dmgSource = p.school === 'shrapnel' ? 'utility' : (p.school as SchoolId);
            const schoolDef = dmgSource !== 'utility' ? SCHOOL_DEFS[dmgSource] : null;
            const isHeavyHit = e.kind === 'boss' || p.damage >= 58;
            this.emitSpellFxEvent({
              type: e.kind === 'boss' ? 'boss_impact' : isHeavyHit ? 'crit' : 'hit',
              school: dmgSource,
              worldX: p.x,
              worldY: p.y,
              dirX: p.vx,
              dirY: p.vy,
              intensityTier: e.kind === 'boss' || isHeavyHit ? 2 : 1,
              primaryColor: schoolDef?.color ?? p.color,
              secondaryColor: schoolDef?.secondaryColor,
            });

            // Wind / Earth knockback
            if ((p.school === 'wind' || p.school === 'earth') && e.kind !== 'boss') {
              const spd = Math.hypot(p.vx, p.vy) || 1;
              e.vx += (p.vx / spd) * 190;
              e.vy += (p.vy / spd) * 190;
            }

            this.damageEnemy(e, p.damage, dmgSource, false);

            if (p.pierce <= 0) {
              destroyed = true;
              break;
            }
          }
        }
        if (destroyed) {
          this.projectiles.splice(i, 1);
        }
      } else if (!this.player.dead) {
        if (Math.hypot(p.x - this.player.x, p.y - (this.player.y - 10)) <= this.player.radius + p.radius) {
          this.damagePlayer(p.damage);
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.bobPhase += dt * 4;
      const dx = this.player.x - pk.x;
      const dy = this.player.y - pk.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 140 && dist > 1) {
        const pull = 285 * (1 - dist / 140);
        pk.x += (dx / dist) * pull * dt;
        pk.y += (dy / dist) * pull * dt;
      }

      if (dist <= this.player.radius + 16) {
        if (pk.kind === 'shard') {
          this.shards += pk.value;
          this.score += 35;
          soundEngine.playPickup(true);
          this.spawnText(pk.x, pk.y - 16, `+${pk.value} Shards`, '#A991F7', 11);
        } else if (pk.kind === 'gold') {
          this.gold += pk.value;
          this.score += 20;
          soundEngine.playPickup(false);
          this.spawnText(pk.x, pk.y - 16, `+${pk.value}g`, '#D9BA72', 11);
        } else if (pk.kind === 'aether') {
          this.player.aether = Math.min(this.player.maxAether, this.player.aether + pk.value);
          soundEngine.playPickup(false);
          this.spawnText(pk.x, pk.y - 16, `+${pk.value} Aether`, '#58D6C2', 11);
        } else {
          if (this.player.hp < this.player.maxHp * 0.88) {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + pk.value);
            this.spawnText(pk.x, pk.y - 16, `+${pk.value} HP`, '#E96578', 11);
          } else {
            this.player.potions = Math.min(5, this.player.potions + 1);
            this.spawnText(pk.x, pk.y - 16, '+1 Vial', '#E96578', 11);
          }
          soundEngine.playPickup(true);
        }
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateVfxAndParticles(dt: number): void {
    for (let i = this.vfx.length - 1; i >= 0; i--) {
      const v = this.vfx[i];
      v.frame += v.fps * dt;
      if (v.frame >= v.frameCount) this.vfx.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].life -= dt;
      if (this.bolts[i].life <= 0) this.bolts.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.pow(0.18, dt);
      pt.vy *= Math.pow(0.18, dt);
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const tx = this.texts[i];
      tx.life -= dt;
      tx.y += tx.vy * dt;
      if (tx.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.blinkGhosts.length - 1; i >= 0; i--) {
      this.blinkGhosts[i].life -= dt;
      if (this.blinkGhosts[i].life <= 0) this.blinkGhosts.splice(i, 1);
    }
  }

  private updateCamera(dt: number): void {
    const { vw, vh } = this.getViewportSize();
    const targetX = Math.max(0, Math.min(this.arena.width - vw, this.player.x - vw / 2));
    const targetY = Math.max(0, Math.min(this.arena.height - vh, this.player.y - vh / 2));
    const lerp = 1 - Math.pow(0.001, dt);
    this.camera.x += (targetX - this.camera.x) * lerp;
    this.camera.y += (targetY - this.camera.y) * lerp;
  }

  private checkEndConditions(): void {
    if (this.runEnded || this.pendingBiomeTransition) return;
    if (this.bossSpawned && this.wave === this.maxWaves) {
      const bossAlive = this.enemies.some((e) => e.kind === 'boss');
      if (!bossAlive) {
        this.biomesCleared++;
        this.totalWavesCleared++;
        if (this.mode === 'gauntlet') {
          this.pendingBiomeTransition = true;
          this.paused = true;
          const nextBiome = getNextGauntletBiome(this.biomeId);
          const choices = this.rollUpgradeChoices();
          this.callbacks.onGauntletBiomeCleared(this.biomeId, nextBiome, this.gauntletTier + 1, choices);
        } else {
          this.finishRun(true);
        }
      }
    }
  }

  private finishRun(victory: boolean): void {
    this.runEnded = true;
    this.paused = true;
    const topResonances = Array.from(this.resonanceBreakdown.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    this.callbacks.onRunFinished({
      victory,
      mode: this.mode,
      biomeId: this.biomeId,
      biomeName: BIOMES[this.biomeId].name,
      biomesCleared: this.biomesCleared,
      gauntletTier: this.gauntletTier,
      classId: this.mageClass.id,
      className: this.mageClass.name,
      equippedSchools: [...this.equippedSchools] as [SchoolId, SchoolId, SchoolId],
      seed: this.seed,
      elapsedSec: Math.round(this.elapsedSec),
      wavesCleared: this.totalWavesCleared,
      kills: this.kills,
      resonanceCount: this.resonanceCount,
      topResonances,
      damageDealt: this.damageDealt,
      shards: this.shards,
      gold: this.gold,
      score: this.score + (victory ? 500 : 0) + this.biomesCleared * 350,
      upgrades: [...this.chosenUpgrades],
    });
  }

  private render(): void {
    const ctx = this.ctx;
    const { vw, vh } = this.getViewportSize();
    const biome = BIOMES[this.biomeId];
    const tileset = spriteRegistry.get(biome.tilesetAssetId);
    const icons = spriteRegistry.get('icons_pickups_schools');
    const mageAsset = spriteRegistry.get(this.mageClass.assetId);

    ctx.fillStyle = biome.ambientHex;
    ctx.fillRect(0, 0, vw, vh);

    const shakeX = this.shakeTime > 0 ? (Math.random() - 0.5) * this.shakeIntensity * 2 : 0;
    const shakeY = this.shakeTime > 0 ? (Math.random() - 0.5) * this.shakeIntensity * 2 : 0;

    ctx.save();
    ctx.translate(Math.round(-this.camera.x + shakeX), Math.round(-this.camera.y + shakeY));

    // 1. Floor & wall tiles
    if (tileset) {
      const startCol = Math.max(0, Math.floor(this.camera.x / this.arena.tileSize) - 1);
      const endCol = Math.min(this.arena.cols - 1, Math.ceil((this.camera.x + vw) / this.arena.tileSize) + 1);
      const startRow = Math.max(0, Math.floor(this.camera.y / this.arena.tileSize) - 1);
      const endRow = Math.min(this.arena.rows - 1, Math.ceil((this.camera.y + vh) / this.arena.tileSize) + 1);

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const tileIdx = this.arena.floorTiles[r * this.arena.cols + c];
          drawAtlasTile(ctx, tileset, tileIdx, c * this.arena.tileSize, r * this.arena.tileSize, 1);
        }
      }
    }

    // 2. Ambient portal glow
    const portalGrad = ctx.createRadialGradient(
      this.arena.portalPos.x,
      this.arena.portalPos.y + 10,
      10,
      this.arena.portalPos.x,
      this.arena.portalPos.y + 10,
      180
    );
    portalGrad.addColorStop(0, 'rgba(169, 145, 247, 0.34)');
    portalGrad.addColorStop(1, 'rgba(169, 145, 247, 0)');
    ctx.fillStyle = portalGrad;
    ctx.beginPath();
    ctx.arc(this.arena.portalPos.x, this.arena.portalPos.y + 10, 180, 0, Math.PI * 2);
    ctx.fill();

    // 3. Lingering resonance hazard & chrono zones
    for (const hz of this.hazards) {
      const alpha = Math.min(1, hz.life / 0.8);
      ctx.save();
      ctx.globalAlpha = 0.24 * alpha;
      ctx.fillStyle = hz.color;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.72 * alpha;
      ctx.strokeStyle = hz.kind === 'chrono' ? '#D9BA72' : hz.secondaryColor;
      ctx.lineWidth = 2;
      ctx.setLineDash(hz.kind === 'chrono' ? [8, 5] : [4, 4]);
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.radius, this.worldTime * 0.8, this.worldTime * 0.8 + Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Ground telegraphs
    this.renderTelegraphs(ctx);

    // 5. Player foot rune ring
    if (!this.player.dead) {
      const activeSchool = SCHOOL_DEFS[this.equippedSchools[this.player.activeSlotIndex]];
      ctx.save();
      ctx.strokeStyle = activeSchool.color;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.player.x, this.player.y + 4, 24, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(217, 186, 114, 0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(this.player.x, this.player.y + 4, 18, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Pickups
    if (icons) {
      for (const pk of this.pickups) {
        const iconIdx = pk.kind === 'health' ? 0 : pk.kind === 'aether' ? 1 : pk.kind === 'shard' ? 2 : 3;
        const bob = Math.sin(pk.bobPhase) * 3.5;
        ctx.fillStyle = 'rgba(10, 6, 18, 0.45)';
        ctx.beginPath();
        ctx.ellipse(pk.x, pk.y + 8, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        drawAtlasTile(ctx, icons, iconIdx, pk.x - 14, pk.y - 18 + bob, 0.88);
      }
    }

    // 7. Y-sorted entities
    type Renderable = { y: number; draw: () => void };
    const queue: Renderable[] = [];

    if (tileset) {
      const brazierFrame = Math.floor(this.worldTime * 6) % 2;
      const portalFrame = Math.floor(this.worldTime * 7) % 4;

      for (const prop of this.arena.decorProps) {
        queue.push({
          y: prop.y,
          draw: () => {
            const tile =
              prop.animated === 'brazier'
                ? 12 + brazierFrame
                : prop.animated === 'portal'
                  ? 14 + portalFrame
                  : prop.tileIndex;
            const sc = prop.scale ?? 1;
            drawAtlasTile(ctx, tileset, tile, prop.x - 32 * sc, prop.y - 52 * sc, sc);
          },
        });
      }

      for (const obs of this.arena.obstacles) {
        queue.push({
          y: obs.y,
          draw: () => {
            const tile = obs.animated === 'brazier' ? 12 + brazierFrame : obs.tileIndex;
            const sc = obs.scale ?? 1;
            drawAtlasTile(ctx, tileset, tile, obs.x - 32 * sc, obs.y - 52 * sc, sc);
            if (this.settings.showHitboxes) {
              ctx.strokeStyle = 'rgba(217, 186, 114, 0.65)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
              ctx.stroke();
            }
          },
        });
      }
    }

    if (mageAsset) {
      for (const gh of this.blinkGhosts) {
        queue.push({
          y: gh.y - 1,
          draw: () => {
            drawSpriteFrame(ctx, mageAsset, 'blink', gh.dir, 1, gh.x, gh.y + 8, 1.08, 0, (gh.life / gh.maxLife) * 0.55);
          },
        });
      }

      queue.push({
        y: this.player.y,
        draw: () => {
          const anim = mageAsset.animMap.get(`${this.player.state}:${this.player.dir}`) || mageAsset.manifest.animations[0];
          const frame = this.player.animTime * anim.fps;
          const alpha = this.player.invulnTimer > 0 && Math.floor(this.worldTime * 20) % 2 === 0 ? 0.62 : 1;
          drawSpriteFrame(ctx, mageAsset, this.player.state, this.player.dir, frame, this.player.x, this.player.y + 10, 1.12, 0, alpha);
          if (this.settings.showHitboxes) {
            ctx.strokeStyle = '#58D6C2';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this.player.x, this.player.y, this.player.radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        },
      });
    }

    for (const enemy of this.enemies) {
      const asset = spriteRegistry.get(enemy.assetId);
      if (!asset) continue;
      queue.push({
        y: enemy.y,
        draw: () => {
          const anim = asset.animMap.get(`${enemy.state}:${enemy.dir}`) || asset.manifest.animations[0];
          const frame = enemy.animTime * anim.fps;
          const sc = enemy.kind === 'boss' ? 1.25 : 1.08;

          // Sightline / charge telegraph for Shieldbone & Bone Archer
          if ((enemy.kind === 'shieldbone' || enemy.kind === 'bone_archer') && enemy.windupTimer > 0 && !enemy.dead) {
            const lineLen = enemy.kind === 'bone_archer' ? 320 : 150;
            ctx.save();
            ctx.strokeStyle = this.settings.highContrastTelegraphs ? '#FFE45E' : 'rgba(233, 101, 120, 0.72)';
            ctx.lineWidth = enemy.kind === 'bone_archer' ? 2 : 3;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(enemy.x, enemy.y - 6);
            ctx.lineTo(enemy.x + enemy.aimDirX * lineLen, enemy.y - 6 + enemy.aimDirY * lineLen);
            ctx.stroke();
            ctx.restore();
          }

          // Primed school aura ring under enemy
          if (!enemy.dead && enemy.primedSchool) {
            const pDef = SCHOOL_DEFS[enemy.primedSchool];
            ctx.save();
            ctx.strokeStyle = pDef.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(enemy.x, enemy.y + 4, enemy.radius + 7, (enemy.radius + 7) * 0.42, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          drawSpriteFrame(ctx, asset, enemy.state, enemy.dir, frame, enemy.x, enemy.y + 10, sc);

          if (!enemy.dead && enemy.kind !== 'boss') {
            const bw = 40;
            const bx = enemy.x - bw / 2;
            const by = enemy.y - 46;
            ctx.fillStyle = 'rgba(20, 14, 29, 0.85)';
            ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
            ctx.fillStyle = '#E96578';
            ctx.fillRect(bx, by, Math.max(0, (enemy.hp / enemy.maxHp) * bw), 4);

            if (enemy.primedSchool) {
              const pDef = SCHOOL_DEFS[enemy.primedSchool];
              ctx.font = '700 9px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillStyle = pDef.color;
              ctx.fillText(pDef.statusTag, enemy.x, by - 4);
            }
          }

          if (this.settings.showHitboxes && !enemy.dead) {
            ctx.strokeStyle = '#E96578';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        },
      });
    }

    queue.sort((a, b) => a.y - b.y);
    for (const item of queue) item.draw();

    // 8. Projectiles (all 13 schools + enemy projectiles, honoring PVFX Lit vs Strict tier)
    const tier = this.settings.vfxStyleTier;
    const vfxFire = spriteRegistry.get(resolveVfxAssetId('vfx_fire', tier));
    const vfxIce = spriteRegistry.get(resolveVfxAssetId('vfx_ice', tier));
    const vfxExt = spriteRegistry.get(resolveVfxAssetId('vfx_schools_extended', tier));
    const vfxUtil = spriteRegistry.get(resolveVfxAssetId('vfx_arcane_utility', tier));

    for (const p of this.projectiles) {
      const rot = Math.atan2(p.vy, p.vx);
      if (p.school === 'fire' && vfxFire) {
        drawSpriteFrame(ctx, vfxFire, 'projectile', 'down', p.animTimer * 14, p.x, p.y, 0.96, rot);
      } else if (p.school === 'ice' && vfxIce) {
        drawSpriteFrame(ctx, vfxIce, 'projectile', 'down', p.animTimer * 14, p.x, p.y, 0.96, rot);
      } else if (p.school === 'cinder_orb' && vfxFire) {
        drawSpriteFrame(ctx, vfxFire, 'projectile', 'down', p.animTimer * 14, p.x, p.y, 0.8, rot);
      } else if (p.school === 'astral_lance' && vfxUtil) {
        drawSpriteFrame(ctx, vfxUtil, 'astral_lance', 'down', p.animTimer * 14, p.x, p.y, 0.88, rot);
      } else if (
        p.owner === 'player' &&
        p.school !== 'shrapnel' &&
        p.school !== 'lightning' &&
        vfxExt
      ) {
        const def = SCHOOL_DEFS[p.school as SchoolId];
        drawSpriteFrame(ctx, vfxExt, def.vfxState, 'down', p.animTimer * 14, p.x, p.y, 0.94, rot);
      } else if (p.school === 'cultist' && vfxUtil) {
        drawSpriteFrame(ctx, vfxUtil, 'cultist_orb', 'down', p.animTimer * 12, p.x, p.y, 0.72, 0);
      } else if (p.school === 'arrow') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.fillStyle = '#140E1D';
        ctx.fillRect(-13, -3, 24, 6);
        ctx.fillStyle = '#E8E1D5';
        ctx.fillRect(-11, -1, 20, 2);
        ctx.fillStyle = '#58D6C2';
        ctx.fillRect(7, -2, 5, 4);
        ctx.restore();
      } else if (p.school === 'void_orb' || p.school === 'spore_glob') {
        ctx.save();
        ctx.fillStyle = '#140E1D';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FAF6EE';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        // Bone spear or shrapnel shard
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.fillStyle = '#140E1D';
        ctx.fillRect(-14, -4, 26, 8);
        ctx.fillStyle = p.color;
        ctx.fillRect(-11, -2, 22, 4);
        ctx.fillStyle = '#FAF6EE';
        ctx.fillRect(6, -2, 6, 4);
        ctx.restore();
      }
    }

    // 9. Chain Bolts
    for (const bolt of this.bolts) {
      const alpha = bolt.life / bolt.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      bolt.points.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();

      ctx.strokeStyle = bolt.coreColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      bolt.points.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
      ctx.restore();
    }

    // 10. Animated Sprite VFX Overlays
    for (const v of this.vfx) {
      const asset = spriteRegistry.get(v.assetId);
      if (asset) {
        drawSpriteFrame(ctx, asset, v.state, 'down', v.frame, v.x, v.y, v.scale, v.rotation);
      }
    }

    // 11. Pixel Particles
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // 12. Floating Combat Text
    for (const tx of this.texts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (tx.life / tx.maxLife) * 1.4);
      ctx.font = `700 ${tx.size}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#140E1D';
      ctx.fillText(tx.text, Math.round(tx.x) + 1, Math.round(tx.y) + 1);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, Math.round(tx.x), Math.round(tx.y));
      ctx.restore();
    }

    // 13. Aim Reticle
    if (!this.paused && !this.player.dead) {
      const rx = Math.round(this.mouseWorld.x);
      const ry = Math.round(this.mouseWorld.y);
      const retColor = SCHOOL_DEFS[this.equippedSchools[this.player.activeSlotIndex]].color;
      ctx.save();
      ctx.strokeStyle = retColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rx - 14, ry);
      ctx.lineTo(rx - 5, ry);
      ctx.moveTo(rx + 5, ry);
      ctx.lineTo(rx + 14, ry);
      ctx.moveTo(rx, ry - 14);
      ctx.lineTo(rx, ry - 5);
      ctx.moveTo(rx, ry + 5);
      ctx.lineTo(rx, ry + 14);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // Subtle biome atmosphere tint & dark vignette
    ctx.fillStyle = biome.fogTint;
    ctx.fillRect(0, 0, vw, vh);

    const vig = ctx.createRadialGradient(
      vw / 2,
      vh / 2,
      Math.min(vw, vh) * 0.36,
      vw / 2,
      vh / 2,
      Math.max(vw, vh) * 0.72
    );
    vig.addColorStop(0, 'rgba(23, 19, 33, 0)');
    vig.addColorStop(1, 'rgba(13, 9, 20, 0.56)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, vw, vh);
  }

  private renderTelegraphs(ctx: CanvasRenderingContext2D): void {
    const hc = this.settings.highContrastTelegraphs;
    for (const tz of this.telegraphs) {
      const progress = Math.min(1, tz.elapsed / tz.duration);
      ctx.save();
      if (tz.kind === 'summon') {
        ctx.strokeStyle = hc ? '#58D6C2' : 'rgba(169, 145, 247, 0.85)';
        ctx.fillStyle = 'rgba(169, 145, 247, 0.14)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tz.x, tz.y, tz.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tz.x, tz.y, tz.radius * (1 - progress * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const isSpore = tz.kind === 'spore_mortar';
        ctx.fillStyle = hc
          ? `rgba(255, 224, 94, ${0.18 + progress * 0.28})`
          : isSpore
            ? `rgba(155, 232, 112, ${0.12 + progress * 0.22})`
            : `rgba(233, 101, 120, ${0.12 + progress * 0.24})`;
        ctx.strokeStyle = hc ? '#FFE05E' : isSpore ? '#9BE870' : '#E96578';
        ctx.lineWidth = hc ? 3 : 2;
        ctx.beginPath();
        ctx.arc(tz.x, tz.y, tz.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = hc ? '#FFFFFF' : '#D9BA72';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tz.x, tz.y, tz.radius * progress, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private computeResonanceHint(): HudSnapshot['resonanceHint'] {
    const primedEnemy = this.enemies.find((e) => !e.dead && e.primedSchool !== null);
    if (!primedEnemy || !primedEnemy.primedSchool) return null;
    const primed = primedEnemy.primedSchool;
    const trigger = this.equippedSchools.find((s) => s !== primed);
    if (!trigger) return null;
    const res = getResonance(primed, trigger);
    if (!res) return null;
    return {
      primedSchool: primed,
      triggerSchool: trigger,
      resonanceName: res.name,
    };
  }

  private emitHud(): void {
    const bossEntity = this.enemies.find((e) => e.kind === 'boss' && !e.dead);
    const haste = this.mageClass.cooldownHaste / this.modifiers.cooldownMult;
    const biome = BIOMES[this.biomeId];

    const slotCooldowns = this.equippedSchools.map((sid, idx) => ({
      schoolId: sid,
      remaining: this.player.slotCooldowns[idx],
      max: Math.max(0.14, SCHOOL_DEFS[sid].cooldown / haste),
    })) as HudSnapshot['slotCooldowns'];

    this.callbacks.onHudUpdate({
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      aether: Math.floor(this.player.aether),
      maxAether: this.player.maxAether,
      surgeCharge: Math.floor(this.player.surgeCharge),
      level: 1 + this.chosenUpgrades.length,
      biomeId: this.biomeId,
      biomeName: biome.name,
      mode: this.mode,
      gauntletTier: this.gauntletTier,
      biomesCleared: this.biomesCleared,
      wave: this.wave,
      maxWaves: this.maxWaves,
      enemiesRemaining: this.enemies.filter((e) => !e.dead).length + this.waveSpawnQueue.length,
      kills: this.kills,
      shards: this.shards,
      gold: this.gold,
      score: this.score,
      elapsedSec: Math.floor(this.elapsedSec),
      equippedSchools: [...this.equippedSchools] as [SchoolId, SchoolId, SchoolId],
      activeSlotIndex: this.player.activeSlotIndex,
      activeSpell: this.equippedSchools[this.player.activeSlotIndex],
      slotCooldowns,
      blinkCooldown: this.player.blinkCooldown,
      blinkMax: Math.max(1.15, 2.45 / haste),
      surgeCooldown: this.player.surgeCooldown,
      surgeMax: 4.0,
      potions: this.player.potions,
      resonanceCount: this.resonanceCount,
      lastResonanceName: this.lastResonanceName,
      resonanceHint: this.computeResonanceHint(),
      boss: bossEntity
        ? {
            id: bossEntity.bossId ?? 'bone_regent',
            name: bossEntity.name,
            hp: Math.ceil(bossEntity.hp),
            maxHp: bossEntity.maxHp,
            phase: bossEntity.bossPhase,
            transitioning: bossEntity.bossTransitioning,
          }
        : null,
      bannerText: this.bannerText,
      minimap: {
        arenaWidth: this.arena.width,
        arenaHeight: this.arena.height,
        player: { x: this.player.x, y: this.player.y },
        portal: this.arena.portalPos,
        obstacles: this.arena.obstacles.map((o) => ({ x: o.x, y: o.y, r: o.radius })),
        enemies: this.enemies.filter((e) => !e.dead).map((e) => ({ x: e.x, y: e.y, isBoss: e.kind === 'boss' })),
        pickups: this.pickups.map((p) => ({ x: p.x, y: p.y })),
      },
      fps: this.measuredFps,
      activeUpgrades: this.chosenUpgrades.map((u) => u.name),
    });
  }
}
