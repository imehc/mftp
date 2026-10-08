import { modelError } from "../domain/errors";
import { modelExtension } from "../domain/formats";

/** URI 只解码一次；文件名中的百分号不应再次被解释为路径分隔符。 */
export function resourcePath(uri: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(uri) || /[?#\\]/.test(uri))
    throw modelError("unsafe");
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw modelError("unsafe");
  }
  if (
    decoded.startsWith("/") ||
    /[\\:]/.test(decoded) ||
    [...decoded].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw modelError("unsafe");
  const parts: string[] = [];
  for (const part of decoded.split("/")) {
    if (part === "..") throw modelError("unsafe");
    if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw modelError("unsafe");
  return parts.join("/");
}

export function isModelName(name: string) {
  return modelExtension(name) !== null;
}
