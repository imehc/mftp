import { i18n } from "@lingui/core";
import { expect, it } from "vitest";

import { decodeDataUri } from "./data-uri";

i18n.loadAndActivate({ locale: "zh-CN", messages: {} });

it("解码两种数据 URI 形式中的任意二进制字节", () => {
  expect(decodeDataUri("data:application/octet-stream,%00%FF%20a", 4)).toEqual(
    new Uint8Array([0, 255, 32, 97]),
  );
  expect(decodeDataUri("data:;base64,AQID", 3)).toEqual(
    new Uint8Array([1, 2, 3]),
  );
});

it("拒绝格式错误的编码和超出预算的分配", () => {
  expect(() => decodeDataUri("data:,abc%zz", 10)).toThrow();
  expect(() => decodeDataUri("data:,abcd", 3)).toThrow();
  expect(() => decodeDataUri("data:;base64,AQID", 2)).toThrow();
});
