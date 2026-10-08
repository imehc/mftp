import { modelError } from "../domain/errors";

export interface GltfDocument {
  asset: { version: string };
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    extensions?: unknown;
  }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  animations?: { name?: string }[];
}

export function parseDocument(bytes: Uint8Array<ArrayBuffer>): {
  json: GltfDocument;
  binary?: Uint8Array<ArrayBuffer>;
} {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let raw = bytes;
    let binary: Uint8Array<ArrayBuffer> | undefined;
    if (bytes.byteLength >= 4 && view.getUint32(0, true) === 0x46546c67) {
      if (
        bytes.length < 20 ||
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== bytes.length
      )
        throw modelError("invalid");
      let jsonFound = false;
      for (let offset = 12; offset < bytes.length;) {
        if (offset + 8 > bytes.length) throw modelError("invalid");
        const length = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        if (length % 4 || offset + 8 + length > bytes.length)
          throw modelError("invalid");
        const chunk = bytes.subarray(offset + 8, offset + 8 + length);
        if (!jsonFound) {
          if (type !== 0x4e4f534a) throw modelError("invalid");
          raw = chunk;
          jsonFound = true;
        } else if (type === 0x004e4942) {
          if (binary) throw modelError("invalid");
          binary = chunk;
        } else if (type === 0x4e4f534a) throw modelError("invalid");
        offset += 8 + length;
      }
      if (!jsonFound) throw modelError("invalid");
    }
    const json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    ) as GltfDocument;
    if (!json || json.asset?.version !== "2.0") throw modelError("invalid");
    for (const list of [json.buffers, json.bufferViews, json.images]) {
      if (
        Array.isArray(list) &&
        list.some(
          (item) => !item || typeof item !== "object" || Array.isArray(item),
        )
      )
        throw modelError("invalid");
      if (list !== undefined && !Array.isArray(list))
        throw modelError("invalid");
    }
    return { json, binary };
  } catch {
    throw modelError("invalid");
  }
}
