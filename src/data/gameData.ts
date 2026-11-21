import type { MageClassDef, PlayerModifiers, SchoolId } from '../types/game';
import { ALL_SCHOOL_IDS } from './resonances';

export const MAGE_CLASSES: MageClassDef[] = [
  {
    id: 'pyromancer',
    assetId: 'mage_pyromancer',
    name: 'Pyromancer',
    title: 'Keeper of the Ember Sigil',
    primaryElement: 'Fire',
    accentColor: '#E96578',
    description: 'High spell power and volatile ignition bolts built for explosive Thermal Shatter and Plasma chains.',
    baseHp: 225,
    baseAether: 125,
    moveSpeed: 215,
    spellPower: 1.14,
    cooldownHaste: 1.0,
    startingSpell: 'fire',
    defaultLoadout: ['fire', 'ice', 'lightning'],
  },
  {
    id: 'cryomancer',
    assetId: 'mage_cryomancer',
    name: 'Cryomancer',
    title: 'Warden of the Pale Glacier',
    primaryElement: 'Ice',
    accentColor: '#58D6C2',
    description: 'Durable frostweaver with piercing glacial lances, elevated Aether reserves, and deep crowd control.',
    baseHp: 250,
    baseAether: 150,
    moveSpeed: 208,
    spellPower: 1.06,
    cooldownHaste: 1.04,
    startingSpell: 'ice',
    defaultLoadout: ['ice', 'wind', 'earth'],
  },
  {
    id: 'stormcaller',
    assetId: 'mage_stormcaller',
    name: 'Stormcaller',
    title: 'Conduit of the Rift Tempest',
    primaryElement: 'Lightning',
    accentColor: '#A991F7',
    description: 'Rapid-casting battlemage with agile footwork, instant chain arcs, and concussive Sonic bursts.',
    baseHp: 215,
    baseAether: 140,
    moveSpeed: 230,
    spellPower: 1.07,
    cooldownHaste: 1.12,
    startingSpell: 'lightning',
    defaultLoadout: ['lightning', 'sonic', 'wind'],
  },
  {
    id: 'voidweaver',
    assetId: 'mage_voidweaver',
    name: 'Voidweaver',
    title: 'Whisper of the Hollow Rift',
    primaryElement: 'Void',
    accentColor: '#C084FC',
    description: 'High burst potency across dark schools, collapsing foes with Void singularities and Blood siphon.',
    baseHp: 210,
    baseAether: 145,
    moveSpeed: 222,
    spellPower: 1.16,
    cooldownHaste: 1.06,
    startingSpell: 'void',
    defaultLoadout: ['void', 'shadow', 'blood'],
  },
  {
    id: 'aethermancer',
    assetId: 'mage_aethermancer',
    name: 'Aethermancer',
    title: 'Archivist of the First Circle',
    primaryElement: 'Arcane',
    accentColor: '#58D6C2',
    description: 'Balanced scholar with deep Aether reserves, radiant Light spears, and verdant Nature hazards.',
    baseHp: 240,
    baseAether: 170,
    moveSpeed: 214,
    spellPower: 1.08,
    cooldownHaste: 1.06,
    startingSpell: 'arcane',
    defaultLoadout: ['arcane', 'light', 'nature'],
  },
  {
    id: 'chronomancer',
    assetId: 'mage_chronomancer',
    name: 'Chronomancer',
    title: 'Keeper of the Gilded Hourglass',
    primaryElement: 'Time',
    accentColor: '#D9BA72',
    description: 'Accelerates cooldowns and Blink tempo to weave Time stasis with Void and Fire detonations.',
    baseHp: 230,
    baseAether: 155,
    moveSpeed: 224,
    spellPower: 1.05,
    cooldownHaste: 1.18,
    startingSpell: 'time',
    defaultLoadout: ['time', 'void', 'fire'],
  },
];

