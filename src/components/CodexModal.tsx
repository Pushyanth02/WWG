import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { PRODUCTION_REPORT } from '../data/gameData';
import { ALL_SCHOOL_IDS, RESONANCE_LIST, SCHOOL_DEFS } from '../data/resonances';
import { BIOME_STYLE_RAMPS, RIFT_NIGHT_SWATCHES } from '../data/styleContract';
import type { SchoolId } from '../types/game';
import { AtlasIcon } from './SpritePreview';

interface CodexModalProps {
  onClose: () => void;
}

export function CodexModal({ onClose }: CodexModalProps) {
  const [tab, setTab] = useState<'schools' | 'resonances' | 'style' | 'ledger'>('resonances');
  const [schoolFilter, setSchoolFilter] = useState<'all' | SchoolId>('all');
  const [query, setQuery] = useState<string>('');

  const filteredResonances = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RESONANCE_LIST.filter((r) => {
      if (schoolFilter !== 'all' && !r.schools.includes(schoolFilter)) return false;
      if (!q) return true;
      const sA = SCHOOL_DEFS[r.schools[0]].name.toLowerCase();
      const sB = SCHOOL_DEFS[r.schools[1]].name.toLowerCase();
      return (
        r.name.toLowerCase().includes(q) ||
        r.archetypeLabel.toLowerCase().includes(q) ||
        r.effect.toLowerCase().includes(q) ||
        sA.includes(q) ||
        sB.includes(q)
      );
    });
  }, [schoolFilter, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0914]/84 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="codex-heading"
    >
      <div className="arcane-panel flex max-h-[88vh] w-full max-w-5xl flex-col rounded-xl p-6 md:p-8">
        <div className="flex items-center justify-between gap-4 border-b border-[#D9BA72]/20 pb-4">
          <div>
            <h2 id="codex-heading" className="font-display text-2xl font-bold tracking-wide text-[#D9BA72]">
              Arcane Codex &amp; 78-Resonance Grimoire
            </h2>
            <p className="mt-1 text-sm text-[#B8AEC9]">
              13 Playable Elemental Schools · All 78 Pair Resonances Live · V3.1 Style Audit
            </p>
          </div>
          <button
            onClick={() => {
              soundEngine.playUiClick();
              onClose();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#D9BA72]/30 bg-[#221A2E] text-[#EFEAF7] hover:border-[#D9BA72] hover:text-[#D9BA72] transition-colors cursor-pointer"
            aria-label="Close codex"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-[#A991F7]/15 pb-3">
          {[
            { id: 'resonances' as const, label: `78 Resonances (${RESONANCE_LIST.length})` },
            { id: 'schools' as const, label: '13 Elemental Schools' },
            { id: 'style' as const, label: 'Biome Style Audit' },
            { id: 'ledger' as const, label: '46-Sheet Roster' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                soundEngine.playUiClick();
                setTab(t.id);
              }}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                tab === t.id
                  ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/45'
                  : 'text-[#A89EC0] hover:text-[#EFEAF7] bg-[#1C1628]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          {tab === 'schools' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ALL_SCHOOL_IDS.map((sid) => {
                const school = SCHOOL_DEFS[sid];
                return (
                  <div
                    key={school.id}
                    className="flex items-start gap-3 rounded-lg border border-[#A991F7]/20 bg-[#1C1628] p-3.5"
                  >
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-[#140F1E]"
                      style={{ borderColor: `${school.color}66` }}
                    >
                      <AtlasIcon tileIndex={school.iconIndex} size={32} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-[#EFEAF7]">
                          {school.name} · <span style={{ color: school.color }}>{school.spellName}</span>
                        </h3>
                      </div>
                      <p className="mt-0.5 text-xs text-[#B5AACB]">{school.shortEffect}</p>
                      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-[#8F84A6]">
                        <span>{school.cost} Aether · {school.cooldown.toFixed(2)}s</span>
                        <span className="text-[#58D6C2]">{school.statusTag} · Live</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'resonances' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#8F84A6]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search 78 resonances by name, school, or archetype..."
                    className="w-full rounded-lg border border-[#A991F7]/25 bg-[#140F1E] py-2 pr-3 pl-9 text-xs text-[#EFEAF7] placeholder-[#7F7499] focus:border-[#D9BA72] focus:outline-none"
                  />
                </div>
                <span className="font-mono text-xs tabular-nums text-[#58D6C2]">
                  Showing {filteredResonances.length} / {RESONANCE_LIST.length}
                </span>
              </div>

              {/* Filter by School */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSchoolFilter('all')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer ${
                    schoolFilter === 'all'
                      ? 'bg-[#34283F] text-[#D9BA72] border border-[#D9BA72]/45'
                      : 'bg-[#171321] text-[#A89EC0] hover:text-[#EFEAF7]'
                  }`}
                >
                  All 13
                </button>
                {ALL_SCHOOL_IDS.map((sid) => {
                  const def = SCHOOL_DEFS[sid];
                  const active = schoolFilter === sid;
                  return (
                    <button
                      key={sid}
                      onClick={() => setSchoolFilter(sid)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer ${
                        active
                          ? 'bg-[#34283F] text-[#F8E7BF] border border-[#D9BA72]/50'
                          : 'bg-[#171321] text-[#A89EC0] hover:text-[#EFEAF7]'
                      }`}
                    >
                      {def.name}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredResonances.map((res) => {
                  const sA = SCHOOL_DEFS[res.schools[0]];
                  const sB = SCHOOL_DEFS[res.schools[1]];
                  return (
                    <div
                      key={res.key}
                      className="rounded-lg border border-[#A991F7]/20 bg-[#1B1527] p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <AtlasIcon tileIndex={sA.iconIndex} size={22} />
                          <AtlasIcon tileIndex={sB.iconIndex} size={22} />
                          <h3 className="font-display text-sm font-bold text-[#EFEAF7] truncate">
                            {res.name}
                          </h3>
                        </div>
                        <span className="font-mono text-[11px] text-[#58D6C2] shrink-0">
                          {res.archetypeLabel}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs">
                        <span style={{ color: sA.color }}>{sA.name}</span>
                        <span className="mx-1.5 text-[#7F7499]">+</span>
                        <span style={{ color: sB.color }}>{sB.name}</span>
                        <span className="mx-2 text-[#5E5275]" aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-[#D9BA72]">
                          {Math.round(res.damageMultiplier * 100)}% Power · {res.radius}px
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-[#BEB4D4]">{res.effect}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'style' && (
            <div className="space-y-6">
              <div>
                <h3 className="font-display text-base font-semibold text-[#D9BA72]">
                  Rift Night Master Palette Contract
                </h3>
                <p className="mt-1 text-xs text-[#B8AEC9]">
                  Every sprite sheet enforces 2× crisp pixel-block density, <span className="font-mono text-[#EFEAF7]">#140E1D</span> outline ink, and top-left directional lighting.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {RIFT_NIGHT_SWATCHES.map((sw) => (
                    <div
                      key={sw.hex}
                      className="flex items-center gap-3 rounded-lg border border-[#A991F7]/15 bg-[#1A1426] p-2.5"
                    >
                      <span
                        className="h-9 w-9 shrink-0 rounded-md border border-white/15"
                        style={{ backgroundColor: sw.hex }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-[#EFEAF7]">{sw.name}</span>
                          <span className="font-mono text-[11px] text-[#D9BA72]">{sw.hex}</span>
                        </div>
                        <p className="text-[11px] text-[#9E93B5] truncate">{sw.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-display text-base font-semibold text-[#D9BA72]">
                  Biome Harmony Audit (All 5 Biomes · Cursed Grove through Astral Abyss)
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  {BIOME_STYLE_RAMPS.map((b) => (
                    <div
                      key={b.biomeId}
                      className="rounded-lg border border-[#D9BA72]/25 bg-[#1A1426] p-4"
                    >
                      <div className="font-display text-sm font-bold text-[#EFEAF7]">{b.name}</div>
                      <div className="mt-0.5 text-xs text-[#A991F7]">Tyrant: {b.bossName}</div>
                      <div className="mt-3 flex gap-1.5">
                        {[b.stoneBase, b.stoneMid, b.stoneLight, b.accentDark, b.accentBright].map((hex) => (
                          <div
                            key={hex}
                            className="h-6 flex-1 rounded border border-white/15"
                            style={{ backgroundColor: hex }}
                            title={hex}
                          />
                        ))}
                      </div>
                      <p className="mt-2.5 text-xs leading-relaxed text-[#BFB5D4]">{b.floorMood}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'ledger' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#D9BA72]/25 text-[#D9BA72]">
                    <th className="pb-2.5 pr-4 font-semibold">Asset / System Batch</th>
                    <th className="pb-2.5 pr-4 font-semibold">Target Roster</th>
                    <th className="pb-2.5 pr-4 font-semibold">Generated Now</th>
                    <th className="pb-2.5 pr-4 font-semibold">Integrated in Demo</th>
                    <th className="pb-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#A991F7]/12">
                  {PRODUCTION_REPORT.map((row) => (
                    <tr key={row.category} className="text-[#D7CFE8]">
                      <td className="py-3 pr-4 font-medium text-[#EFEAF7]">{row.category}</td>
                      <td className="py-3 pr-4 font-mono tabular-nums text-[#B5AACB]">{row.target}</td>
                      <td className="py-3 pr-4 font-mono tabular-nums text-[#58D6C2]">{row.generated}</td>
                      <td className="py-3 pr-4 text-[#C7BED8]">{row.integrated}</td>
                      <td className="py-3 font-medium">
                        <span
                          className={
                            row.status === 'Verified in Demo' ? 'text-[#58D6C2]' : 'text-[#D9BA72]'
                          }
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
