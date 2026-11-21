import type {
  ResonanceArchetype,
  ResonanceDef,
  SchoolDef,
  SchoolId,
  UpgradeCardDef,
} from '../types/game';

export const ALL_SCHOOL_IDS: SchoolId[] = [
  'fire',
  'ice',
  'lightning',
  'earth',
  'shadow',
  'light',
  'time',
  'void',
  'arcane',
  'blood',
  'nature',
  'wind',
  'sonic',
];

export const SCHOOL_DEFS: Record<SchoolId, SchoolDef> = {
  fire: {
    id: 'fire',
    name: 'Fire',
    spellName: 'Pyre Bolt',
    color: '#FF7B29',
    secondaryColor: '#E96578',
    iconIndex: 5,
    cost: 12,
    cooldown: 0.42,
    baseDamage: 34,
    projectileSpeed: 545,
    delivery: 'explosive',
    statusTag: 'BURN',
    role: 'Explosive ignition & Burn DoT',
    shortEffect: 'Splash ember bolt · Applies Burn DoT',
    vfxSheet: 'vfx_fire',
    vfxState: 'projectile',
  },
  ice: {
    id: 'ice',
    name: 'Ice',
    spellName: 'Frost Lance',
    color: '#58D6C2',
    secondaryColor: '#B8F7EC',
    iconIndex: 6,
    cost: 11,
    cooldown: 0.38,
    baseDamage: 29,
    projectileSpeed: 645,
    delivery: 'pierce',
    statusTag: 'CHILL',
    role: 'Piercing frost & Chill slow',
    shortEffect: 'Pierces 2 foes · Applies 35% Chill slow',
    vfxSheet: 'vfx_ice',
    vfxState: 'projectile',
  },
  lightning: {
    id: 'lightning',
    name: 'Lightning',
    spellName: 'Storm Arc',
    color: '#A991F7',
    secondaryColor: '#E8D6FF',
    iconIndex: 7,
    cost: 15,
    cooldown: 0.56,
    baseDamage: 32,
    projectileSpeed: 900,
    delivery: 'chain',
    statusTag: 'SHOCK',
    role: 'Instant chain arcs & stagger',
    shortEffect: 'Instant chaining bolt · Jumps between nearby foes',
    vfxSheet: 'vfx_lightning',
    vfxState: 'bolt',
  },
  earth: {
    id: 'earth',
    name: 'Earth',
    spellName: 'Basalt Shard',
    color: '#C79652',
    secondaryColor: '#F0D098',
    iconIndex: 8,
    cost: 13,
    cooldown: 0.5,
    baseDamage: 40,
    projectileSpeed: 470,
    delivery: 'heavy',
    statusTag: 'SUNDER',
    role: 'Armor break & heavy knockback',
    shortEffect: 'Crushing stone spike · High stagger & armor fracture',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'earth',
  },
  shadow: {
    id: 'shadow',
    name: 'Shadow',
    spellName: 'Umbral Scythe',
    color: '#9B6EE8',
    secondaryColor: '#482880',
    iconIndex: 9,
    cost: 11,
    cooldown: 0.4,
    baseDamage: 33,
    projectileSpeed: 590,
    delivery: 'pierce',
    statusTag: 'UMBRA',
    role: 'Piercing dusk blades & curse',
    shortEffect: 'Shadow crescent · Pierces & amplifies critical hits',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'shadow',
  },
  light: {
    id: 'light',
    name: 'Light',
    spellName: 'Solar Spear',
    color: '#F2CA6B',
    secondaryColor: '#FFF7D6',
    iconIndex: 10,
    cost: 13,
    cooldown: 0.44,
    baseDamage: 35,
    projectileSpeed: 680,
    delivery: 'pierce',
    statusTag: 'SEAR',
    role: 'Radiant beams & purges',
    shortEffect: 'Fast radiant spear · Pierces & illuminates foes',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'light',
  },
  time: {
    id: 'time',
    name: 'Time',
    spellName: 'Chrono Dart',
    color: '#6E9BE8',
    secondaryColor: '#D4E6FF',
    iconIndex: 11,
    cost: 12,
    cooldown: 0.44,
    baseDamage: 28,
    projectileSpeed: 620,
    delivery: 'homing',
    statusTag: 'DILATE',
    role: 'Temporal slow & tracking',
    shortEffect: 'Homing temporal shard · Slows foe attack cadence',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'time',
  },
  void: {
    id: 'void',
    name: 'Void',
    spellName: 'Rift Singularity',
    color: '#C06CFF',
    secondaryColor: '#E8D6FF',
    iconIndex: 12,
    cost: 15,
    cooldown: 0.54,
    baseDamage: 34,
    projectileSpeed: 495,
    delivery: 'explosive',
    statusTag: 'RIFT',
    role: 'Gravity collapse & pull',
    shortEffect: 'Collapsing void orb · Pulls nearby foes inward',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'void',
  },
  arcane: {
    id: 'arcane',
    name: 'Arcane',
    spellName: 'Aether Missile',
    color: '#A991F7',
    secondaryColor: '#58D6C2',
    iconIndex: 13,
    cost: 10,
    cooldown: 0.34,
    baseDamage: 26,
    projectileSpeed: 610,
    delivery: 'homing',
    statusTag: 'FLUX',
    role: 'Rapid homing force bolts',
    shortEffect: 'Low-cost homing missile · Fuels Surge quickly',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'arcane',
  },
  blood: {
    id: 'blood',
    name: 'Blood',
    spellName: 'Crimson Lash',
    color: '#E96578',
    secondaryColor: '#FF9EAC',
    iconIndex: 14,
    cost: 12,
    cooldown: 0.44,
    baseDamage: 33,
    projectileSpeed: 560,
    delivery: 'explosive',
    statusTag: 'BLEED',
    role: 'Life siphon & crimson pacts',
    shortEffect: 'Sanguine orb · Bleed DoT & restores 3 HP on hit',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'blood',
  },
  nature: {
    id: 'nature',
    name: 'Nature',
    spellName: 'Bramble Volley',
    color: '#43B874',
    secondaryColor: '#9BE870',
    iconIndex: 15,
    cost: 12,
    cooldown: 0.42,
    baseDamage: 30,
    projectileSpeed: 550,
    delivery: 'explosive',
    statusTag: 'VENOM',
    role: 'Venom spores & snare',
    shortEffect: 'Spore pod · Poison DoT & mild snare',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'nature',
  },
  wind: {
    id: 'wind',
    name: 'Wind',
    spellName: 'Gale Crescent',
    color: '#6CE3D1',
    secondaryColor: '#D4FFF8',
    iconIndex: 16,
    cost: 10,
    cooldown: 0.36,
    baseDamage: 27,
    projectileSpeed: 690,
    delivery: 'pierce',
    statusTag: 'GALE',
    role: 'Swift knockback crescents',
    shortEffect: 'Fast piercing wind arc · Strong knockback push',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'wind',
  },
  sonic: {
    id: 'sonic',
    name: 'Sonic',
    spellName: 'Resonant Pulse',
    color: '#8E84F7',
    secondaryColor: '#E8D6FF',
    iconIndex: 17,
    cost: 14,
    cooldown: 0.48,
    baseDamage: 31,
    projectileSpeed: 600,
    delivery: 'pulse',
    statusTag: 'ECHO',
    role: 'Shockwave stun & disrupt',
    shortEffect: 'Expanding harmonic ring · Wide hit cone & interrupt',
    vfxSheet: 'vfx_schools_extended',
    vfxState: 'sonic',
  },
};

