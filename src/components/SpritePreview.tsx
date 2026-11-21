import { useEffect, useRef } from 'react';
import { drawAtlasTile, drawSpriteFrame, getAnimation, spriteRegistry } from '../game/spriteLoader';
import type { Direction } from '../types/game';

interface SpritePreviewProps {
  assetId: string;
  state?: string;
  direction?: Direction;
  size?: number;
  scale?: number;
  animate?: boolean;
  className?: string;
}

export function SpritePreview({
  assetId,
  state = 'idle',
  direction = 'down',
  size = 64,
  scale = 1,
  animate = true,
  className = '',
}: SpritePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let alive = true;
    const start = performance.now();

    const draw = (now: number) => {
      if (!alive) return;
      const canvas = canvasRef.current;
      const asset = spriteRegistry.get(assetId);
      if (canvas && asset) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const anim = getAnimation(asset, state, direction);
          const elapsed = (now - start) / 1000;
          const frame = animate ? elapsed * anim.fps : 0;
          const pivotOffsetY = (anim.pivot.y - asset.manifest.frameHeight / 2) * scale;
          drawSpriteFrame(
            ctx,
            asset,
            state,
            direction,
            frame,
            canvas.width / 2,
            canvas.height / 2 + pivotOffsetY,
            scale
          );
        }
      }
      if (animate) {
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [assetId, state, direction, size, scale, animate]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`pixel-art block shrink-0 ${className}`}
    />
  );
}

interface AtlasIconProps {
  tileIndex: number;
  size?: number;
  assetId?: string;
  className?: string;
}

export function AtlasIcon({
  tileIndex,
  size = 32,
  assetId = 'icons_pickups_schools',
  className = '',
}: AtlasIconProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const asset = spriteRegistry.get(assetId);
    if (!canvas || !asset) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sc = size / asset.manifest.frameWidth;
    drawAtlasTile(ctx, asset, tileIndex, 0, 0, sc);
  }, [tileIndex, size, assetId]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`pixel-art block shrink-0 ${className}`}
    />
  );
}
