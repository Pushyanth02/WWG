import { RotateCcw, Sparkles, Swords, Wrench } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { SCHOOL_DEFS } from '../data/resonances';
import type { RunSummary } from '../types/game';
import { AtlasIcon, SpritePreview } from './SpritePreview';

interface ResultsScreenProps {
  summary: RunSummary;
  onReplaySameSeed: () => void;
  onNewSeedRun: () => void;
  onOpenAssetLab: () => void;
  onReturnMenu: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ResultsScreen({
  summary,
  onReplaySameSeed,
  onNewSeedRun,
  onOpenAssetLab,
  onReturnMenu,
}: ResultsScreenProps) {
  const accent = summary.victory ? '#D9BA72' : '#E96578';
  const modeLabel =
    summary.mode === 'gauntlet'
      ? `Endless Gauntlet · Tier ${summary.gauntletTier} · ${summary.biomesCleared} Biome${summary.biomesCleared === 1 ? '' : 's'} Cleared`
      : `${summary.biomeName} · Single Biome`;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#171321] p-6">
      <div className="arcane-panel w-full max-w-3xl rounded-xl p-6 md:p-10">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-[#D9BA72]/40 bg-[#140E1E]">
            <SpritePreview
              assetId={`mage_${summary.classId}`}
              state={summary.victory ? 'idle' : 'downed'}
              direction="down"
              size={72}
              scale={1.15}
            />
          </div>

          <p className="mt-4 text-xs font-medium tracking-widest text-[#B8AEC9]">
            {modeLabel} · Seed {summary.seed} · {summary.className}
          </p>
          <h1
            className="mt-2 font-display text-4xl font-bold tracking-wider md:text-5xl"
            style={{ color: accent }}
          >
            {summary.victory ? 'VICTORY' : 'DEFEATED'}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[#C7BED8]">
            {summary.victory
              ? `The Rift Tyrant fell before your ${summary.className}. Replay this exact seed to refine your time or forge a new elemental triad.`
              : `The Rift claimed your ${summary.className} in ${summary.biomeName}. Prime enemies with one school and detonate with another using RMB or hotkeys 1–3.`}
          </p>

          {/* Equipped Triad Readout */}
          <div className="mt-4 flex items-center gap-3 text-xs text-[#CFC6E2]">
            {summary.equippedSchools.map((sid, idx) => {
              const def = SCHOOL_DEFS[sid];
              return (
                <span key={sid} className="inline-flex items-center gap-1.5">
                  <AtlasIcon tileIndex={def.iconIndex} size={18} />
                  <span style={{ color: def.color }}>{def.name}</span>
                  {idx < 2 && <span className="ml-1.5 text-[#5E5275]" aria-hidden="true">·</span>}
                </span>
              );
            })}
          </div>
        </div>

        <div className="gold-divider my-6" />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Final Score', value: summary.score.toLocaleString(), color: '#D9BA72' },
            { label: 'Time', value: formatDuration(summary.elapsedSec), color: '#EFEAF7' },
            {
              label: summary.mode === 'gauntlet' ? 'Biomes Cleared' : 'Waves Cleared',
              value:
                summary.mode === 'gauntlet'
                  ? `${summary.biomesCleared} (T${summary.gauntletTier})`
                  : `${summary.wavesCleared} / 3`,
              color: '#58D6C2',
            },
            { label: 'Foes Vanquished', value: String(summary.kills), color: '#EFEAF7' },
            { label: 'Resonances Triggered', value: String(summary.resonanceCount), color: '#A991F7' },
            { label: 'Damage Dealt', value: summary.damageDealt.toLocaleString(), color: '#E96578' },
            { label: 'Arcane Shards', value: String(summary.shards), color: '#A991F7' },
            { label: 'Gold Collected', value: String(summary.gold), color: '#D9BA72' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-[#A991F7]/18 bg-[#1A1426] p-3.5 text-center"
            >
              <div className="text-xs text-[#9E93B5]">{stat.label}</div>
              <div
                className="mt-1 font-mono text-xl font-semibold tabular-nums"
                style={{ color: stat.color }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {summary.topResonances.length > 0 && (
          <div className="mt-5 border-t border-[#A991F7]/15 pt-4">
            <div className="text-xs font-medium text-[#9E93B5]">Top Pair Resonances Detonated</div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#EFEAF7]">
              {summary.topResonances.map((r, idx) => (
                <span key={r.name}>
                  <span className="text-[#D9BA72]">{r.name}</span>
                  <span className="font-mono text-xs text-[#58D6C2]"> ×{r.count}</span>
                  {idx < summary.topResonances.length - 1 && (
                    <span className="ml-4 text-[#5E5275]" aria-hidden="true">·</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {summary.upgrades.length > 0 && (
          <div className="mt-4 border-t border-[#A991F7]/15 pt-4">
            <div className="text-xs font-medium text-[#9E93B5]">Attunements Collected</div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#EFEAF7]">
              {summary.upgrades.map((u, idx) => (
                <span key={`${u.id}-${idx}`}>
                  <span className="text-[#D9BA72]">{u.name}</span>
                  <span className="text-[#8E83A8]"> ({u.category})</span>
                  {idx < summary.upgrades.length - 1 && (
                    <span className="ml-4 text-[#5E5275]" aria-hidden="true">·</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onReplaySameSeed();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[#D9BA72] bg-[#3A2B4C] px-5 py-2.5 text-sm font-semibold text-[#F7E8C3] hover:bg-[#493661] transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="h-4 w-4" />
            Replay Seed ({summary.seed})
          </button>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onNewSeedRun();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[#A991F7]/45 bg-[#241B35] px-5 py-2.5 text-sm font-semibold text-[#EFEAF7] hover:border-[#A991F7] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Swords className="h-4 w-4 text-[#58D6C2]" />
            New Seed Run
          </button>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onOpenAssetLab();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[#A991F7]/25 bg-[#1B1528] px-4 py-2.5 text-sm font-medium text-[#C9C0DC] hover:text-[#EFEAF7] hover:border-[#A991F7]/60 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Wrench className="h-4 w-4" />
            Asset Lab
          </button>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onReturnMenu();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-transparent px-4 py-2.5 text-sm font-medium text-[#A99EC2] hover:text-[#EFEAF7] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="h-4 w-4" />
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}
