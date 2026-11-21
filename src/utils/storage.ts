import type { GameSettings, RunSummary } from '../types/game';

const SETTINGS_KEY = 'archmage_riftbound_settings_v3';
const HISTORY_KEY = 'archmage_riftbound_runs_v3';

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.75,
  sfxVolume: 0.85,
  ambientVolume: 0.35,
  muted: false,
  screenShake: 'full',
  bloomIntensity: 'full',
  vfxStyleTier: 'lit',
  particleDensity: 'high',
  showDamageNumbers: true,
  showHitboxes: false,
  reducedMotion: false,
  highContrastTelegraphs: false,
  quickCastHotkeys: false,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors in restricted frames
  }
}

export function loadRunHistory(): RunSummary[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunSummary[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function recordRunSummary(summary: RunSummary): RunSummary[] {
  const existing = loadRunHistory();
  const next = [summary, ...existing].slice(0, 8);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}
