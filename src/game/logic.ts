export interface TrafficVehicle {
  id: number;
  lane: number;
  z: number;
  speed: number;
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
  speedWaveAmplitude = 0
): TrafficVehicle[] {
  return traffic
    .map((vehicle) => {
      const wave =
        speedWaveAmplitude === 0
          ? 0
          : Math.sin(elapsedSeconds * 2.4 + vehicle.id * 0.93) * speedWaveAmplitude;
      const relativeSpeed = Math.max(0.1, vehicle.speed + playerForwardSpeed + wave);
      return {
        ...vehicle,
        z: vehicle.z - relativeSpeed * dt
      };
    })
    .filter((vehicle) => vehicle.z >= despawnZ);
}

export function spawnTraffic(
  id: number,
  laneCount: number,
  spawnZ: number,
  rng: () => number,
  speedRange: [number, number]
): TrafficVehicle {
  const lane = Math.min(laneCount - 1, Math.floor(rng() * laneCount));
  const [minSpeed, maxSpeed] = speedRange;
  const speed = minSpeed + Math.floor(rng() * (maxSpeed - minSpeed + 1));

  return {
    id,
    lane,
    z: spawnZ,
    speed
  };
}

export function createInitialTraffic(
  startId: number,
  count: number,
  laneCount: number,
  firstSpawnZ: number,
  spacing: number,
  rng: () => number,
  speedRange: [number, number]
): TrafficVehicle[] {
  const traffic: TrafficVehicle[] = [];

  for (let index = 0; index < count; index += 1) {
    traffic.push(
      spawnTraffic(
        startId + index,
        laneCount,
        firstSpawnZ + spacing * index,
        rng,
        speedRange
      )
    );
  }

  return traffic;
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
