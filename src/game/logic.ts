export type TrafficDriverProfile = "slow" | "normal" | "aggressive";

export interface TrafficProfileWeights {
  slow: number;
  normal: number;
  aggressive: number;
}

interface TrafficProfileConfig {
  speedMultiplier: number;
  laneChangeChance: number;
  overtakeDistance: number;
  brakeDistance: number;
  laneChangeCooldown: number;
  followSpeedFactor: number;
}

const TRAFFIC_PROFILE_ORDER: TrafficDriverProfile[] = ["slow", "normal", "aggressive"];

const TRAFFIC_PROFILE_CONFIG: Record<TrafficDriverProfile, TrafficProfileConfig> = {
  slow: {
    speedMultiplier: 0.85,
    laneChangeChance: 0.2,
    overtakeDistance: 6.4,
    brakeDistance: 10.4,
    laneChangeCooldown: 2.8,
    followSpeedFactor: 0.95
  },
  normal: {
    speedMultiplier: 1.0,
    laneChangeChance: 0.55,
    overtakeDistance: 7.6,
    brakeDistance: 9.4,
    laneChangeCooldown: 2.2,
    followSpeedFactor: 1.0
  },
  aggressive: {
    speedMultiplier: 1.28,
    laneChangeChance: 0.95,
    overtakeDistance: 10.6,
    brakeDistance: 6.5,
    laneChangeCooldown: 1.1,
    followSpeedFactor: 1.14
  }
};

export const DEFAULT_TRAFFIC_PROFILE_WEIGHTS: TrafficProfileWeights = {
  slow: 0.3,
  normal: 0.5,
  aggressive: 0.2
};

export interface TrafficVehicle {
  id: number;
  lane: number;
  z: number;
  speed: number;
  profile?: TrafficDriverProfile;
  laneChangeCooldown?: number;
}

export interface TrafficStepOptions {
  laneCount?: number;
  rng?: () => number;
  safeMergeGap?: number;
  speedMultiplier?: number;
}

export interface TrafficSpawnOptions {
  laneWeights?: number[];
  profileWeights?: TrafficProfileWeights;
}

export interface TrafficSpawnConstraintOptions {
  laneGapScale?: Partial<Record<number, number>>;
}

export function nextLane(current: number, direction: number, laneCount: number): number {
  if (laneCount <= 0) {
    return 0;
  }

  const maxLane = laneCount - 1;
  const delta = direction > 0 ? 1 : direction < 0 ? -1 : 0;
  return Math.min(maxLane, Math.max(0, current + delta));
}

export function laneToX(lane: number, laneCount: number, laneWidth = 2.5): number {
  if (laneCount <= 0) {
    return 0;
  }

  const centeredIndex = lane - (laneCount - 1) / 2;
  return centeredIndex * laneWidth;
}

