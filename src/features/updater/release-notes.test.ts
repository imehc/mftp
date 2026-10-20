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

it("保留标题、普通说明与超过八条的更新条目，移除提交类型前缀", () => {
  const types = ["feat", "fix(updater)", "perf!", "refactor(core)!"];
  const lines = Array.from(
    { length: 12 },
    (_, index) => `- ${types[index % types.length]}: 改进 ${index}`,
  );
  const result = parseReleaseNotes(
    ["## 本次更新", "适用于桌面版本。", ...lines].join("\n"),
  );
  expect(result).toHaveLength(14);
  expect(result[0]).toEqual({ kind: "heading", text: "本次更新" });
  expect(result[1]).toEqual({ kind: "paragraph", text: "适用于桌面版本。" });
  expect(result.slice(2)).toEqual(
    Array.from({ length: 12 }, (_, index) => ({
      kind: "item",
      text: `改进 ${index}`,
    })),
  );
});

it("仅展示业务与样式类提交，隐藏其他提交类型并保留普通说明", () => {
  const result = parseReleaseNotes(
    [
      "- chore: 发布版本 (1111111)",
      "- chore(deps): 更新依赖 (2222222)",
      "- chore!: 调整构建 (3333333)",
      "- CHORE(tooling)!: 调整工具 (4444444)",
      "- **chore:** 清理配置 (5555555)",
      "- docs: 更新说明",
      "- docs(updater)!: 更新升级文档",
      "- TEST: 增加用例",
      "- test(updater): 增加更新测试",
      "- build: 调整打包",
      "- ci(release): 调整发布流程",
      "- style: 整理代码格式",
      "- revert: 回退提交",
      "fix: 隐藏 chore 提交 (6666666)",
      "- choreography: 保留普通内容",
      "Note: 保留带冒号的说明",
    ].join("\n"),
  );
  expect(result.map((note) => note.text)).toEqual([
    "整理代码格式",
    "回退提交",
    "隐藏 chore 提交 (6666666)",
    "choreography: 保留普通内容",
    "Note: 保留带冒号的说明",
  ]);
});

it("版本范围标题不展示，只保留具体更新条目", () => {
  expect(
    parseReleaseNotes(
      [
        "Changes since v0.2.3",
        "",
        "- feat: 新增离线翻译 (1111111)",
        "- fix: 修复上传失败 (2222222)",
      ].join("\n"),
    ).map((note) => note.text),
  ).toEqual(["新增离线翻译 (1111111)", "修复上传失败 (2222222)"]);
  expect(
    parseReleaseNotes("Initial release\n\n- feat: 首个版本").map(
      (note) => note.text,
    ),
  ).toEqual(["首个版本"]);
  expect(
    parseReleaseNotes("## 本次更新\n\n- feat: 保留自定义标题").map(
      (note) => note.text,
    ),
  ).toEqual(["本次更新", "保留自定义标题"]);
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