const ARCHETYPE_META: Record<
  ResonanceArchetype,
  { label: string; vfxRowState: string; damageMultiplier: number; radius: number }
> = {
  nova: { label: 'AoE Burst Nova', vfxRowState: 'nova', damageMultiplier: 2.05, radius: 132 },
  vortex: { label: 'Gravity Vortex Pull', vfxRowState: 'vortex', damageMultiplier: 1.75, radius: 155 },
  chain: { label: 'Arcing Chain Detonation', vfxRowState: 'chain', damageMultiplier: 1.85, radius: 185 },
  chrono: { label: 'Temporal Slow Field', vfxRowState: 'chrono', damageMultiplier: 1.65, radius: 148 },
  siphon: { label: 'Vitality & Aether Siphon', vfxRowState: 'siphon', damageMultiplier: 1.75, radius: 124 },
  hazard: { label: 'Lingering Hazard Pool', vfxRowState: 'hazard', damageMultiplier: 1.6, radius: 118 },
  shrapnel: { label: 'Radial Shrapnel Volley', vfxRowState: 'shrapnel', damageMultiplier: 1.7, radius: 136 },
  fracture: { label: 'Armor-Shatter Rupture', vfxRowState: 'fracture', damageMultiplier: 2.15, radius: 126 },
};

