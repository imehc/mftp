import type { TodoNoteImageInfo } from "~/bindings";
import { todoNoteImageRead } from "~/lib/ipc";

import { noteError } from "./note-document";

export interface NoteImageScope {
  itemId: string | null;
  draftId: string | null;
}

export interface LoadedNoteImage {
  image: TodoNoteImageInfo;
  blob: Blob;
  url: string;
}

interface CacheEntry {
  promise: Promise<LoadedNoteImage>;
  refs: number;
  value?: LoadedNoteImage;
}

export function imageBlob(dataBase64: string, mimeType: string): Blob {
  return new Blob(
    [Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0))],
    { type: mimeType },
  );
}

export function createNoteImageCache(read = todoNoteImageRead) {
  const entries = new Map<string, CacheEntry>();
  let generation = 0;

  function evict() {
    let bytes = [...entries.values()].reduce(
      (sum, entry) => sum + (entry.value?.blob.size ?? 0),
      0,
    );
    for (const [key, entry] of entries) {
      if (entries.size <= 64 && bytes <= 12_000_000) break;
      if (entry.refs || !entry.value) continue;
      URL.revokeObjectURL(entry.value.url);
      bytes -= entry.value.blob.size;
      entries.delete(key);
    }
  }

  function acquire(assetId: string, scope: NoteImageScope, thumbnail = false) {
    const key = JSON.stringify([
      scope.itemId,
      scope.draftId,
      assetId,
      thumbnail,
    ]);
    let entry = entries.get(key);
    if (!entry) {
      const currentGeneration = generation;
      const created: CacheEntry = {
        refs: 0,
        promise: read(assetId, scope.itemId, scope.draftId, thumbnail)
          .then((data) => {
            if (generation !== currentGeneration)
              throw noteError("todo:note_draft_closed");
            const blob = imageBlob(data.dataBase64, data.image.mimeType);
            const value = {
              image: data.image,
              blob,
              url: URL.createObjectURL(blob),
            };
            created.value = value;
            if (!created.refs) {
              URL.revokeObjectURL(value.url);
              if (entries.get(key) === created) entries.delete(key);
            }
            return value;
          })
          .catch((error: unknown) => {
            if (entries.get(key) === created) entries.delete(key);
            throw error;
          }),
      };
      entry = created;
    }
    entries.delete(key);
    entries.set(key, entry);
    entry.refs++;
    evict();
    let released = false;
    return {
      promise: entry.promise,
      release() {
        if (released) return;
        released = true;
        entry.refs--;
        // 草稿的 URL 不跨会话缓存；正式图片仅在有界页面缓存内复用。
        if (!entry.refs && scope.draftId && entry.value) {
          URL.revokeObjectURL(entry.value.url);
          if (entries.get(key) === entry) entries.delete(key);
        }
        evict();
      },
    };
  }

  function dispose() {
    generation++;
    for (const entry of entries.values()) {
      if (entry.value) URL.revokeObjectURL(entry.value.url);
    }
    entries.clear();
  }

  return { acquire, dispose };
}

export type NoteImageCache = ReturnType<typeof createNoteImageCache>;
