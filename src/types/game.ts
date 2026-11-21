export type Direction = 'down' | 'up' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnimEvent {
  frame: number;
  name: string;
}

export interface AnimationEntry {
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

export interface MasterManifest {
  version: string;
  generatedAt: string;
  sourcePipeline?: string;
  sourceSheetCount?: number;
  availableSourceCount?: number;
  sourceSheetsUsed?: string[];
  assetCount: number;
  assets: AssetManifest[];
}

export interface TrackDiagnostic {
  state: string;
  direction: string;
  row: number;
  frameCount: number;
  fps: number;
  maxPivotJitterPx: number;
  hurtboxContainmentPct: number;
  hitboxOverflowPct: number;
  meanDeltaE: number;
  outlinePerimeterCoverage: number;
  residualHaloPixels: number;
  duplicateAdjacentFrames: number;
}

export interface ValidationItem {
  assetId: string;
  name: string;
  category: string;
  sheetDimensions: string;
  expectedDimensions: string;
  dimensionsValid: boolean;
  transparentBackground: boolean;
  nonEmptyFrames: number;
  totalFrames: number;
  duplicateAdjacentFrames: number;
  pivotsAndBoxesValid: boolean;
  pixelDensity2xValid?: boolean;
  outlineInkPresent?: boolean;
  timingContractValid?: boolean;
  meanDeltaE?: number;
  p95DeltaE?: number;
  outlinePerimeterCoverage?: number;
  residualHaloPixels?: number;
  maxPivotJitterPx?: number;
  hurtboxContainmentPct?: number;
  hitboxOverflowPct?: number;
  trackDiagnostics?: TrackDiagnostic[];
  passed: boolean;
  notes: string[];
}

export interface ValidationReport {
  validatedAt: string;
  styleContractVersion?: string;
  pipelineVersion?: string;
  totalSheets: number;
  passedSheets: number;
  totalFramesValidated: number;
  totalDuplicateAdjacentFrames: number;
  pixelDensity2xPassed?: number;
  outlineInkPassed?: number;
  timingContractPassed?: number;
  avgMeanDeltaE?: number;
  avgOutlineCoverage?: number;
  totalResidualHaloPixels?: number;
  results: ValidationItem[];
}

export type SchoolId =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'earth'
  | 'shadow'
  | 'light'
  | 'time'
  | 'void'
  | 'arcane'
  | 'blood'
  | 'nature'
  | 'wind'
  | 'sonic';

export type SpellId = SchoolId;

export type BiomeId =
  | 'cursed_grove'
  | 'undead_crypt'
  | 'blighted_marsh'
  | 'ashen_citadel'
  | 'astral_abyss';

export type RunMode = 'single' | 'gauntlet';

export type BloomIntensity = 'off' | 'subtle' | 'full';
export type VfxStyleTier = 'lit' | 'strict';

export interface SpellCombatEvent {
  type: 'cast' | 'hit' | 'crit' | 'resonance' | 'boss_impact' | 'surge';
  screenX: number;
  screenY: number;
  dirX: number;
  dirY: number;
  primaryColor: string;
  secondaryColor: string;
  schoolId?: SchoolId;
  radius: number;
  intensityTier: 1 | 2 | 3;
}

export type ResonanceArchetype =
  | 'nova'
  | 'vortex'
  | 'chain'
  | 'chrono'
  | 'siphon'
  | 'hazard'
  | 'shrapnel'
  | 'fracture';

export type SpellDelivery = 'explosive' | 'pierce' | 'chain' | 'heavy' | 'homing' | 'pulse';

export interface SchoolDef {
  id: SchoolId;
  name: string;
  spellName: string;
  color: string;
  secondaryColor: string;
  iconIndex: number;
  cost: number;
  cooldown: number;
  baseDamage: number;
  projectileSpeed: number;
  delivery: SpellDelivery;
  statusTag: string;
  role: string;
  shortEffect: string;
  vfxSheet: 'vfx_fire' | 'vfx_ice' | 'vfx_lightning' | 'vfx_schools_extended';
  vfxState: string;
}

export interface ResonanceDef {
  key: string;
  schools: [SchoolId, SchoolId];
  name: string;
  archetype: ResonanceArchetype;
  archetypeLabel: string;
  vfxRowState: string;
  effect: string;
  damageMultiplier: number;
  radius: number;
}

export type EnemyArchetypeId =
  | 'skeleton'
  | 'cultist'
  | 'shieldbone'
  | 'necromancer'
  | 'wraith'
  | 'bone_archer'
  | 'plaguebearer'
  | 'flesh_construct'
  | 'ember_hound'
  | 'obsidian_golem'
  | 'ash_pyromancer'
  | 'void_stalker'
  | 'starlight_sentinel';

export type BossId =
  | 'bone_regent'
  | 'rift_leviathan'
  | 'blight_colossus'
  | 'cinder_archon'
  | 'astral_sovereign';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  subtitle: string;
  tilesetAssetId: string;
  bossId: BossId;
  bossAssetId: string;
  bossName: string;
  bossTitle: string;
  accentColor: string;
  secondaryAccent: string;
  ambientHex: string;
  fogTint: string;
  description: string;
  wave1Pool: EnemyArchetypeId[];
  wave2Pool: EnemyArchetypeId[];
  wave3Adds: EnemyArchetypeId[];
  cornerTileIndex: number;
  edgeDecorTileIndex: number;
}

