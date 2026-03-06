import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import {
  DEFAULT_TRAFFIC_PROFILE_WEIGHTS,
  advanceLoopingZ,
  applyMouseLookDelta,
  canSpawnTrafficInLane,
  createInitialTraffic,
  evaluateDistanceEvents,
  hasCollision,
  laneToX,
  mapSteerDirectionForMirroredView,
  nextLane,
  sampleCrashBoom,
  spawnTraffic,
  stepTraffic,
  updatePlayerSpeed,
  type TrafficVehicle
} from "./game/logic";
import {
  PLAYER_MODEL_PATHS,
  TRAFFIC_MODEL_PATHS,
  normalizeModelToRoadScale,
  trafficModelPathForId
} from "./game/model-utils";
import {
  createSeededRandom,
  generateProceduralSegments,
  sampleProceduralScenario,
  type ProceduralEventZone,
  type TimeOfDayKind,
  type WeatherKind
} from "./game/procedural";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing root #app element");
}

app.innerHTML = `
  <div class="hud">
    <h1>WebXR Traffic Drive</h1>
    <p id="status" class="status">Booting simulation...</p>
    <p id="telemetry" class="telemetry">Speed 0 km/h | Distance 0.00 km</p>
    <p id="scenario" class="scenario">Seeded procedural road booting...</p>
    <p class="controls">Steer: A/D or Left/Right. Throttle: W/Up. Brake: S/Down. Mouse: hold left button and move to look. VR: thumbstick left/right. Restart: R.</p>
  </div>
  <div id="milestone-celebration" class="milestone-celebration" aria-live="polite"></div>
  <div id="result-overlay" class="result-overlay" aria-live="assertive"></div>
`;

const statusEl = app.querySelector<HTMLParagraphElement>("#status");
const telemetryEl = app.querySelector<HTMLParagraphElement>("#telemetry");
const scenarioEl = app.querySelector<HTMLParagraphElement>("#scenario");
const milestoneCelebrationEl = app.querySelector<HTMLDivElement>("#milestone-celebration");
const resultOverlayEl = app.querySelector<HTMLDivElement>("#result-overlay");

if (!statusEl || !telemetryEl || !scenarioEl || !milestoneCelebrationEl || !resultOverlayEl) {
  throw new Error("Missing hud status elements");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x77a6d1);
scene.fog = new THREE.Fog(0x77a6d1, 26, 130);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 220);
camera.position.set(0, 0, 0);

const cameraRig = new THREE.Group();
const baseCameraYaw = Math.PI;
const mouseLookSensitivity = 0.0028;
const mouseLookMaxPitch = 0.6;
let lookYaw = 0;
let lookPitch = 0;

const applyCameraLook = (): void => {
  cameraRig.rotation.y = baseCameraYaw + lookYaw;
  camera.rotation.x = lookPitch;
};

const isMirroredView = (): boolean => Math.cos(cameraRig.rotation.y) < 0;

cameraRig.position.set(0, 1.8, -6);
cameraRig.add(camera);
scene.add(cameraRig);
applyCameraLook();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
app.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const ambient = new THREE.HemisphereLight(0xffffff, 0x314461, 1.15);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(8, 12, 4);
scene.add(sun);

const laneCount = 3;
const roadWidth = 10;
const laneWidth = 2.5;
const trafficSpeedRange: [number, number] = [9, 16];
const trafficProfileWeights = DEFAULT_TRAFFIC_PROFILE_WEIGHTS;
const trafficSpeedWaveAmplitude = 2.4;
const initialTrafficCount = 3;
const initialTrafficFirstZ = 24;
const initialTrafficSpacing = 16;
const initialPlayerSpeed = 16;
const playerWheelRadius = 0.26;
const crashBoomDuration = 0.8;
const winDistanceKilometers = 10;
const crashParticleCount = 26;
const roadTileLength = 90;
const roadTileCount = 4;
const roadLoopMinZ = -roadTileLength;
const roadLoopMaxZ = roadLoopMinZ + roadTileLength * (roadTileCount - 1);
const stripeLoopMinZ = roadLoopMinZ;
const stripeLoopMaxZ = roadLoopMaxZ;
const spawnZ = 62;
const trafficBaseGapThreshold = 34;
const proceduralQuery = new URLSearchParams(window.location.search);
const proceduralModeEnabled = proceduralQuery.get("procedural") !== "0";
const proceduralSeed = proceduralQuery.get("seed") ?? "issue-2-procedural-road";
const proceduralSegmentCount = Math.max(
  160,
  Math.ceil((winDistanceKilometers * 1000 + spawnZ + roadTileLength * 4) / roadTileLength)
);
const proceduralSegments = proceduralModeEnabled
  ? generateProceduralSegments({
      seed: proceduralSeed,
      count: proceduralSegmentCount,
      segmentLength: roadTileLength,
      laneCount
    })
  : [];
let trafficRng = createSeededRandom(`${proceduralSeed}-traffic`);
const effectsRng = createSeededRandom(`${proceduralSeed}-effects`);

const driveConfig = {
  maxSpeed: 58,
  accelRate: 24,
  brakeRate: 34,
  dragRate: 3.2
};

