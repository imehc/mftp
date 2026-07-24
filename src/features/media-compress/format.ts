export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function baseName(pathOrName: string): string {
  const parts = pathOrName.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? pathOrName;
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Browser fallback: <a download> (works in normal browsers, not always in WebView). */
function downloadBlobInBrowser(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Save a blob to disk. In Tauri, open a native save dialog and write bytes
 * (WebView often ignores the HTML download attribute).
 * Returns the actual bytes written on disk, or false if the user cancelled.
 */
export async function downloadBlob(
  blob: Blob,
  fileName: string,
): Promise<number | false> {
  if (!isTauriRuntime()) {
    downloadBlobInBrowser(blob, fileName);
    return blob.size;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile, stat } = await import("@tauri-apps/plugin-fs");

  const target = await save({
    defaultPath: fileName,
    title: fileName,
  });
  if (typeof target !== "string" || !target) {
    return false;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(target, bytes);

  // Read back actual on-disk size (filesystem block alignment may differ).
  try {
    const info = await stat(target);
    return info.size;
  } catch {
    return bytes.length;
  }
}

/** Positive = smaller than original; negative = larger. null if unknown. */
export function sizeDeltaPercent(
  originalBytes: number,
  resultBytes: number,
): number | null {
  if (
    !Number.isFinite(originalBytes) ||
    !Number.isFinite(resultBytes) ||
    originalBytes <= 0
  ) {
    return null;
  }
  return Math.round(((originalBytes - resultBytes) / originalBytes) * 100);
}
