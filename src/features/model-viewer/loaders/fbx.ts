import { BufferGeometry, type WebGLRenderer } from "three";

import { IpcError } from "~/lib/errors";

import { MissingResources } from "../domain/errors";
import type { ImportProgress, ModelHandle, ModelSource } from "../domain/types";
import { ModelResources } from "../runtime/resources";
import { readFbxImages } from "./fbx-images";
import { FBX_FILE_LIMIT, fbxError } from "./fbx-policy";
import { parseFbxTask } from "./fbx-task";
import { unpackFbx } from "./fbx-transfer";

export async function loadFbx(
  source: ModelSource,
  renderer: WebGLRenderer,
  signal: AbortSignal,
  progress: (value: ImportProgress) => void,
): Promise<ModelHandle> {
  const resources = new ModelResources();
  try {
    signal.throwIfAborted();
    if (source.size > FBX_FILE_LIMIT) throw new IpcError(fbxError("fbx_limit"));
    const bytes = await source.read("", signal, (loaded, total) =>
      progress({ phase: "reading", name: source.name, loaded, total }),
    );
    signal.throwIfAborted();
    progress({ phase: "decoding", name: source.name });
    const parsed = await parseFbxTask(bytes.buffer, signal);
    const track = (value: unknown) => resources.track(value);
    const images = await readFbxImages(
      parsed.images,
      source,
      signal,
      progress,
      track,
      Math.min(renderer.capabilities.maxTextureSize, 8192),
    );
    const scene = await unpackFbx(parsed, images, signal, track);
    let hasGeometry = false;
    scene.traverse((node) => {
      if (
        "geometry" in node &&
        node.geometry instanceof BufferGeometry &&
        (node.geometry.getAttribute("position")?.count ?? 0) > 0
      )
        hasGeometry = true;
    });
    return {
      name: source.name,
      size: source.size,
      format: "FBX",
      scene,
      animations: scene.animations,
      hasGeometry,
      dispose: () => resources.dispose(),
    };
  } catch (error) {
    resources.dispose();
    if (signal.aborted) throw signal.reason;
    if (error instanceof IpcError || error instanceof MissingResources)
      throw error;
    throw new IpcError(fbxError("decode"));
  }
}
