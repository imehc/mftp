import type { ModelLibraryDocument, ModelViewState } from "~/bindings";
import {
  modelLibraryBegin,
  modelLibraryCommit,
  modelLibraryDelete,
  modelLibraryRead,
  modelLibraryWrite,
} from "~/lib/ipc";
import type { ModelHandle, ModelSource } from "../domain/types";
import { modelError } from "../domain/errors";
import { MAX_IMPORT_BYTES } from "../sources/browser";

const CHUNK = 1024 * 1024;

export function originalResources(handle: ModelHandle) {
  if (!handle.archive?.has("")) throw modelError("invalid");
  const resources = new Map(handle.archive);
  if (
    [...resources.values()].reduce((sum, blob) => sum + blob.size, 0) >
    MAX_IMPORT_BYTES
  )
    throw modelError("large");
  return resources;
}

export async function saveModel(
  handle: ModelHandle,
  view: ModelViewState,
  signal: AbortSignal,
  cleanupError: (error: unknown) => void,
) {
  const resources = originalResources(handle);
  signal.throwIfAborted();
  const id = await modelLibraryBegin({
    name: handle.name,
    view,
    resources: [...resources].map(([key, blob]) => ({ key, size: blob.size })),
  });
  try {
    for (const [key, blob] of resources) {
      for (let offset = 0; offset < blob.size; offset += CHUNK) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(
          await blob.slice(offset, offset + CHUNK).arrayBuffer(),
        );
        signal.throwIfAborted();
        await modelLibraryWrite(id, key, offset, Array.from(bytes));
      }
    }
    signal.throwIfAborted();
    await modelLibraryCommit(id);
    return id;
  } catch (error) {
    // 等待在途分片真正返回后清理；草稿清理不能删除已发布条目。
    try {
      await modelLibraryDelete(id, true);
    } catch (cleanup) {
      cleanupError(cleanup);
    }
    throw error;
  }
}

export function librarySource(
  id: string,
  document: ModelLibraryDocument,
): ModelSource {
  const resources = new Map(
    document.resources.map((resource) => [resource.key, resource.size]),
  );
  const size = resources.get("");
  if (size === undefined) throw modelError("invalid");
  return {
    name: document.sourceName,
    size,
    sizeOf: async (key) => resources.get(key) ?? null,
    read: async (key, signal, progress) => {
      const size = resources.get(key);
      if (size === undefined || size > MAX_IMPORT_BYTES)
        throw modelError("invalid");
      const result = new Uint8Array(size);
      for (let offset = 0; offset < size; offset += CHUNK) {
        signal.throwIfAborted();
        const bytes = await modelLibraryRead(id, key, offset);
        signal.throwIfAborted();
        if (bytes.length !== Math.min(CHUNK, size - offset))
          throw modelError("invalid");
        result.set(bytes, offset);
        progress(offset + bytes.length, size);
      }
      return result;
    },
    attach: async () => {
      throw modelError("invalid");
    },
    close: async () => {},
  };
}
