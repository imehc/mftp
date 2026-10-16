// @vitest-environment happy-dom

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, test } from "vitest";

import type { AppError } from "~/bindings";
import {
  todoItemSetCompleted,
  todoNoteDraftClose,
  todoNoteImageImport,
  todoNoteImageRead,
  todoNoteSave,
} from "~/lib/ipc";

afterEach(() => {
  clearMocks();
});

test("待办完成操作只传元数据，不回传备注摘要", async () => {
  mockIPC((command, arguments_) => {
    expect(command).toBe("todo_item_set_completed");
    expect(arguments_).toEqual({ id: "item", completed: true });
    return { id: "item", completed: true };
  });
  await expect(todoItemSetCompleted("item", true)).resolves.toEqual({
    id: "item",
    completed: true,
  });
});

test("备注保存和图片读取沿用生成契约与显式草稿归属", async () => {
  const input = {
    draftId: "draft",
    metadata: {
      title: "标题",
      category: null,
      notes: null,
      dueDate: null,
      dueAt: null,
      completed: false,
    },
    document: {
      version: 2,
      blocks: [{ type: "codeBlock" as const, text: "  return 1;\n" }],
    },
  };
  mockIPC((command, arguments_) => {
    if (command === "todo_note_save") {
      expect(arguments_).toEqual({ input });
      return { document: input.document };
    }
    expect(command).toBe("todo_note_image_read");
    expect(arguments_).toEqual({
      assetId: "image",
      itemId: null,
      draftId: "draft",
      thumbnail: true,
    });
    return { dataBase64: "AA==" };
  });
  await expect(todoNoteSave(input)).resolves.toEqual({
    document: input.document,
  });
  await expect(
    todoNoteImageRead("image", null, "draft", true),
  ).resolves.toEqual({
    dataBase64: "AA==",
  });
});

test("图片导入保留结构化错误且不自动重试写操作", async () => {
  let calls = 0;
  const error: AppError = {
    kind: "custom",
    code: "todo:note_image_limit",
    message: "Todo image exceeds limits",
    args: { reason: "pixels" },
  };
  mockIPC((command, arguments_) => {
    calls += 1;
    expect(command).toBe("todo_note_image_import");
    expect(arguments_).toEqual({ draftId: "draft", dataBase64: "AA==" });
    throw error;
  });
  await expect(todoNoteImageImport("draft", "AA==")).rejects.toMatchObject({
    payload: error,
  });
  expect(calls).toBe(1);
});

test("关闭草稿的空返回统一归一化", async () => {
  mockIPC((command, arguments_) => {
    expect(command).toBe("todo_note_draft_close");
    expect(arguments_).toEqual({ draftId: "draft" });
    return null;
  });
  await expect(todoNoteDraftClose("draft")).resolves.toBeUndefined();
});
