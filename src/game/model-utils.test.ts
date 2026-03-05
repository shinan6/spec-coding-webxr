import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  PLAYER_MODEL_PATHS,
  TRAFFIC_MODEL_PATHS,
  normalizeModelToRoadScale,
  pickCyclicPath,
  trafficModelPathForId
} from "./model-utils";

describe("pickCyclicPath", () => {
  it("returns null for empty lists", () => {
    expect(pickCyclicPath([], 10)).toBeNull();
  });

  it("cycles through paths with positive and negative indexes", () => {
    const paths = ["/a.glb", "/b.glb", "/c.glb"];
    expect(pickCyclicPath(paths, 0)).toBe("/a.glb");
    expect(pickCyclicPath(paths, 4)).toBe("/b.glb");
    expect(pickCyclicPath(paths, -1)).toBe("/c.glb");
  });
});

describe("normalizeModelToRoadScale", () => {
  it("scales model to target length, grounds it, and centers x/z", () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshBasicMaterial());
    mesh.position.y = 4;
    mesh.position.x = 5;
    mesh.position.z = -3;
    group.add(mesh);

    normalizeModelToRoadScale(group, 3);

    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    expect(Math.max(size.x, size.z)).toBeCloseTo(3, 3);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(center.x).toBeCloseTo(0, 3);
    expect(center.z).toBeCloseTo(0, 3);
  });
});

describe("asset path constants", () => {
  it("has a default player model path and cyclic traffic model lookup", () => {
    expect(PLAYER_MODEL_PATHS[0]).toBe("/assets/models/player-car.glb");
    expect(TRAFFIC_MODEL_PATHS.length).toBeGreaterThan(0);
    expect(trafficModelPathForId(1)).toBe(TRAFFIC_MODEL_PATHS[1 % TRAFFIC_MODEL_PATHS.length]);
  });
});
