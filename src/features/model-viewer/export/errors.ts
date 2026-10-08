import { toIpcError } from "~/lib/errors";

import { modelError } from "../domain/errors";

export function exportError(
  error: unknown,
  fallback: Parameters<typeof modelError>[0],
) {
  const parsed = toIpcError(error).payload;
  return parsed.kind === "custom" ||
    !["legacy:raw", "frontend:error", "frontend:unknown"].includes(parsed.code)
    ? parsed
    : modelError(fallback).payload;
}
