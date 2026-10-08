import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  type JSONMeta,
  Material,
  Mesh,
  type Object3D,
  ObjectLoader,
  Texture,
  type TypedArray,
} from "three";

import { FBX_BUFFER_LIMIT, FBX_NODE_LIMIT, fbxError } from "./fbx-policy";

type AttributeData = {
  array: TypedArray;
  itemSize: number;
  normalized: boolean;
  name: string;
};

type GeometryData = {
  uuid: string;
  name: string;
  attributes: Record<string, AttributeData>;
  index?: AttributeData;
  morph: Record<string, AttributeData[]>;
  relative: boolean;
  groups: BufferGeometry["groups"];
  drawRange: BufferGeometry["drawRange"];
};

export type FbxImage = {
  uuid: string;
  path?: string;
  blob?: Blob;
  type: string;
};

export type FbxTransfer = {
  json: ReturnType<Object3D["toJSON"]>;
  geometries: GeometryData[];
  images: FbxImage[];
  morphs: {
    uuid: string;
    influences: number[];
    dictionary?: Record<string, number>;
  }[];
};

export function packFbx(scene: Group, images: FbxImage[]) {
  scene.updateMatrixWorld(true);
  const buffers = new Set<ArrayBuffer>();
  const geometries = new Map<string, GeometryData>();
  const morphs: FbxTransfer["morphs"] = [];
  const meta: JSONMeta = {
    geometries: {},
    materials: {},
    textures: {},
    images: {},
    shapes: {},
    skeletons: {},
    animations: {},
    nodes: {},
  };
  let bytes = 0,
    nodes = 0,
    animationValues = 0;

  const attribute = (value: BufferAttribute): AttributeData => {
    if (
      !(value instanceof BufferAttribute) ||
      !(value.array.buffer instanceof ArrayBuffer)
    )
      throw fbxError("invalid");
    if (!buffers.has(value.array.buffer)) {
      buffers.add(value.array.buffer);
      bytes += value.array.buffer.byteLength;
      if (bytes > FBX_BUFFER_LIMIT) throw fbxError("fbx_limit");
    }
    return {
      array: value.array,
      itemSize: value.itemSize,
      normalized: value.normalized,
      name: value.name,
    };
  };

  scene.traverse((node) => {
    if (++nodes > FBX_NODE_LIMIT) throw fbxError("fbx_limit");
    if (node instanceof Mesh && node.morphTargetInfluences)
      morphs.push({
        uuid: node.uuid,
        influences: node.morphTargetInfluences,
        dictionary: node.morphTargetDictionary,
      });
    if ("geometry" in node && node.geometry instanceof BufferGeometry) {
      const g = node.geometry;
      if (geometries.has(g.uuid)) return;
      const attributes = Object.fromEntries(
        Object.entries(g.attributes).map(([key, a]) => [
          key,
          attribute(a as BufferAttribute),
        ]),
      );
      const morph = Object.fromEntries(
        Object.entries(g.morphAttributes).map(([key, list]) => [
          key,
          list!.map((a) => attribute(a as BufferAttribute)),
        ]),
      );
      geometries.set(g.uuid, {
        uuid: g.uuid,
        name: g.name,
        attributes,
        morph,
        index: g.index ? attribute(g.index) : undefined,
        relative: g.morphTargetsRelative,
        groups: g.groups,
        drawRange: g.drawRange,
      });
      // 预填 Three.js 的序列化缓存，几何数组通过 transfer 移交，不转成巨大的 JSON 数组。
      meta.geometries[g.uuid] = { uuid: g.uuid, type: "BufferGeometry" };
    }
  });
  for (const clip of scene.animations)
    for (const track of clip.tracks) {
      animationValues += track.times.length + track.values.length;
      if (animationValues > 2_000_000) throw fbxError("fbx_limit");
    }
  for (const image of images)
    meta.images[image.uuid] = { uuid: image.uuid, url: "" };
  const json = scene.toJSON(meta);
  // 场景、材质、骨骼和动画沿用 Three.js 官方格式，只有大几何缓冲与图片单独移交。
  Object.assign(
    json,
    Object.fromEntries(
      (["materials", "textures", "skeletons", "animations"] as const).map(
        (key) => [key, Object.values(meta[key])],
      ),
    ),
  );
  return {
    value: {
      json,
      geometries: [...geometries.values()],
      images,
      morphs,
    } satisfies FbxTransfer,
    buffers: [...buffers],
  };
}

export async function unpackFbx(
  value: FbxTransfer,
  images: ReturnType<ObjectLoader["parseImages"]>,
  signal: AbortSignal,
  track: (resource: unknown) => void,
) {
  const geometries: Record<string, BufferGeometry> = {};

  const attribute = (data: AttributeData) => {
    const result = new BufferAttribute(
      data.array,
      data.itemSize,
      data.normalized,
    );

    result.name = data.name;
    return result;
  };

  for (const [index, data] of value.geometries.entries()) {
    signal.throwIfAborted();
    const geometry = new BufferGeometry();
    track(geometry);
    geometry.uuid = data.uuid;
    geometry.name = data.name;
    for (const [key, dataAttribute] of Object.entries(data.attributes))
      geometry.setAttribute(key, attribute(dataAttribute));
    if (data.index) geometry.setIndex(attribute(data.index));
    geometry.morphAttributes = Object.fromEntries(
      Object.entries(data.morph).map(([key, list]) => [
        key,
        list.map(attribute),
      ]),
    );
    geometry.morphTargetsRelative = data.relative;
    geometry.groups = data.groups;
    geometry.drawRange = data.drawRange;
    geometries[data.uuid] = geometry;
    if (index % 32 === 31)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  class PreparedLoader extends ObjectLoader {
    override parseGeometries() {
      return geometries;
    }
    override parseImages() {
      return images;
    }
    override parseTextures(json: unknown, prepared: typeof images) {
      const result = super.parseTextures(json, prepared);
      Object.values(result).forEach(track);
      return result;
    }
    override parseMaterials(
      json: unknown,
      textures: Record<string, Texture>,
    ): Record<string, Material> {
      const result = super.parseMaterials(json, textures);
      Object.values(result).forEach(track);
      return result;
    }
  }

  signal.throwIfAborted();
  const scene = new PreparedLoader().parse(value.json);
  track(scene);
  const morphs = new Map(value.morphs.map((item) => [item.uuid, item]));
  scene.traverse((node) => {
    const morph = morphs.get(node.uuid);
    if (morph && node instanceof Mesh) {
      node.morphTargetInfluences = morph.influences;
      node.morphTargetDictionary = morph.dictionary;
    }
  });
  signal.throwIfAborted();
  return scene as Group;
}