export interface MageClassDef {
  id: string;
  assetId: string;
  name: string;
  title: string;
  primaryElement: string;
  accentColor: string;
  description: string;
  baseHp: number;
  baseAether: number;
  moveSpeed: number;
  spellPower: number;
  cooldownHaste: number;
  startingSpell: SchoolId;
  defaultLoadout: [SchoolId, SchoolId, SchoolId];
}

export interface UpgradeCardDef {
  id: string;
  name: string;
  category: string;
  rarity: 'Rare' | 'Arcane' | 'Mythic';
  summary: string;
  statLabel: string;
  accentColor: string;
  iconIndex: number;
  apply: (mods: PlayerModifiers) => void;
}

export interface PlayerModifiers {
  schoolDamageMult: Record<SchoolId, number>;
  allSpellDamageMult: number;
  dotDpsBonus: number;
  slowBonus: number;
  chainBonus: number;
  extraProjectiles: number;
  cooldownMult: number;
  moveSpeedMult: number;
  maxHpBonus: number;
  maxAetherBonus: number;
  aetherRegenBonus: number;
  resonanceDamageMult: number;
  resonanceRadiusBonus: number;
  blinkShockwave: boolean;
  resonanceMasteryUnlocked: boolean;
}

export interface GameSettings {
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  muted: boolean;
  screenShake: 'off' | 'low' | 'full';
  bloomIntensity: BloomIntensity;
  vfxStyleTier: VfxStyleTier;
  particleDensity: 'low' | 'normal' | 'high';
  showDamageNumbers: boolean;
  showHitboxes: boolean;
  reducedMotion: boolean;
  highContrastTelegraphs: boolean;
  quickCastHotkeys: boolean;
}

export interface MinimapSnapshot {
  arenaWidth: number;
  arenaHeight: number;
  player: { x: number; y: number };
  portal: { x: number; y: number };
  obstacles: { x: number; y: number; r: number }[];
  enemies: { x: number; y: number; isBoss: boolean }[];
  pickups: { x: number; y: number }[];
}

export interface SlotCooldownHud {
  schoolId: SchoolId;
  remaining: number;
  max: number;
}

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  aether: number;
  maxAether: number;
  surgeCharge: number; // 0..100
  level: number;
  biomeId: BiomeId;
  biomeName: string;
  mode: RunMode;
  gauntletTier: number;
  biomesCleared: number;
  wave: number;
  maxWaves: number;
  enemiesRemaining: number;
  kills: number;
  shards: number;
  gold: number;
  score: number;
  elapsedSec: number;
  equippedSchools: [SchoolId, SchoolId, SchoolId];
  activeSlotIndex: 0 | 1 | 2;
  activeSpell: SchoolId;
  slotCooldowns: [SlotCooldownHud, SlotCooldownHud, SlotCooldownHud];
  blinkCooldown: number;
  blinkMax: number;
  surgeCooldown: number;
  surgeMax: number;
  potions: number;
  resonanceCount: number;
  lastResonanceName: string | null;
  resonanceHint: {
    primedSchool: SchoolId;
    triggerSchool: SchoolId;
    resonanceName: string;
  } | null;
  boss: {
    id: BossId;
    name: string;
    hp: number;
    maxHp: number;
    phase: 1 | 2;
    transitioning: boolean;
  } | null;
  bannerText: string | null;
  minimap: MinimapSnapshot;
  fps: number;
  activeUpgrades: string[];
}

export interface RunSummary {
  victory: boolean;
  mode: RunMode;
  biomeId: BiomeId;
  biomeName: string;
  biomesCleared: number;
  gauntletTier: number;
  classId: string;
  className: string;
  equippedSchools: [SchoolId, SchoolId, SchoolId];
  seed: string;
  elapsedSec: number;
  wavesCleared: number;
  kills: number;
  resonanceCount: number;
  topResonances: { name: string; count: number }[];
  damageDealt: number;
  shards: number;
  gold: number;
  score: number;
  upgrades: { id: string; name: string; category: string }[];
}

export type AppScreen = 'menu' | 'playing' | 'asset_lab' | 'results';
