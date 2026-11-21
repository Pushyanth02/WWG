import type {
  AnimationEntry,
  AssetManifest,
  Direction,
  MasterManifest,
  ValidationReport,
  VfxStyleTier,
} from '../types/game';

export interface LoadedSpriteAsset {
  manifest: AssetManifest;
  image: HTMLImageElement;
  animMap: Map<string, AnimationEntry>;
}

class SpriteRegistry {
  private masterPromise: Promise<MasterManifest> | null = null;
  private validationPromise: Promise<ValidationReport> | null = null;
  private loadedAssets = new Map<string, LoadedSpriteAsset>();
  private runtimeOverrides = new Map<string, LoadedSpriteAsset>();
  private loadingPromises = new Map<string, Promise<LoadedSpriteAsset>>();

  async loadMasterManifest(): Promise<MasterManifest> {
    if (!this.masterPromise) {
      this.masterPromise = fetch('/assets/manifest.json').then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch asset manifest (${res.status})`);
        return res.json() as Promise<MasterManifest>;
      });
    }
    return this.masterPromise;
  }

  async loadValidationReport(): Promise<ValidationReport> {
    if (!this.validationPromise) {
      this.validationPromise = fetch('/assets/validation-report.json').then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch validation report (${res.status})`);
        return res.json() as Promise<ValidationReport>;
      });
    }
    return this.validationPromise;
  }

  async loadAsset(manifest: AssetManifest): Promise<LoadedSpriteAsset> {
    const cached = this.loadedAssets.get(manifest.assetId);
    if (cached) return cached;

    const inFlight = this.loadingPromises.get(manifest.assetId);
    if (inFlight) return inFlight;

    const promise = new Promise<LoadedSpriteAsset>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const animMap = new Map<string, AnimationEntry>();
        for (const anim of manifest.animations) {
          animMap.set(`${anim.state}:${anim.direction}`, anim);
        }
        const loaded: LoadedSpriteAsset = { manifest, image: img, animMap };
        this.loadedAssets.set(manifest.assetId, loaded);
        resolve(loaded);
      };
      img.onerror = () => reject(new Error(`Failed to load sprite image ${manifest.sheetUrl}`));
      img.src = manifest.sheetUrl;
    });

    this.loadingPromises.set(manifest.assetId, promise);
    return promise;
  }

  async preloadAll(): Promise<Map<string, LoadedSpriteAsset>> {
    const master = await this.loadMasterManifest();
    await Promise.all(master.assets.map((asset) => this.loadAsset(asset)));
    return this.loadedAssets;
  }

  get(assetId: string): LoadedSpriteAsset | undefined {
    return this.runtimeOverrides.get(assetId) ?? this.loadedAssets.get(assetId);
  }

  /** Hot-swap a runtime VFX or character sprite sheet imported from Pipeline Studio (PVFX Foundry / Pixel Burst) */
  registerRuntimeOverride(
    assetId: string,
    image: HTMLImageElement,
    manifestOverride: AssetManifest
  ): void {
    const animMap = new Map<string, AnimationEntry>();
    for (const anim of manifestOverride.animations) {
      animMap.set(`${anim.state}:${anim.direction}`, anim);
    }
    this.runtimeOverrides.set(assetId, {
      manifest: manifestOverride,
      image,
      animMap,
    });
  }

  clearRuntimeOverride(assetId: string): void {
    this.runtimeOverrides.delete(assetId);
  }

  getRuntimeOverrideIds(): string[] {
    return [...this.runtimeOverrides.keys()];
  }
}

export const spriteRegistry = new SpriteRegistry();

/** Resolves a VFX sheet ID to its Lit or Strict PVFX Foundry tier, with safe fallback to base sheet */
export function resolveVfxAssetId(baseId: string, tier: VfxStyleTier): string {
  if (tier === 'strict') {
    const strictId = baseId.endsWith('_strict') ? baseId : `${baseId}_strict`;
    if (spriteRegistry.get(strictId)) return strictId;
  }
  return baseId;
}

export function getAnimation(
  asset: LoadedSpriteAsset,
  state: string,
  direction: Direction = 'down'
): AnimationEntry {
  return (
    asset.animMap.get(`${state}:${direction}`) ||
    asset.animMap.get(`${state}:down`) ||
    asset.manifest.animations[0]
  );
}

export function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  asset: LoadedSpriteAsset,
  state: string,
  direction: Direction,
  frameIndex: number,
  worldX: number,
  worldY: number,
  scale = 1,
  rotation = 0,
  alpha = 1
): void {
  const anim = getAnimation(asset, state, direction);
  const fw = asset.manifest.frameWidth;
  const fh = asset.manifest.frameHeight;
  const f = anim.loop
    ? ((Math.floor(frameIndex) % anim.frameCount) + anim.frameCount) % anim.frameCount
    : Math.max(0, Math.min(anim.frameCount - 1, Math.floor(frameIndex)));

  const sx = f * fw;
  const sy = anim.row * fh;
  const dw = fw * scale;
  const dh = fh * scale;
  const px = anim.pivot.x * scale;
  const py = anim.pivot.y * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.translate(Math.round(worldX), Math.round(worldY));
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.drawImage(asset.image, sx, sy, fw, fh, Math.round(-px), Math.round(-py), Math.round(dw), Math.round(dh));
  ctx.restore();
}

export function drawAtlasTile(
  ctx: CanvasRenderingContext2D,
  asset: LoadedSpriteAsset,
  tileIndex: number,
  x: number,
  y: number,
  scale = 1
): void {
  const fw = asset.manifest.frameWidth;
  const fh = asset.manifest.frameHeight;
  const col = tileIndex % asset.manifest.columns;
  const row = Math.floor(tileIndex / asset.manifest.columns);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    asset.image,
    col * fw,
    row * fh,
    fw,
    fh,
    Math.round(x),
    Math.round(y),
    Math.round(fw * scale),
    Math.round(fh * scale)
  );
  ctx.restore();
}
