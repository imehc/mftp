import { type ObjectLoader, TextureSource } from "three";

import { IpcError } from "~/lib/errors";

import { MissingResources } from "../domain/errors";
import type { ImportProgress, ModelSource } from "../domain/types";
import { FBX_FILE_LIMIT, FBX_PIXEL_LIMIT, fbxError } from "./fbx-policy";
import type { FbxImage } from "./fbx-transfer";

export async function readFbxImages(
  images: FbxImage[],
  source: ModelSource,
  signal: AbortSignal,
  progress: (value: ImportProgress) => void,
  track: (resource: unknown) => void,
  maxDimension: number,
) {
  const missing: string[] = [];
  const paths = new Set(
    images.flatMap((image) => (image.path ? [image.path] : [])),
  );
  let bytes =
    source.size +
    images.reduce((sum, image) => sum + (image.blob?.size ?? 0), 0);
  for (const path of paths) {
    signal.throwIfAborted();
    const size = await source.sizeOf(path);
    if (size === null) missing.push(path);
    else bytes += size;
  }
  if (bytes > FBX_FILE_LIMIT * 2) throw new IpcError(fbxError("fbx_limit"));
  if (missing.length) throw new MissingResources(missing);
  const result: ReturnType<ObjectLoader["parseImages"]> = {};
  const cache = new Map<Blob | string, ImageBitmap | HTMLImageElement>();
  let pixels = 0;
  for (const image of images) {
    signal.throwIfAborted();
    const key = image.blob ?? image.path;
    if (!key) throw new IpcError(fbxError("invalid"));
    let decoded = cache.get(key);
    if (!decoded) {
      const blob =
        image.blob ??
        new Blob(
          [
            await source.read(image.path!, signal, (loaded, total) =>
              progress({ phase: "reading", name: image.path, loaded, total }),
            ),
          ],
          { type: image.type },
        );
      signal.throwIfAborted();
      progress({ phase: "decoding", name: image.path ?? source.name });
      if (typeof createImageBitmap === "function") {
        // ImageBitmap 上传忽略 Texture.flipY，创建位图时采用 FBX 纹理的默认翻转方向。
        decoded = await createImageBitmap(blob, {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        track(decoded);
      } else {
        const url = URL.createObjectURL(blob);
        try {
          decoded = new Image();
          decoded.src = url;
          // 解码不可中止时等待实际退出，随后再处理取消并回收 URL。
          await decoded.decode();
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      signal.throwIfAborted();
      const width = decoded.width,
        height = decoded.height;
      pixels += width * height;
      if (
        !width ||
        !height ||
        width > maxDimension ||
        height > maxDimension ||
        pixels > FBX_PIXEL_LIMIT
      )
        throw new IpcError(fbxError("fbx_limit"));
      cache.set(key, decoded);
    }
    result[image.uuid] = new TextureSource(decoded);
  }
  return result;
}
