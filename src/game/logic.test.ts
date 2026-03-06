import {
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
} from "./logic";
import { describe, expect, it } from "vitest";

describe("nextLane", () => {
  it("clamps lane index within available lanes", () => {
    expect(nextLane(0, -1, 3)).toBe(0);
    expect(nextLane(1, 1, 3)).toBe(2);
    expect(nextLane(2, 1, 3)).toBe(2);
  });
});

describe("stepTraffic", () => {
  it("moves traffic toward player and removes despawned vehicles", () => {
    const traffic: TrafficVehicle[] = [
      { id: 1, lane: 0, z: 20, speed: 8 },
      { id: 2, lane: 1, z: -9, speed: 2 }
    ];

    const result = stepTraffic(traffic, 1, -10);

    expect(result).toMatchObject([{ id: 1, lane: 0, z: 12, speed: 8 }]);
  });

  it("accounts for player forward speed in relative traffic movement", () => {
    const traffic: TrafficVehicle[] = [{ id: 1, lane: 0, z: 20, speed: 8 }];
    const result = stepTraffic(traffic, 1, -10, 6);
    expect(result).toMatchObject([{ id: 1, lane: 0, z: 6, speed: 8 }]);
  });

  it("supports wave-based speed variation for incoming vehicles", () => {
    const traffic: TrafficVehicle[] = [{ id: 4, lane: 1, z: 50, speed: 10 }];
    const atT0 = stepTraffic(traffic, 1, -100, 0, 0, 2)[0]?.z ?? 0;
    const atT1 = stepTraffic(traffic, 1, -100, 0, 1, 2)[0]?.z ?? 0;
    expect(atT0).not.toBeCloseTo(atT1);
  });

  it("changes lane to overtake when blocked and a safe lane exists", () => {
    const traffic: TrafficVehicle[] = [
      { id: 1, lane: 1, z: 32, speed: 11, profile: "aggressive", laneChangeCooldown: 0 },
      { id: 2, lane: 1, z: 26, speed: 5, profile: "slow", laneChangeCooldown: 0 },
      { id: 3, lane: 2, z: 31, speed: 7, profile: "normal", laneChangeCooldown: 0 }
    ];

    const result = stepTraffic(traffic, 1, -100, 0, 0, 0, {
      laneCount: 3,
      rng: () => 0
    });

    const follower = result.find((vehicle) => vehicle.id === 1);
    expect(follower?.lane).toBe(0);
  });

  it("applies optional scenario speed multipliers without changing defaults", () => {
    const traffic: TrafficVehicle[] = [{ id: 9, lane: 0, z: 20, speed: 10 }];
    const result = stepTraffic(traffic, 1, -10, 0, 0, 0, { speedMultiplier: 0.5 });

    expect(result).toMatchObject([{ id: 9, lane: 0, z: 15, speed: 10 }]);
  });

  it("brakes when blocked and no safe lane change is available", () => {
    const traffic: TrafficVehicle[] = [
      { id: 1, lane: 0, z: 30, speed: 12, profile: "normal", laneChangeCooldown: 0 },
      { id: 2, lane: 0, z: 25, speed: 4, profile: "slow", laneChangeCooldown: 0 }
    ];

    const result = stepTraffic(traffic, 1, -100, 0, 0, 0, {
      laneCount: 1,
      rng: () => 0
    });

    const follower = result.find((vehicle) => vehicle.id === 1);
    expect(follower?.lane).toBe(0);
    expect(follower?.z ?? 0).toBeGreaterThan(18);
  });
});

describe("spawnTraffic", () => {
  it("spawns a vehicle in a deterministic lane and speed from rng", () => {
    const rngValues = [0.92, 0.25, 0.5];
    const rng = () => {
      const value = rngValues.shift();
      if (value === undefined) {
        throw new Error("No RNG values left");
      }
      return value;
    };

    const vehicle = spawnTraffic(4, 3, 40, rng, [6, 10]);

    expect(vehicle).toMatchObject({ id: 4, lane: 2, z: 40, speed: 7 });
  });

  it("supports weighted driver profiles", () => {
    const rngValues = [0.3, 0.1, 0.9];
    const rng = () => {
      const value = rngValues.shift();
      if (value === undefined) {
        throw new Error("No RNG values left");
      }
      return value;
    };

    const vehicle = spawnTraffic(5, 3, 42, rng, [8, 12], {
      profileWeights: {
        slow: 0,
        normal: 0,
        aggressive: 1
      }
    });

    expect(vehicle.profile).toBe("aggressive");
  });

  it("supports weighted lane selection for scenario pressure", () => {
    const rngValues = [0.74, 0.25, 0.5];
    const rng = () => {
      const value = rngValues.shift();
      if (value === undefined) {
        throw new Error("No RNG values left");
      }
      return value;
    };

    const vehicle = spawnTraffic(10, 3, 48, rng, [6, 10], {
      laneWeights: [0.1, 0.1, 0.8],
      profileWeights: {
        slow: 0,
        normal: 1,
        aggressive: 0
      }
    });

    expect(vehicle).toMatchObject({ id: 10, lane: 2, z: 48, speed: 7, profile: "normal" });
  });
});