export function stepTraffic(
  traffic: TrafficVehicle[],
  dt: number,
  despawnZ: number,
  playerForwardSpeed = 0,
  elapsedSeconds = 0,
  speedWaveAmplitude = 0,
  options: TrafficStepOptions = {}
): TrafficVehicle[] {
  const laneCount =
    options.laneCount ?? traffic.reduce((maxLane, vehicle) => Math.max(maxLane, vehicle.lane), 0) + 1;
  const boundedLaneCount = Math.max(1, laneCount);
  const rng = options.rng ?? Math.random;
  const safeMergeGap = Math.max(0.5, options.safeMergeGap ?? 4.8);

  const getProfile = (vehicle: TrafficVehicle): TrafficDriverProfile =>
    vehicle.profile ?? "normal";

  const getClosestAheadVehicle = (
    subject: TrafficVehicle,
    lane: number
  ): { vehicle: TrafficVehicle; gap: number } | null => {
    let closest: TrafficVehicle | null = null;
    let gap = Number.POSITIVE_INFINITY;

    for (const candidate of traffic) {
      if (candidate.id === subject.id || candidate.lane !== lane || candidate.z >= subject.z) {
        continue;
      }

      const candidateGap = subject.z - candidate.z;
      if (candidateGap < gap) {
        closest = candidate;
        gap = candidateGap;
      }
    }

    if (!closest) {
      return null;
    }

    return { vehicle: closest, gap };
  };

  const isLaneSafeToMerge = (subject: TrafficVehicle, lane: number): boolean =>
    traffic.every(
      (candidate) =>
        candidate.id === subject.id ||
        candidate.lane !== lane ||
        Math.abs(candidate.z - subject.z) > safeMergeGap
    );

  const chooseOvertakeLane = (
    subject: TrafficVehicle,
    currentGap: number
  ): number => {
    let bestLane = subject.lane;
    let bestGap = currentGap;

    for (const direction of [-1, 1]) {
      const targetLane = subject.lane + direction;
      if (targetLane < 0 || targetLane >= boundedLaneCount) {
        continue;
      }

      if (!isLaneSafeToMerge(subject, targetLane)) {
        continue;
      }

      const blocker = getClosestAheadVehicle(subject, targetLane);
      const targetGap = blocker ? blocker.gap : Number.POSITIVE_INFINITY;
      if (targetGap > bestGap + 0.8) {
        bestLane = targetLane;
        bestGap = targetGap;
      }
    }

    return bestLane;
  };

  return traffic
    .map((vehicle) => {
      const profile = getProfile(vehicle);
      const profileConfig = TRAFFIC_PROFILE_CONFIG[profile];
      const lane = Math.min(Math.max(vehicle.lane, 0), boundedLaneCount - 1);
      let laneChangeCooldown = Math.max(0, (vehicle.laneChangeCooldown ?? 0) - dt);

      let nextLane = lane;
      const blockerInCurrentLane = getClosestAheadVehicle(vehicle, lane);
      const currentGap = blockerInCurrentLane?.gap ?? Number.POSITIVE_INFINITY;
      const wantsOvertake =
        blockerInCurrentLane !== null &&
        currentGap <= profileConfig.overtakeDistance &&
        laneChangeCooldown <= 0 &&
        rng() <= profileConfig.laneChangeChance;

      if (wantsOvertake) {
        const targetLane = chooseOvertakeLane(vehicle, currentGap);
        if (targetLane !== lane) {
          nextLane = targetLane;
          laneChangeCooldown = profileConfig.laneChangeCooldown;
        }
      }

      let adjustedSpeed = vehicle.speed;
      const blockerAfterDecision = getClosestAheadVehicle(
        { ...vehicle, lane: nextLane },
        nextLane
      );
      if (blockerAfterDecision && blockerAfterDecision.gap <= profileConfig.brakeDistance) {
        const speedCap =
          blockerAfterDecision.vehicle.speed +
          Math.max(0, blockerAfterDecision.gap - 1.2) * 0.45;
        adjustedSpeed = Math.min(
          adjustedSpeed,
          Math.max(0.8, speedCap * profileConfig.followSpeedFactor)
        );
      }

      const wave =
        speedWaveAmplitude === 0
          ? 0
          : Math.sin(elapsedSeconds * 2.4 + vehicle.id * 0.93) * speedWaveAmplitude;
      const speedMultiplier = Math.max(0.1, options.speedMultiplier ?? 1);
      const relativeSpeed = Math.max(
        0.1,
        (adjustedSpeed + playerForwardSpeed + wave) * speedMultiplier
      );
      return {
        ...vehicle,
        lane: nextLane,
        speed: adjustedSpeed,
        profile,
        laneChangeCooldown,
        z: vehicle.z - relativeSpeed * dt
      };
    })
    .filter((vehicle) => vehicle.z >= despawnZ);
}

function pickTrafficProfile(
  rng: () => number,
  weights: TrafficProfileWeights
): TrafficDriverProfile {
  const normalizedWeights = TRAFFIC_PROFILE_ORDER.map((profile) => ({
    profile,
    weight: Math.max(0, weights[profile])
  }));
  const totalWeight = normalizedWeights.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return "normal";
  }

  let sample = rng() * totalWeight;
  for (const entry of normalizedWeights) {
    sample -= entry.weight;
    if (sample <= 0) {
      return entry.profile;
    }
  }

  return "normal";
}

function selectTrafficLane(laneCount: number, rng: () => number, laneWeights?: number[]): number {
  if (laneCount <= 0) {
    return 0;
  }

  const weights = Array.from({ length: laneCount }, (_, lane) =>
    Math.max(0, laneWeights?.[lane] ?? 1)
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return Math.min(laneCount - 1, Math.floor(rng() * laneCount));
  }

  let threshold = rng() * totalWeight;
  for (let lane = 0; lane < weights.length; lane += 1) {
    threshold -= weights[lane] ?? 0;
    if (threshold <= 0) {
      return lane;
    }
  }

  return laneCount - 1;
}

export function spawnTraffic(
  id: number,
  laneCount: number,
  spawnZ: number,
  rng: () => number,
  speedRange: [number, number],
  options: TrafficSpawnOptions = {}
): TrafficVehicle {
  const lane = selectTrafficLane(laneCount, rng, options.laneWeights);
  const [minSpeed, maxSpeed] = speedRange;
  const baseSpeed = minSpeed + Math.floor(rng() * (maxSpeed - minSpeed + 1));
  const profileWeights = options.profileWeights ?? DEFAULT_TRAFFIC_PROFILE_WEIGHTS;
  const profile = pickTrafficProfile(rng, profileWeights);
  const speed = Math.max(
    1,
    Number((baseSpeed * TRAFFIC_PROFILE_CONFIG[profile].speedMultiplier).toFixed(2))
  );

  return {
    id,
    lane,
    z: spawnZ,
    speed,
    profile,
    laneChangeCooldown: 0
  };
}

export function createInitialTraffic(
  startId: number,
  count: number,
  laneCount: number,
  firstSpawnZ: number,
  spacing: number,
  rng: () => number,
  speedRange: [number, number],
  profileWeights: TrafficProfileWeights = DEFAULT_TRAFFIC_PROFILE_WEIGHTS
): TrafficVehicle[] {
  const traffic: TrafficVehicle[] = [];

  for (let index = 0; index < count; index += 1) {
    traffic.push(
      spawnTraffic(
        startId + index,
        laneCount,
        firstSpawnZ + spacing * index,
        rng,
        speedRange,
        { profileWeights }
      )
    );
  }

  return traffic;
}

