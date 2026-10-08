import { IpcError, toIpcError } from "~/lib/errors";
import {
  modelEnvironmentAbort,
  modelEnvironmentBegin,
  modelEnvironmentClear,
  modelEnvironmentCommit,
  modelEnvironmentCurrent,
  modelEnvironmentRead,
  modelEnvironmentWrite,
} from "~/lib/ipc";

import { modelError } from "../domain/errors";

const CHUNK = 1024 * 1024;
// 跨页面串行提交，旧页面的在途保存不能晚于新页面的清除落库。
let writes: Promise<unknown> = Promise.resolve();

function enqueue(work: () => Promise<void>) {
  const result = writes.then(work, work);
  writes = result.catch(() => {});
  return result;
}

export function saveEnvironment(file: File | null, signal: AbortSignal) {
  return enqueue(async () => {
    signal.throwIfAborted();
    if (!file) {
      await modelEnvironmentClear();
      return;
    }
    if (!file.size || file.size > 32 * CHUNK) throw modelError("invalid");
    const id = await modelEnvironmentBegin(file.name, file.size);
    try {
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(
          await file.slice(offset, offset + CHUNK).arrayBuffer(),
        );
        signal.throwIfAborted();
        await modelEnvironmentWrite(id, offset, Array.from(bytes));
      }
      signal.throwIfAborted();
      await modelEnvironmentCommit(id);
    } catch (error) {
      try {
        await modelEnvironmentAbort(id);
      } catch (cleanup) {
        const primary = toIpcError(error);
        throw new IpcError({
          ...primary.payload,
          args: {
            ...primary.payload.args,
            cleanupCode: toIpcError(cleanup).payload.code,
          },
        });
      }
      throw error;
    }
  });
}

export async function readEnvironment(
  signal: AbortSignal,
): Promise<File | null> {
  await writes;
  signal.throwIfAborted();
  const current = await modelEnvironmentCurrent();
  signal.throwIfAborted();
  if (!current) return null;
  if (!current.size || current.size > 32 * CHUNK) throw modelError("invalid");
  const bytes = new Uint8Array(current.size);
  for (let offset = 0; offset < current.size; offset += CHUNK) {
    const chunk = await modelEnvironmentRead(current.id, offset);
    signal.throwIfAborted();
    if (chunk.length !== Math.min(CHUNK, current.size - offset))
      throw modelError("invalid");
    bytes.set(chunk, offset);
  }
  return new File([bytes], current.name);
}
