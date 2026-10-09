import type { PerspectiveCamera, Vector3 } from "three";

import type { ModelCameraState, ModelLayout, ModelViewState } from "~/bindings";

import type { InspectionTools } from "../inspection/tools";
import type { ModelCollection, ModelEntry } from "../runtime/collection";

export function cameraState(
  camera: PerspectiveCamera,
  target: Vector3,
): ModelCameraState {
  return {
    position: camera.position.toArray(),
    target: target.toArray(),
    near: camera.near,
    far: camera.far,
  };
}

export function captureModelView(
  camera: PerspectiveCamera,
  target: Vector3,
  tools: InspectionTools,
  entry: ModelEntry,
  layout: ModelLayout,
): ModelViewState {
  const state = tools.snapshot();
  return {
    version: 1,
    layout,
    camera: cameraState(camera, target),
    views: state.views.map(({ id, name, position, target, near, far }) => ({
      id,
      name,
      camera: {
        position: [position[0], position[1], position[2]],
        target: [target[0], target[1], target[2]],
        near,
        far,
      },
    })),
    animation: entry.animation.persist(),
    position: entry.layer.position.toArray(),
    visible: entry.layer.visible,
    unit: state.unit,
    wireframe: state.wireframe,
    normals: state.normals,
    shadows: state.shadows,
    autoRotate: state.autoRotate,
  };
}

export function restoreModelPlacement(
  models: ModelCollection,
  entry: ModelEntry,
  value: ModelViewState,
) {
  // 恢复布局选项不重新排布，避免覆盖用户保存的位置或移动其他模型。
  models.layout = value.layout ?? "row";
  entry.layer.position.fromArray(value.position);
  entry.layer.visible = value.visible;
}
