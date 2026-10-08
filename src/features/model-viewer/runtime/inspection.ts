import {
  BufferGeometry,
  Color,
  DoubleSide,
  Material,
  Mesh,
  Object3D,
  Texture,
  type InstancedMesh,
  RGBAFormat,
  RGBFormat,
  RedFormat,
  RGFormat,
  RGB_S3TC_DXT1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_ASTC_4x4_Format,
  RGBA_ASTC_6x6_Format,
  RGBA_ASTC_8x8_Format,
  RGBA_BPTC_Format,
  RGB_BPTC_SIGNED_Format,
  RGB_BPTC_UNSIGNED_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGB_PVRTC_2BPPV1_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_PVRTC_2BPPV1_Format,
} from "three";
import type { ModelHandle } from "../domain/types";
import type {
  MaterialInfo,
  ModelInspection,
  TextureInfo,
} from "../domain/inspection";

const formats = new Map<number, string>(
  Object.entries({
    RGBAFormat,
    RGBFormat,
    RedFormat,
    RGFormat,
    RGB_S3TC_DXT1_Format,
    RGBA_S3TC_DXT1_Format,
    RGBA_S3TC_DXT3_Format,
    RGBA_S3TC_DXT5_Format,
    RGB_ETC1_Format,
    RGB_ETC2_Format,
    RGBA_ETC2_EAC_Format,
    RGBA_ASTC_4x4_Format,
    RGBA_ASTC_6x6_Format,
    RGBA_ASTC_8x8_Format,
    RGBA_BPTC_Format,
    RGB_BPTC_SIGNED_Format,
    RGB_BPTC_UNSIGNED_Format,
    RGB_PVRTC_4BPPV1_Format,
    RGB_PVRTC_2BPPV1_Format,
    RGBA_PVRTC_4BPPV1_Format,
    RGBA_PVRTC_2BPPV1_Format,
  }).map(([name, value]) => [value, name]),
);

export function textureFormat(format: number) {
  return formats.get(format) ?? null;
}

function textureInfo(texture: Texture): TextureInfo {
  const image = texture.source?.data as
    { width?: number; height?: number } | undefined;
  return {
    id: texture.uuid,
    name: texture.name,
    width: image?.width ?? null,
    height: image?.height ?? null,
    format: formats.get(texture.format) ?? null,
    slots: [],
  };
}

/** 当前场景的资源按对象身份去重；节点实例与几何体资源分别计数。 */
export function inspectModel(model: ModelHandle) {
  const geometries = new Set<BufferGeometry>();
  const triangleGeometries = new Set<BufferGeometry>();
  const materials = new Map<string, MaterialInfo>();
  const textures = new Map<string, Texture>();
  const textureDetails = new Map<string, TextureInfo>();
  const nodes: ModelInspection["nodes"] = {};
  let vertices: number | null = 0;
  let triangles: number | null = 0;
  let instances = 0;
  const stack: Object3D[] = [model.scene];
  while (stack.length) {
    const node = stack.pop()!;
    for (let i = node.children.length - 1; i >= 0; i--)
      stack.push(node.children[i]);
    const drawable = node as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    const geometry = drawable.geometry;
    if (geometry) {
      instances += (node as InstancedMesh).isInstancedMesh
        ? (node as InstancedMesh).count
        : 1;
      if (!geometries.has(geometry)) {
        geometries.add(geometry);
        const count = geometry.getAttribute("position")?.count;
        vertices =
          vertices === null || count === undefined ? null : vertices + count;
      }
      if ((node as Mesh).isMesh && !triangleGeometries.has(geometry)) {
        triangleGeometries.add(geometry);
        const count =
          geometry.index?.count ?? geometry.getAttribute("position")?.count;
        triangles =
          triangles === null || count === undefined
            ? null
            : triangles + Math.floor(count / 3);
      }
    }
    const list = drawable.material
      ? Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]
      : [];
    nodes[node.uuid] = {
      id: node.uuid,
      name: node.name,
      type: node.type,
      parent: node === model.scene ? null : (node.parent?.uuid ?? null),
      children: node.children.map((child) => child.uuid),
      materials: list.map((material) => material.uuid),
    };
    for (const material of list) {
      if (materials.has(material.uuid)) continue;
      const properties = material as Material & {
        color?: Color;
        metalness?: number;
        roughness?: number;
      };
      const slots: MaterialInfo["textures"] = [];
      for (const [slot, value] of Object.entries(material)) {
        if (!(value instanceof Texture)) continue;
        textures.set(value.uuid, value);
        slots.push({ slot, id: value.uuid });
        const info = textureDetails.get(value.uuid) ?? textureInfo(value);
        if (!info.slots.includes(slot)) info.slots.push(slot);
        textureDetails.set(value.uuid, info);
      }
      materials.set(material.uuid, {
        id: material.uuid,
        name: material.name,
        type: material.type,
        color:
          properties.color instanceof Color
            ? `#${properties.color.getHexString()}`
            : null,
        opacity: material.opacity,
        metalness: properties.metalness ?? null,
        roughness: properties.roughness ?? null,
        doubleSided: material.side === DoubleSide,
        textures: slots,
      });
    }
  }
  const snapshot: ModelInspection = {
    root: model.scene.uuid,
    nodes,
    materials: [...materials.values()],
    textures: [...textureDetails.values()],
    counts: {
      vertices,
      triangles,
      geometries: geometries.size,
      instances,
      materials: materials.size,
      textures: textures.size,
      animations: model.animations.length,
    },
  };
  return { snapshot, textures };
}
