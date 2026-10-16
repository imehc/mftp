// @vitest-environment happy-dom

import { Editor, Node } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoNoteClipboard, TodoNoteImageImport } from "~/bindings";

import { noteError } from "./note-document";
import { createTodoNoteExtensions } from "./note-extensions";
import { createNoteImports, type NoteImports } from "./note-imports";

const pendingNode = Node.create({
  name: "imageImport",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null } };
  },
  renderHTML() {
    return ["span"];
  },
});
let editor: Editor;
let imports: NoteImports;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function result(id: string): TodoNoteImageImport {
  return {
    image: { id, mimeType: "image/png", width: 1, height: 1, byteLength: 1 },
    compressed: false,
  };
}

function setup() {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [...createTodoNoteExtensions(), pendingNode],
  });
  const api = {
    import: vi.fn(async (_draft: string, encoded: string) => result(encoded)),
    copy: vi.fn(
      async (_draft: string, _item: string, id: string) =>
        result(`copy-${id}`).image,
    ),
    encode: vi.fn(async (file: File) => file.name),
    validate: vi.fn(async (_file: File) => {}),
    clipboard: vi.fn(
      async (
        _draft: string,
        _textOnly: boolean,
      ): Promise<TodoNoteClipboard> => ({ type: "empty" }),
    ),
  };
  imports = createNoteImports(editor, "draft", api);
  imports.start();
  return api;
}

function add(...names: string[]) {
  imports.insert(
    { version: 2, blocks: [] },
    names.map((name) => new File(["image"], name, { type: "image/png" })),
  );
}

afterEach(() => {
  imports?.stop();
  editor?.destroy();
});

