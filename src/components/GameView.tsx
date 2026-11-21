import { Pause, Play, RotateCcw, Settings, Sparkles, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { SCHOOL_DEFS } from '../data/resonances';
import { RiftboundEngine } from '../game/engine';
import { useSpellImpactFx } from '../hooks/useSpellImpactFx';
import type {
  BiomeId,
  GameSettings,
  HudSnapshot,
  MageClassDef,
  MinimapSnapshot,
  RunMode,
  RunSummary,
  SchoolId,
  UpgradeCardDef,
} from '../types/game';
import { AtlasIcon, SpritePreview } from './SpritePreview';
import { UpgradeModal } from './UpgradeModal';

interface GameViewProps {
  mageClass: MageClassDef;
  biomeId: BiomeId;
  mode: RunMode;
  equippedSchools: [SchoolId, SchoolId, SchoolId];
  seed: string;
  settings: GameSettings;
  onOpenSettings: () => void;
  onOpenAssetLab: () => void;
  onRestartSameSeed: () => void;
  onReturnMenu: () => void;
  onRunFinished: (summary: RunSummary) => void;
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function Minimap({ data }: { data: MinimapSnapshot }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const sx = w / data.arenaWidth;
    const sy = h / data.arenaHeight;

    ctx.fillStyle = '#140F1E';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(217, 186, 114, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    ctx.fillStyle = '#4B3D66';
    for (const o of data.obstacles) {
      ctx.beginPath();
      ctx.arc(o.x * sx, o.y * sy, Math.max(2, o.r * sx), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#A991F7';
    ctx.beginPath();
    ctx.arc(data.portal.x * sx, data.portal.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#D9BA72';
    for (const pk of data.pickups) {
      ctx.fillRect(Math.round(pk.x * sx) - 1, Math.round(pk.y * sy) - 1, 2, 2);
    }

    for (const e of data.enemies) {
      ctx.fillStyle = e.isBoss ? '#D9BA72' : '#E96578';
      ctx.beginPath();
      ctx.arc(e.x * sx, e.y * sy, e.isBoss ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#58D6C2';
    ctx.beginPath();
    ctx.arc(data.player.x * sx, data.player.y * sy, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }, [data]);

  return (
    <canvas
      ref={ref}
      width={126}
      height={84}
      className="block rounded-lg border border-[#D9BA72]/45 bg-[#140F1E] shadow-md"
    />
  );
}

export function GameView({
  mageClass,
  biomeId,
  mode,
  equippedSchools,
  seed,
  settings,
  onOpenSettings,
  onOpenAssetLab,
  onRestartSameSeed,
  onReturnMenu,
  onRunFinished,
}: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<RiftboundEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{
    waveCleared: number;
    biomeId: BiomeId;
    choices: UpgradeCardDef[];
  } | null>(null);
  const [gauntletGate, setGauntletGate] = useState<{
    clearedBiome: BiomeId;
    nextBiome: BiomeId;
    nextTier: number;
    choices: UpgradeCardDef[];
  } | null>(null);

  const loadoutKey = equippedSchools.join(',');
  const modalBlocking = Boolean(upgradePrompt || gauntletGate);

  const { overlayCanvasRef, shakeContainerRef, emitSpellEvent, clearFx } = useSpellImpactFx({
    settings,
    paused: paused || modalBlocking,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    clearFx();
    soundEngine.startAmbient();
    const engine = new RiftboundEngine(
      canvas,
      {
        mageClass,
        biomeId,
        mode,
        equippedSchools,
        seed,
        settings,
      },
      {
        onHudUpdate: (snap) => setHud(snap),
        onUpgradePrompt: (waveCleared, choices) => {
          setUpgradePrompt({ waveCleared, biomeId: hud?.biomeId ?? biomeId, choices });
        },
        onGauntletBiomeCleared: (clearedBiome, nextBiome, nextTier, choices) => {
          setGauntletGate({ clearedBiome, nextBiome, nextTier, choices });
        },
        onRunFinished: (summary) => {
          soundEngine.stopAmbient();
          onRunFinished(summary);
        },
        onSpellEvent: emitSpellEvent,
      }
    );
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.destroy();
      engineRef.current = null;
      clearFx();
      soundEngine.stopAmbient();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mageClass.id, biomeId, mode, loadoutKey, seed]);

  useEffect(() => {
    engineRef.current?.updateSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalBlocking) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        setPaused((prev) => {
          const next = !prev;
          engineRef.current?.setPaused(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalBlocking]);

  const togglePause = () => {
    if (modalBlocking) return;
    soundEngine.playUiClick();
    setPaused((prev) => {
      const next = !prev;
      engineRef.current?.setPaused(next);
      return next;
    });
  };

  const handleSelectUpgrade = (card: UpgradeCardDef) => {
    setUpgradePrompt(null);
    engineRef.current?.applyUpgrade(card);
  };

  const handleAdvanceGauntlet = (card: UpgradeCardDef) => {
    setGauntletGate(null);
    engineRef.current?.advanceGauntletBiome(card);
  };

  const handleExtractGauntlet = () => {
    setGauntletGate(null);
    engineRef.current?.endGauntletEarly();
  };

  const hpPct = hud ? Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100)) : 100;
  const aetherPct = hud ? Math.max(0, Math.min(100, (hud.aether / hud.maxAether) * 100)) : 100;
  const surgeReady = (hud?.surgeCharge ?? 0) >= 100;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#171321] select-none">
      <div ref={shakeContainerRef} className="relative h-full w-full will-change-transform">
        <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" />
        <canvas
          ref={overlayCanvasRef}
          className="pointer-events-none absolute inset-0 z-10 block h-full w-full"
          aria-hidden="true"
        />
      </div>

      {/* Top HUD Layer */}
      {hud && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
          {/* Top-Left: Portrait + HP & Aether */}
          <div className="pointer-events-auto arcane-panel flex items-center gap-3 rounded-xl px-3.5 py-2.5">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-[#D9BA72]/70 bg-[#140E1E]">
              <SpritePreview
                assetId={mageClass.assetId}
                state="idle"
                direction="down"
                size={48}
                scale={0.78}
              />
              <span className="absolute -bottom-1.5 -right-1.5 rounded border border-[#D9BA72]/70 bg-[#171321] px-1 font-mono text-[10px] font-bold text-[#D9BA72]">
                Lv.{hud.level}
              </span>
            </div>

            <div className="w-44 space-y-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-display font-bold text-[#EFEAF7]">{mageClass.name}</span>
                <span className="font-mono text-[11px] text-[#9E93B5]">{seed}</span>
              </div>

              <div className="relative h-4 overflow-hidden rounded border border-[#D9BA72]/35 bg-[#120D1B]">
                <div
                  className="h-full bg-linear-to-r from-[#A61E3C] to-[#E96578] transition-all duration-100"
                  style={{ width: `${hpPct}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-semibold tabular-nums text-white drop-shadow">
                  HP {hud.hp} / {hud.maxHp}
                </span>
              </div>

              <div className="relative h-3.5 overflow-hidden rounded border border-[#58D6C2]/35 bg-[#120D1B]">
                <div
                  className="h-full bg-linear-to-r from-[#1D6D7A] to-[#58D6C2] transition-all duration-100"
                  style={{ width: `${aetherPct}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-semibold tabular-nums text-white drop-shadow">
                  Aether {hud.aether} / {hud.maxAether}
                </span>
              </div>
            </div>
          </div>

          {/* Top-Center: Biome Crest OR Active Tyrant Boss Health Bar */}
          <div className="flex flex-col items-center">
            {hud.boss ? (
              <div className="arcane-panel flex w-80 items-center gap-3 rounded-xl px-3.5 py-2.5 sm:w-[420px]">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#D9BA72]/60 bg-[#140D1F]">
                  <AtlasIcon
                    assetId="portraits_classes_tyrants"
                    tileIndex={
                      hud.boss.id === 'bone_regent'
                        ? 6
                        : hud.boss.id === 'blight_colossus'
                          ? 7
                          : hud.boss.id === 'rift_leviathan'
                            ? 8
                            : hud.boss.id === 'cinder_archon'
                              ? 10
                              : 11
                    }
                    size={42}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-sm font-bold tracking-wider text-[#D9BA72] truncate">
                      {hud.boss.name.toUpperCase()}
                    </span>
                    <span className="font-mono text-xs text-[#A991F7] shrink-0">
                      {hud.boss.transitioning
                        ? 'Phase Shift'
                        : hud.boss.phase === 2
                          ? 'Phase II'
                          : 'Phase I'}
                      {hud.mode === 'gauntlet' ? ` · Tier ${hud.gauntletTier}` : ''}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-4 overflow-hidden rounded border border-[#D9BA72]/60 bg-[#140D1F]">
                    <div
                      className={`h-full transition-all duration-100 ${
                        hud.boss.phase === 2
                          ? 'bg-linear-to-r from-[#7B2CBF] via-[#C9366B] to-[#E96578]'
                          : 'bg-linear-to-r from-[#9E1C36] to-[#E96578]'
                      }`}
                      style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.maxHp) * 100)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold tabular-nums text-white">
                      {hud.boss.hp} / {hud.boss.maxHp}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-col items-center rounded-xl border border-[#D9BA72]/25 bg-[#171321]/82 px-5 py-2 backdrop-blur-xs">
                <span className="font-display text-base font-bold tracking-widest text-[#D9BA72]">
                  {hud.biomeName.toUpperCase()}
                </span>
                <span className="text-[11px] text-[#B5AACB]">
                  {hud.mode === 'gauntlet'
                    ? `Endless Gauntlet · Rift Tier ${hud.gauntletTier} · Wave ${hud.wave}/${hud.maxWaves}`
                    : `Wave ${hud.wave} / ${hud.maxWaves}`}
                </span>
              </div>
            )}

            {hud.bannerText && (
              <div className="mt-3 rounded-lg border border-[#D9BA72]/55 bg-[#191228]/92 px-5 py-2 font-display text-sm font-bold tracking-wider text-[#F7E7BE] shadow-lg">
                {hud.bannerText}
              </div>
            )}
          </div>

          {/* Top-Right: Telemetry & Minimap */}
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="arcane-panel flex items-center gap-3 rounded-xl px-3.5 py-2 font-mono text-xs tabular-nums">
              <span className="text-[#D9BA72]">
                Wave {hud.wave}/{hud.maxWaves}
              </span>
              <span className="text-[#9E93B5]" aria-hidden="true">·</span>
              <span className="text-[#E96578]">{hud.enemiesRemaining} Left</span>
              <span className="text-[#9E93B5]" aria-hidden="true">·</span>
              <span className="text-[#A991F7]">{hud.shards} Shards</span>
              <span className="text-[#9E93B5]" aria-hidden="true">·</span>
              <span className="text-[#EFEAF7]">{formatTimer(hud.elapsedSec)}</span>
              <button
                onClick={togglePause}
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-md border border-[#D9BA72]/35 bg-[#221933] text-[#EFEAF7] hover:border-[#D9BA72] hover:text-[#D9BA72] cursor-pointer"
                aria-label="Pause game"
                title="Pause (Esc)"
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  if (!paused) {
                    setPaused(true);
                    engineRef.current?.setPaused(true);
                  }
                  onOpenSettings();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-[#A991F7]/30 bg-[#221933] text-[#EFEAF7] hover:border-[#A991F7] cursor-pointer"
                aria-label="Open settings"
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="hidden sm:block">
              <Minimap data={hud.minimap} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom HUD Layer: Dynamic 3-School Hotbar */}
      {hud && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-4">
          {hud.resonanceHint && (
            <div className="rounded-md border border-[#D9BA72]/55 bg-[#1B1329]/92 px-3.5 py-1 text-xs font-medium text-[#F7E5B8]">
              Primed ({SCHOOL_DEFS[hud.resonanceHint.primedSchool].statusTag}) — Strike with{' '}
              <span style={{ color: SCHOOL_DEFS[hud.resonanceHint.triggerSchool].color }}>
                {SCHOOL_DEFS[hud.resonanceHint.triggerSchool].spellName}
              </span>{' '}
              to trigger <strong className="text-[#D9BA72]">{hud.resonanceHint.resonanceName}</strong>
            </div>
          )}

          <div className="pointer-events-auto arcane-panel flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
            {/* Health Vial (Q) */}
            <button
              onClick={() => engineRef.current?.triggerPotion()}
              disabled={hud.potions <= 0}
              className={`relative flex h-13 w-13 flex-col items-center justify-center rounded-xl border transition-colors ${
                hud.potions > 0
                  ? 'border-[#E96578]/55 bg-[#23162D] hover:border-[#E96578] cursor-pointer'
                  : 'border-[#A991F7]/15 bg-[#161121] opacity-45 cursor-not-allowed'
              }`}
              title="Drink Health Vial (Q)"
            >
              <AtlasIcon tileIndex={0} size={28} />
              <span className="absolute top-1 left-1.5 font-mono text-[10px] font-bold text-[#B8AEC9]">Q</span>
              <span className="absolute right-1.5 bottom-0.5 font-mono text-[10px] font-bold tabular-nums text-[#E96578]">
                ×{hud.potions}
              </span>
            </button>

            <div className="h-9 w-px bg-[#D9BA72]/20" aria-hidden="true" />

            {/* 3 Equipped Elemental School Slots */}
            {hud.slotCooldowns.map((slot, idx) => {
              const def = SCHOOL_DEFS[slot.schoolId];
              const pct = slot.max > 0 ? Math.min(100, (slot.remaining / slot.max) * 100) : 0;
              const selected = hud.activeSlotIndex === idx;
              return (
                <button
                  key={`${slot.schoolId}-${idx}`}
                  onClick={() => engineRef.current?.selectSlot(idx as 0 | 1 | 2)}
                  className={`relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-transform cursor-pointer ${
                    selected
                      ? 'border-[#D9BA72] bg-[#322447] -translate-y-0.5 shadow-md'
                      : 'border-[#A991F7]/25 bg-[#1C152B] hover:border-[#A991F7]/65'
                  }`}
                  title={`${def.name}: ${def.spellName} (${idx + 1}) — ${def.shortEffect}`}
                >
                  <AtlasIcon tileIndex={def.iconIndex} size={32} />
                  {pct > 0 && (
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 bg-[#0D0916]/75"
                      style={{ height: `${pct}%` }}
                    />
                  )}
                  <span className="absolute top-1 left-1.5 font-mono text-[10px] font-bold text-[#F5E7C4]">
                    {idx + 1}
                  </span>
                  <span className="absolute right-1.5 bottom-0.5 font-mono text-[9px] text-[#58D6C2]">
                    {def.cost}
                  </span>
                </button>
              );
            })}

            <div className="h-9 w-px bg-[#D9BA72]/20" aria-hidden="true" />

            {/* Blink (Space) */}
            <button
              onClick={() => engineRef.current?.triggerBlink()}
              className="relative flex h-14 w-16 flex-col items-center justify-center overflow-hidden rounded-xl border border-[#58D6C2]/50 bg-[#1B1A30] hover:border-[#58D6C2] transition-colors cursor-pointer"
              title="Blink Dash (Space) — Brief invulnerability & phase movement"
            >
              <span className="font-display text-xs font-bold text-[#58D6C2]">BLINK</span>
              <span className="font-mono text-[10px] text-[#B5AACB]">Space</span>
              {hud.blinkCooldown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0E0A17]/80 font-mono text-xs font-bold tabular-nums text-[#58D6C2]">
                  {hud.blinkCooldown.toFixed(1)}s
                </div>
              )}
            </button>

            {/* Aether Surge (F) */}
            <button
              onClick={() => engineRef.current?.triggerSurge()}
              className={`relative flex h-14 w-16 flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-all cursor-pointer ${
                surgeReady
                  ? 'border-[#D9BA72] bg-[#3D2559] shadow-lg'
                  : 'border-[#A991F7]/30 bg-[#1B152A]'
              }`}
              title="Aether Surge (F) — Unleashes radial knockback nova & restores Aether at 100% charge"
            >
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-[#A991F7]/25 transition-all"
                style={{ height: `${hud.surgeCharge}%` }}
              />
              <span className={`relative font-display text-xs font-bold ${surgeReady ? 'text-[#F8E7BF]' : 'text-[#A991F7]'}`}>
                SURGE
              </span>
              <span className="relative font-mono text-[10px] tabular-nums text-[#C9C0DC]">
                {surgeReady ? 'Press F' : `${hud.surgeCharge}%`}
              </span>
            </button>

            {/* Resonance Counter */}
            <div className="hidden sm:flex flex-col items-end pl-2 pr-1 text-right">
              <span className="text-[10px] text-[#9E93B5]">Resonances</span>
              <span className="font-mono text-sm font-bold tabular-nums text-[#D9BA72]">
                {hud.resonanceCount}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Between-Wave Upgrade Modal */}
      {upgradePrompt && (
        <UpgradeModal
          waveCleared={upgradePrompt.waveCleared}
          biomeId={hud?.biomeId ?? upgradePrompt.biomeId}
          choices={upgradePrompt.choices}
          onSelect={handleSelectUpgrade}
        />
      )}

      {/* Endless Gauntlet Rift Gate Transition Modal */}
      {gauntletGate && (
        <UpgradeModal
          waveCleared={3}
          biomeId={gauntletGate.clearedBiome}
          choices={gauntletGate.choices}
          onSelect={handleAdvanceGauntlet}
          gauntletGate={{
            nextBiome: gauntletGate.nextBiome,
            nextTier: gauntletGate.nextTier,
            onExtractVictory: handleExtractGauntlet,
          }}
        />
      )}

      {/* Pause Overlay */}
      {paused && !modalBlocking && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#0C0814]/80 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Run Paused"
        >
          <div className="arcane-panel w-full max-w-md rounded-xl p-6 text-center">
            <h2 className="font-display text-2xl font-bold tracking-wider text-[#D9BA72]">
              RUN PAUSED
            </h2>
            <p className="mt-1 text-xs text-[#B5AACB]">
              {hud?.biomeName ?? biomeId} · Seed {seed} · {mageClass.name}
            </p>
            <div className="gold-divider my-5" />
            <div className="flex flex-col gap-2.5">
              <button
                onClick={togglePause}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#D9BA72] bg-[#3A2B4C] px-4 py-2.5 text-sm font-semibold text-[#F8E7BF] hover:bg-[#493661] cursor-pointer"
              >
                <Play className="h-4 w-4" />
                Resume Run
              </button>
              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onRestartSameSeed();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#A991F7]/35 bg-[#221933] px-4 py-2.5 text-sm font-medium text-[#EFEAF7] hover:border-[#A991F7] cursor-pointer"
              >
                <RotateCcw className="h-4 w-4 text-[#58D6C2]" />
                Restart Seed ({seed})
              </button>
              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onOpenSettings();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#A991F7]/25 bg-[#1B1528] px-4 py-2.5 text-sm font-medium text-[#D4CCE6] hover:text-[#EFEAF7] cursor-pointer"
              >
                <Settings className="h-4 w-4" />
                Settings &amp; Controls
              </button>
              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onOpenAssetLab();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#A991F7]/25 bg-[#1B1528] px-4 py-2.5 text-sm font-medium text-[#D4CCE6] hover:text-[#EFEAF7] cursor-pointer"
              >
                <Wrench className="h-4 w-4" />
                Open Asset Lab
              </button>
              <button
                onClick={() => {
                  soundEngine.playUiClick();
                  onReturnMenu();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-[#A89EC0] hover:text-[#E96578] cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Abandon Run &amp; Return to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