const roadTiles: THREE.Mesh[] = [];
const shoulderTiles: THREE.Mesh[] = [];
const constructionOverlays: THREE.Mesh[] = [];
const bottleneckOverlays: THREE.Mesh[] = [];
const roadGeometry = new THREE.PlaneGeometry(roadWidth, roadTileLength);
const shoulderGeometry = new THREE.PlaneGeometry(roadWidth + 2.8, roadTileLength);
const roadMaterial = new THREE.MeshStandardMaterial({
  color: 0x222831,
  roughness: 0.95,
  metalness: 0.02
});
const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x465331, roughness: 1.0 });
const stripeMaterial = new THREE.MeshStandardMaterial({
  color: 0xe9ecef,
  roughness: 0.7,
  emissive: 0x000000
});
const constructionOverlayMaterial = new THREE.MeshStandardMaterial({
  color: 0xffae42,
  transparent: true,
  opacity: 0.48,
  roughness: 0.82,
  metalness: 0.02,
  depthWrite: false
});
const bottleneckOverlayMaterial = new THREE.MeshStandardMaterial({
  color: 0xff5d73,
  transparent: true,
  opacity: 0.34,
  roughness: 0.8,
  metalness: 0.02,
  depthWrite: false
});

for (let index = 0; index < roadTileCount; index += 1) {
  const tileZ = roadLoopMinZ + index * roadTileLength;

  const roadTile = new THREE.Mesh(roadGeometry, roadMaterial);
  roadTile.rotation.x = -Math.PI / 2;
  roadTile.position.set(0, -0.05, tileZ);
  scene.add(roadTile);
  roadTiles.push(roadTile);

  const shoulderTile = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
  shoulderTile.rotation.x = -Math.PI / 2;
  shoulderTile.position.set(0, -0.09, tileZ);
  scene.add(shoulderTile);
  shoulderTiles.push(shoulderTile);

  const constructionOverlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), constructionOverlayMaterial);
  constructionOverlay.rotation.x = -Math.PI / 2;
  constructionOverlay.position.set(0, -0.015, tileZ);
  constructionOverlay.visible = false;
  scene.add(constructionOverlay);
  constructionOverlays.push(constructionOverlay);

  const bottleneckOverlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bottleneckOverlayMaterial);
  bottleneckOverlay.rotation.x = -Math.PI / 2;
  bottleneckOverlay.position.set(0, -0.012, tileZ);
  bottleneckOverlay.visible = false;
  scene.add(bottleneckOverlay);
  bottleneckOverlays.push(bottleneckOverlay);
}

const laneStripes: THREE.Mesh[] = [];

for (const separatorX of [-laneWidth / 2, laneWidth / 2]) {
  for (let z = stripeLoopMinZ; z <= stripeLoopMaxZ; z += 9) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 4.6), stripeMaterial);
    stripe.position.set(separatorX, -0.01, z);
    stripe.userData.baseX = separatorX;
    scene.add(stripe);
    laneStripes.push(stripe);
  }
}

const crashBoomGroup = new THREE.Group();
crashBoomGroup.visible = false;
scene.add(crashBoomGroup);

const crashFlashMaterial = new THREE.MeshBasicMaterial({
  color: 0xffbb55,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const crashFlash = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 18), crashFlashMaterial);
crashBoomGroup.add(crashFlash);

const crashRingMaterial = new THREE.MeshBasicMaterial({
  color: 0xff6d2d,
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const crashRing = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.7, 40), crashRingMaterial);
crashRing.rotation.x = -Math.PI / 2;
crashBoomGroup.add(crashRing);

const crashParticlesGeometry = new THREE.BufferGeometry();
const crashParticleDirections = new Float32Array(crashParticleCount * 3);
const crashParticlePositions = new Float32Array(crashParticleCount * 3);
for (let index = 0; index < crashParticleCount; index += 1) {
  const dir = new THREE.Vector3(
    effectsRng() * 2 - 1,
    effectsRng() * 1.2,
    effectsRng() * 2 - 1
  ).normalize();
  crashParticleDirections[index * 3] = dir.x;
  crashParticleDirections[index * 3 + 1] = dir.y;
  crashParticleDirections[index * 3 + 2] = dir.z;
}
crashParticlesGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(crashParticlePositions, 3)
);
const crashParticlesMaterial = new THREE.PointsMaterial({
  color: 0xffd36b,
  size: 0.13,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const crashParticles = new THREE.Points(crashParticlesGeometry, crashParticlesMaterial);
crashBoomGroup.add(crashParticles);

const rainDropCount = 180;
const rainPositions = new Float32Array(rainDropCount * 3);
const rainFallSpeeds = new Float32Array(rainDropCount);
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
const rainMaterial = new THREE.PointsMaterial({
  color: 0xc4defd,
  size: 0.07,
  transparent: true,
  opacity: 0.72,
  depthWrite: false
});
const rainParticles = new THREE.Points(rainGeometry, rainMaterial);
rainParticles.visible = false;
scene.add(rainParticles);

const createFallbackHKULogoTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create HKU logo canvas context");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#1f3f75";
  context.lineWidth = 18;
  context.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);

  context.fillStyle = "#7b1f2b";
  context.font = "bold 108px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("HKU", canvas.width / 2, canvas.height / 2 + 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
};

const hkuLogoMaterial = new THREE.MeshBasicMaterial({
  map: createFallbackHKULogoTexture(),
  transparent: true,
  depthWrite: false
});
const hkuLogoTexturePath = "/assets/textures/hku-logo-english.jpg";

new THREE.TextureLoader().load(
  hkuLogoTexturePath,
  (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    hkuLogoMaterial.map = texture;
    hkuLogoMaterial.needsUpdate = true;
  },
  undefined,
  (error) => {
    console.warn(
      `[assets] Failed to load ${hkuLogoTexturePath}; using fallback HKU decal texture.`,
      error
    );
  }
);

