import {
  BufferGeometry,
  LoadingManager,
  Texture,
  type WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import { IpcError } from "~/lib/errors";

import { modelError } from "../domain/errors";
import type { ImportProgress, ModelHandle, ModelSource } from "../domain/types";
import { ModelResources } from "../runtime/resources";
import { prepareGltf } from "./prepare";

export async function loadGltf(
  source: ModelSource,
  renderer: WebGLRenderer,
  signal: AbortSignal,
  progress: (value: ImportProgress) => void,
): Promise<ModelHandle> {
  const prepared = await prepareGltf(source, signal, progress);
  const resources = new ModelResources();
  const tasks = new Set<Promise<unknown>>();
  const manager = new LoadingManager();
  let resourceFailed = false;
  manager.onError = () => {
    resourceFailed = true;
  };
  manager.setURLModifier((url) => {
    if (!prepared.urls.has(url)) throw modelError("unsafe");
    return url;
  });
  // 解码器使用独立的可信资源加载器；模型资源只能访问本次解析自有的 URL。
  const draco = new DRACOLoader()
    .setDecoderPath(`${import.meta.env.BASE_URL}model-decoders/draco/`)
    .setWorkerLimit(2);
  const ktx = new KTX2Loader()
    .setTranscoderPath(`${import.meta.env.BASE_URL}model-decoders/basis/`)
    .setWorkerLimit(2)
    .detectSupport(renderer);
  const loader = new GLTFLoader(manager)
    .setDRACOLoader(draco)
    .setKTX2Loader(ktx)
    .setMeshoptDecoder(MeshoptDecoder);

  const track = <T>(promise: Promise<T>): Promise<T> => {
    const task = promise.then((value) => {
      resources.track(value);
      return value;
    });
    tasks.add(task);
    void task.catch(() => {});
    return task;
  };

  loader.register((parser) => {
    const getDependency = parser.getDependency.bind(parser);
    parser.getDependency = (type, index) =>
      track(
        getDependency(type, index).then((value) => {
          if (type === "texture" && value === null) resourceFailed = true;
          // 临时对象 URL 是加载器的占位名，界面应使用可翻译的纹理序号。
          if (
            type === "texture" &&
            value instanceof Texture &&
            value.name.startsWith("blob:")
          )
            value.name = "";
          return value;
        }),
      );
    const loadGeometries = parser.loadGeometries.bind(parser);
    parser.loadGeometries = (primitives) => track(loadGeometries(primitives));
    return { name: "MFTP_resource_ownership" };
  });
  try {
    progress({ phase: "decoding" });
    signal.throwIfAborted();
    const gltf = await loader.parseAsync(JSON.stringify(prepared.json), "");
    // GLTFLoader 会给无名动画生成英文占位名；界面改用可翻译的序号标签。
    gltf.animations.forEach((clip, index) => {
      const name = prepared.json.animations?.[index]?.name;
      clip.name = typeof name === "string" ? name : "";
    });
    signal.throwIfAborted();
    if (resourceFailed) throw modelError("decode");
    resources.track(gltf.scenes);
    let hasGeometry = false;
    gltf.scene.traverse((node) => {
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
      format: source.name.toLowerCase().endsWith(".glb") ? "GLB" : "glTF",
      scene: gltf.scene,
      resourceScenes: gltf.scenes,
      animations: gltf.animations,
      hasGeometry,
      validationSource: prepared.validationSource,
      archive: prepared.archive,
      dispose: () => resources.dispose(),
    };
  } catch (error) {
    resources.dispose();
    if (signal.aborted) throw signal.reason;
    if (error instanceof IpcError) throw error;
    throw modelError("decode");
  } finally {
    // 解析失败不能在仍有解码任务时终止 worker，否则其 promise 永远悬挂。
    let count = -1;
    while (count !== tasks.size) {
      count = tasks.size;
      await Promise.allSettled([...tasks]);
    }
    draco.dispose();
    ktx.dispose();
    prepared.dispose();
  }
}
