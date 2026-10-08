import { baseName, stripExtension } from "~/lib/files";

export function exportFileName(
  name: string,
  extension: "png" | "mp4" | "webm",
) {
  const stem =
    stripExtension(baseName(name))
      .replace(/[<>:"/\\|?*]/g, "_")
      .split("")
      .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("")
      .slice(0, 48)
      .trim() || "model";
  return `${stem}-${Date.now()}.${extension}`;
}