const attachHKULogo = (car: THREE.Group): void => {
  const existing = car.getObjectByName("hku-logo");
  if (existing?.parent) {
    existing.parent.remove(existing);
  }

  const bounds = new THREE.Box3().setFromObject(car);
  const size = new THREE.Vector3();
  bounds.getSize(size);

  const logoWidth = Math.max(0.68, size.x * 0.55);
  const logoHeight = logoWidth * 0.56;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(logoWidth, logoHeight), hkuLogoMaterial);
  logo.name = "hku-logo";
  logo.rotation.x = -Math.PI / 2;
  logo.position.set(0, Math.max(0.65, size.y * 0.54), Math.max(0.45, size.z * 0.2));
  car.add(logo);
};

const labelizeScenarioValue = (value: string): string => value.replace(/_/g, " ");

const resetRainDrop = (index: number): void => {
  rainPositions[index * 3] = effectsRng() * 14 - 7;
  rainPositions[index * 3 + 1] = effectsRng() * 7 + 0.5;
  rainPositions[index * 3 + 2] = effectsRng() * 24 - 12;
  rainFallSpeeds[index] = 9 + effectsRng() * 8;
};

for (let index = 0; index < rainDropCount; index += 1) {
  resetRainDrop(index);
}

type EnvironmentPreset = {
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  roadColor: number;
  shoulderColor: number;
  stripeEmissive: number;
  stripeColor: number;
};

const environmentPresets: Record<TimeOfDayKind, Record<WeatherKind, EnvironmentPreset>> = {
  day: {
    clear: {
      background: 0x77a6d1,
      fog: 0x77a6d1,
      fogNear: 26,
      fogFar: 130,
      ambientSky: 0xffffff,
      ambientGround: 0x314461,
      ambientIntensity: 1.15,
      sunColor: 0xffffff,
      sunIntensity: 0.82,
      sunPosition: [8, 12, 4],
      roadColor: 0x222831,
      shoulderColor: 0x465331,
      stripeEmissive: 0x000000,
      stripeColor: 0xe9ecef
    },
    light_rain: {
      background: 0x5f7591,
      fog: 0x6a7c91,
      fogNear: 20,
      fogFar: 92,
      ambientSky: 0xdce7f4,
      ambientGround: 0x273445,
      ambientIntensity: 0.98,
      sunColor: 0xd9e5f8,
      sunIntensity: 0.58,
      sunPosition: [5, 10, 2],
      roadColor: 0x1c242d,
      shoulderColor: 0x394430,
      stripeEmissive: 0x1d2b35,
      stripeColor: 0xd4dde8
    },
    fog: {
      background: 0x8ba1ab,
      fog: 0x9caeb5,
      fogNear: 10,
      fogFar: 54,
      ambientSky: 0xf1f4f8,
      ambientGround: 0x40505e,
      ambientIntensity: 1.08,
      sunColor: 0xf5f7fb,
      sunIntensity: 0.45,
      sunPosition: [4, 10, 0],
      roadColor: 0x283038,
      shoulderColor: 0x4d5a49,
      stripeEmissive: 0x24323f,
      stripeColor: 0xe8edf2
    }
  },
  dusk: {
    clear: {
      background: 0x9f6749,
      fog: 0x896256,
      fogNear: 22,
      fogFar: 118,
      ambientSky: 0xffd2b8,
      ambientGround: 0x35243f,
      ambientIntensity: 0.96,
      sunColor: 0xffb36f,
      sunIntensity: 0.7,
      sunPosition: [6, 8, -4],
      roadColor: 0x29242b,
      shoulderColor: 0x4e4735,
      stripeEmissive: 0x2c1709,
      stripeColor: 0xf3e8d7
    },
    light_rain: {
      background: 0x6e5b66,
      fog: 0x6f6870,
      fogNear: 18,
      fogFar: 82,
      ambientSky: 0xdfcad1,
      ambientGround: 0x2c2331,
      ambientIntensity: 0.88,
      sunColor: 0xd4b6c2,
      sunIntensity: 0.42,
      sunPosition: [4, 7, -3],
      roadColor: 0x201f26,
      shoulderColor: 0x404132,
      stripeEmissive: 0x33180f,
      stripeColor: 0xe8dfd8
    },
    fog: {
      background: 0x7b6a76,
      fog: 0x847a86,
      fogNear: 10,
      fogFar: 48,
      ambientSky: 0xe9dfe4,
      ambientGround: 0x352f38,
      ambientIntensity: 0.9,
      sunColor: 0xe2d3dc,
      sunIntensity: 0.3,
      sunPosition: [3, 7, -1],
      roadColor: 0x25232a,
      shoulderColor: 0x45443d,
      stripeEmissive: 0x35231c,
      stripeColor: 0xf0e7e0
    }
  },
  night: {
    clear: {
      background: 0x07111f,
      fog: 0x0a1526,
      fogNear: 16,
      fogFar: 82,
      ambientSky: 0x7aa0d6,
      ambientGround: 0x101822,
      ambientIntensity: 0.62,
      sunColor: 0xa8c5ff,
      sunIntensity: 0.22,
      sunPosition: [-6, 8, -5],
      roadColor: 0x141a24,
      shoulderColor: 0x1f2f28,
      stripeEmissive: 0x6c87b7,
      stripeColor: 0xe8eef7
    },
    light_rain: {
      background: 0x050d19,
      fog: 0x09111d,
      fogNear: 12,
      fogFar: 58,
      ambientSky: 0x6e86aa,
      ambientGround: 0x0d141b,
      ambientIntensity: 0.54,
      sunColor: 0x96b0da,
      sunIntensity: 0.14,
      sunPosition: [-5, 7, -5],
      roadColor: 0x101720,
      shoulderColor: 0x192920,
      stripeEmissive: 0x7b9dd5,
      stripeColor: 0xe4ebf6
    },
    fog: {
      background: 0x08111d,
      fog: 0x0d1825,
      fogNear: 8,
      fogFar: 40,
      ambientSky: 0x7f93b2,
      ambientGround: 0x111a23,
      ambientIntensity: 0.56,
      sunColor: 0xa8b7d5,
      sunIntensity: 0.1,
      sunPosition: [-4, 6, -3],
      roadColor: 0x121922,
      shoulderColor: 0x233227,
      stripeEmissive: 0x8ca4d7,
      stripeColor: 0xeaf0fb
    }
  }
};

function createCarMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.2 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.8 });
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.8), bodyMaterial);
  body.position.set(0, 0.62, 0);
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 1.45), trimMaterial);
  cabin.position.set(0, 1.05, -0.1);
  group.add(cabin);

  const wheelGeometry = new THREE.CylinderGeometry(0.26, 0.26, 0.22, 18);
  const wheelOffsets: Array<[number, number, number]> = [
    [-0.65, 0.28, 1.0],
    [0.65, 0.28, 1.0],
    [-0.65, 0.28, -1.0],
    [0.65, 0.28, -1.0]
  ];

  for (const [x, y, z] of wheelOffsets) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.userData.isWheel = true;
    wheel.position.set(x, y, z);
    group.add(wheel);
  }

  return group;
}

const fallbackTrafficColors = [0xfc5c65, 0xffa94d, 0x6c63ff, 0xff6b9d];
const gltfLoader = new GLTFLoader();
const trafficModelTemplates: Array<THREE.Group | null> = [];

const loadModelTemplate = async (path: string): Promise<THREE.Group | null> => {
  try {
    const gltf = await gltfLoader.loadAsync(path);
    const template = gltf.scene;
    normalizeModelToRoadScale(template, 2.8);
    template.updateMatrixWorld(true);
    return template;
  } catch (error) {
    console.warn(`[assets] Failed to load ${path}; using primitive fallback.`, error);
    return null;
  }
};

const createTrafficVisual = (vehicleId: number): THREE.Group => {
  const template =
    trafficModelTemplates.length > 0
      ? trafficModelTemplates[vehicleId % trafficModelTemplates.length]
      : null;

  if (template) {
    return template.clone(true);
  }

  return createCarMesh(fallbackTrafficColors[vehicleId % fallbackTrafficColors.length]);
};

let playerCar = createCarMesh(0x21c6b8);
playerCar.position.set(laneToX(1, laneCount, laneWidth), 0, 0);
attachHKULogo(playerCar);
scene.add(playerCar);

const preloadCarAssets = async (): Promise<void> => {
  for (let index = 0; index < TRAFFIC_MODEL_PATHS.length; index += 1) {
    const path = trafficModelPathForId(index);
    trafficModelTemplates[index] = path ? await loadModelTemplate(path) : null;
  }

  const playerPath = PLAYER_MODEL_PATHS[0];
  if (!playerPath) {
    return;
  }

  const playerTemplate = await loadModelTemplate(playerPath);
  if (!playerTemplate) {
    return;
  }

  const replacement = playerTemplate.clone(true);
  replacement.position.copy(playerCar.position);
  replacement.rotation.copy(playerCar.rotation);
  attachHKULogo(replacement);

  scene.remove(playerCar);
  playerCar = replacement;
  scene.add(playerCar);
};

void preloadCarAssets();

const buildInitialTraffic = (): TrafficVehicle[] =>
  createInitialTraffic(
    1,
    initialTrafficCount,
    laneCount,
    initialTrafficFirstZ,
    initialTrafficSpacing,
    trafficRng,
    trafficSpeedRange,
    trafficProfileWeights
  );

let traffic: TrafficVehicle[] = buildInitialTraffic();
let playerLane = 1;
let nextTrafficId = traffic.length + 1;
let crashed = false;
let won = false;
let spawnTimer = 0.65;
let laneMoveCooldown = 0;
let xrAxisLatch = 0;
let crashBoomActive = false;
let crashBoomElapsed = 0;
let playerSpeed = initialPlayerSpeed;
let throttleInput = 0;
let brakeInput = 0;
let distanceMeters = 0;
let raceElapsedSeconds = 0;
let celebrationResetTimer: number | null = null;

const triggerMilestoneCelebration = (kilometer: number): void => {
  milestoneCelebrationEl.textContent = `${kilometer} KM!`;
  milestoneCelebrationEl.classList.remove("is-active");
  void milestoneCelebrationEl.offsetWidth;
  milestoneCelebrationEl.classList.add("is-active");

  if (celebrationResetTimer !== null) {
    window.clearTimeout(celebrationResetTimer);
  }

  celebrationResetTimer = window.setTimeout(() => {
    milestoneCelebrationEl.classList.remove("is-active");
    celebrationResetTimer = null;
  }, 1250);
};

const showResultOverlay = (message: string, type: "win" | "lose"): void => {
  resultOverlayEl.textContent = message;
  resultOverlayEl.classList.remove("win", "lose", "is-active");
  void resultOverlayEl.offsetWidth;
  resultOverlayEl.classList.add("is-active", type);
};

const hideResultOverlay = (): void => {
  resultOverlayEl.classList.remove("win", "lose", "is-active");
  resultOverlayEl.textContent = "";
};

const trafficMeshes = new Map<number, THREE.Group>();
const clock = new THREE.Clock();
let scenarioSummary =
  proceduralModeEnabled
    ? `Seed ${proceduralSeed} | clear day | straight`
    : "Procedural mode disabled (`?procedural=0`)";