export function getResonanceKey(a: SchoolId, b: SchoolId): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

interface RawResonanceSpec {
  a: SchoolId;
  b: SchoolId;
  name: string;
  archetype: ResonanceArchetype;
  effect: string;
}

// Complete C(13, 2) = 78 unique elemental pair resonances
const RAW_78_RESONANCES: RawResonanceSpec[] = [
  // Fire (12)
  { a: 'fire', b: 'ice', name: 'Thermal Shatter', archetype: 'nova', effect: 'Violent vapor-crystal shockwave detonates Burn & Chill with knockback.' },
  { a: 'fire', b: 'lightning', name: 'Plasma Overload', archetype: 'chain', effect: 'Superheated arc jumps between foes, igniting every struck target.' },
  { a: 'fire', b: 'earth', name: 'Magma Eruption', archetype: 'hazard', effect: 'Ruptures a molten caldera pool that sears enemies standing within.' },
  { a: 'fire', b: 'shadow', name: 'Ashen Eclipse', archetype: 'nova', effect: 'Blackflame blast engulfs nearby enemies and amplifies burn ticks.' },
  { a: 'fire', b: 'light', name: 'Solar Flare', archetype: 'nova', effect: 'Blinding coronal burst scorches wide radius and staggers casters.' },
  { a: 'fire', b: 'time', name: 'Cinder Rewind', archetype: 'chrono', effect: 'Dilates burning targets while accelerating instant ember ticks.' },
  { a: 'fire', b: 'void', name: 'Supernova Collapse', archetype: 'vortex', effect: 'Drags foes into a collapsing star before an arcane-fire burst.' },
  { a: 'fire', b: 'arcane', name: 'Starfire Ignition', archetype: 'shrapnel', effect: 'Launches six arcane-ember shards radially from the detonation.' },
  { a: 'fire', b: 'blood', name: 'Cauterize Pact', archetype: 'siphon', effect: 'Sears crimson flame across foes, restoring mage HP and Aether.' },
  { a: 'fire', b: 'nature', name: 'Wildfire Spores', archetype: 'hazard', effect: 'Ignites volatile briar ash across the arena floor.' },
  { a: 'fire', b: 'wind', name: 'Firestorm Vortex', archetype: 'vortex', effect: 'Cyclonic updraft whips burning foes inward in a cinder spiral.' },
  { a: 'fire', b: 'sonic', name: 'Detonation Wave', archetype: 'fracture', effect: 'Concussive blast shatters armor and staggers heavy tyrants.' },

  // Ice (11)
  { a: 'ice', b: 'lightning', name: 'Superconduct', archetype: 'chain', effect: 'Cryo-charged voltage arcs violently through chilled enemy packs.' },
  { a: 'ice', b: 'earth', name: 'Permafrost Quake', archetype: 'fracture', effect: 'Glacial fault line shatters enemy guard and deals heavy impact.' },
  { a: 'ice', b: 'shadow', name: 'Frostbite Shroud', archetype: 'hazard', effect: 'Spreads creeping dark-ice rime that chills and drains foes.' },
  { a: 'ice', b: 'light', name: 'Prism Refraction', archetype: 'shrapnel', effect: 'Refracts radiant-ice beams outward into piercing crystal splinters.' },
  { a: 'ice', b: 'time', name: 'Absolute Stasis', archetype: 'chrono', effect: 'Locks enemies in a deep frozen-time dome, halting their advance.' },
  { a: 'ice', b: 'void', name: 'Zero-Point Rift', archetype: 'vortex', effect: 'Sub-zero singularity pulls targets together and flashes frost.' },
  { a: 'ice', b: 'arcane', name: 'Crystal Cascade', archetype: 'shrapnel', effect: 'Fires arcane-etched icicles in all directions on detonation.' },
  { a: 'ice', b: 'blood', name: 'Frozen Vein', archetype: 'siphon', effect: 'Crystallizes crimson mist to mend HP and restore chilled Aether.' },
  { a: 'ice', b: 'nature', name: 'Hoarfrost Bramble', archetype: 'hazard', effect: 'Sprouts frosted thorns that root and chill encroaching enemies.' },
  { a: 'ice', b: 'wind', name: 'Blizzard Squall', archetype: 'vortex', effect: 'Howling frost gale sweeps enemies inward while chilling deeply.' },
  { a: 'ice', b: 'sonic', name: 'Glacial Shatter', archetype: 'fracture', effect: 'High-frequency resonance fractures frozen armor for massive burst.' },

  // Lightning (10)
  { a: 'lightning', b: 'earth', name: 'Fulmination Spike', archetype: 'fracture', effect: 'Grounds a lightning rod through basalt, cracking armor in a blast.' },
  { a: 'lightning', b: 'shadow', name: 'Umbral Surge', archetype: 'chain', effect: 'Dark-violet bolts leap silently from shadow to shadow.' },
  { a: 'lightning', b: 'light', name: 'Celestial Bolt', archetype: 'chain', effect: 'Radiant sky-arcs strike multiple foes with high stagger.' },
  { a: 'lightning', b: 'time', name: 'Tachyon Flash', archetype: 'chrono', effect: 'Temporal static slows foes while energizing your spell cadence.' },
  { a: 'lightning', b: 'void', name: 'Rift Discharge', archetype: 'vortex', effect: 'Magnetic rift pulls targets into an ionized void collapse.' },
  { a: 'lightning', b: 'arcane', name: 'Aether Storm', archetype: 'chain', effect: 'Overcharged arcane lightning chains widely and grants Surge.' },
  { a: 'lightning', b: 'blood', name: 'Galvanic Drain', archetype: 'siphon', effect: 'Bio-electric siphon steals vitality and converts it to Aether.' },
  { a: 'lightning', b: 'nature', name: 'Blighted Static', archetype: 'hazard', effect: 'Electrifies toxic spore ground with crackling DoT arcs.' },
  { a: 'lightning', b: 'wind', name: 'Tempest Cyclone', archetype: 'vortex', effect: 'Storm funnel gathers enemies into a swirling lightning core.' },
  { a: 'lightning', b: 'sonic', name: 'Thunderclap', archetype: 'nova', effect: 'Deafening storm detonation slams and briefly stuns nearby foes.' },

  // Earth (9)
  { a: 'earth', b: 'shadow', name: 'Obsidian Tomb', archetype: 'fracture', effect: 'Dark monolith shards erupt, crushing enemy defenses.' },
  { a: 'earth', b: 'light', name: 'Gilded Monolith', archetype: 'nova', effect: 'Radiant stone pulse erupts with antique-gold shockwaves.' },
  { a: 'earth', b: 'time', name: 'Petrified Epoch', archetype: 'chrono', effect: 'Encases the zone in slow-moving temporal sediment.' },
  { a: 'earth', b: 'void', name: 'Gravity Well', archetype: 'vortex', effect: 'Crushing tectonic singularity drags foes toward impact center.' },
  { a: 'earth', b: 'arcane', name: 'Runestone Rupture', archetype: 'shrapnel', effect: 'Blasts rune-carved fragments outward through nearby targets.' },
  { a: 'earth', b: 'blood', name: 'Iron Siphon', archetype: 'siphon', effect: 'Draws mineral-crimson essence to fortify health and shred guard.' },
  { a: 'earth', b: 'nature', name: 'Rootquake', archetype: 'hazard', effect: 'Shattered earth blooms into toxic vines that damage passersby.' },
  { a: 'earth', b: 'wind', name: 'Sandstone Shred', archetype: 'shrapnel', effect: 'Scouring gravel storm pelts enemies with high-velocity grit.' },
  { a: 'earth', b: 'sonic', name: 'Seismic Tremor', archetype: 'fracture', effect: 'Subterranean shockwave cracks armor and hurls foes back.' },

  // Shadow (8)
  { a: 'shadow', b: 'light', name: 'Eclipse Nova', archetype: 'nova', effect: 'Duality of dawn and dusk detonates in a colossal twilight ring.' },
  { a: 'shadow', b: 'time', name: 'Dusk Stasis', archetype: 'chrono', effect: 'Suspends foes inside a shadowy temporal pocket.' },
  { a: 'shadow', b: 'void', name: 'Abyssal Maw', archetype: 'vortex', effect: 'Devouring umbral rift pulls enemies into crushing darkness.' },
  { a: 'shadow', b: 'arcane', name: 'Hex Cascade', archetype: 'shrapnel', effect: 'Unleashes homing umbral-arcane darts across the battlefield.' },
  { a: 'shadow', b: 'blood', name: 'Nightmare Leech', archetype: 'siphon', effect: 'Drains shadowy crimson life force to heal and replenish Aether.' },
  { a: 'shadow', b: 'nature', name: 'Withered Mire', archetype: 'hazard', effect: 'Creates a necrotic marsh pool that rots enemies over time.' },
  { a: 'shadow', b: 'wind', name: 'Phantom Gale', archetype: 'chain', effect: 'Spectral gusts slash from enemy to enemy in rapid succession.' },
  { a: 'shadow', b: 'sonic', name: 'Banshee Wail', archetype: 'fracture', effect: 'Piercing umbral shriek shatters resolve and armor.' },

  // Light (7)
  { a: 'light', b: 'time', name: 'Chrono Radiance', archetype: 'chrono', effect: 'Golden light bends time, freezing enemy motion inside a halo.' },
  { a: 'light', b: 'void', name: 'Quasar Implosion', archetype: 'vortex', effect: 'Blinding rift implodes inward before releasing radiant force.' },
  { a: 'light', b: 'arcane', name: 'Astral Convergence', archetype: 'nova', effect: 'Starlight and arcane geometry erupt in a purifying blast.' },
  { a: 'light', b: 'blood', name: 'Sanctified Tithe', archetype: 'siphon', effect: 'Purifies crimson essence into direct mage restoration.' },
  { a: 'light', b: 'nature', name: 'Sunbloom Spore', archetype: 'hazard', effect: 'Radiant flora erupts into a searing golden-green pollen zone.' },
  { a: 'light', b: 'wind', name: 'Dawn Zephyr', archetype: 'shrapnel', effect: 'Sends golden wind-blades radiating outward in all directions.' },
  { a: 'light', b: 'sonic', name: 'Choir Resonance', archetype: 'nova', effect: 'Harmonic golden shockwave purges and staggers surrounding foes.' },

  // Time (6)
  { a: 'time', b: 'void', name: 'Event Horizon', archetype: 'vortex', effect: 'Collapsing spacetime pulls foes in and locks them in stasis.' },
  { a: 'time', b: 'arcane', name: 'Paradox Loop', archetype: 'chrono', effect: 'Creates a shimmering time-field that echoes arcane damage.' },
  { a: 'time', b: 'blood', name: 'Stolen Lifespan', archetype: 'siphon', effect: 'Rewinds cellular vitality from struck foes back into the mage.' },
  { a: 'time', b: 'nature', name: 'Overgrowth Cycle', archetype: 'hazard', effect: 'Accelerates toxic vine growth across a wide lingering zone.' },
  { a: 'time', b: 'wind', name: 'Slipstream Echo', archetype: 'chain', effect: 'Afterimage gusts strike rapidly across clustered targets.' },
  { a: 'time', b: 'sonic', name: 'Echo Cadence', archetype: 'chrono', effect: 'Repeating harmonic pulses slow and vibrate enemy formations.' },

  // Void (5)
  { a: 'void', b: 'arcane', name: 'Rift Singularity', archetype: 'vortex', effect: 'Pure arcane-void collapse drags enemies into a violet blast.' },
  { a: 'void', b: 'blood', name: 'Hollow Feast', archetype: 'siphon', effect: 'Abyssal tendrils drain crimson life and restore Aether.' },
  { a: 'void', b: 'nature', name: 'Blighted Rift', archetype: 'hazard', effect: 'Spills corrupted void-spores across a persistent mire patch.' },
  { a: 'void', b: 'wind', name: 'Vacuum Maelstrom', archetype: 'vortex', effect: 'Airless rift cyclone violently condenses foes into one point.' },
  { a: 'void', b: 'sonic', name: 'Null Scream', archetype: 'fracture', effect: 'Silent void shockwave ruptures enemy defenses with bonus damage.' },

  // Arcane (4)
  { a: 'arcane', b: 'blood', name: 'Hemomantic Surge', archetype: 'siphon', effect: 'Transmutes enemy blood directly into Aether and HP recovery.' },
  { a: 'arcane', b: 'nature', name: 'Leyline Bloom', archetype: 'hazard', effect: 'Awakens glowing violet-green leyline runes that burn foes.' },
  { a: 'arcane', b: 'wind', name: 'Aether Cyclone', archetype: 'shrapnel', effect: 'Fires spiraling arcane wind blades in a 360-degree burst.' },
  { a: 'arcane', b: 'sonic', name: 'Harmonic Pulse', archetype: 'chain', effect: 'Tuning-fork arcane waves bounce across nearby enemies.' },

  // Blood (3)
  { a: 'blood', b: 'nature', name: 'Briar Siphon', archetype: 'siphon', effect: 'Thorny crimson vines entangle foes and leech life to the mage.' },
  { a: 'blood', b: 'wind', name: 'Crimson Squall', archetype: 'shrapnel', effect: 'Scatters razor blood-mists outward through surrounding packs.' },
  { a: 'blood', b: 'sonic', name: 'Pulse Rupture', archetype: 'fracture', effect: 'Heart-stopping shockwave ruptures bleeding foes for heavy burst.' },

  // Nature (2)
  { a: 'nature', b: 'wind', name: 'Spore Tempest', archetype: 'hazard', effect: 'Scatters a swirling cloud of toxic viridian pollen over the arena.' },
  { a: 'nature', b: 'sonic', name: 'Bramble Vibration', archetype: 'shrapnel', effect: 'Shatters briar pods into a radial storm of venomous needles.' },

  // Wind (1)
  { a: 'wind', b: 'sonic', name: 'Sonic Boom', archetype: 'fracture', effect: 'Mach-speed pressure wave tears armor and launches enemies back.' },
];