export function createDefaultModifiers(): PlayerModifiers {
  const schoolDamageMult = {} as Record<SchoolId, number>;
  for (const id of ALL_SCHOOL_IDS) {
    schoolDamageMult[id] = 1;
  }
  return {
    schoolDamageMult,
    allSpellDamageMult: 1,
    dotDpsBonus: 0,
    slowBonus: 0,
    chainBonus: 0,
    extraProjectiles: 0,
    cooldownMult: 1,
    moveSpeedMult: 1,
    maxHpBonus: 0,
    maxAetherBonus: 0,
    aetherRegenBonus: 0,
    resonanceDamageMult: 1,
    resonanceRadiusBonus: 0,
    blinkShockwave: false,
    resonanceMasteryUnlocked: false,
  };
}

export interface ProductionBatchRow {
  category: string;
  target: string;
  generated: string;
  integrated: string;
  status: 'Verified in Demo' | 'Generated · Next Batch' | 'Planned Content Batch';
}

export const PRODUCTION_REPORT: ProductionBatchRow[] = [
  {
    category: 'Playable Mage Classes (64×64, 9 states × 4 dirs)',
    target: '6 classes',
    generated: '6 / 6 PNG + JSON',
    integrated: '6 / 6 playable with hi-bit 2× shading, full-body articulation & custom loadouts',
    status: 'Verified in Demo',
  },
  {
    category: 'Enemy Archetypes (64×64, 7 states × 4 dirs)',
    target: '19 archetypes',
    generated: '13 / 19 PNG + JSON (Batch 1–3 · Hi-Bit 2× Articulated)',
    integrated: '13 / 13 active across 5 Biomes (incl. Ember Hound, Obsidian Golem, Ash Pyromancer, Void Stalker, Starlight Sentinel)',
    status: 'Verified in Demo',
  },
  {
    category: 'Tyrant Bosses (128×128, 8 states × 4 dirs)',
    target: '5 tyrants',
    generated: '5 / 5 PNG + JSON (Bone Regent, Rift Leviathan, Blight Colossus, Cinder Archon, Astral Sovereign)',
    integrated: '5 / 5 two-phase Tyrants live in Single Biome & Endless Gauntlet',
    status: 'Verified in Demo',
  },
  {
    category: '5-Stage Elemental & Resonance VFX (Lit + Strict)',
    target: '13 schools + 78 resonances',
    generated: '14 VFX sheets (7 PVFX Lit + 7 PVFX Strict) + Pack Importer',
    integrated: '13 / 13 Schools & 78 / 78 Resonances live + GameView Bloom & Shake Hook',
    status: 'Verified in Demo',
  },
  {
    category: 'Environment Biomes & Props (64×64, 20 tiles each)',
    target: '10 biomes',
    generated: '5 / 10 PNG + JSON (Cursed Grove, Undead Crypt, Blighted Marsh, Ashen Citadel, Astral Abyss)',
    integrated: '5 / 5 seeded arenas + 5-Biome Endless Rift Gauntlet loop',
    status: 'Verified in Demo',
  },
  {
    category: 'Portraits, Relics & 13 Hexagonal School Crests (32×32 & 64×64)',
    target: '3 UI & Relic atlases',
    generated: '3 / 3 PNG + JSON (12 Portraits incl. 5 Tyrants, 12 Relics/Staves, 18 Pickups/Schools)',
    integrated: 'Live across Main Menu Biome cards, Boss HUD, Upgrade Relics & Codex',
    status: 'Verified in Demo',
  },
  {
    category: 'Source Sheet Coverage & Pipeline Parity (V3.1)',
    target: '12 / 12 source sheets',
    generated: '46 / 46 V3.1 PNG + JSON (Hi-Bit 2× + 5-Stage Lit/Strict VFX)',
    integrated: '100% validated sheets active in Combat, Codex, Vault & Lossless ZIP Export',
    status: 'Verified in Demo',
  },
];
