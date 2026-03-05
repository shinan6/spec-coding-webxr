import * as THREE from "three";

export const PLAYER_MODEL_PATHS = ["/assets/models/player-car.glb"];

export const TRAFFIC_MODEL_PATHS = [
  "/assets/models/traffic-car-a.glb",
  "/assets/models/traffic-car-b.glb",
  "/assets/models/traffic-car-c.glb"
];

export function pickCyclicPath(paths: string[], index: number): string | null {
  if (paths.length === 0) {
    return null;
  }

  const safeIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  const normalized = ((safeIndex % paths.length) + paths.length) % paths.length;
  return paths[normalized];
}

export function trafficModelPathForId(id: number): string | null {
  return pickCyclicPath(TRAFFIC_MODEL_PATHS, id);
}

export function normalizeModelToRoadScale(model: THREE.Object3D, targetLength: number): void {
  const initialBox = new THREE.Box3().setFromObject(model);
  const initialSize = new THREE.Vector3();
  initialBox.getSize(initialSize);

  const longestDimension = Math.max(initialSize.x, initialSize.z, Number.EPSILON);
  const scale = targetLength / longestDimension;
  model.scale.multiplyScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);

  model.position.x -= scaledCenter.x;
  model.position.z -= scaledCenter.z;
  model.position.y -= scaledBox.min.y;
}
