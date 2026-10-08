import { i18n } from "@lingui/core";
import { expect, it } from "vitest";

import { parseDocument } from "./document";

i18n.loadAndActivate({ locale: "zh-CN", messages: {} });

function glb(json: object, binary?: Uint8Array) {
  const text = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(
    text.padEnd(Math.ceil(text.length / 4) * 4),
  );
  const bytes = new Uint8Array(
    20 + jsonBytes.length + (binary ? 8 + binary.length : 0),
  );
  const view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, jsonBytes.length, 0x4e4f534a].forEach((v, i) =>
    view.setUint32(i * 4, v, true),
  );
  bytes.set(jsonBytes, 20);
  if (binary) {
    const offset = 20 + jsonBytes.length;
    view.setUint32(offset, binary.length, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    bytes.set(binary, offset + 8);
  }
  return bytes;
}

it("读取 glTF JSON 和 GLB 二进制数据块且不复制内容", () => {
  const document = { asset: { version: "2.0" } };
  expect(
    parseDocument(new TextEncoder().encode(JSON.stringify(document))).json,
  ).toEqual(document);
  const bytes = glb(document, new Uint8Array([1, 2, 3, 4]));
  const parsed = parseDocument(bytes);
  expect(parsed.json).toEqual(document);
  expect(parsed.binary).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(parsed.binary?.buffer).toBe(bytes.buffer);
});

it("拒绝被截断的数据块、长度不一致和不支持的版本", () => {
  const bytes = glb({ asset: { version: "2.0" } });
  expect(() => parseDocument(bytes.slice(0, -1))).toThrow();
  new DataView(bytes.buffer).setUint32(12, 0xfffffffc, true);
  expect(() => parseDocument(bytes)).toThrow();
  expect(() =>
    parseDocument(new TextEncoder().encode('{"asset":{"version":"1.0"}}')),
  ).toThrow();
  expect(() =>
    parseDocument(new TextEncoder().encode("not a model")),
  ).toThrow();
});
