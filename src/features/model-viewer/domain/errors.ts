import { frontendError, IpcError } from "~/lib/errors";

export function modelError(
  code:
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
