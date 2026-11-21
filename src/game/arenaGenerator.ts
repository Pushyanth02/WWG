import { BIOMES } from '../data/biomes';
import type { BiomeId } from '../types/game';
import { SeededRNG } from '../utils/prng';

export interface ArenaObstacle {
  id: string;
  x: number;
  y: number;
  radius: number;
  tileIndex: number;
  blocksProjectiles: boolean;
  animated?: 'brazier' | 'portal';
  scale?: number;
}

export interface ArenaProp {
  x: number;
  y: number;
  tileIndex: number;
  animated?: 'brazier' | 'portal';
  scale?: number;
}

export interface BiomeArena {
  biomeId: BiomeId;
  seed: string;
  cols: number;
  rows: number;
  tileSize: number;
  width: number;
  height: number;
  floorTiles: number[]; // tile indices 0..6
  obstacles: ArenaObstacle[];
  decorProps: ArenaProp[];
  portalPos: { x: number; y: number };
  spawnPoints: { x: number; y: number }[];
  playerStart: { x: number; y: number };
}

export function generateBiomeArena(biomeId: BiomeId, seed: string): BiomeArena {
  const biome = BIOMES[biomeId];
  const rng = new SeededRNG(`${biomeId}:${seed}`);
  const tileSize = 64;
  const cols = 24;
  const rows = 15;
  const width = cols * tileSize;
  const height = rows * tileSize;

  const floorTiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isBorder = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      if (isBorder) {
        floorTiles.push(6); // Perimeter wall
      } else {
        const roll = rng.next();
        if (roll < 0.42) floorTiles.push(0);
        else if (roll < 0.72) floorTiles.push(1);
        else if (roll < 0.84) floorTiles.push(2); // Biome accent scatter
        else if (roll < 0.92) floorTiles.push(3); // Cracked stone
        else if (roll < 0.97) floorTiles.push(4); // Lichen / moss / soul patch
        else floorTiles.push(5); // Arcane rune floor
      }
    }
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const portalPos = { x: centerX, y: tileSize * 2.15 };
  const playerStart = { x: centerX, y: height - tileSize * 3.1 };

  const obstacles: ArenaObstacle[] = [];
  const decorProps: ArenaProp[] = [];

  // Flanking Rift Portal, braziers & banners at north wall
  decorProps.push(
    { x: portalPos.x, y: portalPos.y, tileIndex: 14, animated: 'portal', scale: 1.55 },
    { x: portalPos.x - 104, y: portalPos.y + 18, tileIndex: 12, animated: 'brazier', scale: 1.05 },
    { x: portalPos.x + 104, y: portalPos.y + 18, tileIndex: 12, animated: 'brazier', scale: 1.05 },
    { x: portalPos.x - 165, y: portalPos.y - 6, tileIndex: 19, scale: 1.05 },
    { x: portalPos.x + 165, y: portalPos.y - 6, tileIndex: 19, scale: 1.05 }
  );

  // Corner landmarks & crystal clusters framing the biome
  const cornerTile = biome.cornerTileIndex;
  const corners: [number, number, number][] = [
    [tileSize * 2.2, tileSize * 2.1, cornerTile],
    [width - tileSize * 2.2, tileSize * 2.1, cornerTile],
    [tileSize * 2.1, height - tileSize * 2.2, cornerTile],
    [width - tileSize * 2.1, height - tileSize * 2.2, cornerTile],
    [tileSize * 3.3, tileSize * 2.4, 10],
    [width - tileSize * 3.3, tileSize * 2.4, 10],
  ];
  corners.forEach(([x, y, tileIndex], idx) => {
    obstacles.push({
      id: `corner_${idx}`,
      x,
      y,
      radius: tileIndex === 9 ? 28 : 22,
      tileIndex,
      blocksProjectiles: tileIndex === 9,
      scale: tileIndex === 9 ? 1.32 : 1.05,
    });
  });

  // Seeded interior cover: pillars, statues, crystals, tombstones/sarcophagi/totems, braziers
  const candidateCount = biomeId === 'undead_crypt' ? 13 : 12;
  let placed = 0;
  let attempts = 0;

  while (placed < candidateCount && attempts < 140) {
    attempts++;
    const x = rng.range(tileSize * 3.2, width - tileSize * 3.2);
    const y = rng.range(tileSize * 3.6, height - tileSize * 3.2);

    if (Math.hypot(x - playerStart.x, y - playerStart.y) < 155) continue;
    if (Math.hypot(x - portalPos.x, y - portalPos.y) < 210) continue;
    if (Math.hypot(x - centerX, y - centerY) < 125) continue;

    const tooClose = obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < 148);
    if (tooClose) continue;

    const kindRoll = rng.next();
    let tileIndex = 7;
    let radius = 24;
    let blocksProjectiles = true;
    let animated: 'brazier' | undefined;
    let scale = 1.1;

    if (kindRoll < 0.34) {
      tileIndex = 7; // Pillar
      radius = 24;
      blocksProjectiles = true;
      scale = 1.15;
    } else if (kindRoll < 0.52) {
      tileIndex = 18; // Statue / Idol
      radius = 24;
      blocksProjectiles = true;
      scale = 1.2;
    } else if (kindRoll < 0.72) {
      tileIndex = 10; // Crystal cluster
      radius = 21;
      blocksProjectiles = true;
      scale = 1.05;
    } else if (kindRoll < 0.88) {
      tileIndex = 11; // Gravestone / Sarcophagus / Marsh Totem
      radius = 19;
      blocksProjectiles = false;
      scale = 1.0;
    } else {
      tileIndex = 12; // Animated Brazier
      radius = 18;
      blocksProjectiles = false;
      animated = 'brazier';
      scale = 1.0;
    }

    obstacles.push({
      id: `obs_${placed}`,
      x,
      y,
      radius,
      tileIndex,
      blocksProjectiles,
      animated,
      scale,
    });
    placed++;
  }

  // Edge props framing east/west borders
  for (let i = 0; i < 4; i++) {
    const ty = tileSize * (4 + i * 2.3);
    decorProps.push(
      { x: tileSize * 0.9, y: ty, tileIndex: biome.edgeDecorTileIndex, scale: 1.22 },
      { x: width - tileSize * 0.9, y: ty, tileIndex: biome.edgeDecorTileIndex, scale: 1.22 }
    );
  }

  const spawnPoints = [
    { x: portalPos.x, y: portalPos.y + 66 },
    { x: tileSize * 3.5, y: tileSize * 3.8 },
    { x: width - tileSize * 3.5, y: tileSize * 3.8 },
    { x: tileSize * 3.5, y: height - tileSize * 3.8 },
    { x: width - tileSize * 3.5, y: height - tileSize * 3.8 },
  ];

  return {
    biomeId,
    seed,
    cols,
    rows,
    tileSize,
    width,
    height,
    floorTiles,
    obstacles,
    decorProps,
    portalPos,
    spawnPoints,
    playerStart,
  };
}
