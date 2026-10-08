import type { PerspectiveCamera, Vector3 } from "three";
import type { ModelCameraState, ModelViewState } from "~/bindings";
import type { ModelEntry } from "../runtime/collection";
import type { InspectionTools } from "../inspection/tools";

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
): ModelViewState {
  const state = tools.snapshot();
  return {
    version: 1,
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
