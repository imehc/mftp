// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { notePasteContent } from "./note-paste";

function data(text: string, html = ""): DataTransfer {
  return {
    getData: (type: string) =>
      type === "text/plain" ? text : type === "text/html" ? html : "",
  } as DataTransfer;
}

describe("外部图文剪贴板转换", () => {
  it("文字与多张图片按原顺序留在同一段，不保留外部地址或可执行标记", () => {
    const files = [new File(["a"], "a.png"), new File(["b"], "b.png")];
    const paste = notePasteContent(
      data(
        "前中后",
        '<p>前<img src="https://example.invalid/a.png" onerror="alert(1)">中<img src="file:///private/b.png">后<script>alert(1)</script></p>',
      ),
      files,
    );
    expect(paste.sources).toEqual(files);
    expect(paste.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "前" },
          { type: "clipboardImage", attrs: { index: 0 } },
          { type: "text", text: "中" },
          { type: "clipboardImage", attrs: { index: 1 } },
          { type: "text", text: "后" },
        ],
      },
    ]);
    expect(JSON.stringify(paste.content)).not.toMatch(
      /https:|file:|onerror|alert/,
    );
  });

  it("只有图片时不把辅助网址当作正文，原生读取在导入时才发生", () => {
    const native = vi.fn();
    const paste = notePasteContent(
      data(
        "https://example.invalid/a",
        '<img src="https://example.invalid/a">',
      ),
      [],
      native,
    );
    expect(native).not.toHaveBeenCalled();
    expect(paste.sources).toEqual([native]);
    expect(paste.content[0].content).toEqual([
      { type: "clipboardImage", attrs: { index: 0 } },
    ]);
  });

  it("没有 HTML 时保留文字换行，图片紧接在文字之后", () => {
    const file = new File(["image"], "a.png");
    const paste = notePasteContent(data("前\n后"), [file]);
    expect(paste.content[0].content).toEqual([
      { type: "text", text: "前" },
      { type: "hardBreak" },
      { type: "text", text: "后" },
      { type: "clipboardImage", attrs: { index: 0 } },
    ]);
  });
});
