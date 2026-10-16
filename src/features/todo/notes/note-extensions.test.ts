// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createTodoNoteExtensions } from "./note-extensions";

let editor: Editor | null = null;

function createEditor(content: Editor["options"]["content"] = "") {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: createTodoNoteExtensions(),
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("待办备注最小编辑器", () => {
  it("只注册文本、换行、图片和代码块节点，不注册格式标记", () => {
    const current = createEditor();
    expect(Object.keys(current.schema.nodes).sort()).toEqual([
      "codeBlock",
      "doc",
      "hardBreak",
      "image",
      "paragraph",
      "text",
    ]);
    expect(Object.keys(current.schema.marks)).toEqual([]);
  });

  it("保留中文文本和代码块中的缩进、换行与类 HTML 内容", () => {
    const code =
      'const 内容 = "<script>不是可执行页面</script>";\n\treturn 内容;\n';
    const current = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "普通中文" }] },
        { type: "codeBlock", content: [{ type: "text", text: code }] },
      ],
    });
    expect(current.getJSON().content?.[1]).toMatchObject({
      type: "codeBlock",
      content: [{ type: "text", text: code }],
    });
    expect(current.getText({ blockSeparator: "\n" })).toBe(`普通中文\n${code}`);
    expect(current.view.dom.querySelector("script")).toBeNull();
    expect(current.view.dom.querySelector("pre code")?.textContent).toBe(code);
  });

  it("图片状态只保存资源标识，不包含本机路径或临时地址", () => {
    const current = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                assetId: "asset-1",
                src: "blob:temporary-preview",
                title: "/Users/private/source.png",
              },
            },
          ],
        },
      ],
    });
    expect(current.getJSON().content?.[0].content?.[0]).toEqual({
      type: "image",
      attrs: { assetId: "asset-1" },
    });
    expect(current.getHTML()).not.toContain("blob:");
    expect(current.getHTML()).not.toContain("/Users/");
  });

  it("外部富文本降为允许的文本，不导入远程图片或格式标记", () => {
    const current = createEditor(
      '<h1>标题</h1><p><b>粗体</b><a href="javascript:alert(1)">链接</a></p>' +
        '<img src="https://example.invalid/tracking.png">' +
        '<img src="data:image/png;base64,untrusted">' +
        '<div data-todo-image="forged-asset-id"></div>',
    );
    expect(current.getText()).toContain("粗体链接");
    expect(current.getHTML()).not.toMatch(/<img|href=|<h1|<b>|forged-asset/);
    expect(
      current.getJSON().content?.some((node) => node.type === "image"),
    ).toBe(false);
  });

  it("将普通文本切换为代码块后能退出并继续输入", () => {
    const current = createEditor("<p>let value = 1;</p>");
    expect(current.commands.setCodeBlock()).toBe(true);
    expect(current.isActive("codeBlock")).toBe(true);
    current.commands.setTextSelection(current.state.doc.content.size - 1);
    expect(current.commands.exitCode()).toBe(true);
    expect(current.isActive("paragraph")).toBe(true);
    current.commands.insertContent("后续文字");
    expect(current.getJSON().content?.map((node) => node.type)).toEqual([
      "codeBlock",
      "paragraph",
    ]);
    expect(current.getText()).toContain("后续文字");
  });

  it("同一事务插入图文和代码块后可以完整撤销重做", () => {
    const current = createEditor();
    current.commands.insertContent([
      { type: "paragraph", content: [{ type: "text", text: "说明" }] },
      {
        type: "paragraph",
        content: [{ type: "image", attrs: { assetId: "first" } }],
      },
      { type: "codeBlock", content: [{ type: "text", text: "print(1)" }] },
      {
        type: "paragraph",
        content: [{ type: "image", attrs: { assetId: "second" } }],
      },
    ]);
    const saved = current.getJSON();
    expect(current.commands.undo()).toBe(true);
    expect(current.getText()).toBe("");
    expect(current.commands.redo()).toBe(true);
    expect(current.getJSON()).toEqual(saved);
    expect(
      saved.content
        ?.flatMap((node) => node.content ?? [])
        .filter((node) => node.type === "image")
        .map((node) => ("attrs" in node ? node.attrs?.assetId : undefined)),
    ).toEqual(["first", "second"]);
  });

  it("图文同段时退格与删除键一次删除相邻图片，并支持撤销恢复", () => {
    const current = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "前" },
            { type: "image", attrs: { assetId: "image" } },
            { type: "text", text: "后" },
          ],
        },
      ],
    });
    const original = current.getJSON();
    current.commands.setTextSelection(3);
    expect(current.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(current.getText()).toBe("前后");
    expect(current.getJSON().content?.[0].content).toEqual([
      { type: "text", text: "前后" },
    ]);
    expect(current.commands.undo()).toBe(true);
    expect(current.getJSON()).toEqual(original);
    current.commands.setTextSelection(2);
    expect(current.commands.keyboardShortcut("Delete")).toBe(true);
    expect(current.getJSON().content?.[0].content).toEqual([
      { type: "text", text: "前后" },
    ]);
    expect(current.commands.undo()).toBe(true);
    expect(current.getJSON()).toEqual(original);
    current.commands.setTextSelection({ from: 1, to: 4 });
    current.commands.deleteSelection();
    expect(current.getText()).toBe("");
    expect(current.commands.undo()).toBe(true);
    expect(current.getJSON()).toEqual(original);
  });
});
