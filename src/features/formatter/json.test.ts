import { describe, expect, it } from "vitest";
import {
  escapeJsonString,
  formatJson,
  minifyJson,
  sortJsonKeys,
  unescapeJsonString,
  validateJson,
} from "./json";

describe("格式化操作", () => {
  it("格式化及压缩保留 Unicode 和嵌套数据", () => {
    const input = '{"name":"诗词😀","items":[1,{"ok":true}]}';
    const formatted = formatJson(input, { indent: "    " });
    expect(formatted.ok).toBe(true);
    if (formatted.ok)
      expect(minifyJson(formatted.value)).toEqual({ ok: true, value: input });
  });
  it("无效输入返回错误，不产生替换文档", () => {
    for (const result of [
      validateJson('{"a":}'),
      formatJson('{"a":}', { indent: "  " }),
      minifyJson('{"a":}'),
    ])
      expect(result.ok).toBe(false);
  });
  it("升降序递归排序且保留特殊键", () => {
    const input = '{"z":1,"__proto__":{"b":2,"a":1},"a":[{"z":1,"a":2}]}';
    const asc = sortJsonKeys(input, { indent: "" }, "asc");
    expect(asc).toEqual({
      ok: true,
      value: '{"__proto__":{"a":1,"b":2},"a":[{"a":2,"z":1}],"z":1}',
    });
    const desc = sortJsonKeys('{"a":1,"z":2}', { indent: "" }, "desc");
    expect(desc).toEqual({ ok: true, value: '{"z":2,"a":1}' });
  });
  it("转义与还原保留文档内容", () => {
    const input = '{"name":"诗词","newline":"a\\nb"}';
    const escaped = escapeJsonString(input);
    expect(escaped.ok).toBe(true);
    if (escaped.ok)
      expect(unescapeJsonString(escaped.value)).toEqual({
        ok: true,
        value: input,
      });
    expect(unescapeJsonString("bad\\q").ok).toBe(false);
  });
});