export function canSpawnTrafficInLane(
  traffic: TrafficVehicle[],
  lane: number,
  minGapAheadZ: number,
  options: TrafficSpawnConstraintOptions = {}
): boolean {
  const gapScale = Math.max(0.1, options.laneGapScale?.[lane] ?? 1);
  const effectiveMinGap = minGapAheadZ / gapScale;

  return traffic.every((vehicle) => vehicle.lane !== lane || vehicle.z <= effectiveMinGap);
}

export function mapSteerDirectionForMirroredView(
  direction: -1 | 1,
  mirroredView: boolean
): -1 | 1 {
  if (!mirroredView) {
    return direction;
  }

  return direction === -1 ? 1 : -1;
}

export function applyMouseLookDelta(
  yaw: number,
  pitch: number,
  deltaX: number,
  deltaY: number,
  sensitivity: number,
  maxPitch: number
): { yaw: number; pitch: number } {
  const nextYaw = yaw - deltaX * sensitivity;
  const unclampedPitch = pitch - deltaY * sensitivity;
  const nextPitch = Math.max(-maxPitch, Math.min(maxPitch, unclampedPitch));

  return {
    yaw: nextYaw,
    pitch: nextPitch
  };
}

export function advanceLoopingZ(
  z: number,
  speed: number,
  dt: number,
  minZ: number,
  maxZ: number
): number {
  const span = maxZ - minZ;
  if (span <= 0) {
    return z;
  }

  let next = z - speed * dt;

  while (next < minZ) {
    next += span;
  }

  while (next > maxZ) {
    next -= span;
  }

  return next;
}

export interface CrashBoomSample {
  active: boolean;
  flashOpacity: number;
  flashScale: number;
  ringOpacity: number;
  ringScale: number;
  particleOpacity: number;
  particleDistance: number;
}

export function sampleCrashBoom(elapsed: number, duration: number): CrashBoomSample {
  const safeDuration = Math.max(duration, 0.0001);
  const progress = Math.min(1, Math.max(0, elapsed / safeDuration));
  const active = progress < 1;

  if (!active) {
    return {
      active: false,
      flashOpacity: 0,
      flashScale: 0,
      ringOpacity: 0,
      ringScale: 0,
      particleOpacity: 0,
      particleDistance: 0
    };
  }

  return {
    active: true,
    flashOpacity: Math.max(0, 1 - progress * 2.5),
    flashScale: 1 + progress * 3.5,
    ringOpacity: Math.max(0, 1 - progress * 1.4),
    ringScale: 1 + progress * 7,
    particleOpacity: Math.max(0, 1 - progress * 1.8),
    particleDistance: progress * 6.2
  };
}

export interface PlayerSpeedConfig {
  maxSpeed: number;
  accelRate: number;
  brakeRate: number;
  dragRate: number;
}

export function updatePlayerSpeed(
  currentSpeed: number,
  throttleInput: number,
  brakeInput: number,
  dt: number,
  config: PlayerSpeedConfig
): number {
  const throttle = Math.max(0, Math.min(1, throttleInput));
  const braking = Math.max(0, Math.min(1, brakeInput));
  let nextSpeed = currentSpeed + config.accelRate * throttle * dt - config.brakeRate * braking * dt;

  if (nextSpeed > 0) {
    nextSpeed -= config.dragRate * dt;
  }

  return Math.max(0, Math.min(config.maxSpeed, nextSpeed));
}

export interface DistanceEvents {
  crossedKilometers: number[];
  reachedWin: boolean;
}

export function evaluateDistanceEvents(
  previousMeters: number,
  nextMeters: number,
  winKilometers: number
): DistanceEvents {
  const safePreviousMeters = Math.max(0, previousMeters);
  const safeNextMeters = Math.max(safePreviousMeters, nextMeters);
  const previousKilometer = Math.floor(safePreviousMeters / 1000);
  const nextKilometer = Math.floor(safeNextMeters / 1000);
  const crossedKilometers: number[] = [];

  for (let kilometer = previousKilometer + 1; kilometer <= nextKilometer; kilometer += 1) {
    crossedKilometers.push(kilometer);
  }

  const winMeters = Math.max(1, winKilometers) * 1000;
  const reachedWin = safePreviousMeters < winMeters && safeNextMeters >= winMeters;

  return {
    crossedKilometers,
    reachedWin
  };
}

export function hasCollision(
  playerLane: number,
  playerZ: number,
  traffic: TrafficVehicle[],
  laneHitDistance: number,
  zHitDistance: number
): boolean {
  return traffic.some(
    (vehicle) =>
      Math.abs(vehicle.lane - playerLane) <= laneHitDistance &&
      Math.abs(vehicle.z - playerZ) <= zHitDistance
  );
}
