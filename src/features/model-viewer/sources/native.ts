import {
  modelViewerAttach,
  modelViewerClose,
  modelViewerOpen,
  modelViewerRead,
  modelViewerSize,
} from "~/lib/ipc";
import { hasCustomCode } from "~/lib/errors";
import { modelError, MissingResources } from "../domain/errors";
import type { ModelSource } from "../domain/types";
import { MAX_IMPORT_BYTES } from "./browser";

export async function nativeSource(
  path: string,
  selected: string[] = [],
): Promise<ModelSource> {
  const session = await modelViewerOpen(path);
  try {
    const normalized = path.replaceAll("\\", "/");
    const base = normalized.slice(0, normalized.lastIndexOf("/") + 1);
    for (const dependency of selected) {
      const resource = dependency.replaceAll("\\", "/");
      if (resource !== normalized && resource.startsWith(base))
        await modelViewerAttach(
          session.id,
          resource.slice(base.length),
          dependency,
        );
    }
  } catch (error) {
    await modelViewerClose(session.id);
    throw error;
  }
  const sizeOf = async (key: string) => {
    try {
      return await modelViewerSize(session.id, key);
    } catch (error) {
      if (hasCustomCode(error, "model:resource_missing")) return null;
      throw error;
    }
  };
  return {
    name: session.name,
    size: session.size,
    sizeOf,
    async read(key, signal, progress) {
      signal.throwIfAborted();
      const size = await sizeOf(key);
      if (size === null) throw new MissingResources([key]);
      if (size > MAX_IMPORT_BYTES) throw modelError("large");
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size; offset += 1024 * 1024) {
        signal.throwIfAborted();
        const chunk = await modelViewerRead(
          session.id,
          key,
          offset,
          Math.min(1024 * 1024, size - offset),
        );
        signal.throwIfAborted();
        bytes.set(chunk, offset);
        progress(offset + chunk.length, size);
      }
      return bytes;
    },
    async attach(key, file) {
      if (typeof file !== "string") throw modelError("invalid");
      await modelViewerAttach(session.id, key, file);
    },
    async close() {
      await modelViewerClose(session.id);
    },
  };
}
