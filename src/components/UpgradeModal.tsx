import { BIOMES } from '../data/biomes';
import type { BiomeId, UpgradeCardDef } from '../types/game';
import { AtlasIcon } from './SpritePreview';

interface UpgradeModalProps {
  waveCleared: number;
  biomeId: BiomeId;
  choices: UpgradeCardDef[];
  onSelect: (card: UpgradeCardDef) => void;
  gauntletGate?: {
    nextBiome: BiomeId;
    nextTier: number;
    onExtractVictory: () => void;
  };
}

export function UpgradeModal({
  waveCleared,
  biomeId,
  choices,
  onSelect,
  gauntletGate,
}: UpgradeModalProps) {
  const currentBiome = BIOMES[biomeId];
  const nextBiome = gauntletGate ? BIOMES[gauntletGate.nextBiome] : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#0C0814]/84 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
    >
      <div className="arcane-panel w-full max-w-4xl rounded-xl p-6 md:p-8">
        <div className="text-center">
          <div className="text-xs font-medium tracking-widest text-[#58D6C2]">
            {gauntletGate
              ? `${currentBiome.name} Conquered · ${currentBiome.bossName} Slain · +45% Vitality & +1 Vial`
              : `${currentBiome.name} · Wave ${waveCleared} Cleared · +25% Vitality Restored`}
          </div>
          <h2
            id="upgrade-title"
            className="mt-2 font-display text-2xl font-bold tracking-wide text-[#D9BA72] md:text-3xl"
          >
            {gauntletGate ? 'Rift Gate Unlocked — Choose Your Boon' : 'Choose an Arcane Attunement'}
          </h2>
          <p className="mt-1.5 text-sm text-[#BFB5D4]">
            {gauntletGate && nextBiome
              ? `Next Realm: ${nextBiome.name} (Rift Tier ${gauntletGate.nextTier}) — Guarded by ${nextBiome.bossName}.`
              : waveCleared === 1
                ? 'Prime foes with one equipped school and detonate with another to unleash live pair resonances.'
                : `Prepare your attunements — ${currentBiome.bossName} awaits in Wave 3.`}
          </p>
        </div>

        <div className="gold-divider my-6" />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {choices.map((card, cardIdx) => {
            const relicTile = (card.iconIndex + cardIdx) % 12;
            return (
              <button
                key={card.id}
                onClick={() => onSelect(card)}
                className="group flex flex-col justify-between rounded-xl border border-[#D9BA72]/30 bg-[#1B1427] p-5 text-left transition-all duration-150 hover:-translate-y-1 hover:border-[#D9BA72] hover:bg-[#251C36] focus-visible:outline-2 focus-visible:outline-[#D9BA72] cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[#A991F7]">{card.category}</span>
                    <span className="text-[#D9BA72]">{card.rarity}</span>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <div
                      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-[#130E1D]"
                      style={{ borderColor: `${card.accentColor}66` }}
                    >
                      <AtlasIcon assetId="ui_relics_artifacts" tileIndex={relicTile} size={40} />
                      <div className="absolute -bottom-1.5 -right-1.5 rounded border border-[#D9BA72]/50 bg-[#130E1D] p-0.5">
                        <AtlasIcon tileIndex={card.iconIndex} size={16} />
                      </div>
                    </div>
                    <h3 className="font-display text-lg font-bold leading-snug text-[#EFEAF7] group-hover:text-[#F8E7BF]">
                      {card.name}
                    </h3>
                  </div>

                  <p className="mt-3.5 text-xs leading-relaxed text-[#C2B8D6]">{card.summary}</p>
                </div>

                <div className="mt-5 border-t border-[#A991F7]/15 pt-3.5">
                  <div className="font-mono text-xs font-medium text-[#58D6C2]">{card.statLabel}</div>
                  <div className="mt-3 flex items-center justify-between text-xs font-semibold text-[#D9BA72]">
                    <span>{gauntletGate && nextBiome ? `Enter ${nextBiome.name}` : 'Select Upgrade'}</span>
                    <span aria-hidden="true">→</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {gauntletGate && (
          <div className="mt-5 flex justify-center border-t border-[#A991F7]/15 pt-4">
            <button
              onClick={gauntletGate.onExtractVictory}
              className="rounded-lg border border-[#A991F7]/30 bg-[#1A1426] px-4 py-2 text-xs font-medium text-[#C7BED8] hover:border-[#D9BA72] hover:text-[#D9BA72] transition-colors cursor-pointer"
            >
              Claim Gauntlet Victory &amp; Extract Score Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
