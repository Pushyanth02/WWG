import { useEffect, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { AssetLab } from './components/AssetLab';
import { CodexModal } from './components/CodexModal';
import { GameView } from './components/GameView';
import { MainMenu } from './components/MainMenu';
import { ResultsScreen } from './components/ResultsScreen';
import { SettingsModal } from './components/SettingsModal';
import { MAGE_CLASSES } from './data/gameData';
import { spriteRegistry } from './game/spriteLoader';
import type {
  AppScreen,
  BiomeId,
  GameSettings,
  MageClassDef,
  MasterManifest,
  RunMode,
  RunSummary,
  SchoolId,
  ValidationReport,
} from './types/game';
import { generateRandomSeed } from './utils/prng';
import { loadRunHistory, loadSettings, recordRunSummary, saveSettings } from './utils/storage';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('menu');
  const [selectedClass, setSelectedClass] = useState<MageClassDef>(MAGE_CLASSES[0]);
  const [selectedBiome, setSelectedBiome] = useState<BiomeId>('cursed_grove');
  const [runMode, setRunMode] = useState<RunMode>('single');
  const [equippedSchools, setEquippedSchools] = useState<[SchoolId, SchoolId, SchoolId]>(
    MAGE_CLASSES[0].defaultLoadout
  );
  const [seed, setSeed] = useState<string>('RIFT-7482');
  const [runKey, setRunKey] = useState<number>(1);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>(() => loadRunHistory());
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  const [assetLabInitialTab, setAssetLabInitialTab] = useState<'preview' | 'pipeline' | 'export'>('preview');

  const [manifest, setManifest] = useState<MasterManifest | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    soundEngine.configure(settings);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      spriteRegistry.loadMasterManifest(),
      spriteRegistry.preloadAll(),
      spriteRegistry.loadValidationReport().catch(() => null),
    ])
      .then(([master, , report]) => {
        if (!mounted) return;
        setManifest(master);
        setValidation(report);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load pixel sprite sheets.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectClass = (cls: MageClassDef) => {
    setSelectedClass(cls);
    setEquippedSchools([...cls.defaultLoadout] as [SchoolId, SchoolId, SchoolId]);
  };

  const handleChangeLoadoutSlot = (slotIndex: 0 | 1 | 2, schoolId: SchoolId) => {
    setEquippedSchools((prev) => {
      const next: [SchoolId, SchoolId, SchoolId] = [...prev] as [SchoolId, SchoolId, SchoolId];
      const existingIdx = next.indexOf(schoolId);
      if (existingIdx !== -1 && existingIdx !== slotIndex) {
        // Swap so all 3 slots always remain 3 distinct Elemental Schools (guaranteeing 3 active resonances)
        next[existingIdx] = next[slotIndex];
      }
      next[slotIndex] = schoolId;
      return next;
    });
  };

  const startRun = (nextSeed?: string) => {
    const cleanSeed = (nextSeed ?? seed).trim() || generateRandomSeed();
    setSeed(cleanSeed);
    setRunKey((k) => k + 1);
    setScreen('playing');
  };

  const handleRunFinished = (summary: RunSummary) => {
    setLastSummary(summary);
    setRecentRuns(recordRunSummary(summary));
    setScreen('results');
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#171321] p-6 text-center">
        <div className="arcane-panel max-w-md rounded-xl p-8">
          <h1 className="font-display text-2xl font-bold text-[#E96578]">Sprite Atlas Load Failed</h1>
          <p className="mt-2 text-sm text-[#C7BED8]">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#171321] p-6 text-center">
        <div className="font-display text-2xl font-bold tracking-widest text-[#D9BA72]">
          ARCHMAGE: RIFTBOUND
        </div>
        <p className="mt-3 text-sm text-[#A99EC2]">Loading 46 pixel-art sprite sheets and manifests...</p>
      </div>
    );
  }

  return (
    <>
      {screen === 'menu' && (
        <MainMenu
          selectedClass={selectedClass}
          onSelectClass={handleSelectClass}
          selectedBiome={selectedBiome}
          onSelectBiome={setSelectedBiome}
          runMode={runMode}
          onSelectRunMode={setRunMode}
          equippedSchools={equippedSchools}
          onChangeLoadoutSlot={handleChangeLoadoutSlot}
          seed={seed}
          onChangeSeed={setSeed}
          onRandomizeSeed={() => setSeed(generateRandomSeed())}
          onStartSoloRun={() => startRun()}
          onOpenAssetLab={() => {
            setAssetLabInitialTab('preview');
            setScreen('asset_lab');
          }}
          onOpenCodex={() => setShowCodex(true)}
          onOpenSettings={() => setShowSettings(true)}
          recentRuns={recentRuns}
          reducedMotion={settings.reducedMotion}
        />
      )}

      {screen === 'playing' && (
        <GameView
          key={`${selectedClass.id}-${selectedBiome}-${runMode}-${equippedSchools.join('-')}-${seed}-${runKey}`}
          mageClass={selectedClass}
          biomeId={selectedBiome}
          mode={runMode}
          equippedSchools={equippedSchools}
          seed={seed}
          settings={settings}
          onOpenSettings={() => setShowSettings(true)}
          onOpenAssetLab={() => {
            setAssetLabInitialTab('preview');
            setScreen('asset_lab');
          }}
          onRestartSameSeed={() => startRun(seed)}
          onReturnMenu={() => setScreen('menu')}
          onRunFinished={handleRunFinished}
        />
      )}

      {screen === 'asset_lab' && (
        <AssetLab
          manifest={manifest}
          validation={validation}
          initialTab={assetLabInitialTab}
          onBack={() => setScreen('menu')}
          onLaunchDemo={() => startRun()}
        />
      )}

      {screen === 'results' && lastSummary && (
        <ResultsScreen
          summary={lastSummary}
          onReplaySameSeed={() => startRun(lastSummary.seed)}
          onNewSeedRun={() => startRun(generateRandomSeed())}
          onOpenAssetLab={() => setScreen('asset_lab')}
          onReturnMenu={() => setScreen('menu')}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showCodex && <CodexModal onClose={() => setShowCodex(false)} />}
    </>
  );
}
