import type { GameSettings } from '../types/game';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private settings: GameSettings | null = null;
  private ambientOsc1: OscillatorNode | null = null;
  private ambientOsc2: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;

  configure(settings: GameSettings): void {
    this.settings = settings;
    this.syncAmbientGain();
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private getSfxGain(): number {
    if (!this.settings || this.settings.muted) return 0;
    return this.settings.masterVolume * this.settings.sfxVolume;
  }

  private syncAmbientGain(): void {
    if (!this.ambientGain || !this.ctx || !this.settings) return;
    const target = this.settings.muted
      ? 0
      : this.settings.masterVolume * this.settings.ambientVolume * 0.08;
    this.ambientGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
  }

  startAmbient(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.ambientOsc1) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;

    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = 55; // A1 dark drone

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 82.41; // E2 fifth harmonic

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();

    this.ambientOsc1 = osc1;
    this.ambientOsc2 = osc2;
    this.ambientGain = gain;
    this.syncAmbientGain();
  }

  stopAmbient(): void {
    if (this.ambientOsc1) {
      try {
        this.ambientOsc1.stop();
        this.ambientOsc2?.stop();
      } catch {
        // Ignore already stopped
      }
      this.ambientOsc1 = null;
      this.ambientOsc2 = null;
      this.ambientGain = null;
    }
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volumeScale: number,
    delay = 0
  ): void {
    const vol = this.getSfxGain() * volumeScale;
    if (vol <= 0.001) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(duration: number, filterFreq: number, volumeScale: number): void {
    const vol = this.getSfxGain() * volumeScale;
    if (vol <= 0.001) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.4;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  playUiClick(): void {
    this.tone(520, 680, 0.06, 'triangle', 0.14);
  }

  playFireCast(): void {
    this.noise(0.16, 620, 0.22);
    this.tone(240, 95, 0.17, 'sawtooth', 0.18);
  }

  playIceCast(): void {
    this.tone(980, 1420, 0.11, 'sine', 0.16);
    this.tone(1320, 880, 0.13, 'triangle', 0.12, 0.02);
  }

  playLightningCast(): void {
    this.noise(0.12, 2400, 0.24);
    this.tone(840, 260, 0.11, 'square', 0.12);
    this.tone(1180, 420, 0.09, 'sawtooth', 0.1, 0.03);
  }

  playThermalShatter(): void {
    // Dramatic crystalline-ember detonation
    this.noise(0.32, 950, 0.34);
    this.tone(150, 48, 0.36, 'sawtooth', 0.28);
    this.tone(1120, 1680, 0.18, 'triangle', 0.2, 0.02);
    this.tone(840, 420, 0.24, 'sine', 0.2, 0.06);
  }

  playBlink(): void {
    this.tone(360, 920, 0.12, 'sine', 0.18);
    this.tone(720, 1180, 0.1, 'triangle', 0.12, 0.03);
  }

  playSurge(): void {
    this.noise(0.28, 520, 0.28);
    this.tone(180, 620, 0.28, 'sawtooth', 0.22);
    this.tone(440, 880, 0.22, 'triangle', 0.16, 0.06);
  }

  playEnemyHit(): void {
    this.tone(210, 110, 0.07, 'square', 0.11);
  }

  playEnemyDeath(): void {
    this.tone(260, 72, 0.18, 'triangle', 0.16);
    this.noise(0.11, 420, 0.12);
  }

  playPlayerHit(): void {
    this.tone(160, 68, 0.19, 'sawtooth', 0.25);
    this.noise(0.14, 300, 0.2);
  }

  playPickup(isRare = false): void {
    this.tone(isRare ? 660 : 540, isRare ? 990 : 780, 0.09, 'sine', 0.16);
    if (isRare) {
      this.tone(880, 1320, 0.12, 'triangle', 0.14, 0.05);
    }
  }

  playPotion(): void {
    this.tone(420, 680, 0.12, 'sine', 0.18);
    this.tone(640, 960, 0.16, 'sine', 0.16, 0.08);
  }

  playBossPhase(): void {
    this.noise(0.55, 340, 0.34);
    this.tone(130, 52, 0.6, 'sawtooth', 0.3);
    this.tone(260, 390, 0.45, 'triangle', 0.2, 0.12);
  }

  playBossNova(): void {
    this.noise(0.36, 480, 0.3);
    this.tone(140, 44, 0.38, 'sawtooth', 0.26);
  }

  playUpgradePick(): void {
    this.tone(440, 554, 0.12, 'triangle', 0.18);
    this.tone(554, 659, 0.12, 'triangle', 0.18, 0.08);
    this.tone(659, 880, 0.22, 'triangle', 0.2, 0.16);
  }

  playVictory(): void {
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((n, idx) => {
      this.tone(n, n * 1.01, 0.3, 'triangle', 0.2, idx * 0.11);
    });
  }

  playDefeat(): void {
    const notes = [330, 293.66, 246.94, 196];
    notes.forEach((n, idx) => {
      this.tone(n, n * 0.96, 0.28, 'sawtooth', 0.16, idx * 0.13);
    });
  }
}

export const soundEngine = new SoundEngine();