const sampleRoadStateAtLocalZ = (localZ: number) =>
  proceduralModeEnabled
    ? sampleProceduralScenario(proceduralSegments, Math.max(0, distanceMeters + localZ))
    : null;

const applySurfacePose = (mesh: THREE.Mesh, baseY: number, localZ: number): void => {
  const scenario = sampleRoadStateAtLocalZ(localZ);

  if (!scenario) {
    mesh.position.x = 0;
    mesh.position.y = baseY;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.y = 0;
    return;
  }

  mesh.position.x = scenario.pose.offsetX;
  mesh.position.y = baseY + scenario.pose.offsetY;
  mesh.rotation.x = -Math.PI / 2 + scenario.pose.pitch;
  mesh.rotation.y = scenario.pose.yaw;
};

const applyEnvironment = (dt: number, weather: WeatherKind, timeOfDay: TimeOfDayKind): void => {
  const target = environmentPresets[timeOfDay][weather];
  const blend = Math.min(1, dt * 2.4);
  const background = scene.background;
  const fog = scene.fog;

  if (background instanceof THREE.Color) {
    background.lerp(new THREE.Color(target.background), blend);
  } else {
    scene.background = new THREE.Color(target.background);
  }

  if (fog instanceof THREE.Fog) {
    fog.color.lerp(new THREE.Color(target.fog), blend);
    fog.near = THREE.MathUtils.lerp(fog.near, target.fogNear, blend);
    fog.far = THREE.MathUtils.lerp(fog.far, target.fogFar, blend);
  }

  ambient.color.lerp(new THREE.Color(target.ambientSky), blend);
  ambient.groundColor.lerp(new THREE.Color(target.ambientGround), blend);
  ambient.intensity = THREE.MathUtils.lerp(ambient.intensity, target.ambientIntensity, blend);

  sun.color.lerp(new THREE.Color(target.sunColor), blend);
  sun.intensity = THREE.MathUtils.lerp(sun.intensity, target.sunIntensity, blend);
  sun.position.lerp(new THREE.Vector3(...target.sunPosition), blend);

  roadMaterial.color.lerp(new THREE.Color(target.roadColor), blend);
  shoulderMaterial.color.lerp(new THREE.Color(target.shoulderColor), blend);
  stripeMaterial.color.lerp(new THREE.Color(target.stripeColor), blend);
  stripeMaterial.emissive.lerp(new THREE.Color(target.stripeEmissive), blend);
  roadMaterial.roughness = THREE.MathUtils.lerp(
    roadMaterial.roughness,
    weather === "light_rain" ? 0.72 : 0.95,
    blend
  );
  roadMaterial.metalness = THREE.MathUtils.lerp(
    roadMaterial.metalness,
    weather === "light_rain" ? 0.18 : 0.02,
    blend
  );
};

const updateRain = (dt: number, weather: WeatherKind): void => {
  if (weather !== "light_rain") {
    rainParticles.visible = false;
    return;
  }

  rainParticles.visible = true;
  rainParticles.position.x = cameraRig.position.x;
  rainParticles.position.y = cameraRig.position.y + 0.8;
  rainParticles.position.z = 4;

  const positions = rainGeometry.getAttribute("position");
  for (let index = 0; index < rainDropCount; index += 1) {
    const nextY = (positions.getY(index) ?? 0) - rainFallSpeeds[index] * dt;
    const nextZ = (positions.getZ(index) ?? 0) - rainFallSpeeds[index] * 0.3 * dt;

    if (nextY < -4 || nextZ < -14) {
      resetRainDrop(index);
      continue;
    }

    positions.setXYZ(index, positions.getX(index) ?? 0, nextY, nextZ);
  }
  positions.needsUpdate = true;
};

const eventLaneWeights = (eventZone: ProceduralEventZone | null): number[] | undefined => {
  if (!eventZone) {
    return undefined;
  }

  const weights = Array.from({ length: laneCount }, () => 1);

  if (eventZone.kind === "construction_narrow_lane") {
    weights[eventZone.lane] = 0.2;
    for (let lane = 0; lane < weights.length; lane += 1) {
      if (lane !== eventZone.lane) {
        weights[lane] = lane === 1 ? 1.45 : 1.15;
      }
    }
    return weights;
  }

  weights[eventZone.lane] = 1.9;
  return weights;
};

const eventLaneGapScale = (eventZone: ProceduralEventZone | null): Record<number, number> | undefined => {
  if (!eventZone) {
    return undefined;
  }

  if (eventZone.kind === "construction_narrow_lane") {
    const gapScale: Record<number, number> = {};
    for (let lane = 0; lane < laneCount; lane += 1) {
      if (lane !== eventZone.lane) {
        gapScale[lane] = lane === 1 ? 0.76 : 0.82;
      }
    }
    return gapScale;
  }

  return {
    [eventZone.lane]: 0.72
  };
};