export const RESONANCE_LIST: ResonanceDef[] = RAW_78_RESONANCES.map((spec) => {
  const meta = ARCHETYPE_META[spec.archetype];
  const sorted: [SchoolId, SchoolId] = spec.a < spec.b ? [spec.a, spec.b] : [spec.b, spec.a];
  return {
    key: getResonanceKey(spec.a, spec.b),
    schools: sorted,
    name: spec.name,
    archetype: spec.archetype,
    archetypeLabel: meta.label,
    vfxRowState: meta.vfxRowState,
    effect: spec.effect,
    damageMultiplier: meta.damageMultiplier,
    radius: meta.radius,
  };
});

export const RESONANCE_MAP: Map<string, ResonanceDef> = new Map(
  RESONANCE_LIST.map((r) => [r.key, r])
);

export function getResonance(a: SchoolId, b: SchoolId): ResonanceDef | null {
  if (a === b) return null;
  return RESONANCE_MAP.get(getResonanceKey(a, b)) ?? null;
}

export function getLoadoutResonances(
  loadout: [SchoolId, SchoolId, SchoolId]
): [ResonanceDef, ResonanceDef, ResonanceDef] {
  const r01 = getResonance(loadout[0], loadout[1]) || RESONANCE_LIST[0];
  const r02 = getResonance(loadout[0], loadout[2]) || RESONANCE_LIST[1];
  const r12 = getResonance(loadout[1], loadout[2]) || RESONANCE_LIST[2];
  return [r01, r02, r12];
}

