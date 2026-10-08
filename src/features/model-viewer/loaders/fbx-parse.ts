import { Group, Loader, LoadingManager, Texture } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

import {
  FBX_FILE_LIMIT,
  FBX_TEXTURE_LIMIT,
  fbxError,
  fbxResourcePath,
  fbxTextureType,
} from "./fbx-policy";
import { type FbxImage, packFbx } from "./fbx-transfer";

/** 只在专属 Worker 内调用；处理结束即销毁 Worker，避免官方加载器模块级场景缓存常驻。 */
export function parseFbx(bytes: ArrayBuffer) {
  if (bytes.byteLength > FBX_FILE_LIMIT) throw fbxError("fbx_limit");
  const images: FbxImage[] = [];
  const embedded = new Map<string, Blob>();
  const create = URL.createObjectURL;
  let embeddedBytes = 0;
  // 内嵌二进制图片也只作为 Blob 移交，不生成跨 Worker 生命周期的真实对象 URL。
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob)) throw fbxError("invalid");
    embeddedBytes += blob.size;
    if (embeddedBytes > FBX_FILE_LIMIT) throw fbxError("fbx_limit");
    const id = `blob:mftp-fbx-${embedded.size}`;
    embedded.set(id, blob);
    return id;
  };

  class DeferredTextureLoader extends Loader<Texture> {
    override load(reference: string) {
      if (images.length >= FBX_TEXTURE_LIMIT) throw fbxError("fbx_limit");
      const texture = new Texture();
      const blob = embedded.get(reference);
      if (blob)
        images.push({ uuid: texture.source.uuid, blob, type: blob.type });
      else if (reference.startsWith("data:")) {
        const match =
          /^data:(image\/(?:png|jpeg|webp|bmp));base64,([a-z\d+/=\s]+)$/i.exec(
            reference,
          );
        if (!match) throw fbxError("fbx_texture");
        const raw = atob(match[2]);
        embeddedBytes += raw.length;
        if (embeddedBytes > FBX_FILE_LIMIT) throw fbxError("fbx_limit");
        images.push({
          uuid: texture.source.uuid,
          blob: new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], {
            type: match[1],
          }),
          type: match[1],
        });
      } else {
        const path = fbxResourcePath(reference);
        images.push({
          uuid: texture.source.uuid,
          path,
          type: fbxTextureType(path),
        });
      }
      return texture;
    }
  }

  try {
    const manager = new LoadingManager();
    manager.setURLModifier(() => {
      throw fbxError("unsafe");
    });
    // 所有格式的贴图都先成为描述符；此阶段不访问 DOM、本地路径或网络。
    manager.addHandler(/./, new DeferredTextureLoader(manager));
    const loader = new FBXLoader(manager);
    loader.trimAnimationClips = true;
    const root = loader.parse(bytes, "");
    const unit = root.userData.unitScaleFactor;
    if (typeof unit !== "number" || !Number.isFinite(unit) || unit <= 0)
      throw fbxError("fbx_unit");
    // FBX UnitScaleFactor 的基准是厘米；独立父节点可避免动画轨道覆盖单位缩放。
    const scene = new Group();
    scene.scale.setScalar(unit / 100);
    scene.animations = root.animations;
    root.animations = [];
    scene.add(root);
    return packFbx(scene, images);
  } finally {
    URL.createObjectURL = create;
    embedded.clear();
  }
}