const updateRoadVisuals = (): void => {
  for (let index = 0; index < roadTiles.length; index += 1) {
    const roadTile = roadTiles[index];
    const shoulderTile = shoulderTiles[index];
    const constructionOverlay = constructionOverlays[index];
    const bottleneckOverlay = bottleneckOverlays[index];
    const scenario = sampleRoadStateAtLocalZ(roadTile.position.z);

    applySurfacePose(roadTile, -0.05, roadTile.position.z);
    applySurfacePose(shoulderTile, -0.09, shoulderTile.position.z);

    constructionOverlay.visible = false;
    bottleneckOverlay.visible = false;

    if (!scenario?.segment.eventZone) {
      continue;
    }

    const zone = scenario.segment.eventZone;
    const overlayLength = Math.max(20, zone.endOffset - zone.startOffset);
    const overlayZ = roadTile.position.z;
    const overlayPitch = scenario.pose.pitch;
    const overlayYaw = scenario.pose.yaw;
    const overlayY = -0.014 + scenario.pose.offsetY;

    if (zone.kind === "construction_narrow_lane") {
      constructionOverlay.visible = true;
      constructionOverlay.scale.set(laneWidth * 0.9, overlayLength, 1);
      constructionOverlay.position.set(
        laneToX(zone.lane, laneCount, laneWidth) + scenario.pose.offsetX,
        overlayY,
        overlayZ
      );
      constructionOverlay.rotation.x = -Math.PI / 2 + overlayPitch;
      constructionOverlay.rotation.y = overlayYaw;
    } else {
      bottleneckOverlay.visible = true;
      bottleneckOverlay.scale.set(roadWidth * 0.7, overlayLength, 1);
      bottleneckOverlay.position.set(
        laneToX(zone.lane, laneCount, laneWidth) * 0.35 + scenario.pose.offsetX,
        overlayY + 0.002,
        overlayZ
      );
      bottleneckOverlay.rotation.x = -Math.PI / 2 + overlayPitch;
      bottleneckOverlay.rotation.y = overlayYaw;
    }
  }

  for (const stripe of laneStripes) {
    const scenario = sampleRoadStateAtLocalZ(stripe.position.z);
    const baseX = Number(stripe.userData.baseX ?? 0);

    if (!scenario) {
      stripe.position.x = baseX;
      stripe.position.y = -0.01;
      stripe.rotation.x = 0;
      stripe.rotation.y = 0;
      continue;
    }

    stripe.position.x = baseX + scenario.pose.offsetX;
    stripe.position.y = -0.01 + scenario.pose.offsetY;
    stripe.rotation.x = scenario.pose.pitch;
    stripe.rotation.y = scenario.pose.yaw;
  }
};

const updateStatus = (): void => {
  const speedKmh = Math.round(playerSpeed * 3.6);
  const distanceKm = (distanceMeters / 1000).toFixed(2);
  telemetryEl.textContent = `Speed ${speedKmh} km/h | Distance ${distanceKm} km`;
  scenarioEl.textContent = scenarioSummary;

  if (crashed) {
    statusEl.textContent = "You lose! Crash detected - press R to restart.";
    return;
  }

  if (won) {
    statusEl.textContent = "You win! Reached 10 km - press R to play again.";
    return;
  }
  statusEl.textContent = "Drive forward, avoid traffic, and keep building distance.";
};

const rebuildTrafficMeshes = (): void => {
  const activeIds = new Set<number>();

  for (const vehicle of traffic) {
    activeIds.add(vehicle.id);
    let mesh = trafficMeshes.get(vehicle.id);

    if (!mesh) {
      mesh = createTrafficVisual(vehicle.id);
      mesh.rotation.y = Math.PI;
      scene.add(mesh);
      trafficMeshes.set(vehicle.id, mesh);
    }

    const scenario = sampleRoadStateAtLocalZ(vehicle.z);
    const poseOffsetX = scenario?.pose.offsetX ?? 0;
    const poseOffsetY = scenario?.pose.offsetY ?? 0;
    const poseYaw = scenario?.pose.yaw ?? 0;
    const laneTargetX = laneToX(vehicle.lane, laneCount, laneWidth) + poseOffsetX;
    if (mesh.userData.hasInitializedLanePosition) {
      mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, laneTargetX, 0.18);
    } else {
      mesh.position.x = laneTargetX;
      mesh.userData.hasInitializedLanePosition = true;
    }
    mesh.position.y = poseOffsetY;
    mesh.position.z = vehicle.z;
    mesh.rotation.y = Math.PI + poseYaw;
  }

  for (const [id, mesh] of trafficMeshes) {
    if (!activeIds.has(id)) {
      scene.remove(mesh);
      trafficMeshes.delete(id);
    }
  }
};

const animateRoadFlow = (dt: number, forwardSpeed: number): void => {
  const flowSpeed = Math.max(0, forwardSpeed);

  for (const tile of roadTiles) {
    tile.position.z = advanceLoopingZ(tile.position.z, flowSpeed, dt, roadLoopMinZ, roadLoopMaxZ);
  }

  for (const tile of shoulderTiles) {
    tile.position.z = advanceLoopingZ(tile.position.z, flowSpeed, dt, roadLoopMinZ, roadLoopMaxZ);
  }

  for (const stripe of laneStripes) {
    stripe.position.z = advanceLoopingZ(
      stripe.position.z,
      flowSpeed,
      dt,
      stripeLoopMinZ,
      stripeLoopMaxZ
    );
  }
};

const animatePlayerWheels = (dt: number, forwardSpeed: number): void => {
  const angularVelocity = Math.max(0, forwardSpeed) / playerWheelRadius;
  playerCar.traverse((object) => {
    if (!object.userData.isWheel) {
      return;
    }
    object.rotation.x -= angularVelocity * dt;
  });
};

const updateDrivePhysics = (dt: number): void => {
  playerSpeed = updatePlayerSpeed(playerSpeed, throttleInput, brakeInput, dt, driveConfig);
  distanceMeters += playerSpeed * dt;
  raceElapsedSeconds += dt;
};

