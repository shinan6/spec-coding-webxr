# WebXR Traffic Drive (Chrome)

A TypeScript + Three.js starter project for a VR driving experience in Chrome with WebXR support.

## Why this stack

- **Language:** TypeScript (best fit for browser/WebXR reliability, tooling, and maintainability)
- **3D/WebXR:** Three.js + `VRButton`
- **Build/Test:** Vite + Vitest

## What is implemented

- WebXR-ready renderer for Chrome (`VRButton`)
- 3-lane driving with smooth lane switching
- Real forward driving physics (speedometer, acceleration/braking, odometer distance)
- Incoming traffic AI with driver profiles, lane changes, overtakes, and reactive braking
- Infinite looping road tiles/markers (no time-based auto restart)
- Seeded procedural road scenarios with weighted straights, curves, and elevation changes
- Weather/time-of-day modifiers (`clear`, `light_rain`, `fog`, `day`, `dusk`, `night`)
- Event zones for `construction_narrow_lane` and `traffic_bottleneck`
- HKU official logo decal on the player car (with local fallback texture)
- Kilometer celebration burst effect every 1 km
- Win/Lose end-state overlays (`You win!` at 10 km, `You lose!` on crash)
- Collision detection + restart flow
- Pure game logic + procedural generation modules with tests (`src/game/logic.ts`, `src/game/procedural.ts`)

## Run locally

```bash
npm install
npm run import-assets
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in Chrome.

`npm run import-assets` downloads `.glb` vehicle files into `public/assets/models` and writes attribution metadata.
The importer uses open-license Khronos sample models with per-model license notes.

## Controls

- Steering: `A` / `D` or `Left` / `Right`
- Throttle: `W` or `Up`
- Brake: `S` or `Down`
- Mouse: hold left button and move to look around
- VR: controller thumbstick left/right
- Restart after crash: `R`
- Visual forward motion is shown by road flow and wheel spin
- Crash now shows a boom flash/ring/particles effect

## Procedural mode

- Procedural mode is enabled by default.
- Use `?seed=<value>` to replay the same road/weather/event sequence.
- Use `?procedural=0` to fall back to the original straight-road mode.
- The HUD now shows the active seed, modifier set, segment type, and live event zone.

## Build and test

```bash
npm test
npm run build
```

## Asset sources (open-source)

Curated sources are documented in [assets/README.md](assets/README.md), including:

- [Kenney - Car Kit (CC0)](https://kenney.nl/assets/car-kit)
- [Quaternius - LowPoly Cars (CC0)](https://quaternius.itch.io/lowpoly-cars)
- [ambientCG Asphalt/Road textures (CC0)](https://ambientcg.com/)
- [Poly Haven HDRIs/textures (CC0)](https://polyhaven.com/)
- [OpenGameArt - High Traffic Road Sounds (CC0)](https://opengameart.org/content/high-traffic-road-sounds)

Place downloaded files under:

- `public/assets/models`
- `public/assets/textures`
- `public/assets/audio`

Expected model filenames for auto-loading:

- `public/assets/models/player-car.glb`
- `public/assets/models/traffic-car-a.glb`
- `public/assets/models/traffic-car-b.glb`
- `public/assets/models/traffic-car-c.glb`

If these files are missing, the app keeps using built-in primitive meshes.
