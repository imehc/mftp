import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64";

describe("Base64 文本工作区", () => {
  it("中文和 emoji 在编码、互换解码后保持原文", () => {
    const input = "古诗词 · 明月 🌕";
    const encoded = encodeBase64(input);
    expect(encoded.ok).toBe(true);
    if (encoded.ok)
      expect(decodeBase64(encoded.value)).toEqual({ ok: true, value: input });
  });
  it("URL 安全模式省略填充并支持反向解码", () => {
    const encoded = encodeBase64("😀??", "url-safe");
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      expect(encoded.value).not.toMatch(/[+/=]/);
      expect(decodeBase64(encoded.value, "url-safe")).toEqual({
        ok: true,
        value: "😀??",
      });
    }
  });
  it("无效输入返回错误而非残留上次结果", () => {
    expect(decodeBase64("###")).toEqual({ ok: false, error: "invalid-base64" });
    expect(decodeBase64("A")).toEqual({ ok: false, error: "invalid-base64" });
    expect(decodeBase64("")).toEqual({ ok: true, value: "" });
  });
});