const triggerCrashBoom = (): void => {
  crashBoomActive = true;
  crashBoomElapsed = 0;
  playerSpeed = 0;
  throttleInput = 0;
  brakeInput = 0;
  crashBoomGroup.visible = true;
  crashBoomGroup.position.copy(playerCar.position);
  crashBoomGroup.position.y += 0.55;

  crashFlash.scale.setScalar(1);
  crashRing.scale.setScalar(1);
  crashFlashMaterial.opacity = 1;
  crashRingMaterial.opacity = 1;
  crashParticlesMaterial.opacity = 1;
  showResultOverlay("You lose!", "lose");

  const positions = crashParticlesGeometry.getAttribute("position");
  for (let index = 0; index < crashParticleCount; index += 1) {
    positions.setXYZ(index, 0, 0, 0);
  }
  positions.needsUpdate = true;
};

const updateCrashBoom = (dt: number): void => {
  if (!crashBoomActive) {
    return;
  }

  crashBoomElapsed += dt;
  const sample = sampleCrashBoom(crashBoomElapsed, crashBoomDuration);
  if (!sample.active) {
    crashBoomActive = false;
    crashBoomGroup.visible = false;
    return;
  }

  crashFlash.scale.setScalar(sample.flashScale);
  crashFlashMaterial.opacity = sample.flashOpacity;

  crashRing.scale.setScalar(sample.ringScale);
  crashRingMaterial.opacity = sample.ringOpacity;

  crashParticlesMaterial.opacity = sample.particleOpacity;
  const positions = crashParticlesGeometry.getAttribute("position");
  for (let index = 0; index < crashParticleCount; index += 1) {
    const px = crashParticleDirections[index * 3] * sample.particleDistance;
    const py = crashParticleDirections[index * 3 + 1] * sample.particleDistance * 0.8;
    const pz = crashParticleDirections[index * 3 + 2] * sample.particleDistance;
    positions.setXYZ(index, px, py, pz);
  }
  positions.needsUpdate = true;
};

const queueLaneMove = (direction: number): void => {
  if (crashed || laneMoveCooldown > 0) {
    return;
  }

  playerLane = nextLane(playerLane, direction, laneCount);
  laneMoveCooldown = 0.16;
};

const resetGame = (): void => {
  trafficRng = createSeededRandom(`${proceduralSeed}-traffic`);
  traffic = buildInitialTraffic();
  for (const [, mesh] of trafficMeshes) {
    scene.remove(mesh);
  }
  trafficMeshes.clear();

  playerLane = 1;
  playerCar.position.x = laneToX(playerLane, laneCount, laneWidth);

  crashed = false;
  won = false;
  spawnTimer = 0.65;
  laneMoveCooldown = 0;
  xrAxisLatch = 0;
  nextTrafficId = traffic.length + 1;
  crashBoomActive = false;
  crashBoomElapsed = 0;
  crashBoomGroup.visible = false;
  playerSpeed = initialPlayerSpeed;
  throttleInput = 0;
  brakeInput = 0;
  distanceMeters = 0;
  raceElapsedSeconds = 0;
  scenarioSummary =
    proceduralModeEnabled
      ? `Seed ${proceduralSeed} | clear day | straight`
      : "Procedural mode disabled (`?procedural=0`)";
  milestoneCelebrationEl.classList.remove("is-active");
  if (celebrationResetTimer !== null) {
    window.clearTimeout(celebrationResetTimer);
    celebrationResetTimer = null;
  }
  for (let index = 0; index < rainDropCount; index += 1) {
    resetRainDrop(index);
  }
  rainGeometry.getAttribute("position").needsUpdate = true;
  hideResultOverlay();
  updateRoadVisuals();
  updateStatus();
};

