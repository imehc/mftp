import type { ModelExportAction, ModelExportOutcome } from "~/bindings";
import { IpcError, toIpcError } from "~/lib/errors";
import { downloadBlob, isTauriRuntime } from "~/lib/files";
import {
  modelExportBegin,
  modelExportCancel,
  modelExportClose,
  modelExportPresent,
  modelExportWrite,
} from "~/lib/ipc";
import { isMobilePlatform } from "~/lib/platform";

import { modelError } from "../domain/errors";

export async function exportBlob(
  blob: Blob,
  name: string,
  action: ModelExportAction,
  signal: AbortSignal,
): Promise<ModelExportOutcome> {
  if (signal.aborted) return "cancelled";
  if (!isTauriRuntime() || !isMobilePlatform()) {
    if (action === "share") throw modelError("export_mobile_only");
    return (await downloadBlob(blob, name, signal)) === false
      ? "cancelled"
      : "saved";
  }
  if (!blob.size || blob.size > 64 * 1024 * 1024)
    throw modelError("export_invalid");
  const id = await modelExportBegin(name, blob.size);
  let failure: unknown;
  let cleanupFailure: unknown;
  let outcome: ModelExportOutcome = "cancelled";
  let cancellation: Promise<void> | undefined;
  let presenting = false;

  const cancel = () => {
    if (presenting)
      cancellation = modelExportCancel(id).catch((error) => {
        cleanupFailure = error;
      });
  };

  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (
      let offset = 0;
      offset < blob.size && !signal.aborted;
      offset += 1024 * 1024
    ) {
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      );
      if (signal.aborted) break;
      await modelExportWrite(id, offset, Array.from(bytes));
    }
    if (!signal.aborted) {
      presenting = true;
      outcome = await modelExportPresent(id, action);
    }
  } catch (error) {
    failure = error;
  } finally {
    signal.removeEventListener("abort", cancel);
    await cancellation;
    try {
      await modelExportClose(id);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (failure) {
    const primary = toIpcError(failure);
    if (cleanupFailure)
      throw new IpcError({
        ...primary.payload,
        args: {
          ...primary.payload.args,
          cleanupCode: toIpcError(cleanupFailure).payload.code,
        },
      });
    throw primary;
  }
  if (cleanupFailure) throw toIpcError(cleanupFailure);
  return signal.aborted ? "cancelled" : outcome;
}
