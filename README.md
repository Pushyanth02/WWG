# Archmage: Riftbound

A top-down dark-fantasy pixel-art action roguelite with a built-in V3.1 sprite pipeline, interactive Asset Lab, PVFX Foundry / Pixel Burst VFX pack importer, and lossless asset export center.

**Live Playable Build (GitHub Pages):** https://pushyanth02.github.io/WWG/

## Features

- **6 Playable Mage Classes** — Pyromancer, Cryomancer, Stormcaller, Voidweaver, Aethermancer, and Chronomancer with 13 elemental spell schools and Elemental Resonance combos.
- **5 Playable Biomes & 5 Tyrant Bosses** — Cursed Grove (*Bone Regent*), Blighted Marsh (*Blight Colossus*), Undead Crypt (*Rift Leviathan*), Ashen Citadel (*Cinder Archon*), and Astral Abyss (*Astral Sovereign*), plus the 5-biome **Rift Gauntlet**.
- **13 Animated Enemy Archetypes** — Full-body articulated 2× hi-bit pixel sprites with directional rim lighting and crevice AO.
- **5-Stage Lit & Strict Spell VFX** — 14 built-in 5-stage spell sheets (`cast_charge`, `projectile`, `impact`, `aoe_burst`, `ground_linger`) in both **Lit Glow** and **Strict Banded** tiers, plus a tiered spell-impact light bloom, spark particle, and directional screen-shake hook.
- **Asset Lab, Pipeline Studio & Export Center** — Inspect all 46 validated V3.1 sprite sheets (`3,942` frames, 0 adjacent duplicates), import local PVFX Foundry / Pixel Burst PNG strips + `effects.json` into live combat, and export lossless `.zip` packs with SHA-256 integrity verification.

## Controls

- **Move:** `WASD` or Arrow Keys
- **Aim & Cast:** Mouse + Left Click (`1` / `2` / `3` to swap spell slots)
- **Phase Blink:** `Space` or `Shift`
- **Arcane Surge:** `Q` or Right Click
- **Health Potion:** `E`
- **Pause:** `Esc` or `P`

## Local Development

```bash
npm install
npm run dev
```

### Build & Asset Pipeline Commands

```bash
npm run lint              # Strict TypeScript check (tsc --noEmit)
npm run build             # Production Vite build (dist/)
npm run generate:assets   # Regenerate all 46 V3.1 sprite sheets + manifests
npm run validate:assets   # Validate all 46 sheets against the V3.1 contract
```

## Deployment

Pushing to `main` automatically runs `.github/workflows/deploy-pages.yml`, type-checks and builds the bundle with `VITE_BASE_PATH=/WWG/`, and deploys `./dist` to GitHub Pages.
