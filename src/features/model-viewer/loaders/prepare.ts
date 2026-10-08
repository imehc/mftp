import { MissingResources, modelError } from "../domain/errors";
import type { ImportProgress, ModelSource } from "../domain/types";
import { MAX_IMPORT_BYTES } from "../sources/browser";
import { resourcePath } from "../sources/paths";
import { decodeDataUri } from "./data-uri";
import { parseDocument } from "./document";

export async function prepareGltf(
  source: ModelSource,
  signal: AbortSignal,
  progress: (value: ImportProgress) => void,
) {
  const urls = new Set<string>();

  const dispose = () => {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.clear();
  };

  const objectUrl = (
    bytes: Uint8Array<ArrayBuffer>,
    type = "application/octet-stream",
  ) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.add(url);

    return url;
  };

  const read = (key: string) =>
    source.read(key, signal, (loaded, total) =>
      progress({ phase: "reading", name: key || source.name, loaded, total }),
    );
  try {
    if (source.size > MAX_IMPORT_BYTES) throw modelError("large");
    const entry = await read("");
    const validationSource = {
      entry: new Blob([entry]),
      resources: new Map<string, Blob>(),
    };
    signal.throwIfAborted();
    const { json, binary } = parseDocument(entry);
    const missing: string[] = [];
    const paths = new Set<string>();
    let allocation = entry.byteLength;
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      if (item.uri !== undefined) {
        if (typeof item.uri !== "string") throw modelError("invalid");
        if (!item.uri.startsWith("data:")) paths.add(resourcePath(item.uri));
      }
    }
    for (const key of paths) {
      signal.throwIfAborted();
      const size = await source.sizeOf(key);
      if (size === null) missing.push(key);
      else allocation += size;
    }
    if (allocation > MAX_IMPORT_BYTES) throw modelError("large");

    if (missing.length) throw new MissingResources(missing);
    const cache = new Map<string, Uint8Array<ArrayBuffer>>();
    const validationBlobs = new Map<string, Blob>();

    const resolve = async (uri: string) => {
      const key = uri.startsWith("data:") ? uri : resourcePath(uri);
      const existing = cache.get(key);
      if (existing) {
        const blob = validationBlobs.get(key);
        if (blob) validationSource.resources.set(uri, blob);
        return existing;
      }
      signal.throwIfAborted();
      let bytes: Uint8Array<ArrayBuffer>;
      if (uri.startsWith("data:")) {
        bytes = decodeDataUri(uri, MAX_IMPORT_BYTES - allocation);
        allocation += bytes.byteLength;
      } else bytes = await read(key);
      if (!uri.startsWith("data:")) {
        const blob = new Blob([bytes]);
        validationBlobs.set(key, blob);
        // Worker 只接收原始 URI 到已授权 Blob 的映射，避免引入路径工具的 UI 翻译依赖。
        validationSource.resources.set(uri, blob);
      }

      signal.throwIfAborted();
      cache.set(key, bytes);
      return bytes;
    };

    const buffers: Uint8Array<ArrayBuffer>[] = [];
    for (const [index, buffer] of (json.buffers ?? []).entries()) {
      const bytes =
        buffer.uri !== undefined
          ? await resolve(buffer.uri)
          : index === 0
            ? binary
            : undefined;
      if (
        !bytes ||
        !Number.isSafeInteger(buffer.byteLength) ||
        buffer.byteLength < 0 ||
        buffer.byteLength > bytes.length
      )
        throw modelError("invalid");
      buffers.push(bytes);
      buffer.uri = objectUrl(bytes);
    }
    for (const image of json.images ?? []) {
      let bytes: Uint8Array<ArrayBuffer>;
      if (image.uri !== undefined) bytes = await resolve(image.uri);
      else {
        const view = json.bufferViews?.[image.bufferView ?? -1];
        const buffer = view && buffers[view.buffer];
        const offset = view?.byteOffset ?? 0;
        if (
          !view ||
          !buffer ||
          view.extensions ||
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(view.byteLength) ||
          offset < 0 ||
          view.byteLength < 0 ||
          offset + view.byteLength > buffer.length
        )
          throw modelError("invalid");
        bytes = buffer.subarray(offset, offset + view.byteLength);
      }
      // 由本适配器拥有所有图片 URL，失败路径也能回收，避免加载器失败时遗漏。
      image.uri = objectUrl(bytes, image.mimeType);
      delete image.bufferView;
    }
    signal.throwIfAborted();
    const archive = new Map<string, Blob>([["", validationSource.entry]]);
    for (const [uri, blob] of validationSource.resources)
      archive.set(resourcePath(uri), blob);
    return { json, urls, dispose, validationSource, archive };
  } catch (error) {
    dispose();
    throw error;
  }
}
