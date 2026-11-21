export interface SwatchEntry {
  name: string;
  hex: string;
  role: string;
}

export interface BiomeStyleRamp {
  biomeId: 'cursed_grove' | 'undead_crypt' | 'blighted_marsh' | 'ashen_citadel' | 'astral_abyss';
  name: string;
  stoneBase: string;
  stoneMid: string;
  stoneLight: string;
  accentDark: string;
  accentBright: string;
  floorMood: string;
  bossName: string;
}

export interface ExternalPackPreset {
  id: string;
  label: string;
  creator: string;
  frameWidth: number;
  frameHeight: number;
  recommendedCategory: string;
  licenseNote: string;
  bestUse: string;
}

export const RIFT_NIGHT_SWATCHES: SwatchEntry[] = [
  { name: 'Outline Ink', hex: '#140E1D', role: 'Universal 1px pixel-block outer silhouette' },
  { name: 'Rift Night', hex: '#171321', role: 'Primary 60% void canvas & shadow ground' },
  { name: 'Deep Violet Ground', hex: '#241C33', role: 'Shadowed masonry & recessed depth' },
  { name: 'Obsidian Stone', hex: '#3D3152', role: 'Core gothic architecture midtone' },
  { name: 'Weathered Stone', hex: '#7A669C', role: 'Top-left directional rim highlight' },
  { name: 'Arcane Core', hex: '#A991F7', role: 'Shared 78-resonance core & Rift portals' },
  { name: 'Arcane Bright', hex: '#E8D6FF', role: 'Spell flash peaks & rune inlays' },
  { name: 'Antique Gold', hex: '#D9BA72', role: 'Gothic trim, crowns, keyframe accents' },
  { name: 'Aether Teal', hex: '#58D6C2', role: 'Frost, Aether pools & soul lanterns' },
  { name: 'Danger Crimson', hex: '#E96578', role: 'Enemy telegraphs, fire cores & blood magic' },
  { name: 'Bone Ivory', hex: '#E8E1D5', role: 'Undead silhouettes & Bone Regent highlights' },
];

export const RIFT_NIGHT_MASTER_PALETTE: [number, number, number][] = [
  [20, 14, 29],
  [23, 19, 33],
  [36, 28, 51],
  [48, 37, 69],
  [61, 49, 82],
  [90, 74, 118],
  [122, 102, 156],
  [45, 18, 89],
  [91, 58, 168],
  [169, 145, 247],
  [232, 214, 255],
  [139, 107, 50],
  [217, 186, 114],
  [247, 227, 166],
  [34, 128, 126],
  [88, 214, 194],
  [184, 247, 236],
  [158, 43, 66],
  [233, 101, 120],
  [255, 158, 172],
  [45, 122, 82],
  [67, 184, 116],
  [155, 232, 112],
  [196, 53, 146],
  [255, 138, 212],
  [155, 145, 166],
  [232, 225, 213],
  [250, 246, 238],
];

export const BIOME_STYLE_RAMPS: BiomeStyleRamp[] = [
  {
    biomeId: 'cursed_grove',
    name: 'Cursed Grove (Reference Baseline)',
    stoneBase: '#281F3B',
    stoneMid: '#3D3152',
    stoneLight: '#7A669C',
    accentDark: '#C43592',
    accentBright: '#FF8AD4',
    floorMood: 'Obsidian flagstones with magenta blossom petals & violet rune inlays',
    bossName: 'Bone Regent',
  },
  {
    biomeId: 'undead_crypt',
    name: 'Undead Crypt (Batch 2)',
    stoneBase: '#1E192E',
    stoneMid: '#322B47',
    stoneLight: '#6F698F',
    accentDark: '#267880',
    accentBright: '#58D6C2',
    floorMood: 'Catacomb slate slabs, scattered bone dust, cyan soul lanterns & amber wax',
    bossName: 'Rift Leviathan',
  },
  {
    biomeId: 'blighted_marsh',
    name: 'Blighted Marsh (Batch 2)',
    stoneBase: '#201F33',
    stoneMid: '#33344A',
    stoneLight: '#6B7285',
    accentDark: '#2D7A52',
    accentBright: '#9BE870',
    floorMood: 'Sunken mire flagstones, toxic viridian lichen, spore totems & drowned pillars',
    bossName: 'Blight Colossus',
  },
  {
    biomeId: 'ashen_citadel',
    name: 'Ashen Citadel (Batch 3 · Hi-Bit 2×)',
    stoneBase: '#201521',
    stoneMid: '#3A2332',
    stoneLight: '#6D4353',
    accentDark: '#9E2B38',
    accentBright: '#FF6B3D',
    floorMood: 'Scorched basalt flagstones, molten forge veins, ember crystals & volcanic braziers',
    bossName: 'Cinder Archon',
  },
  {
    biomeId: 'astral_abyss',
    name: 'Astral Abyss (Batch 3 · Hi-Bit 2×)',
    stoneBase: '#15142B',
    stoneMid: '#2A2857',
    stoneLight: '#5A589E',
    accentDark: '#5265D6',
    accentBright: '#7C9BFF',
    floorMood: 'Celestial obsidian marble, starlight spires, sapphire prism crystals & void portals',
    bossName: 'Astral Sovereign',
  },
];

