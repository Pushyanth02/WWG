import { BookOpen, Dices, Infinity as InfinityIcon, Lock, Settings, Swords, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { BIOME_LIST, BIOMES } from '../data/biomes';
import { MAGE_CLASSES } from '../data/gameData';
import { ALL_SCHOOL_IDS, getLoadoutResonances, SCHOOL_DEFS } from '../data/resonances';
import { drawAtlasTile, drawSpriteFrame, spriteRegistry } from '../game/spriteLoader';
import type { BiomeId, MageClassDef, RunMode, RunSummary, SchoolId } from '../types/game';
import { AtlasIcon, SpritePreview } from './SpritePreview';

interface MainMenuProps {
  selectedClass: MageClassDef;
  onSelectClass: (cls: MageClassDef) => void;
  selectedBiome: BiomeId;
  onSelectBiome: (biome: BiomeId) => void;
  runMode: RunMode;
  onSelectRunMode: (mode: RunMode) => void;
  equippedSchools: [SchoolId, SchoolId, SchoolId];
  onChangeLoadoutSlot: (slotIndex: 0 | 1 | 2, schoolId: SchoolId) => void;
  seed: string;
  onChangeSeed: (seed: string) => void;
  onRandomizeSeed: () => void;
  onStartSoloRun: () => void;
  onOpenAssetLab: () => void;
  onOpenCodex: () => void;
  onOpenSettings: () => void;
  recentRuns: RunSummary[];
  reducedMotion: boolean;
}

export function MainMenu({
  selectedClass,
  onSelectClass,
  selectedBiome,
  onSelectBiome,
  runMode,
  onSelectRunMode,
  equippedSchools,
  onChangeLoadoutSlot,
  seed,
  onChangeSeed,
  onRandomizeSeed,
  onStartSoloRun,
  onOpenAssetLab,
  onOpenCodex,
  onOpenSettings,
  recentRuns,
  reducedMotion,
}: MainMenuProps) {
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const [editingSlot, setEditingSlot] = useState<0 | 1 | 2>(0);

  const biomeDef = BIOMES[selectedBiome];
  const activeResonances = getLoadoutResonances(equippedSchools);

  // Animated real pixel-art backdrop switching dynamically per selected Biome!
  useEffect(() => {
    const canvas = backdropRef.current;
    if (!canvas) return;
    let raf = 0;
    const start = performance.now();

    const motes = Array.from({ length: 28 }, (_, i) => ({
      x: (i * 97) % 1440,
      y: (i * 53) % 900,
      vx: 14 + (i % 5) * 6,
      vy: 10 + (i % 4) * 5,
      size: 3 + (i % 2) * 2,
    }));

    const render = (now: number) => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }
      const ctx = canvas.getContext('2d');
      const tiles = spriteRegistry.get(biomeDef.tilesetAssetId);
      const mage = spriteRegistry.get(selectedClass.assetId);
      const boss = spriteRegistry.get(biomeDef.bossAssetId);
      if (ctx && tiles) {
        const w = canvas.width;
        const h = canvas.height;
        const t = reducedMotion ? 0 : (now - start) / 1000;

        ctx.fillStyle = biomeDef.ambientHex;
        ctx.fillRect(0, 0, w, h);

        for (let y = 0; y < h; y += 64) {
          for (let x = 0; x < w; x += 64) {
            const hash = (x * 7 + y * 13) % 11;
            const tileIdx = hash < 4 ? 0 : hash < 8 ? 1 : hash === 8 ? 2 : hash === 9 ? 4 : 3;
            drawAtlasTile(ctx, tiles, tileIdx, x, y, 1);
          }
        }

        const portalX = Math.round(w * 0.5);
        const portalY = Math.round(h * 0.22);
        const portalFrame = Math.floor(t * 6) % 4;
        const brazierFrame = Math.floor(t * 5) % 2;

        drawAtlasTile(ctx, tiles, 14 + portalFrame, portalX - 56, portalY - 56, 1.75);
        drawAtlasTile(ctx, tiles, 12 + brazierFrame, portalX - 165, portalY - 8, 1.15);
        drawAtlasTile(ctx, tiles, 12 + brazierFrame, portalX + 95, portalY - 8, 1.15);

        drawAtlasTile(ctx, tiles, biomeDef.cornerTileIndex, 24, 90, 1.55);
        drawAtlasTile(ctx, tiles, biomeDef.cornerTileIndex, w - 130, 90, 1.55);
        drawAtlasTile(ctx, tiles, 7, 140, h - 180, 1.35);
        drawAtlasTile(ctx, tiles, 10, w - 210, h - 175, 1.25);
        drawAtlasTile(ctx, tiles, 18, 86, h * 0.48, 1.3);

        if (boss) {
          drawSpriteFrame(ctx, boss, 'idle', 'left', t * 6, w * 0.85, h * 0.4, 1.22, 0, 0.9);
        }
        if (mage) {
          drawSpriteFrame(ctx, mage, 'idle', 'right', t * 6, w * 0.15, h * 0.72, 1.45, 0, 0.92);
        }

        if (!reducedMotion) {
          ctx.fillStyle = biomeDef.accentColor;
          ctx.globalAlpha = 0.55;
          for (const p of motes) {
            const px = ((p.x + t * p.vx) % (w + 40)) - 20;
            const py = ((p.y + t * p.vy) % (h + 40)) - 20;
            ctx.fillRect(Math.round(px), Math.round(py), p.size, p.size - 1);
          }
          ctx.globalAlpha = 1;
        }

        const scrim = ctx.createRadialGradient(
          w * 0.5,
          h * 0.48,
          80,
          w * 0.5,
          h * 0.5,
          Math.max(w, h) * 0.74
        );
        scrim.addColorStop(0, 'rgba(20, 15, 31, 0.74)');
        scrim.addColorStop(1, 'rgba(13, 9, 20, 0.93)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [selectedClass.assetId, biomeDef, reducedMotion]);

  const bestScore = recentRuns.reduce((max, r) => Math.max(max, r.score), 0);

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-[#171321] text-[#EFEAF7]">
      <canvas
        ref={backdropRef}
        className="pointer-events-none fixed inset-0 h-full w-full"
        aria-hidden="true"
      />

      {/* Top Navigation Bar */}
      <header className="relative z-10 flex items-center justify-between gap-8 border-b border-[#D9BA72]/20 bg-[#171321]/80 px-6 py-4 backdrop-blur-xs">
        <span className="font-display text-lg font-bold tracking-wider text-[#D9BA72] whitespace-nowrap shrink-0">
          ARCHMAGE: RIFTBOUND
        </span>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#C8BEDB]">
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onOpenAssetLab();
            }}
            className="hover:text-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Asset Lab (46 Sheets)
          </button>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onOpenCodex();
            }}
            className="hover:text-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            78-Resonance Codex
          </button>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onOpenSettings();
            }}
            className="hover:text-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Settings
          </button>
        </nav>

        <button
          onClick={() => {
            soundEngine.playUiClick();
            onStartSoloRun();
          }}
          className="rounded-lg border border-[#D9BA72] bg-[#34283F] px-4 py-2 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {runMode === 'gauntlet' ? 'Start Rift Gauntlet' : `Enter ${biomeDef.name}`}
        </button>
      </header>

      {/* Main Hub Workspace */}
      <main className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-1 flex-col justify-center px-6 py-8">
        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1.06fr_0.94fr]">
          {/* Left Column: Title, Mode + Biome Picker, Seed, & Launch Actions */}
          <section className="flex flex-col justify-between space-y-6">
            <div>
              <p className="text-xs font-medium tracking-widest text-[#A991F7]">
                Dark Arcane Pixel Roguelite · V3.1 · 5 Biomes · 5 Tyrants · 13 Schools · 78 Resonances
              </p>
              <h1 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-wide text-[#D9BA72] sm:text-5xl [text-wrap:balance]">
                ARCHMAGE: RIFTBOUND
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#CFC6E2]">
                Forge any 3-school loadout from all 13 Elemental Schools to unleash 5-stage elemental spells across{' '}
                <span className="text-[#FF8AD4] font-medium">Cursed Grove</span>,{' '}
                <span className="text-[#58D6C2] font-medium">Undead Crypt</span>,{' '}
                <span className="text-[#9BE870] font-medium">Blighted Marsh</span>,{' '}
                <span className="text-[#FF6B3D] font-medium">Ashen Citadel</span>, and{' '}
                <span className="text-[#7C9BFF] font-medium">Astral Abyss</span>.
              </p>
            </div>

            {/* Run Mode & Biome Selector Panel */}
            <div className="arcane-panel rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-bold text-[#D9BA72]">
                  Expedition Mode &amp; Biome
                </h2>
                <div className="flex items-center gap-1 rounded-lg bg-[#140F1E] p-1">
                  <button
                    onClick={() => {
                      soundEngine.playUiClick();
                      onSelectRunMode('single');
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      runMode === 'single'
                        ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/45'
                        : 'text-[#A89EC0] hover:text-[#EFEAF7]'
                    }`}
                  >
                    Single Biome (3 Waves)
                  </button>
                  <button
                    onClick={() => {
                      soundEngine.playUiClick();
                      onSelectRunMode('gauntlet');
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      runMode === 'gauntlet'
                        ? 'bg-[#34283F] text-[#58D6C2] border border-[#58D6C2]/50'
                        : 'text-[#A89EC0] hover:text-[#EFEAF7]'
                    }`}
                  >
                    <InfinityIcon className="h-3.5 w-3.5" />
                    Endless Rift Gauntlet
                  </button>
                </div>
              </div>

              {/* 5 Playable Biomes */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {BIOME_LIST.map((b) => {
                  const active = b.id === selectedBiome;
                  const tyrantTile =
                    b.bossId === 'bone_regent'
                      ? 6
                      : b.bossId === 'blight_colossus'
                        ? 7
                        : b.bossId === 'rift_leviathan'
                          ? 8
                          : b.bossId === 'cinder_archon'
                            ? 10
                            : 11;
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        soundEngine.playUiClick();
                        onSelectBiome(b.id);
                      }}
                      className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-[#D9BA72] bg-[#2C213E]'
                          : 'border-[#A991F7]/15 bg-[#191326] hover:border-[#A991F7]/45'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#D9BA72]/30 bg-[#120D1C]">
                          <AtlasIcon
                            assetId="portraits_classes_tyrants"
                            tileIndex={tyrantTile}
                            size={38}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-display text-sm font-bold text-[#EFEAF7] block truncate">
                            {b.name}
                          </span>
                          <div className="mt-0.5 text-[11px] font-medium truncate" style={{ color: b.accentColor }}>
                            Tyrant: {b.bossName}
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] leading-snug text-[#A99EC2] line-clamp-2">
                        {b.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-[#BEB4D4]">
                {runMode === 'gauntlet'
                  ? `Starts in ${biomeDef.name} at Rift Tier 1. Defeating each Tyrant opens a Rift Gate to the next biome with escalating enemy HP, cadence, and carried-over attunements.`
                  : biomeDef.description}
              </p>
            </div>

            {/* Primary & Secondary Launch Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onStartSoloRun();
                }}
                className="inline-flex items-center gap-2.5 rounded-lg border-2 border-[#D9BA72] bg-linear-to-b from-[#493363] to-[#2F2042] px-6 py-3.5 font-display text-base font-bold tracking-wide text-[#FBF0D2] shadow-lg hover:from-[#5A3F7A] hover:to-[#3A2852] transition-all cursor-pointer whitespace-nowrap"
              >
                <Swords className="h-5 w-5 text-[#D9BA72]" />
                {runMode === 'gauntlet' ? `Launch Gauntlet (${biomeDef.name})` : `Enter ${biomeDef.name}`}
              </button>

              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onOpenAssetLab();
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-[#A991F7]/45 bg-[#221933]/90 px-4 py-3.5 text-sm font-semibold text-[#EFEAF7] hover:border-[#A991F7] hover:bg-[#2C2142] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Wrench className="h-4 w-4 text-[#58D6C2]" />
                Asset Lab &amp; Importer
              </button>
            </div>

            {/* Honest Online Party Notice + Quick Links */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-[#A398BC]">
              <button
                type="button"
                disabled
                title="Online Party requires a dedicated authoritative server and is disabled in this standalone solo build."
                className="inline-flex items-center gap-2 rounded-lg border border-[#A991F7]/15 bg-[#1B1528]/80 px-3 py-1.5 text-xs font-medium text-[#7F7499] cursor-not-allowed whitespace-nowrap"
              >
                <Lock className="h-3.5 w-3.5" />
                Online Party · Unavailable in Solo Build
              </button>

              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onOpenCodex();
                }}
                className="inline-flex items-center gap-1.5 text-[#C7BED8] hover:text-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap"
              >
                <BookOpen className="h-3.5 w-3.5" />
                78-Resonance Codex
              </button>

              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onOpenSettings();
                }}
                className="inline-flex items-center gap-1.5 text-[#C7BED8] hover:text-[#D9BA72] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Settings className="h-3.5 w-3.5" />
                Audio &amp; Controls
              </button>
            </div>

            {/* Seed & Verified Metrics */}
            <div className="grid grid-cols-1 gap-4 border-t border-[#D9BA72]/20 pt-4 sm:grid-cols-2">
              <div>
                <label htmlFor="arena-seed-input" className="block text-xs font-medium text-[#A99EC2]">
                  Arena Seed (Deterministic Layout)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    id="arena-seed-input"
                    type="text"
                    value={seed}
                    maxLength={18}
                    onChange={(e) => onChangeSeed(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-[#D9BA72]/30 bg-[#140F1E] px-3 py-2 font-mono text-sm text-[#D9BA72] focus:border-[#D9BA72] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playUiClick();
                      onRandomizeSeed();
                    }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#A991F7]/30 bg-[#241B35] text-[#EFEAF7] hover:border-[#D9BA72] hover:text-[#D9BA72] transition-colors cursor-pointer"
                    aria-label="Generate random arena seed"
                    title="Randomize seed"
                  >
                    <Dices className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col justify-end text-xs text-[#B5AACB]">
                <div className="flex items-center justify-between py-0.5">
                  <span>Validated Sprite Sheets</span>
                  <span className="font-mono tabular-nums text-[#58D6C2]">46 PNG + JSON (Hi-Bit 2×)</span>
                </div>
                <div className="flex items-center justify-between py-0.5">
                  <span>Verified Frames</span>
                  <span className="font-mono tabular-nums text-[#D9BA72]">3,942 (0 dupes)</span>
                </div>
                {bestScore > 0 && (
                  <div className="flex items-center justify-between py-0.5">
                    <span>Best Solo Score</span>
                    <span className="font-mono tabular-nums text-[#EFEAF7]">{bestScore.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Right Column: 6-Class Picker + 3-Slot 13-School Loadout Builder */}
          <section className="arcane-panel flex flex-col justify-between rounded-xl p-5 space-y-5">
            {/* Mage Class Selector */}
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-bold text-[#D9BA72]">1. Select Archmage Class</h2>
                <span className="text-xs text-[#9E93B5]">6 / 6 Playable</span>
              </div>

              <div className="mt-3 flex items-center gap-3.5 border-b border-[#D9BA72]/18 pb-3.5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-[#D9BA72]/40 bg-[#140E1E]">
                  <SpritePreview
                    assetId={selectedClass.assetId}
                    state="idle"
                    direction="down"
                    size={72}
                    scale={1.12}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-display text-lg font-bold text-[#EFEAF7]">{selectedClass.name}</h3>
                    <span className="text-xs font-medium" style={{ color: selectedClass.accentColor }}>
                      {selectedClass.primaryElement}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#C2B8D6]">{selectedClass.description}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3.5 font-mono text-[11px] tabular-nums text-[#B8AEC9]">
                    <span>HP <strong className="text-[#E96578]">{selectedClass.baseHp}</strong></span>
                    <span>Aether <strong className="text-[#58D6C2]">{selectedClass.baseAether}</strong></span>
                    <span>Power <strong className="text-[#D9BA72]">{Math.round(selectedClass.spellPower * 100)}%</strong></span>
                    <span>Haste <strong className="text-[#A991F7]">{Math.round(selectedClass.cooldownHaste * 100)}%</strong></span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {MAGE_CLASSES.map((cls) => {
                  const active = cls.id === selectedClass.id;
                  return (
                    <button
                      key={cls.id}
                      onClick={() => {
                        soundEngine.playUiClick();
                        onSelectClass(cls);
                      }}
                      className={`flex flex-col items-center rounded-lg border p-1.5 transition-colors cursor-pointer ${
                        active
                          ? 'border-[#D9BA72] bg-[#302342]'
                          : 'border-[#A991F7]/18 bg-[#1A1426] hover:border-[#A991F7]/50'
                      }`}
                    >
                      <SpritePreview
                        assetId={cls.assetId}
                        state={active ? 'cast' : 'idle'}
                        direction="down"
                        size={42}
                        scale={0.68}
                        animate={active}
                      />
                      <span className="mt-0.5 font-display text-[11px] font-bold text-[#EFEAF7] truncate max-w-full">
                        {cls.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3-Slot 13-School Spell Loadout Picker */}
            <div className="border-t border-[#D9BA72]/20 pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-bold text-[#D9BA72]">
                  2. Equip 3 Elemental Schools (Hotkeys 1 · 2 · 3)
                </h2>
                <span className="text-xs text-[#58D6C2]">13 / 13 Live</span>
              </div>

              {/* Active 3 Slots */}
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {([0, 1, 2] as const).map((slotIdx) => {
                  const sid = equippedSchools[slotIdx];
                  const def = SCHOOL_DEFS[sid];
                  const isEditing = editingSlot === slotIdx;
                  return (
                    <button
                      key={slotIdx}
                      onClick={() => {
                        soundEngine.playUiClick();
                        setEditingSlot(slotIdx);
                      }}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors cursor-pointer ${
                        isEditing
                          ? 'border-[#D9BA72] bg-[#322447]'
                          : 'border-[#A991F7]/20 bg-[#1A1426] hover:border-[#A991F7]/50'
                      }`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#120D1C]">
                        <AtlasIcon tileIndex={def.iconIndex} size={26} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] text-[#D9BA72]">Slot {slotIdx + 1}</div>
                        <div className="text-xs font-bold text-[#EFEAF7] truncate">{def.name}</div>
                        <div className="text-[10px] text-[#9E93B5] truncate">{def.spellName}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 13-School Palette Grid for Active Editing Slot */}
              <div className="mt-2.5">
                <div className="text-[11px] text-[#A99EC2] mb-1.5">
                  Pick school for <span className="font-semibold text-[#D9BA72]">Slot {editingSlot + 1}</span>:
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
                  {ALL_SCHOOL_IDS.map((sid) => {
                    const def = SCHOOL_DEFS[sid];
                    const inSlot = equippedSchools.indexOf(sid);
                    const isCurrentSlot = inSlot === editingSlot;
                    return (
                      <button
                        key={sid}
                        onClick={() => {
                          soundEngine.playUiClick();
                          onChangeLoadoutSlot(editingSlot, sid);
                        }}
                        title={`${def.name}: ${def.spellName} — ${def.shortEffect}`}
                        className={`flex flex-col items-center rounded-md border p-1.5 transition-colors cursor-pointer ${
                          isCurrentSlot
                            ? 'border-[#D9BA72] bg-[#37284E]'
                            : inSlot >= 0
                              ? 'border-[#58D6C2]/45 bg-[#231B36]'
                              : 'border-[#A991F7]/12 bg-[#161122] hover:border-[#A991F7]/50'
                        }`}
                      >
                        <AtlasIcon tileIndex={def.iconIndex} size={22} />
                        <span className="mt-0.5 text-[10px] font-medium text-[#DFD7F0] truncate max-w-full">
                          {def.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Triad Resonances Preview */}
              <div className="mt-3 rounded-lg border border-[#A991F7]/20 bg-[#140F1E] p-3">
                <div className="text-[11px] font-medium text-[#A991F7]">
                  Active Triad Resonances (Prime with 1 school, detonate with another)
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  {activeResonances.map((res) => (
                    <div key={res.key} className="flex items-baseline justify-between gap-2">
                      <span className="text-[#EFEAF7] font-medium">
                        <span style={{ color: SCHOOL_DEFS[res.schools[0]].color }}>
                          {SCHOOL_DEFS[res.schools[0]].name}
                        </span>
                        <span className="mx-1 text-[#6D6187]">+</span>
                        <span style={{ color: SCHOOL_DEFS[res.schools[1]].color }}>
                          {SCHOOL_DEFS[res.schools[1]].name}
                        </span>
                        <span className="mx-1.5 text-[#6D6187]">→</span>
                        <span className="text-[#D9BA72]">{res.name}</span>
                      </span>
                      <span className="font-mono text-[10px] text-[#58D6C2] shrink-0">
                        {res.archetypeLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Controls Cheat-Sheet */}
            <div className="border-t border-[#A991F7]/15 pt-3 text-xs text-[#ADA3C4]">
              <span className="font-mono text-[#D9BA72]">WASD</span> Move
              <span className="mx-2 text-[#5B4F75]" aria-hidden="true">·</span>
              <span className="font-mono text-[#D9BA72]">LMB / RMB</span> Cast / Alternate Slot
              <span className="mx-2 text-[#5B4F75]" aria-hidden="true">·</span>
              <span className="font-mono text-[#D9BA72]">1 2 3</span> Schools
              <span className="mx-2 text-[#5B4F75]" aria-hidden="true">·</span>
              <span className="font-mono text-[#D9BA72]">Space</span> Blink
              <span className="mx-2 text-[#5B4F75]" aria-hidden="true">·</span>
              <span className="font-mono text-[#D9BA72]">F</span> Surge
              <span className="mx-2 text-[#5B4F75]" aria-hidden="true">·</span>
              <span className="font-mono text-[#D9BA72]">Q</span> Vial
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
