import { describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { resourcePath } from "./paths";
i18n.loadAndActivate({ locale: "zh-CN", messages: {} });

describe("模型资源 URI 边界", () => {
  it("保留目录标识并只解码一次 Unicode", () => {
    expect(resourcePath("./textures/%E4%B8%AD%E6%96%87%20a.png")).toBe(
      "textures/中文 a.png",
    );
    expect(resourcePath("a/%252e%252e.png")).toBe("a/%2e%2e.png");
    expect(resourcePath("a/picture%23one.png")).toBe("a/picture#one.png");
    expect(resourcePath("b/picture.png")).not.toBe(
      resourcePath("a/picture.png"),
    );
  });
  it.each([
    "../secret",
    "a/../secret",
    "%2e%2e/secret",
    "/root",
    "//host/file",
    "https://host/a",
    "file:///tmp/a",
    "blob:other",
    "a\\b",
    "C:/file",
    "a/%00.png",
    "%zz",
    "",
    "a?x",
    "a#x",
    "a/%5c../x",
  ])("rejects %s", (uri) => {
    expect(() => resourcePath(uri)).toThrow();
  });
});
