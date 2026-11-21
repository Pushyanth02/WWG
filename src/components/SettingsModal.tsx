import { Volume2, VolumeX, X } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import type { GameSettings } from '../types/game';
import { DEFAULT_SETTINGS } from '../utils/storage';

interface SettingsModalProps {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onChange, onClose }: SettingsModalProps) {
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    soundEngine.playUiClick();
    onChange({ ...settings, [key]: value });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0914]/82 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-heading"
    >
      <div className="arcane-panel w-full max-w-3xl rounded-xl p-6 md:p-8">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#D9BA72]/20">
          <div>
            <h2 id="settings-heading" className="font-display text-2xl font-bold tracking-wide text-[#D9BA72]">
              Settings &amp; Controls
            </h2>
            <p className="mt-1 text-sm text-[#B8AEC9]">
              Audio, graphics, and accessibility preferences persist automatically across runs.
            </p>
          </div>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onClose();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#D9BA72]/30 bg-[#221A2E] text-[#EFEAF7] hover:border-[#D9BA72] hover:text-[#D9BA72] transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Audio Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#EFEAF7]">Audio</h3>
              <button
                onClick={() => update('muted', !settings.muted)}
                className="inline-flex items-center gap-2 rounded-md border border-[#A991F7]/30 bg-[#241B33] px-3 py-1.5 text-xs font-medium text-[#EFEAF7] hover:border-[#A991F7] transition-colors cursor-pointer whitespace-nowrap"
              >
                {settings.muted ? <VolumeX className="h-3.5 w-3.5 text-[#E96578]" /> : <Volume2 className="h-3.5 w-3.5 text-[#58D6C2]" />}
                {settings.muted ? 'Unmute Audio' : 'Mute Audio'}
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <div className="mb-1 flex justify-between text-xs text-[#C7BED8]">
                  <span>Master Volume</span>
                  <span className="font-mono tabular-nums text-[#D9BA72]">{Math.round(settings.masterVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.masterVolume}
                  onChange={(e) => update('masterVolume', Number(e.target.value))}
                  className="w-full accent-[#D9BA72]"
                />
              </label>

              <label className="block">
                <div className="mb-1 flex justify-between text-xs text-[#C7BED8]">
                  <span>Spell &amp; Combat SFX</span>
                  <span className="font-mono tabular-nums text-[#D9BA72]">{Math.round(settings.sfxVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.sfxVolume}
                  onChange={(e) => update('sfxVolume', Number(e.target.value))}
                  className="w-full accent-[#A991F7]"
                />
              </label>

              <label className="block">
                <div className="mb-1 flex justify-between text-xs text-[#C7BED8]">
                  <span>Biome Ambience</span>
                  <span className="font-mono tabular-nums text-[#D9BA72]">{Math.round(settings.ambientVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.ambientVolume}
                  onChange={(e) => update('ambientVolume', Number(e.target.value))}
                  className="w-full accent-[#58D6C2]"
                />
              </label>
            </div>

            <div className="pt-2">
              <h3 className="font-display text-base font-semibold text-[#EFEAF7]">Controls</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-[#9E93B5]">Move</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">WASD / Arrows</dd>
                <dt className="text-[#9E93B5]">Cast Active Spell</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">Left Click</dd>
                <dt className="text-[#9E93B5]">Alternate Fire / Ice</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">Right Click</dd>
                <dt className="text-[#9E93B5]">Select Spell</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">1 · 2 · 3</dd>
                <dt className="text-[#9E93B5]">Blink Dash</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">Space</dd>
                <dt className="text-[#9E93B5]">Aether Surge</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">F</dd>
                <dt className="text-[#9E93B5]">Health Vial</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">Q</dd>
                <dt className="text-[#9E93B5]">Pause Run</dt>
                <dd className="font-mono text-right text-[#EFEAF7]">Esc / P</dd>
              </dl>
            </div>
          </section>

          {/* Graphics & Accessibility */}
          <section className="space-y-5">
            <div className="space-y-3">
              <h3 className="font-display text-base font-semibold text-[#EFEAF7]">Graphics</h3>

              <div>
                <div className="mb-1.5 text-xs text-[#C7BED8]">Screen Shake</div>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#171321] p-1 border border-[#A991F7]/20">
                  {(['off', 'low', 'full'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => update('screenShake', opt)}
                      className={`rounded-md py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        settings.screenShake === opt
                          ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/40'
                          : 'text-[#9E93B5] hover:text-[#EFEAF7]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs text-[#C7BED8]">Light Bloom Intensity</div>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#171321] p-1 border border-[#A991F7]/20">
                  {(['off', 'subtle', 'full'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => update('bloomIntensity', opt)}
                      className={`rounded-md py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        settings.bloomIntensity === opt
                          ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/40'
                          : 'text-[#9E93B5] hover:text-[#EFEAF7]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs text-[#C7BED8]">Spell VFX Style Tier (PVFX Foundry)</div>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#171321] p-1 border border-[#A991F7]/20">
                  {(
                    [
                      { id: 'lit', label: 'Lit Glow (Additive)' },
                      { id: 'strict', label: 'Strict Banded (Retro)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => update('vfxStyleTier', opt.id)}
                      className={`rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        settings.vfxStyleTier === opt.id
                          ? 'bg-[#34283F] text-[#58D6C2] border border-[#58D6C2]/45'
                          : 'text-[#9E93B5] hover:text-[#EFEAF7]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs text-[#C7BED8]">Particle Density</div>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#171321] p-1 border border-[#A991F7]/20">
                  {(['low', 'normal', 'high'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => update('particleDensity', opt)}
                      className={`rounded-md py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        settings.particleDensity === opt
                          ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/40'
                          : 'text-[#9E93B5] hover:text-[#EFEAF7]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <h3 className="font-display text-base font-semibold text-[#EFEAF7]">Accessibility &amp; Combat</h3>
              {[
                { key: 'showDamageNumbers' as const, label: 'Floating Damage Numbers' },
                { key: 'highContrastTelegraphs' as const, label: 'High-Contrast Boss Telegraphs' },
                { key: 'reducedMotion' as const, label: 'Reduced Motion Mode' },
                { key: 'quickCastHotkeys' as const, label: 'Quick-Cast on 1 / 2 / 3 Keys' },
                { key: 'showHitboxes' as const, label: 'Show Collision & Hitbox Overlay' },
              ].map((row) => (
                <label
                  key={row.key}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[#1A1426] px-3 py-2 text-xs text-[#DDD6EC] cursor-pointer hover:bg-[#231B33] transition-colors"
                >
                  <span>{row.label}</span>
                  <input
                    type="checkbox"
                    checked={settings[row.key]}
                    onChange={(e) => update(row.key, e.target.checked)}
                    className="h-4 w-4 accent-[#D9BA72] cursor-pointer"
                  />
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-[#D9BA72]/20 pt-4">
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onChange({ ...DEFAULT_SETTINGS });
            }}
            className="rounded-lg border border-[#A991F7]/25 bg-transparent px-4 py-2 text-xs font-medium text-[#B8AEC9] hover:border-[#A991F7] hover:text-[#EFEAF7] transition-colors cursor-pointer whitespace-nowrap"
          >
            Reset to Defaults
          </button>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onClose();
            }}
            className="rounded-lg border border-[#D9BA72]/60 bg-[#34283F] px-5 py-2 text-sm font-semibold text-[#F6E6BD] hover:bg-[#423252] transition-colors cursor-pointer whitespace-nowrap"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}
