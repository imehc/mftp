import {
  type BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
  Material,
  type Object3D,
  type Skeleton,
  Texture,
  TextureUtils,
} from "three";

import type { ModelHandle } from "../domain/types";

export type Allocation = {
  key: object;
  bytes: number;
  category: "geometry" | "texture" | "animation" | "skeleton" | "shared";
};

export type MemoryInventory = {
  sources: Map<Blob, number>;
  cpu: Map<object, Allocation>;
  gpu: Map<object, Allocation>;
  textures: {
    id: string;
    name: string;
    width: number | null;
    height: number | null;
    format: number;
    gpu: number | null;
  }[];
  geometries: number;
  materials: number;
  animations: number;
  unknown: number;
};

export type MemoryTotals = {
  source: number;
  cpu: number;
  gpu: number;
  known: number;
  unknown: number;
};

export function textureBytes(texture: Texture): number | null {
  const data = texture.source?.data;
  const faces = Array.isArray(data) ? data : [data];
  let bytes = 0;
  try {
    for (const face of faces) {
      const { width, height } = face ?? {};
      if (!(width > 0 && height > 0) || !Number.isFinite(width * height))
        return null;
      const levels = face?.mipmaps ?? texture.mipmaps;
      if (levels.length) {
        for (const mip of levels)
          bytes +=
            TextureUtils.getByteLength(
              mip.width,
              mip.height,
              texture.format,
              texture.type,
            ) * (face.depth ?? 1);
      } else {
        let w = width,
          h = height;
        let more = true;
        while (more) {
          bytes +=
            TextureUtils.getByteLength(w, h, texture.format, texture.type) *
            (face.depth ?? 1);
          more = texture.generateMipmaps && (w > 1 || h > 1);
          w = Math.max(1, Math.floor(w / 2));
          h = Math.max(1, Math.floor(h / 2));
        }
      }
    }
  } catch {
    return null;
  }
  return Number.isFinite(bytes) ? bytes : null;
}

/** CPU 按底层 ArrayBuffer，GPU 按上传资源去重；二者不能混为同一分配。 */
export function memoryInventory(model: ModelHandle): MemoryInventory {
  const sources = new Map<Blob, number>();
  if (model.validationSource)
    for (const blob of [
      model.validationSource.entry,
      ...model.validationSource.resources.values(),
    ])
      sources.set(blob, blob.size);
  const cpu = new Map<object, Allocation>(),
    gpu = new Map<object, Allocation>();
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>();
  const textures = new Set<Texture>(),
    skeletons = new Set<Skeleton>();
  let unknown = 0;

  const array = (value: unknown, category: Allocation["category"]) => {
    if (ArrayBuffer.isView(value))
      cpu.set(value.buffer, {
        key: value.buffer,
        bytes: value.buffer.byteLength,
        category:
          cpu.has(value.buffer) && cpu.get(value.buffer)!.category !== category
            ? "shared"
            : category,
      });
  };

  const attribute = (
    attr: BufferAttribute | InterleavedBufferAttribute,
    upload = true,
  ) => {
    const storage = "isInterleavedBufferAttribute" in attr ? attr.data : attr;
    array(storage.array, "geometry");
    if (upload)
      gpu.set(storage, {
        key: storage,
        bytes: storage.array.byteLength,
        category: "geometry",
      });
  };

  for (const root of model.resourceScenes ?? [model.scene])
    root.traverse((node: Object3D) => {
      const mesh = node as Object3D & {
        geometry?: BufferGeometry;
        material?: Material | Material[];
        skeleton?: Skeleton;
        instanceMatrix?: BufferAttribute;
        instanceColor?: BufferAttribute;
      };
      if (mesh.geometry && !geometries.has(mesh.geometry)) {
        const geometry = mesh.geometry;
        geometries.add(geometry);
        Object.values(geometry.attributes).forEach((attr) => attribute(attr));
        if (geometry.index) attribute(geometry.index);
        for (const attributes of Object.values(geometry.morphAttributes))
          attributes?.forEach((attr) => attribute(attr, false));
        // WebGL morph 数据由渲染器打包成纹理，填充/设备限制不可从源数组可靠推断。
        if (Object.keys(geometry.morphAttributes).length) unknown++;
      }
      if (mesh.instanceMatrix) attribute(mesh.instanceMatrix);
      if (mesh.instanceColor) attribute(mesh.instanceColor);
      if (mesh.skeleton && !skeletons.has(mesh.skeleton)) {
        skeletons.add(mesh.skeleton);
        array(mesh.skeleton.boneMatrices, "skeleton");
        if (mesh.skeleton.boneTexture) textures.add(mesh.skeleton.boneTexture);
      }
      const list = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const material of list) {
        if (materials.has(material)) continue;
        materials.add(material);
        Object.values(material).forEach((value) => {
          if (value instanceof Texture) textures.add(value);
        });
      }
    });
  for (const clip of model.animations)
    for (const track of clip.tracks) {
      array(track.times, "animation");
      array(track.values, "animation");
      if (!ArrayBuffer.isView(track.values)) unknown++;
    }
  const textureDetails: MemoryInventory["textures"] = [];
  for (const texture of textures) {
    const data = texture.source?.data;
    for (const face of Array.isArray(data) ? data : [data]) {
      array(face?.data, "texture");
      // 解码位图仅估算像素存储；不同 Texture 共用图像时按图像身份去重。
      if (
        face &&
        !face.data &&
        face.width > 0 &&
        face.height > 0 &&
        !face.mipmaps &&
        !texture.mipmaps.length
      )
        cpu.set(face, {
          key: face,
          bytes: face.width * face.height * 4,
          category: "texture",
        });
      for (const mip of face?.mipmaps ?? texture.mipmaps)
        array(mip.data, "texture");
    }
    const bytes = textureBytes(texture);
    if (bytes === null) unknown++;
    else gpu.set(texture, { key: texture, bytes, category: "texture" });
    const dimensions = data as { width?: number; height?: number } | undefined;
    textureDetails.push({
      id: texture.uuid,
      name: texture.name,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      format: texture.format,
      gpu: bytes,
    });
  }
  // 材质、mixer、场景节点、驱动/着色器开销没有可靠的字节值，始终明确为未计入。
  return {
    sources,
    cpu,
    gpu,
    textures: textureDetails,
    geometries: geometries.size,
    materials: materials.size,
    animations: model.animations.length,
    unknown,
  };
}

