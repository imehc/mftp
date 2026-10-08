import { MissingResources, modelError } from "../domain/errors";
import type { ModelSource } from "../domain/types";
import { isModelName } from "./paths";

export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

export function browserSource(files: File[], selected?: File): ModelSource {
  const entries = files.filter((file) => isModelName(file.name));
  if (!selected && entries.length !== 1) throw modelError("unsupported");
  const entry = selected ?? entries[0];
  if (!entries.includes(entry)) throw modelError("unsupported");
  const entryPath = entry.webkitRelativePath || entry.name;
  const base = entryPath.slice(0, entryPath.lastIndexOf("/") + 1);
  const resources = new Map<string, File>();
  const ambiguous = new Set<string>();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (!path.startsWith(base)) continue;
    const key = path.slice(base.length);
    // 重名不静默覆盖；缺依赖面板让用户明确把文件映射到目标路径。
    if (resources.has(key) || ambiguous.has(key)) {
      resources.delete(key);
      ambiguous.add(key);
      continue;
    }
    resources.set(key, file);
  }
  resources.set("", entry);
  let closed = false;
  return {
    name: entry.name,
    size: entry.size,
    async sizeOf(key) {
      return resources.get(key)?.size ?? null;
    },
    async read(key, signal, progress) {
      signal.throwIfAborted();
      const file = resources.get(key);
      if (closed || !file) throw new MissingResources([key]);
      if (file.size > MAX_IMPORT_BYTES) throw modelError("large");
      const bytes = new Uint8Array(file.size);
      // 分片读取让取消可在大文件读取期间生效，也避免额外整文件副本。
      for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
        signal.throwIfAborted();
        const chunk = await file
          .slice(offset, offset + 1024 * 1024)
          .arrayBuffer();
        signal.throwIfAborted();
        bytes.set(new Uint8Array(chunk), offset);
        progress(offset + chunk.byteLength, file.size);
      }
      return bytes;
    },
    async attach(key, file) {
      if (closed || typeof file === "string") throw modelError("invalid");
      resources.set(key, file);
    },
    async close() {
      closed = true;
      resources.clear();
    },
  };
}
