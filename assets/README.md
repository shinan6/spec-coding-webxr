# Open-Source Asset Catalog

Use these assets to replace placeholder geometry in the prototype.

## 1) Vehicle models (manual CC0 options)

- Source: [Kenney - Car Kit](https://kenney.nl/assets/car-kit)
  - License: CC0 (public domain dedication from Kenney)
  - Use for: player car + simple traffic cars
- Source: [Quaternius - LowPoly Cars](https://quaternius.itch.io/lowpoly-cars)
  - License: CC0
  - Use for: low-poly variations of incoming traffic

## 2) Road / environment textures (CC0)

- Source: [ambientCG Road/Asphalt collection](https://ambientcg.com/list?category=Asphalt)
  - Example texture pages:
    - [Asphalt 024A](https://ambientcg.com/view?id=Asphalt024A)
    - [Road 006](https://ambientcg.com/view?id=Road006)
  - License: CC0
- Source: [Poly Haven](https://polyhaven.com/)
  - License: CC0
  - Use for: HDRI sky lighting and extra PBR textures

## 3) Audio (CC0 picks)

- Source: [OpenGameArt - High Traffic Road Sounds](https://opengameart.org/content/high-traffic-road-sounds)
  - License: CC0
  - Use for: ambient traffic bed
- Source: [OpenGameArt - Motor Sound Effect](https://opengameart.org/content/motor-sound-effect)
  - License: CC0
  - Use for: simple engine loop / acceleration cue

## 4) Player car logo (official university asset)

- Source: [HKU Visual Identity - Logos](https://hku.hk/visual-identity/en/logo)
  - File used in this project:
    - `public/assets/textures/hku-logo-english.jpg`
    - Upstream URL: `https://hku.hk/f/page/7562/500p282/Standard_University_Logo_English.jpg`
  - Note: This logo is an official mark, not a CC0/open-source asset. Keep usage consistent with HKU brand guidance.

## Placement paths

Put downloaded assets here:

- Models: `public/assets/models`
- Textures: `public/assets/textures`
- Audio: `public/assets/audio`

Automatic importer:

```bash
npm run import-assets
```

This command fetches vehicle models from Khronos glTF Sample Models and writes `public/assets/models/ATTRIBUTION.md`.
The imported set is open-license, but licenses can vary by model; use the generated attribution file to review upstream terms.

Model filenames expected by the current loader:

- `public/assets/models/player-car.glb`
- `public/assets/models/traffic-car-a.glb`
- `public/assets/models/traffic-car-b.glb`
- `public/assets/models/traffic-car-c.glb`

## Integration notes

- For GLB/GLTF vehicles, load with `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`.
- Keep lane logic and collision math from `src/game/logic.ts`; swap only visual meshes first.
- Normalize model scale and set origin near wheelbase center for easier lane alignment.