window.addEventListener("keydown", (event) => {
  const key = event.key;

  if (key === "ArrowUp" || key === "w" || key === "W") {
    throttleInput = 1;
    event.preventDefault();
    return;
  }

  if (key === "ArrowDown" || key === "s" || key === "S") {
    brakeInput = 1;
    event.preventDefault();
    return;
  }

  if (key === "ArrowLeft" || key === "a" || key === "A") {
    queueLaneMove(mapSteerDirectionForMirroredView(-1, isMirroredView()));
    event.preventDefault();
    return;
  }

  if (key === "ArrowRight" || key === "d" || key === "D") {
    queueLaneMove(mapSteerDirectionForMirroredView(1, isMirroredView()));
    event.preventDefault();
    return;
  }

  if (key === "r" || key === "R") {
    resetGame();
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.key;

  if (key === "ArrowUp" || key === "w" || key === "W") {
    throttleInput = 0;
    return;
  }

  if (key === "ArrowDown" || key === "s" || key === "S") {
    brakeInput = 0;
  }
});

const readXRHorizontalAxis = (): number => {
  const session = renderer.xr.getSession();
  if (!session) {
    return 0;
  }

  let axisSum = 0;
  let axisCount = 0;

  for (const source of session.inputSources) {
    const { gamepad } = source;
    if (!gamepad || gamepad.axes.length === 0) {
      continue;
    }

    const horizontal = gamepad.axes[2] ?? gamepad.axes[0] ?? 0;
    axisSum += horizontal;
    axisCount += 1;
  }

  if (axisCount === 0) {
    return 0;
  }

  return axisSum / axisCount;
};

const updateXRInput = (): void => {
  if (!renderer.xr.isPresenting) {
    xrAxisLatch = 0;
    return;
  }

  const xAxis = readXRHorizontalAxis();

  if (Math.abs(xAxis) < 0.35) {
    xrAxisLatch = 0;
    return;
  }

  if (xrAxisLatch !== 0) {
    return;
  }

  if (xAxis <= -0.65) {
    queueLaneMove(mapSteerDirectionForMirroredView(-1, isMirroredView()));
    xrAxisLatch = -1;
  } else if (xAxis >= 0.65) {
    queueLaneMove(mapSteerDirectionForMirroredView(1, isMirroredView()));
    xrAxisLatch = 1;
  }
};

window.addEventListener("mousemove", (event) => {
  if (renderer.xr.isPresenting) {
    return;
  }

  if ((event.buttons & 1) === 0) {
    return;
  }

  const next = applyMouseLookDelta(
    lookYaw,
    lookPitch,
    event.movementX,
    event.movementY,
    mouseLookSensitivity,
    mouseLookMaxPitch
  );
  lookYaw = next.yaw;
  lookPitch = next.pitch;
  applyCameraLook();
});

window.addEventListener("resize", () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

updateStatus();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  laneMoveCooldown = Math.max(0, laneMoveCooldown - dt);

  updateXRInput();

  if (!crashed && !won) {
    const previousDistanceMeters = distanceMeters;
    updateDrivePhysics(dt);
    const distanceEvents = evaluateDistanceEvents(
      previousDistanceMeters,
      distanceMeters,
      winDistanceKilometers
    );

    for (const kilometer of distanceEvents.crossedKilometers) {
      if (kilometer < winDistanceKilometers) {
        triggerMilestoneCelebration(kilometer);
      }
    }

    if (distanceEvents.reachedWin) {
      won = true;
      playerSpeed = 0;
      throttleInput = 0;
      brakeInput = 0;
      showResultOverlay("You win!", "win");
    } else {
      animateRoadFlow(dt, playerSpeed);
      animatePlayerWheels(dt, playerSpeed);
      const spawnRateScale = THREE.MathUtils.clamp(playerSpeed / 16, 0.65, 2.1);
      const spawnScenario = sampleRoadStateAtLocalZ(spawnZ);
      const spawnEventZone = spawnScenario?.activeEventZone ?? null;
      const spawnRateBoost = spawnEventZone?.kind === "traffic_bottleneck" ? 1.25 : 1;
      spawnTimer -= dt * spawnRateScale * spawnRateBoost;

      if (spawnTimer <= 0) {
        spawnTimer = 0.85 + trafficRng() * 0.5;
        const vehicle = spawnTraffic(nextTrafficId, laneCount, spawnZ, trafficRng, trafficSpeedRange, {
          laneWeights: eventLaneWeights(spawnEventZone),
          profileWeights: trafficProfileWeights
        });
        const laneIsOpen = canSpawnTrafficInLane(traffic, vehicle.lane, trafficBaseGapThreshold, {
          laneGapScale: eventLaneGapScale(spawnEventZone)
        });

        if (laneIsOpen) {
          traffic.push(vehicle);
          nextTrafficId += 1;
        }
      }

      const playerScenario = sampleRoadStateAtLocalZ(0);
      const trafficSpeedMultiplier =
        playerScenario?.activeEventZone?.kind === "traffic_bottleneck"
          ? 0.88
          : playerScenario?.segment.weather === "fog"
            ? 0.94
            : 1;
      traffic = stepTraffic(
        traffic,
        dt,
        -22,
        playerSpeed,
        raceElapsedSeconds,
        trafficSpeedWaveAmplitude,
        {
          laneCount,
          rng: trafficRng,
          speedMultiplier: trafficSpeedMultiplier
        }
      );
      const wasCrashed = crashed;
      crashed = hasCollision(playerLane, 0, traffic, 0.1, 1.9);
      if (!wasCrashed && crashed) {
        triggerCrashBoom();
      }
    }
  }

  const playerScenario = sampleRoadStateAtLocalZ(0);
  const playerPose = playerScenario?.pose;
  const targetPlayerX = laneToX(playerLane, laneCount, laneWidth) + (playerPose?.offsetX ?? 0);
  const targetPlayerY = playerPose?.offsetY ?? 0;
  playerCar.position.x = THREE.MathUtils.lerp(playerCar.position.x, targetPlayerX, Math.min(1, dt * 10));
  playerCar.position.y = THREE.MathUtils.lerp(playerCar.position.y, targetPlayerY, Math.min(1, dt * 8));
  playerCar.rotation.y = THREE.MathUtils.lerp(playerCar.rotation.y, playerPose?.yaw ?? 0, Math.min(1, dt * 6));
  cameraRig.position.x = THREE.MathUtils.lerp(cameraRig.position.x, targetPlayerX, Math.min(1, dt * 8));
  cameraRig.position.y = THREE.MathUtils.lerp(
    cameraRig.position.y,
    1.8 + targetPlayerY,
    Math.min(1, dt * 6)
  );

  const weather = playerScenario?.segment.weather ?? "clear";
  const timeOfDay = playerScenario?.segment.timeOfDay ?? "day";
  const segmentLabel = playerScenario?.segment
    ? labelizeScenarioValue(playerScenario.segment.kind)
    : "straight";
  const eventLabel = playerScenario?.activeEventZone
    ? ` | ${labelizeScenarioValue(playerScenario.activeEventZone.kind)}`
    : "";
  scenarioSummary = proceduralModeEnabled
    ? `Seed ${proceduralSeed} | ${labelizeScenarioValue(weather)} ${labelizeScenarioValue(timeOfDay)} | ${segmentLabel}${eventLabel}`
    : "Procedural mode disabled (`?procedural=0`)";

  applyEnvironment(dt, weather, timeOfDay);
  updateRain(dt, weather);
  updateCrashBoom(dt);
  updateRoadVisuals();
  rebuildTrafficMeshes();
  updateStatus();
  renderer.render(scene, camera);
});
