import { modelError } from "../domain/errors";

/** glTF 内嵌资源既可使用 base64，也可使用逐字节 URI 转义。 */
export function decodeDataUri(
  uri: string,
  budget: number,
): Uint8Array<ArrayBuffer> {
  const separator = uri.indexOf(",");
  if (!uri.startsWith("data:") || separator < 5) throw modelError("invalid");
  const header = uri.slice(5, separator);
  const encoded = uri.slice(separator + 1);
  if (header.endsWith(";base64")) {
    if (Math.ceil((encoded.length * 3) / 4) > budget) throw modelError("large");
    try {
      return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
      throw modelError("invalid");
    }
  }
  // 先核对实际字节数，再分配，避免百分号转义造成不必要的大副本。
  let length = 0;
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === "%") {
      if (!/^[\da-f]{2}$/i.test(encoded.slice(index + 1, index + 3)))
        throw modelError("invalid");
      index += 2;
    } else if (encoded.charCodeAt(index) > 127) throw modelError("invalid");
    if (++length > budget) throw modelError("large");
  }
  const bytes = new Uint8Array(length);
  let output = 0;
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === "%") {
      bytes[output++] = parseInt(encoded.slice(index + 1, index + 3), 16);
      index += 2;
    } else bytes[output++] = encoded.charCodeAt(index);
  }
  return bytes;
}
