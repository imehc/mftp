import {
  Box3,
  Group,
  PerspectiveCamera,
  Sphere,
  Vector3,
  type Object3D,
} from "three";
import { modelError } from "../domain/errors";

export function frameModel(root: Object3D) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const layer = new Group();
  const offset = new Group();
  layer.add(offset);
  offset.add(root);
  if (box.isEmpty()) return layer;
  const sphere = box.getBoundingSphere(new Sphere());
  if (
    ![sphere.radius, sphere.center.x, sphere.center.y, sphere.center.z].every(
      Number.isFinite,
    )
  )
    throw modelError("invalid");
  // 仅在预览父节点归一化，保留 glTF 原始变换与单位，避免极端尺度裁剪。
  const scale = sphere.radius > 0 ? 1 / sphere.radius : 1;
  offset.position.copy(sphere.center).negate();
  layer.scale.setScalar(scale);
  return layer;
}

export function fitCamera(camera: PerspectiveCamera) {
  const vertical = (camera.fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  const distance = 1.15 / Math.sin(Math.min(vertical, horizontal));
  camera.position.copy(
    new Vector3(1, 0.65, 1).normalize().multiplyScalar(distance),
  );
  camera.near = 0.001;
  camera.far = Math.max(1000, distance * 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
