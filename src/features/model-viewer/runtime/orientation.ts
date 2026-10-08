import { Vector3, type PerspectiveCamera } from "three";

export const axisDirections = {
  posX: [1, 0, 0],
  negX: [-1, 0, 0],
  posY: [0, 1, 0],
  negY: [0, -1, 0],
  posZ: [0, 0, 1],
  negZ: [0, 0, -1],
} as const;
export type ViewAxis = keyof typeof axisDirections;

export function orientCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  axis: ViewAxis,
) {
  const distance = camera.position.distanceTo(target);
  const direction = new Vector3(...axisDirections[axis]);
  // 极点保留微小偏移，与 OrbitControls 的极角保护一致，避免相机上方向退化。
  if (Math.abs(direction.y) === 1) direction.z = 0.000001;
  camera.position
    .copy(target)
    .add(direction.normalize().multiplyScalar(distance));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}
