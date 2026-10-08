import type { AppError } from "~/bindings";

// FBX 同步解析仅在独立 Worker 中运行；文件、展开数据和对象数量分别设限。
export const FBX_FILE_LIMIT = 64 * 1024 * 1024;

export const FBX_BUFFER_LIMIT = 128 * 1024 * 1024;

export const FBX_NODE_LIMIT = 2000;

export const FBX_TEXTURE_LIMIT = 64;

export const FBX_PIXEL_LIMIT = 32 * 1024 * 1024;

export const FBX_PARSE_TIMEOUT = 30_000;

export function fbxError(
  code:
    "invalid" | "unsafe" | "decode" | "fbx_limit" | "fbx_texture" | "fbx_unit",
): AppError {
  return {
    kind: "external",
    code: `model:${code}`,
    message: `FBX import: ${code}`,
    args: {},
  };
}

export function fbxResourcePath(reference: string) {
  const path = reference.replaceAll("\\", "/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes(":") ||
    [...path].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw fbxError("unsafe");
  const parts = path.split("/");
  if (parts.includes("..")) throw fbxError("unsafe");
  const key = parts.filter((part) => part && part !== ".").join("/");
  if (!key || key.length > 4096) throw fbxError("unsafe");
  // FBX 引用是文件名而非 URI；百分号保留原义，不能重复解码或按 basename 猜测。
  return key;
}

export function fbxTextureType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    bmp: "image/bmp",
  };
  const type = extension ? types[extension] : undefined;
  if (!type) throw fbxError("fbx_texture");
  return type;
}
