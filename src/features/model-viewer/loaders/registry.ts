import type { WebGLRenderer } from "three";

import { modelError } from "../domain/errors";
import { type ModelExtension, modelExtension } from "../domain/formats";
import type { ImportProgress, ModelSource } from "../domain/types";
import { loadGltf } from "./gltf";

const loaders: Record<ModelExtension, typeof loadGltf> = {
  glb: loadGltf,
  gltf: loadGltf,
  fbx: async (...args) => (await import("./fbx")).loadFbx(...args),
};

export { modelExtensions } from "../domain/formats";

export function loadModel(
  source: ModelSource,
  renderer: WebGLRenderer,
  signal: AbortSignal,
  progress: (value: ImportProgress) => void,
) {
  const extension = modelExtension(source.name);
  if (!extension) throw modelError("unsupported");
  return loaders[extension](source, renderer, signal, progress);
}