export function memoryTotals(
  inventories: Iterable<MemoryInventory>,
): MemoryTotals {
  const cpu = new Map<object, Allocation>(),
    gpu = new Map<object, Allocation>();
  const sources = new Map<Blob, number>();
  let unknown = 0;
  for (const inventory of inventories) {
    inventory.sources.forEach((value, key) => sources.set(key, value));
    inventory.cpu.forEach((value, key) => cpu.set(key, value));
    inventory.gpu.forEach((value, key) => gpu.set(key, value));
    unknown += inventory.unknown;
  }
  const sum = (values: Map<object, Allocation>) =>
    [...values.values()].reduce((n, value) => n + value.bytes, 0);
  const c = sum(cpu),
    g = sum(gpu);
  return {
    cpu: c,
    gpu: g,
    known: c + g,
    unknown,
    source: [...sources.values()].reduce((n, size) => n + size, 0),
  };
}

export class MemoryHistory {
  private inventories = new Map<string, MemoryInventory>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private state = {
    total: memoryTotals([]),
    models: {} as Record<string, MemoryTotals>,
    history: [] as (MemoryTotals & { time: number })[],
    threshold: 512 * 1024 * 1024,
    paused: false,
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  inventory(id: string) {
    return this.inventories.get(id);
  }
  private publish() {
    this.listeners.forEach((listener) => listener());
  }
  refresh(models: Iterable<[string, ModelHandle]>) {
    this.inventories = new Map(
      [...models].map(([id, model]) => [id, memoryInventory(model)]),
    );
    this.state = {
      ...this.state,
      total: memoryTotals(this.inventories.values()),
      models: Object.fromEntries(
        [...this.inventories].map(([id, inventory]) => [
          id,
          memoryTotals([inventory]),
        ]),
      ),
    };
    this.publish();
  }
  sample(time = Date.now()) {
    if (
      this.state.paused ||
      (this.state.history.length &&
        time - this.state.history.at(-1)!.time < 1000)
    )
      return;
    this.state = {
      ...this.state,
      history: [
        ...this.state.history.slice(-119),
        { ...this.state.total, time },
      ],
    };
    this.publish();
  }
  setThreshold(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    this.state = { ...this.state, threshold: bytes };
    this.publish();
  }
  pause(paused: boolean) {
    this.state = { ...this.state, paused };
    this.publish();
  }
  start() {
    this.stop();
    this.timer = setInterval(() => {
      if (!document.hidden) this.sample();
    }, 1000);
  }
  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  dispose() {
    this.stop();
    this.inventories.clear();
    this.state = {
      ...this.state,
      total: memoryTotals([]),
      models: {},
      history: [],
    };
    this.publish();
  }
}