export function buildUpgradePool(equippedSchools: [SchoolId, SchoolId, SchoolId]): UpgradeCardDef[] {
  const pairResonances = getLoadoutResonances(equippedSchools);
  const resNames = pairResonances.map((r) => r.name).join(', ');

  const schoolCards: UpgradeCardDef[] = equippedSchools.map((sid) => {
    const def = SCHOOL_DEFS[sid];
    return {
      id: `school_focus_${sid}`,
      name: `${def.name} Conduit`,
      category: def.name,
      rarity: 'Arcane',
      summary: `Amplifies ${def.spellName} potency and empowers ${def.statusTag} priming across every resonance it triggers.`,
      statLabel: `+36% ${def.name} Damage · +12 DoT / Slow`,
      accentColor: def.color,
      iconIndex: def.iconIndex,
      apply: (m) => {
        m.schoolDamageMult[sid] = (m.schoolDamageMult[sid] ?? 1) + 0.36;
        m.dotDpsBonus += 10;
        m.slowBonus += 0.08;
      },
    };
  });

  const universalCards: UpgradeCardDef[] = [
    {
      id: 'resonance_mastery',
      name: 'Tri-Resonance Mastery',
      category: 'Resonance',
      rarity: 'Mythic',
      summary: `Supercharges your active resonance triad (${resNames}) with expanded arcane shockwaves and shrapnel echoes.`,
      statLabel: '+60% Resonance Damage · +44px Radius',
      accentColor: '#D9BA72',
      iconIndex: 2,
      apply: (m) => {
        m.resonanceMasteryUnlocked = true;
        m.resonanceDamageMult += 0.6;
        m.resonanceRadiusBonus += 44;
      },
    },
    {
      id: 'twin_volley',
      name: 'Prismatic Split',
      category: 'Arcane',
      rarity: 'Arcane',
      summary: 'Splits projectile spells into an additional twin cast and grants extra bounces to chaining spells.',
      statLabel: '+1 Extra Projectile · +2 Chain Jumps',
      accentColor: '#58D6C2',
      iconIndex: 13,
      apply: (m) => {
        m.extraProjectiles += 1;
        m.chainBonus += 2;
        m.allSpellDamageMult += 0.12;
      },
    },
    {
      id: 'rift_conduit',
      name: 'Rift Conduit',
      category: 'Arcane',
      rarity: 'Rare',
      summary: 'Accelerates all spell cooldowns and floods your vessel with Aether regeneration for rapid resonance weaving.',
      statLabel: '-20% Cooldowns · +45 Max Aether · +9/s Regen',
      accentColor: '#A991F7',
      iconIndex: 1,
      apply: (m) => {
        m.cooldownMult *= 0.8;
        m.maxAetherBonus += 45;
        m.aetherRegenBonus += 9;
      },
    },
    {
      id: 'blink_aftershock',
      name: 'Blink Aftershock',
      category: 'Arcane',
      rarity: 'Rare',
      summary: 'Blinking releases a damaging arcane nova on arrival while fortifying vitality and stride.',
      statLabel: 'Blink Arrival Nova · +70 Max HP · +12% Speed',
      accentColor: '#E96578',
      iconIndex: 0,
      apply: (m) => {
        m.blinkShockwave = true;
        m.maxHpBonus += 70;
        m.moveSpeedMult += 0.12;
      },
    },
  ];

  return [universalCards[0], ...schoolCards, ...universalCards.slice(1)];
}
