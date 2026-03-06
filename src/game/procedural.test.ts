import {
  generateProceduralSegments,
  sampleProceduralScenario,
  type ProceduralSegment
} from "./procedural";
import { describe, expect, it } from "vitest";

const segmentLength = 90;
const laneCount = 3;

const countKinds = (segments: ProceduralSegment[]): Record<ProceduralSegment["kind"], number> =>
  segments.reduce<Record<ProceduralSegment["kind"], number>>(
    (counts, segment) => {
      counts[segment.kind] += 1;
      return counts;
    },
    {
      straight: 0,
      gentle_curve: 0,
      medium_curve: 0,
      elevation_up: 0,
      elevation_down: 0
    }
  );

describe("generateProceduralSegments", () => {
  it("is deterministic for a given seed", () => {
    const first = generateProceduralSegments({
      seed: "issue-2-seed",
      count: 16,
      segmentLength,
      laneCount
    });
    const second = generateProceduralSegments({
      seed: "issue-2-seed",
      count: 16,
      segmentLength,
      laneCount
    });
    const third = generateProceduralSegments({
      seed: "different-seed",
      count: 16,
      segmentLength,
      laneCount
    });

    expect(first).toEqual(second);
    expect(third).not.toEqual(first);
  });

  it("favours straights while still producing each scenario type over time", () => {
    const segments = generateProceduralSegments({
      seed: "weights-check",
      count: 80,
      segmentLength,
      laneCount
    }).slice(2);
    const counts = countKinds(segments);

    expect(counts.straight).toBeGreaterThan(counts.medium_curve);
    expect(counts.gentle_curve).toBeGreaterThan(0);
    expect(counts.elevation_up).toBeGreaterThan(0);
    expect(counts.elevation_down).toBeGreaterThan(0);
  });

  it("keeps event zones inside segment bounds with cooldown spacing", () => {
    const segments = generateProceduralSegments({
      seed: "zone-check",
      count: 40,
      segmentLength,
      laneCount
    });
    let previousEventIndex = -99;

    for (const segment of segments) {
      if (!segment.eventZone) {
        continue;
      }

      expect(segment.eventZone.startOffset).toBeGreaterThanOrEqual(segmentLength * 0.16);
      expect(segment.eventZone.endOffset).toBeLessThanOrEqual(segmentLength * 0.88);
      expect(segment.eventZone.endOffset).toBeGreaterThan(segment.eventZone.startOffset);
      expect(segment.index - previousEventIndex).toBeGreaterThanOrEqual(2);
      expect(segment.eventZone.lane).toBeGreaterThanOrEqual(0);
      expect(segment.eventZone.lane).toBeLessThan(laneCount);

      if (segment.eventZone.kind === "construction_narrow_lane") {
        expect([0, laneCount - 1]).toContain(segment.eventZone.lane);
      }

      previousEventIndex = segment.index;
    }
  });
});

describe("sampleProceduralScenario", () => {
  it("reports active event zones only inside their distance window", () => {
    const segments = generateProceduralSegments({
      seed: "active-zone-check",
      count: 60,
      segmentLength,
      laneCount
    });
    const segment = segments.find((candidate) => candidate.eventZone);

    expect(segment).toBeDefined();
    if (!segment?.eventZone) {
      return;
    }

    const before = sampleProceduralScenario(
      segments,
      segment.startDistance + segment.eventZone.startOffset - 1
    );
    const inside = sampleProceduralScenario(
      segments,
      segment.startDistance + (segment.eventZone.startOffset + segment.eventZone.endOffset) / 2
    );

    expect(before.activeEventZone).toBeNull();
    expect(inside.segment.index).toBe(segment.index);
    expect(inside.activeEventZone?.kind).toBe(segment.eventZone.kind);
  });
});