describe("待办图片异步导入", () => {
  it("剪贴板预检不占位且保留门禁，插入位置随文字编辑定位", async () => {
    const api = setup();
    const pending = deferred<File | null>();
    imports.insert({ version: 2, blocks: [] }, [() => pending.promise]);
    expect(imports.store.getState().running).toBe(true);
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "imageImport"),
    ).toBe(false);
    expect(api.encode).not.toHaveBeenCalled();
    editor.commands.insertContentAt(0, {
      type: "paragraph",
      content: [{ type: "text", text: "先补充的文字" }],
    });
    pending.resolve(new File(["image"], "clipboard", { type: "image/png" }));
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    const nodes = editor.getJSON().content ?? [];
    expect(nodes[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "先补充的文字" }],
    });
    expect(
      "attrs" in nodes[1].content![0]
        ? nodes[1].content![0].attrs?.assetId
        : undefined,
    ).toBe("clipboard");
  });

  it("剪贴板读取中关闭或移除占位，迟到结果不发起编码与 IPC", async () => {
    const api = setup();
    const pending = deferred<File | null>();
    imports.insert({ version: 2, blocks: [] }, [() => pending.promise]);
    editor.commands.clearContent();
    imports.stop();
    pending.resolve(new File(["image"], "clipboard"));
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(api.encode).not.toHaveBeenCalled();
    expect(api.import).not.toHaveBeenCalled();
  });

  it("剪贴板结果超出文件预算时提示错误且不占位或编码", async () => {
    const api = setup();
    const file = new File(["image"], "clipboard");
    Object.defineProperty(file, "size", { value: 20_000_001 });
    imports.insert({ version: 2, blocks: [] }, [async () => file]);
    await vi.waitFor(() =>
      expect(imports.store.getState().error?.code).toBe(
        "todo:note_image_limit",
      ),
    );
    expect(api.encode).not.toHaveBeenCalled();
    expect(api.import).not.toHaveBeenCalled();
  });

  it("导入重试使用已读取图片，不重新读取可能变化的剪贴板", async () => {
    const api = setup();
    const read = vi.fn(async () => new File(["image"], "clipboard"));
    api.import.mockRejectedValueOnce(new Error("failed"));
    imports.insert({ version: 2, blocks: [] }, [read]);
    await vi.waitFor(() =>
      expect(imports.store.getState().jobs[0]?.status).toBe("failed"),
    );
    expect(read).toHaveBeenCalledTimes(1);
    imports.retry(imports.store.getState().jobs[0].id);
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(api.import).toHaveBeenCalledTimes(2);
  });

  it("先创建顺序占位并串行处理，多图保持插入顺序", async () => {
    const api = setup();
    const pending = deferred<TodoNoteImageImport>();
    api.import.mockImplementationOnce(() => pending.promise);
    add("first", "second");
    await vi.waitFor(() => expect(api.import).toHaveBeenCalledTimes(1));
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .filter((node) => node.type === "imageImport"),
    ).toHaveLength(2);
    pending.resolve(result("first"));
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .filter((node) => node.type === "image")
        .map((node) => ("attrs" in node ? node.attrs?.assetId : undefined)),
    ).toEqual(["first", "second"]);
  });

  it("删除占位不回填，实际 worker 退出前保留忙碌状态", async () => {
    const api = setup();
    const pending = deferred<TodoNoteImageImport>();
    api.import.mockImplementationOnce(() => pending.promise);
    add("first");
    await vi.waitFor(() => expect(api.import).toHaveBeenCalledTimes(1));
    editor.commands.clearContent();
    expect(imports.store.getState().running).toBe(true);
    pending.resolve(result("first"));
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "image"),
    ).toBe(false);
  });

  it("关闭后不复活图片也不继续排队中的第二次导入", async () => {
    const api = setup();
    const pending = deferred<TodoNoteImageImport>();
    api.import.mockImplementationOnce(() => pending.promise);
    add("first", "second");
    await vi.waitFor(() => expect(api.import).toHaveBeenCalledTimes(1));
    imports.stop();
    pending.resolve(result("first"));
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(api.import).toHaveBeenCalledTimes(1);
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "image"),
    ).toBe(false);
  });

  it("任务失败发布新的节点快照，旧订阅快照不被原地修改", async () => {
    const api = setup();
    let fail!: (error: unknown) => void;
    api.import.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    add("first");
    await vi.waitFor(() => expect(api.import).toHaveBeenCalledTimes(1));
    const processing = imports.store.getState().jobs[0];
    expect(processing.status).toBe("processing");
    fail(new Error("failed"));
    await vi.waitFor(() =>
      expect(imports.store.getState().jobs[0]?.status).toBe("failed"),
    );
    expect(imports.store.getState().jobs[0]).not.toBe(processing);
    expect(processing.error).toBeNull();
    expect(processing.status).toBe("processing");
  });

  it("导入失败不自动重放，只在用户主动重试时再次发送", async () => {
    const api = setup();
    api.import.mockRejectedValueOnce(new Error("failed"));
    add("first");
    await vi.waitFor(() =>
      expect(imports.store.getState().jobs[0]?.status).toBe("failed"),
    );
    expect(api.import).toHaveBeenCalledTimes(1);
    imports.retry(imports.store.getState().jobs[0].id);
    await vi.waitFor(() =>
      expect(
        editor
          .getJSON()
          .content?.flatMap((node) => node.content ?? [])
          .some((node) => node.type === "image"),
      ).toBe(true),
    );
    expect(api.import).toHaveBeenCalledTimes(2);
  });

  it("已完成图片撤销重做不恢复处理中占位", async () => {
    setup();
    add("first");
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(editor.commands.undo()).toBe(true);
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "image"),
    ).toBe(false);
    expect(editor.commands.redo()).toBe(true);
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "imageImport"),
    ).toBe(false);
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some(
          (node) =>
            ("attrs" in node ? node.attrs?.assetId : undefined) === "first",
        ),
    ).toBe(true);
  });

  it("跨待办粘贴建立新图片归属，不直接带入来源 ID", async () => {
    const api = setup();
    imports.insert(
      {
        version: 2,
        blocks: [
          { type: "paragraph", content: [{ type: "text", text: "说明" }] },
          {
            type: "paragraph",
            content: [{ type: "image", assetId: "source-image" }],
          },
        ],
      },
      [],
      undefined,
      "source-item",
    );
    await vi.waitFor(() =>
      expect(api.copy).toHaveBeenCalledWith(
        "draft",
        "source-item",
        "source-image",
      ),
    );
    await vi.waitFor(() =>
      expect(
        editor
          .getJSON()
          .content?.flatMap((node) => node.content ?? [])
          .some(
            (node) =>
              ("attrs" in node ? node.attrs?.assetId : undefined) ===
              "copy-source-image",
          ),
      ).toBe(true),
    );
  });

  it("大小与数量超限不插入占位、不读取文件", () => {
    const api = setup();
    add(...Array.from({ length: 11 }, (_, index) => `image-${index}`));
    expect(api.encode).not.toHaveBeenCalled();
    expect(imports.store.getState().error?.code).toBe("todo:note_image_limit");
    const file = new File(["image"], "large.png");
    Object.defineProperty(file, "size", { value: 20_000_001 });
    imports.insert({ version: 2, blocks: [] }, [file]);
    expect(api.encode).not.toHaveBeenCalled();
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "imageImport"),
    ).toBe(false);
  });

  it("达到图片上限后仍可粘贴替换选中的图片", async () => {
    setup();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: Array.from({ length: 10 }, (_, index) => ({
            type: "image",
            attrs: { assetId: `existing-${index}` },
          })),
        },
      ],
    });
    editor.commands.setNodeSelection(1);
    add("replacement");
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(imports.store.getState().error).toBeNull();
    const images = editor.getJSON().content?.[0].content ?? [];
    expect(images).toHaveLength(10);
    expect(images[0]).toMatchObject({
      type: "image",
      attrs: { assetId: "replacement" },
    });
    expect(images[1]).toMatchObject({ attrs: { assetId: "existing-1" } });
  });

  it("光标中插图不拆段，删除占位与撤销重做不会丢掉两侧文字", async () => {
    setup();
    editor.commands.setContent("<p>前后</p>");
    editor.commands.setTextSelection(2);
    add("inline");
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getJSON().content?.[0].content).toEqual([
      { type: "text", text: "前" },
      { type: "image", attrs: { assetId: "inline" } },
      { type: "text", text: "后" },
    ]);
    editor.commands.setTextSelection(3);
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(editor.getText()).toBe("前后");
    editor.commands.undo();
    expect(editor.getJSON().content?.[0].content?.[1]).toMatchObject({
      type: "image",
    });
  });

  it("原生兜底的文字和空剪贴板完成后解除门禁，并可撤销文字粘贴", async () => {
    const api = setup();
    editor.commands.setContent("<p>前后</p>");
    editor.commands.setTextSelection(2);
    api.clipboard.mockResolvedValueOnce({ type: "text", text: "一\n二" });
    imports.pasteClipboard();
    expect(imports.store.getState().running).toBe(true);
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(editor.getJSON().content?.[0].content).toEqual([
      { type: "text", text: "前一" },
      { type: "hardBreak" },
      { type: "text", text: "二后" },
    ]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("前后");
    imports.pasteClipboard();
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(imports.store.getState().jobs).toEqual([]);
    expect(editor.getText()).toBe("前后");
  });

  it("原生预检中关闭编辑器，迟到图片不复活", async () => {
    const api = setup();
    const pending = deferred<TodoNoteClipboard>();
    api.clipboard.mockReturnValueOnce(pending.promise);
    imports.pasteClipboard();
    await vi.waitFor(() => expect(api.clipboard).toHaveBeenCalledTimes(1));
    imports.stop();
    pending.resolve({ type: "image", image: result("late").image });
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(editor.getJSON().content?.[0].content ?? []).toEqual([]);
  });

  it("超像素预检不改变选中文字或撤销历史，也不创建占位", async () => {
    const api = setup();
    editor.commands.setContent("<p>前选中文字后</p>");
    editor.commands.setTextSelection({ from: 2, to: 6 });
    const document = editor.getJSON();
    const selection = editor.state.selection.toJSON();
    const updates = vi.fn();
    editor.on("update", updates);
    api.validate.mockRejectedValueOnce(noteError("todo:note_image_pixels"));
    add("large");
    expect(editor.getJSON()).toEqual(document);
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(imports.store.getState().error?.code).toBe("todo:note_image_pixels");
    expect(editor.getJSON()).toEqual(document);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(updates).not.toHaveBeenCalled();
    expect(imports.store.getState().jobs).toEqual([]);
    expect(api.encode).not.toHaveBeenCalled();
    expect(api.import).not.toHaveBeenCalled();
  });

  it("连续粘贴按调用顺序插入，预检期间移动光标不改变插入位置", async () => {
    const api = setup();
    const pending = deferred<void>();
    api.validate.mockReturnValueOnce(pending.promise);
    editor.commands.setContent("<p>前后</p>");
    editor.commands.setTextSelection(2);
    add("first");
    add("second");
    editor.commands.setTextSelection(3);
    pending.resolve();
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(editor.getJSON().content?.[0].content).toEqual([
      { type: "text", text: "前" },
      { type: "image", attrs: { assetId: "first" } },
      { type: "image", attrs: { assetId: "second" } },
      { type: "text", text: "后" },
    ]);
    expect(editor.state.selection.from).toBe(5);
  });

  it("原生超限或空剪贴板保留选中文字，不留下占位", async () => {
    const api = setup();
    editor.commands.setContent("<p>前选中文字后</p>");
    editor.commands.setTextSelection({ from: 2, to: 6 });
    const document = editor.getJSON();
    api.clipboard.mockRejectedValueOnce(noteError("todo:note_image_pixels"));
    imports.pasteClipboard();
    expect(editor.getJSON()).toEqual(document);
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(imports.store.getState().error?.code).toBe("todo:note_image_pixels");
    expect(editor.getJSON()).toEqual(document);
    imports.pasteClipboard();
    await vi.waitFor(() =>
      expect(imports.store.getState().running).toBe(false),
    );
    expect(editor.getJSON()).toEqual(document);
    expect(imports.store.getState().jobs).toEqual([]);
  });
});
