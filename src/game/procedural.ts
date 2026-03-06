export type ProceduralSegmentKind =
  | "straight"
  | "gentle_curve"
  | "medium_curve"
  | "elevation_up"
  | "elevation_down";

export type WeatherKind = "clear" | "light_rain" | "fog";
export type TimeOfDayKind = "day" | "dusk" | "night";
export type EventZoneKind = "construction_narrow_lane" | "traffic_bottleneck";

export interface ProceduralEventZone {
  kind: EventZoneKind;
  startOffset: number;
  endOffset: number;
  lane: number;
}

export interface ProceduralSegment {
  index: number;
  startDistance: number;
  endDistance: number;
  length: number;
  kind: ProceduralSegmentKind;
  weather: WeatherKind;
  timeOfDay: TimeOfDayKind;
  curveDirection: -1 | 1;
  eventZone: ProceduralEventZone | null;
}

export interface ProceduralGenerationOptions {
  seed: number | string;
  count: number;
  segmentLength: number;
  laneCount: number;
}

export interface RoadPose {
  offsetX: number;
  offsetY: number;
  yaw: number;
  pitch: number;
}

export interface ProceduralScenarioSample {
  segment: ProceduralSegment;
  localDistance: number;
  pose: RoadPose;
  activeEventZone: ProceduralEventZone | null;
}

type WeightedEntry<T> = {
  value: T;
  weight: number;
};

const segmentWeights: Array<WeightedEntry<ProceduralSegmentKind>> = [
  { value: "straight", weight: 4.6 },
  { value: "gentle_curve", weight: 3.2 },
  { value: "medium_curve", weight: 1.7 },
  { value: "elevation_up", weight: 1.9 },
  { value: "elevation_down", weight: 1.9 }
];

const weatherWeights: Array<WeightedEntry<WeatherKind>> = [
  { value: "clear", weight: 5 },
  { value: "light_rain", weight: 2.2 },
  { value: "fog", weight: 1.4 }
];

const timeOfDayWeights: Array<WeightedEntry<TimeOfDayKind>> = [
  { value: "day", weight: 4.6 },
  { value: "dusk", weight: 2.1 },
  { value: "night", weight: 1.8 }
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function xmur3(seed: string): () => number {
  let hash = 1779033703 ^ seed.length;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return hash >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededRandom(seed: number | string): () => number {
  const seedText = String(seed);
  const hash = xmur3(seedText);
  return mulberry32(hash());
}

function chooseWeighted<T>(rng: () => number, entries: Array<WeightedEntry<T>>): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = rng() * total;

  for (const entry of entries) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry.value;
    }
  }

  return entries[entries.length - 1]!.value;
}

function choosePersistentModifier<T extends string>(
  rng: () => number,
  previous: T,
  entries: Array<WeightedEntry<T>>,
  keepChance: number
): T {
  if (rng() < keepChance) {
    return previous;
  }

  const alternatives = entries.filter((entry) => entry.value !== previous);
  return chooseWeighted(rng, alternatives.length > 0 ? alternatives : entries);
}

function createEventZone(
  rng: () => number,
  segmentLength: number,
  laneCount: number
): ProceduralEventZone {
  const kind: EventZoneKind = rng() < 0.55 ? "construction_narrow_lane" : "traffic_bottleneck";
  const startOffset = segmentLength * (0.16 + rng() * 0.16);
  const rawLength = segmentLength * (0.28 + rng() * 0.18);
  const endOffset = Math.min(segmentLength * 0.88, startOffset + rawLength);

  if (kind === "construction_narrow_lane") {
    return {
      kind,
      startOffset,
      endOffset,
      lane: rng() < 0.5 ? 0 : Math.max(0, laneCount - 1)
    };
  }

  return {
    kind,
    startOffset,
    endOffset,
    lane: Math.min(laneCount - 1, Math.floor(rng() * laneCount))
  };
}

export function generateProceduralSegments(
  options: ProceduralGenerationOptions
): ProceduralSegment[] {
  const rng = createSeededRandom(options.seed);
  const segments: ProceduralSegment[] = [];
  let weather: WeatherKind = "clear";
  let timeOfDay: TimeOfDayKind = "day";
  let eventCooldown = 0;

  for (let index = 0; index < options.count; index += 1) {
    const kind =
      index < 2 ? "straight" : chooseWeighted(rng, segmentWeights);
    const startDistance = index * options.segmentLength;
    const endDistance = startDistance + options.segmentLength;

    if (index >= 2) {
      weather = choosePersistentModifier(rng, weather, weatherWeights, 0.66);
      timeOfDay = choosePersistentModifier(rng, timeOfDay, timeOfDayWeights, 0.72);
    }

    let eventZone: ProceduralEventZone | null = null;
    if (index >= 2 && eventCooldown <= 0 && kind !== "medium_curve" && rng() < 0.24) {
      eventZone = createEventZone(rng, options.segmentLength, options.laneCount);
      eventCooldown = 1;
    } else if (eventCooldown > 0) {
      eventCooldown -= 1;
    }

    segments.push({
      index,
      startDistance,
      endDistance,
      length: options.segmentLength,
      kind,
      weather,
      timeOfDay,
      curveDirection: rng() < 0.5 ? -1 : 1,
      eventZone
    });
  }

  return segments;
}

function curveStrengthForKind(kind: ProceduralSegmentKind): number {
  switch (kind) {
    case "gentle_curve":
      return 2.4;
    case "medium_curve":
      return 4.2;
    default:
      return 0;
  }
}

function elevationStrengthForKind(kind: ProceduralSegmentKind): number {
  switch (kind) {
    case "elevation_up":
      return 1.35;
    case "elevation_down":
      return -1.2;
    default:
      return 0;
  }
}

export function getSegmentAtDistance(
  segments: ProceduralSegment[],
  distance: number
): ProceduralSegment {
  if (segments.length === 0) {
    throw new Error("Cannot sample procedural segments from an empty list");
  }

  const safeDistance = Math.max(0, distance);
  const segmentLength = segments[0]?.length ?? 1;
  const index = Math.min(segments.length - 1, Math.floor(safeDistance / segmentLength));
  return segments[index]!;
}

export function sampleRoadPose(segment: ProceduralSegment, distance: number): RoadPose {
  const localDistance = Math.max(0, Math.min(segment.length, distance - segment.startDistance));
  const progress = clamp01(localDistance / segment.length);
  const arch = 0.5 - 0.5 * Math.cos(Math.PI * 2 * progress);
  const slope = (Math.PI * Math.sin(Math.PI * 2 * progress)) / segment.length;
  const lateralStrength = curveStrengthForKind(segment.kind) * segment.curveDirection;
  const elevationStrength = elevationStrengthForKind(segment.kind);

  return {
    offsetX: lateralStrength * arch,
    offsetY: elevationStrength * arch,
    yaw: Math.atan(lateralStrength * slope),
    pitch: Math.atan(elevationStrength * slope)
  };
}

export function sampleProceduralScenario(
  segments: ProceduralSegment[],
  distance: number
): ProceduralScenarioSample {
  const segment = getSegmentAtDistance(segments, distance);
  const localDistance = Math.max(0, Math.min(segment.length, distance - segment.startDistance));
  const activeEventZone =
    segment.eventZone &&
    localDistance >= segment.eventZone.startOffset &&
    localDistance <= segment.eventZone.endOffset
      ? segment.eventZone
      : null;

  return {
    segment,
    localDistance,
    pose: sampleRoadPose(segment, distance),
    activeEventZone
  };
}
