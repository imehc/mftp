// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { Editor } from "@tiptap/core";
import { act, type ReactNode, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TodoNoteDraft } from "~/bindings";

import { noteError } from "./note-document";
import TodoNoteEditor, { type NoteEditorHandle } from "./TodoNoteEditor";
import { TodoNoteImages } from "./use-note-image";

const clipboard = vi.hoisted(() => ({
  read: vi.fn(),
  native: vi.fn(),
  import: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: clipboard.error } }));
vi.mock("~/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ipc")>()),
  todoNoteClipboardRead: clipboard.native,
  todoNoteImageImport: clipboard.import,
}));
vi.mock("./note-image-clipboard", () => ({
  canReadNoteClipboardImage: () => true,
  readNoteClipboardImage: clipboard.read,
}));

let root: Root;
let container: HTMLDivElement;
const draft: TodoNoteDraft = {
  id: "draft",
  item: null,
  document: {
    version: 2,
    blocks: [
      { type: "paragraph", content: [{ type: "text", text: "中文备注" }] },
    ],
  },
  baseRevision: null,
};

beforeEach(() => {
  clipboard.read.mockReset();
  clipboard.native.mockReset();
  clipboard.import.mockReset();
  clipboard.error.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function currentEditor() {
  return (
    container.querySelector(".tiptap") as HTMLElement & { editor: Editor }
  ).editor;
}

function Frame({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe("待办备注编辑器接入", () => {
  it("原生剪贴板预检时静默等待并禁止保存", async () => {
    const ready = vi.fn();
    let finishRead!: (result: { type: "empty" }) => void;
    clipboard.native.mockReturnValue(
      new Promise<{ type: "empty" }>((resolve) => {
        finishRead = resolve;
      }),
    );
    await act(async () =>
      root.render(
        <Frame>
          <TodoNoteImages>
            <TodoNoteEditor
              draft={draft}
              disabled={false}
              onChange={vi.fn()}
              onStatus={vi.fn()}
              onReady={ready}
            />
          </TodoNoteImages>
        </Frame>,
      ),
    );
    const editor = currentEditor();
    const handle = ready.mock.lastCall?.[0] as NoteEditorHandle;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { types: ["image/png"], files: [], items: [], getData: () => "" },
    });
    await act(async () => {
      editor.view.dom.dispatchEvent(paste);
      expect(handle.canSave()).toBe(false);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(clipboard.native).toHaveBeenCalledTimes(1);
    expect(
      editor
        .getJSON()
        .content?.flatMap((node) => node.content ?? [])
        .some((node) => node.type === "imageImport"),
    ).toBe(false);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => finishRead({ type: "empty" }));
    expect(handle.canSave()).toBe(true);
    expect(clipboard.native).toHaveBeenCalledTimes(1);
  });

  it("原生剪贴板超限只弹出消息且解除保存门禁，不修改选中文字", async () => {
    const ready = vi.fn();
    let fail!: (error: unknown) => void;
    clipboard.native.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await act(async () =>
      root.render(
        <Frame>
          <TodoNoteImages>
            <TodoNoteEditor
              draft={draft}
              disabled={false}
              onChange={vi.fn()}
              onStatus={vi.fn()}
              onReady={ready}
            />
          </TodoNoteImages>
        </Frame>,
      ),
    );
    const editor = currentEditor();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    const original = editor.getJSON();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { types: ["image/png"], files: [], items: [], getData: () => "" },
    });
    await act(async () => {
      editor.view.dom.dispatchEvent(event);
    });
    expect(editor.getJSON()).toEqual(original);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => fail(noteError("todo:note_image_pixels")));
    expect(container.textContent).not.toContain("正在处理图片");
    expect(clipboard.error).toHaveBeenCalledExactlyOnceWith(
      "图片超过 1200 万像素限制，请先缩小后再添加",
    );
    const handle = ready.mock.lastCall![0] as NoteEditorHandle;
    expect(handle.canSave()).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(3);
    expect(container.textContent).not.toContain("重试");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("粘贴超像素文件立即显示对应提示，不读取完整文件或发起导入 IPC", async () => {
    await act(async () =>
      root.render(
        <Frame>
          <TodoNoteImages>
            <TodoNoteEditor
              draft={draft}
              disabled={false}
              onChange={vi.fn()}
              onStatus={vi.fn()}
              onReady={vi.fn()}
            />
          </TodoNoteImages>
        </Frame>,
      ),
    );
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const data = new DataView(header.buffer);
    data.setUint32(16, 4096);
    data.setUint32(20, 4096);
    const file = new File([header], "large.png", { type: "image/png" });
    const fullRead = vi.spyOn(file, "arrayBuffer");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { types: ["Files"], files: [file], items: [], getData: () => "" },
    });
    await act(async () => {
      currentEditor().view.dom.dispatchEvent(event);
    });
    expect(clipboard.error).toHaveBeenCalledExactlyOnceWith(
      "图片超过 1200 万像素限制，请先缩小后再添加",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(currentEditor().getText()).toBe("中文备注");
    expect(container.textContent).not.toContain("重试");
    expect(container.textContent).not.toContain("正在处理图片");
    expect(fullRead).not.toHaveBeenCalled();
    expect(clipboard.import).not.toHaveBeenCalled();
    expect(clipboard.native).not.toHaveBeenCalled();
  });

  it("插入图片和代码块只显示图标，保留名称提示与代码切换功能", async () => {
    await act(async () =>
      root.render(
        <Frame>
          <TodoNoteImages>
            <TodoNoteEditor
              draft={draft}
              disabled={false}
              onChange={vi.fn()}
              onStatus={vi.fn()}
              onReady={vi.fn()}
            />
          </TodoNoteImages>
        </Frame>,
      ),
    );
    const imageButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="插入图片"]',
    )!;
    const codeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="代码块"]',
    )!;
    for (const button of [imageButton, codeButton]) {
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.title).toBe(button.getAttribute("aria-label"));
    }
    await act(async () => codeButton.click());
    expect(currentEditor().isActive("codeBlock")).toBe(true);
    expect(codeButton.getAttribute("aria-pressed")).toBe("true");
    expect(imageButton.disabled).toBe(true);
    expect(
      container.querySelector('button[aria-label="退出代码块"]')?.textContent,
    ).toBe("");
    await act(async () => codeButton.click());
    expect(currentEditor().isActive("codeBlock")).toBe(false);
    expect(imageButton.disabled).toBe(false);
  });

  it("严格模式重挂载只保留一个剪贴板插件，初次加载不标记为编辑", async () => {
    const change = vi.fn();
    const ready = vi.fn();
    await act(async () =>
      root.render(
        <Frame>
          <StrictMode>
            <TodoNoteImages>
              <TodoNoteEditor
                draft={draft}
                disabled={false}
                onChange={change}
                onStatus={vi.fn()}
                onReady={ready}
              />
            </TodoNoteImages>
          </StrictMode>
        </Frame>,
      ),
    );
    const editor = currentEditor();
    expect(editor.getText()).toBe("中文备注");
    expect(
      editor.state.plugins.filter(
        (plugin) =>
          plugin.props.handleDOMEvents?.copy && plugin.props.handlePaste,
      ),
    ).toHaveLength(1);
    expect(change).not.toHaveBeenCalled();
    const handle = ready.mock.lastCall?.[0] as NoteEditorHandle;
    expect(handle.canSave()).toBe(true);
    expect(handle.isDirty()).toBe(false);
    await act(async () => {
      editor.commands.insertContent("新文字");
    });
    expect(change).toHaveBeenLastCalledWith(handle.document());
    expect(handle.isDirty()).toBe(true);
  });

  it("父组件重新渲染和切换禁用状态不丢内容或粘贴处理器", async () => {
    const change = vi.fn();
    const status = vi.fn();
    const ready = vi.fn();
    const render = (disabled: boolean) => (
      <Frame>
        <TodoNoteImages>
          <TodoNoteEditor
            draft={draft}
            disabled={disabled}
            onChange={change}
            onStatus={status}
            onReady={ready}
          />
        </TodoNoteImages>
      </Frame>
    );
    await act(async () => root.render(render(false)));
    const editor = currentEditor();
    await act(async () => {
      editor.commands.insertContent("新内容");
    });
    await act(async () => root.render(render(true)));
    expect(currentEditor()).toBe(editor);
    expect(editor.getText()).toContain("新内容");
    expect(editor.isEditable).toBe(false);
    expect(
      editor.state.plugins.filter(
        (plugin) =>
          plugin.props.handleDOMEvents?.copy && plugin.props.handlePaste,
      ),
    ).toHaveLength(1);
    await act(async () => root.render(render(false)));
    expect(editor.isEditable).toBe(true);
  });

  it("同步读取实时正文，未完成图片在状态回调之前也不能保存", async () => {
    const ready = vi.fn();
    await act(async () =>
      root.render(
        <Frame>
          <TodoNoteImages>
            <TodoNoteEditor
              draft={draft}
              disabled={false}
              onChange={vi.fn()}
              onStatus={vi.fn()}
              onReady={ready}
            />
          </TodoNoteImages>
        </Frame>,
      ),
    );
    const editor = currentEditor();
    const handle = ready.mock.lastCall?.[0] as NoteEditorHandle;
    await act(async () => {
      editor.commands.insertContent({
        type: "imageImport",
        attrs: { id: "pending" },
      });
      expect(handle.canSave()).toBe(false);
    });
    await act(async () => {
      editor.commands.clearContent();
    });
    expect(handle.canSave()).toBe(true);
    expect(handle.document()).toEqual({ version: 2, blocks: [] });
  });

  it("快捷键未触发粘贴事件时由原生剪贴板兜底，正常文字粘贴不重复读取", async () => {
    clipboard.native.mockResolvedValue({ type: "text", text: "快捷粘贴" });
    await act(async () =>
      root.render(
        <Frame>
          <TodoNoteImages>
            <TodoNoteEditor
              draft={draft}
              disabled={false}
              onChange={vi.fn()}
              onStatus={vi.fn()}
              onReady={vi.fn()}
            />
          </TodoNoteImages>
        </Frame>,
      ),
    );
    const editor = currentEditor();
    await act(async () => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "v",
          metaKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(clipboard.native).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toContain("快捷粘贴");
    clipboard.native.mockClear();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        files: [],
        items: [],
        getData: (type: string) => (type === "text/plain" ? "普通文字" : ""),
      },
    });
    await act(async () => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "v",
          metaKey: true,
          bubbles: true,
        }),
      );
      editor.view.dom.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(clipboard.native).not.toHaveBeenCalled();
    expect(editor.getText()).toContain("普通文字");
  });

  it("编辑器实例重建后粘贴仍绑定当前实例，不复用已销毁实例的导入队列", async () => {
    const ready = vi.fn();
    const render = (disabled: boolean) => (
      <Frame>
        <TodoNoteImages>
          <TodoNoteEditor
            draft={draft}
            disabled={disabled}
            onChange={vi.fn()}
            onStatus={vi.fn()}
            onReady={ready}
          />
        </TodoNoteImages>
      </Frame>
    );
    await act(async () => root.render(render(false)));
    const previous = currentEditor();
    await act(async () => {
      previous.destroy();
      root.render(render(true));
    });
    await act(async () => root.render(render(false)));
    const editor = currentEditor();
    expect(editor).not.toBe(previous);
    expect(editor.isDestroyed).toBe(false);
    let finish!: (value: { type: "empty" }) => void;
    clipboard.native.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { types: ["image/png"], files: [], items: [], getData: () => "" },
    });
    await act(async () => {
      editor.view.dom.dispatchEvent(event);
    });
    expect(clipboard.native).toHaveBeenCalledTimes(1);
    const handle = ready.mock.lastCall![0] as NoteEditorHandle;
    expect(handle.canSave()).toBe(false);
    await act(async () => finish({ type: "empty" }));
    expect(handle.canSave()).toBe(true);
  });
});