describe("createInitialTraffic", () => {
  it("creates sequential ids with forward spaced z positions", () => {
    const rngValues = [0.1, 0.2, 0.5, 0.6, 0.4, 0.5, 0.9, 0.8, 0.5];
    const rng = () => {
      const value = rngValues.shift();
      if (value === undefined) {
        throw new Error("No RNG values left");
      }
      return value;
    };

    const traffic = createInitialTraffic(7, 3, 3, 24, 16, rng, [8, 12]);

    expect(traffic.map((vehicle) => vehicle.id)).toEqual([7, 8, 9]);
    expect(traffic.map((vehicle) => vehicle.z)).toEqual([24, 40, 56]);
    expect(traffic.every((vehicle) => vehicle.z > 0)).toBe(true);
  });
});

describe("hasCollision", () => {
  it("detects collision when car is in the same lane and within z range", () => {
    const traffic: TrafficVehicle[] = [
      { id: 1, lane: 1, z: 1.2, speed: 8 },
      { id: 2, lane: 2, z: 4, speed: 8 }
    ];

    expect(hasCollision(1, 0, traffic, 0.1, 1.5)).toBe(true);
    expect(hasCollision(0, 0, traffic, 0.1, 1.5)).toBe(false);
  });
});

describe("laneToX", () => {
  it("maps lanes symmetrically around center", () => {
    expect(laneToX(0, 3)).toBe(-2.5);
    expect(laneToX(1, 3)).toBe(0);
    expect(laneToX(2, 3)).toBe(2.5);
  });
});

describe("mapSteerDirectionForMirroredView", () => {
  it("keeps direction when view is not mirrored and flips when mirrored", () => {
    expect(mapSteerDirectionForMirroredView(-1, false)).toBe(-1);
    expect(mapSteerDirectionForMirroredView(1, false)).toBe(1);
    expect(mapSteerDirectionForMirroredView(-1, true)).toBe(1);
    expect(mapSteerDirectionForMirroredView(1, true)).toBe(-1);
  });
});

describe("applyMouseLookDelta", () => {
  it("updates yaw and pitch based on mouse movement", () => {
    const next = applyMouseLookDelta(0, 0, 20, -10, 0.01, 0.6);
    expect(next.yaw).toBeCloseTo(-0.2);
    expect(next.pitch).toBeCloseTo(0.1);
  });

  it("clamps pitch to max range", () => {
    const up = applyMouseLookDelta(0, 0.55, 0, -20, 0.01, 0.6);
    const down = applyMouseLookDelta(0, -0.55, 0, 20, 0.01, 0.6);

    expect(up.pitch).toBeCloseTo(0.6);
    expect(down.pitch).toBeCloseTo(-0.6);
  });
});

describe("advanceLoopingZ", () => {
  it("moves z backward by speed*dt when within bounds", () => {
    expect(advanceLoopingZ(10, 6, 0.5, -10, 120)).toBeCloseTo(7);
  });

  it("wraps to the far end when value goes below min", () => {
    expect(advanceLoopingZ(-9, 6, 0.5, -10, 120)).toBeCloseTo(118);
  });
});

describe("sampleCrashBoom", () => {
  it("starts active with strong flash values", () => {
    const sample = sampleCrashBoom(0, 0.8);
    expect(sample.active).toBe(true);
    expect(sample.flashOpacity).toBeCloseTo(1);
    expect(sample.ringScale).toBeCloseTo(1);
    expect(sample.particleDistance).toBeCloseTo(0);
  });

  it("turns inactive at or after duration", () => {
    const sample = sampleCrashBoom(0.8, 0.8);
    expect(sample.active).toBe(false);
    expect(sample.flashOpacity).toBe(0);
    expect(sample.ringOpacity).toBe(0);
    expect(sample.particleOpacity).toBe(0);
  });
});

describe("updatePlayerSpeed", () => {
  const config = {
    maxSpeed: 40,
    accelRate: 10,
    brakeRate: 16,
    dragRate: 2
  };

  it("accelerates with throttle and clamps to max speed", () => {
    expect(updatePlayerSpeed(39, 1, 0, 1, config)).toBe(40);
  });

  it("decelerates with braking and never drops below zero", () => {
    expect(updatePlayerSpeed(5, 0, 1, 1, config)).toBe(0);
  });
});

describe("evaluateDistanceEvents", () => {
  it("returns every crossed kilometer marker in order", () => {
    const events = evaluateDistanceEvents(950, 3050, 10);
    expect(events.crossedKilometers).toEqual([1, 2, 3]);
    expect(events.reachedWin).toBe(false);
  });

  it("marks win exactly when crossing the target kilometer", () => {
    const events = evaluateDistanceEvents(9950, 10010, 10);
    expect(events.crossedKilometers).toEqual([10]);
    expect(events.reachedWin).toBe(true);
  });

  it("does not duplicate milestones when distance stays in the same kilometer", () => {
    const events = evaluateDistanceEvents(2100, 2899, 10);
    expect(events.crossedKilometers).toEqual([]);
    expect(events.reachedWin).toBe(false);
  });
});

describe("canSpawnTrafficInLane", () => {
  it("keeps default spawn gap checks when no scenario overrides are provided", () => {
    const traffic: TrafficVehicle[] = [{ id: 1, lane: 1, z: 30, speed: 8 }];
    expect(canSpawnTrafficInLane(traffic, 1, 28)).toBe(false);
  });

  it("allows tighter gaps on pressured lanes when overrides are present", () => {
    const traffic: TrafficVehicle[] = [{ id: 1, lane: 1, z: 30, speed: 8 }];

    expect(
      canSpawnTrafficInLane(traffic, 1, 28, {
        laneGapScale: {
          1: 0.75
        }
      })
    ).toBe(true);
  });
});
