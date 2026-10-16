import { describe, expect, it } from "vitest";

import type { TodoNoteDocument } from "~/bindings";

import { editorToNote, noteToEditor, readNoteClipboard } from "./note-document";

describe("待办备注文档适配", () => {
  it("图文与代码块保留空段、缩进及换行，不生成 HTML", () => {
    const document: TodoNoteDocument = {
      version: 2,
      blocks: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "说明\n第二行" }],
        },
        {
          type: "paragraph",
          content: [{ type: "image", assetId: "image-id" }],
        },
        { type: "codeBlock", text: '\tconst value = "<script>";\n\n' },
        { type: "paragraph", content: [] },
      ],
    };
    expect(editorToNote(noteToEditor(document))).toEqual(document);
  });

  it("空备注往返保持为空，不能提交处理中占位", () => {
    expect(editorToNote(noteToEditor({ version: 2, blocks: [] }))).toEqual({
      version: 2,
      blocks: [],
    });
    expect.assertions(2);
    try {
      editorToNote({
        type: "doc",
        content: [{ type: "imageImport", attrs: { id: "pending" } }],
      });
    } catch (error) {
      expect(error).toMatchObject({ payload: { code: "todo:note_invalid" } });
    }
  });

  it("只接受受限的应用内剪贴板文档", () => {
    const value = {
      itemId: "source",
      draftId: "draft",
      document: {
        version: 2,
        blocks: [
          { type: "paragraph", content: [{ type: "text", text: "选中文字" }] },
        ],
      },
    };
    expect(readNoteClipboard(JSON.stringify(value))).toEqual(value);
    expect(
      readNoteClipboard(
        JSON.stringify({
          ...value,
          document: {
            version: 2,
            blocks: [
              {
                type: "paragraph",
                content: [{ type: "image", assetId: "forged" }],
              },
            ],
          },
        }),
      ),
    ).toBeNull();
    expect(
      readNoteClipboard(
        JSON.stringify({ ...value, document: { version: 3, blocks: [] } }),
      ),
    ).toBeNull();
    expect(readNoteClipboard(" ".repeat(256_001))).toBeNull();
    expect(readNoteClipboard("{}")).toBeNull();
  });
});
