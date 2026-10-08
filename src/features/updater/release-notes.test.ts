import { expect, it } from "vitest";

import { parseReleaseNotes, prepareReleaseNotes } from "./release-notes";

it("长日志有明确截断标记，换行规范化不误报截断", () => {
  expect(prepareReleaseNotes("one\r\ntwo")).toEqual({
    text: "one\ntwo",
    truncated: false,
  });
  const lines = prepareReleaseNotes(Array(501).fill("item").join("\n"));
  expect(lines.truncated).toBe(true);
  expect(parseReleaseNotes(lines.text)).toHaveLength(500);
  const text = prepareReleaseNotes("x".repeat(32_001));
  expect(text.text).toHaveLength(32_000);
  expect(text.truncated).toBe(true);
});

it("保留标题、普通说明与超过八条的更新条目", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `- fix: 改进 ${index}`,
  );
  const result = parseReleaseNotes(
    ["## 本次更新", "适用于桌面版本。", ...lines].join("\n"),
  );
  expect(result).toHaveLength(14);
  expect(result[0]).toEqual({ kind: "heading", text: "本次更新" });
  expect(result[1]).toEqual({ kind: "paragraph", text: "适用于桌面版本。" });
  expect(result[13]).toEqual({ kind: "item", text: "改进 11" });
});

it("HTML、外部链接和代码内容仅保留为展示文本", () => {
  const result = parseReleaseNotes(
    "- **重点**：`path`\n[链接](javascript:alert)\n<img src=x onerror=alert(1)>",
  );
  expect(result.map((note) => note.text)).toEqual([
    "重点：path",
    "链接 (javascript:alert)",
    "<img src=x onerror=alert(1)>",
  ]);
});
