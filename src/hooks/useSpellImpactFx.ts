import { useCallback, useEffect, useRef } from 'react';
import type { GameSettings, SpellCombatEvent } from '../types/game';

interface BloomFlare {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  secondaryColor?: string;
  life: number;
  maxLife: number;
  tier: 1 | 2 | 3;
}

interface ShockRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  lineWidth: number;
  life: number;
  maxLife: number;
}

interface SpellSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  drag: number;
  square: boolean;
}

interface EdgeBloomPulse {
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface DirectionalShakeState {
  offsetX: number;
  offsetY: number;
  velX: number;
  velY: number;
  trauma: number;
  dirX: number;
  dirY: number;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbaStr(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTuple(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export interface UseSpellImpactFxOptions {
  settings: GameSettings;
  paused: boolean;
}

export interface UseSpellImpactFxResult {
  /** Pointer-events-none additive bloom & particle overlay canvas */
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Viewport wrapper ref that receives GPU-composited directional screen-shake transform */
  shakeContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Emit a spell cast / hit / crit / resonance / boss impact / surge event */
  emitSpellEvent: (event: SpellCombatEvent) => void;
  /** Reset all active particles, bloom flares, and shake impulse */
  clearFx: () => void;
}

/**
 * Dedicated GameView particle, light-based bloom, and tiered directional screen-shake hook.
 * Renders additive Rift Night elemental light flares, shock rings, velocity-damped sparks,
 * and subtle dark-fantasy viewport edge bloom without triggering React re-renders per frame.
 */
export function useSpellImpactFx({
  settings,
  paused,
}: UseSpellImpactFxOptions): UseSpellImpactFxResult {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shakeContainerRef = useRef<HTMLDivElement | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const flaresRef = useRef<BloomFlare[]>([]);
  const ringsRef = useRef<ShockRing[]>([]);
  const sparksRef = useRef<SpellSpark[]>([]);
  const edgePulseRef = useRef<EdgeBloomPulse | null>(null);
  const shakeRef = useRef<DirectionalShakeState>({
    offsetX: 0,
    offsetY: 0,
    velX: 0,
    velY: 0,
    trauma: 0,
    dirX: 1,
    dirY: 0,
  });

  const clearFx = useCallback(() => {
    flaresRef.current = [];
    ringsRef.current = [];
    sparksRef.current = [];
    edgePulseRef.current = null;
    shakeRef.current = {
      offsetX: 0,
      offsetY: 0,
      velX: 0,
      velY: 0,
      trauma: 0,
      dirX: 1,
      dirY: 0,
    };
    const container = shakeContainerRef.current;
    if (container) {
      container.style.transform = 'translate3d(0px, 0px, 0px)';
    }
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const emitSpellEvent = useCallback((event: SpellCombatEvent) => {
    const s = settingsRef.current;
    const isStrict = s.vfxStyleTier === 'strict';
    const densityMult =
      s.particleDensity === 'high' ? 1.15 : s.particleDensity === 'normal' ? 0.78 : 0.4;
    const bloomMult =
      s.bloomIntensity === 'off' ? 0 : s.bloomIntensity === 'subtle' ? 0.55 : 1.0;

    // 1. Tiered Light-Based Bloom Flare
    if (bloomMult > 0) {
      const tier = event.intensityTier;
      const baseMaxRadius =
        event.type === 'cast'
          ? 44
          : tier === 3
            ? 148
            : tier === 2
              ? 96
              : 62;
      const maxLife = event.type === 'cast' ? 0.2 : tier === 3 ? 0.44 : tier === 2 ? 0.3 : 0.22;

      flaresRef.current.push({
        x: event.screenX,
        y: event.screenY,
        radius: baseMaxRadius * 0.24,
        maxRadius: baseMaxRadius * (0.75 + 0.25 * bloomMult),
        color: event.primaryColor,
        secondaryColor: event.secondaryColor,
        life: maxLife,
        maxLife,
        tier,
      });

      // Shockwave light rings for hits, crits, resonances, boss impacts, surges
      if (event.type !== 'cast') {
        ringsRef.current.push({
          x: event.screenX,
          y: event.screenY,
          radius: 8,
          maxRadius: tier === 3 ? 132 : tier === 2 ? 78 : 44,
          color: event.primaryColor,
          lineWidth: tier === 3 ? 4 : tier === 2 ? 3 : 2,
          life: tier === 3 ? 0.36 : 0.24,
          maxLife: tier === 3 ? 0.36 : 0.24,
        });

        if (tier === 3) {
          ringsRef.current.push({
            x: event.screenX,
            y: event.screenY,
            radius: 4,
            maxRadius: 176,
            color: event.secondaryColor ?? '#E8D6FF',
            lineWidth: 2.5,
            life: 0.44,
            maxLife: 0.44,
          });

          if (!s.reducedMotion) {
            edgePulseRef.current = {
              color: event.primaryColor,
              alpha: 0.22 * bloomMult,
              life: 0.34,
              maxLife: 0.34,
            };
          }
        }
      }
    }

    // 2. Directional Elemental Sparks
    const baseSparkCount =
      event.type === 'cast'
        ? 7
        : event.intensityTier === 3
          ? 34
          : event.intensityTier === 2
            ? 20
            : 11;
    const count = Math.max(2, Math.round(baseSparkCount * densityMult));
    const dirLen = Math.hypot(event.dirX, event.dirY) || 1;
    const nx = event.dirX / dirLen;
    const ny = event.dirY / dirLen;
    const baseAngle = Math.atan2(ny, nx);

    for (let i = 0; i < count; i++) {
      // Half sparks spray along impact direction cone, half radiate outward
      const directional = i < count * 0.6;
      const angle = directional
        ? baseAngle + (Math.random() - 0.5) * (event.type === 'cast' ? 1.1 : 1.7)
        : Math.random() * Math.PI * 2;
      const speed =
        (event.intensityTier === 3 ? 210 : event.intensityTier === 2 ? 160 : 115) *
        (0.45 + Math.random() * 0.85);
      const maxLife =
        (event.intensityTier === 3 ? 0.52 : event.intensityTier === 2 ? 0.38 : 0.28) *
        (0.7 + Math.random() * 0.5);
      const useSecondary = event.secondaryColor && i % 3 === 0;
      const isHotCore = i % 5 === 0;

      sparksRef.current.push({
        x: event.screenX + (Math.random() - 0.5) * 8,
        y: event.screenY + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (event.intensityTier === 3 ? 22 : 10),
        size: isStrict
          ? event.intensityTier === 3
            ? 4
            : 3
          : 2.2 + Math.random() * (event.intensityTier === 3 ? 3.2 : 2.1),
        color: isHotCore
          ? '#FAF6EE'
          : useSecondary
            ? event.secondaryColor!
            : event.primaryColor,
        life: maxLife,
        maxLife,
        drag: 0.91,
        square: isStrict || i % 2 === 0,
      });
    }

    // Cap arrays cleanly for sustained 60fps
    if (sparksRef.current.length > 260) {
      sparksRef.current.splice(0, sparksRef.current.length - 260);
    }
    if (flaresRef.current.length > 36) {
      flaresRef.current.splice(0, flaresRef.current.length - 36);
    }
    if (ringsRef.current.length > 30) {
      ringsRef.current.splice(0, ringsRef.current.length - 30);
    }

    // 3. Tiered Directional Screen Shake Impulse (respects screenShake & reducedMotion)
    if (!s.reducedMotion && s.screenShake !== 'off' && event.type !== 'cast') {
      const shakeScale = s.screenShake === 'low' ? 0.45 : 1.0;
      const impulse =
        event.intensityTier === 3
          ? 12.5
          : event.intensityTier === 2
            ? 7.2
            : 3.4;
      const scaled = impulse * shakeScale;
      const st = shakeRef.current;
      st.dirX = nx;
      st.dirY = ny;
      st.trauma = Math.min(1.0, st.trauma + (event.intensityTier === 3 ? 0.72 : event.intensityTier === 2 ? 0.42 : 0.22));
      // Kick along impact vector with slight recoil bounce
      st.offsetX = Math.max(-16, Math.min(16, st.offsetX + nx * scaled * 0.65));
      st.offsetY = Math.max(-16, Math.min(16, st.offsetY + ny * scaled * 0.65));
      st.velX += -nx * scaled * 16;
      st.velY += -ny * scaled * 16;
    }
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      rafId = requestAnimationFrame(step);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const canvas = overlayCanvasRef.current;
      if (!canvas) return;

      // Keep overlay canvas 1:1 with viewport CSS size
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(1, Math.round(rect.width));
      const targetH = Math.max(1, Math.round(rect.height));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const s = settingsRef.current;
      const isStrict = s.vfxStyleTier === 'strict';
      const bloomMult =
        s.bloomIntensity === 'off' ? 0 : s.bloomIntensity === 'subtle' ? 0.55 : 1.0;

      // Update damped spring directional screen shake
      const st = shakeRef.current;
      const container = shakeContainerRef.current;
      if (!pausedRef.current && !s.reducedMotion && s.screenShake !== 'off') {
        if (st.trauma > 0.002 || Math.abs(st.offsetX) > 0.05 || Math.abs(st.offsetY) > 0.05) {
          const springK = 260;
          const damping = 18;
          const ax = -springK * st.offsetX - damping * st.velX;
          const ay = -springK * st.offsetY - damping * st.velY;
          st.velX += ax * dt;
          st.velY += ay * dt;
          st.offsetX += st.velX * dt;
          st.offsetY += st.velY * dt;
          st.trauma = Math.max(0, st.trauma - dt * 2.6);

          const jitter = st.trauma * st.trauma * (s.screenShake === 'low' ? 2.5 : 5.5);
          const jx = (Math.random() - 0.5) * 2 * jitter;
          const jy = (Math.random() - 0.5) * 2 * jitter;

          if (container) {
            container.style.transform = `translate3d(${(st.offsetX + jx).toFixed(2)}px, ${(st.offsetY + jy).toFixed(2)}px, 0px)`;
          }
        } else if (container && container.style.transform !== 'translate3d(0px, 0px, 0px)') {
          st.offsetX = 0;
          st.offsetY = 0;
          st.velX = 0;
          st.velY = 0;
          container.style.transform = 'translate3d(0px, 0px, 0px)';
        }
      } else if (container && container.style.transform !== 'translate3d(0px, 0px, 0px)') {
        container.style.transform = 'translate3d(0px, 0px, 0px)';
      }

      if (pausedRef.current) return;

      const hasWork =
        flaresRef.current.length > 0 ||
        ringsRef.current.length > 0 ||
        sparksRef.current.length > 0 ||
        edgePulseRef.current !== null;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!hasWork) return;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 1. Subtle Dark-Fantasy Edge Bloom Vignette on Tier 3 Resonances / Boss Impacts
      if (edgePulseRef.current && bloomMult > 0) {
        const ep = edgePulseRef.current;
        ep.life -= dt;
        if (ep.life <= 0) {
          edgePulseRef.current = null;
        } else {
          const t = ep.life / ep.maxLife;
          const cx = canvas.width * 0.5;
          const cy = canvas.height * 0.5;
          const outerR = Math.hypot(cx, cy);
          const grad = ctx.createRadialGradient(cx, cy, outerR * 0.52, cx, cy, outerR);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, rgbaStr(ep.color, ep.alpha * t * t));
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }

      // 2. Additive Light-Based Bloom Flares
      for (let i = flaresRef.current.length - 1; i >= 0; i--) {
        const fl = flaresRef.current[i];
        fl.life -= dt;
        if (fl.life <= 0) {
          flaresRef.current.splice(i, 1);
          continue;
        }
        const progress = 1 - fl.life / fl.maxLife;
        const alpha = (1 - progress) * (1 - progress) * bloomMult;
        const r = fl.radius + (fl.maxRadius - fl.radius) * Math.pow(progress, 0.55);

        if (isStrict) {
          // Strict retro banded stepped light discs
          const outerR = Math.round(r * 0.85);
          const midR = Math.round(r * 0.5);
          const coreR = Math.round(r * 0.22);
          ctx.fillStyle = rgbaStr(fl.color, alpha * 0.38);
          ctx.beginPath();
          ctx.arc(Math.round(fl.x), Math.round(fl.y), outerR, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = rgbaStr(fl.secondaryColor ?? fl.color, alpha * 0.58);
          ctx.beginPath();
          ctx.arc(Math.round(fl.x), Math.round(fl.y), midR, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = rgbaStr('#FAF6EE', alpha * 0.72);
          ctx.beginPath();
          ctx.arc(Math.round(fl.x), Math.round(fl.y), coreR, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Lit smooth additive dark-fantasy light bloom
          const grad = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r);
          grad.addColorStop(0, rgbaStr('#FFF6E5', alpha * (fl.tier === 3 ? 0.88 : 0.7)));
          grad.addColorStop(0.28, rgbaStr(fl.color, alpha * 0.65));
          grad.addColorStop(0.62, rgbaStr(fl.secondaryColor ?? fl.color, alpha * 0.26));
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(fl.x, fl.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3. Expanding Light Shockwave Rings
      for (let i = ringsRef.current.length - 1; i >= 0; i--) {
        const rg = ringsRef.current[i];
        rg.life -= dt;
        if (rg.life <= 0) {
          ringsRef.current.splice(i, 1);
          continue;
        }
        const progress = 1 - rg.life / rg.maxLife;
        const r = rg.radius + (rg.maxRadius - rg.radius) * (1 - Math.pow(1 - progress, 2.2));
        const alpha = (1 - progress) * 0.85 * Math.max(0.35, bloomMult);
        ctx.strokeStyle = rgbaStr(rg.color, alpha);
        ctx.lineWidth = Math.max(1, rg.lineWidth * (1 - progress * 0.6));
        ctx.beginPath();
        ctx.arc(Math.round(rg.x), Math.round(rg.y), r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 4. Velocity-Damped Elemental Sparks
      for (let i = sparksRef.current.length - 1; i >= 0; i--) {
        const sp = sparksRef.current[i];
        sp.life -= dt;
        if (sp.life <= 0) {
          sparksRef.current.splice(i, 1);
          continue;
        }
        const dragFactor = Math.pow(sp.drag, dt * 60);
        sp.vx *= dragFactor;
        sp.vy *= dragFactor;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;

        const t = sp.life / sp.maxLife;
        const sz = Math.max(1.2, sp.size * (0.45 + 0.55 * t));
        ctx.fillStyle = rgbaStr(sp.color, t * 0.95);

        if (sp.square) {
          const px = Math.round(sp.x - sz * 0.5);
          const py = Math.round(sp.y - sz * 0.5);
          ctx.fillRect(px, py, Math.round(sz), Math.round(sz));
        } else {
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sz * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return {
    overlayCanvasRef,
    shakeContainerRef,
    emitSpellEvent,
    clearFx,
  };
}