export const EXTERNAL_PACK_PRESETS: ExternalPackPreset[] = [
  {
    id: 'nerijs_pvfx_64',
    label: 'nerijs PVFX Foundry — Lit / Strict (64×64)',
    creator: 'nerijs (CC0 Public Domain)',
    frameWidth: 64,
    frameHeight: 64,
    recommendedCategory: 'vfx',
    licenseNote: 'CC0 Public Domain (https://nerijs.itch.io/pvfx-foundry). Drop local strip + JSON to quantize into Lit or Strict Rift Night tiers.',
    bestUse: 'Lit additive glows & Strict banded retro explosions, cast circles, void bursts, and spell impacts.',
  },
  {
    id: 'dotplays_pixel_burst_64',
    label: 'dotplays Pixel Burst: Elemental Spells (64×64)',
    creator: 'dotplays',
    frameWidth: 64,
    frameHeight: 64,
    recommendedCategory: 'vfx',
    licenseNote: 'External itch.io pack (https://dotplays.itch.io/pixel-burst-elemental-spells) — not bundled; import your downloaded PNG strips + effects.json.',
    bestUse: '5-stage spell lifecycles: Cast/Charge, Projectile, Impact, AoE Burst, and Lingering Ground Hazards.',
  },
  {
    id: 'creativekind_128',
    label: 'CreativeKind Necromancer (128×128)',
    creator: 'CreativeKind',
    frameWidth: 128,
    frameHeight: 128,
    recommendedCategory: 'boss',
    licenseNote: 'Free tier: Commercial OK, credit optional. Verify download page terms before shipping.',
    bestUse: 'Dark-fantasy mage hero or caster boss mirror-match sheets.',
  },
  {
    id: 'zerie_100',
    label: 'Zerie Tiny RPG Pack (100×100)',
    creator: 'Zerie',
    frameWidth: 100,
    frameHeight: 100,
    recommendedCategory: 'mage',
    licenseNote: 'Mage tier requires $2 license; free tier covers soldier/orc. Check license file included in zip.',
    bestUse: 'High-clarity mage/necromancer animation strips with hurt & death states.',
  },
  {
    id: 'pimen_gandalf_48',
    label: 'pimen Skeletons / GandalfHardcore (48×48)',
    creator: 'pimen / GandalfHardcore',
    frameWidth: 48,
    frameHeight: 48,
    recommendedCategory: 'enemy',
    licenseNote: 'Commercial OK; GandalfHardcore includes no-AI-training clause. Keep attribution in credits.',
    bestUse: '4-directional top-down wizard & melee/ranged skeleton strips.',
  },
  {
    id: 'anokolisa_icons_32',
    label: 'Anokolisa / Hypnobius / Shikashi (32×32)',
    creator: 'Anokolisa · Hypnobius · Shikashi · Caz',
    frameWidth: 32,
    frameHeight: 32,
    recommendedCategory: 'icons',
    licenseNote: 'Mixed CC BY 4.0 / commercial-free; AbyssOwl Gothic UI requires credit & forbids AI training.',
    bestUse: 'Moonlit graveyard tiles, gothic UI bars, spell medallions, and 32×32 status icons.',
  },
];
