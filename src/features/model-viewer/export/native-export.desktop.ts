import type { ModelExportAction, ModelExportOutcome } from "~/bindings";
import { downloadBlob } from "~/lib/files";

import { modelError } from "../domain/errors";

export async function exportBlob(
  blob: Blob,
  name: string,
  action: ModelExportAction,
  signal: AbortSignal,
): Promise<ModelExportOutcome> {
  if (signal.aborted) return "cancelled";
  if (action === "share") throw modelError("export_mobile_only");
  return (await downloadBlob(blob, name, signal)) === false
    ? "cancelled"
    : "saved";
}
