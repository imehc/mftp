import { frontendError, IpcError } from "~/lib/errors";

export function modelError(
  code:
    | "attachment_invalid"
    | "system_open"
    | "capture"
    | "recording_unsupported"
    | "recording_failed"
    | "recording_limit"
    | "recording_save"
    | "export"
    | "export_invalid"
    | "export_mobile_only"
    | "invalid"
    | "unsupported"
    | "unsafe"
    | "large"
    | "decode"
    | "webgl"
    | "analysis_limit",
) {
  return new IpcError(frontendError(`model:${code}`, `Model viewer: ${code}`));
}

export class MissingResources extends Error {
  constructor(readonly paths: string[]) {
    super("Model resources require explicit selection");
  }
}
