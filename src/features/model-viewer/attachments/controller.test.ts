import { beforeEach, expect, it, vi } from "vitest";

import type { ModelAttachment } from "~/bindings";
import { IpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";

import { exportBlob } from "../export/native-export";
import { AttachmentController, validateAttachment } from "./controller";

vi.mock("~/lib/ipc", () => ({
  modelAttachmentAdd: vi.fn(),
  modelAttachmentDelete: vi.fn(),
  modelAttachmentList: vi.fn(),
  modelAttachmentRead: vi.fn(),
}));
vi.mock("../export/native-export", () => ({ exportBlob: vi.fn() }));
const entry: ModelAttachment = {
  id: "attachment",
  name: "note.md",
  kind: "markdown",
  size: 4,
};
const encode = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.modelAttachmentList).mockResolvedValue([entry]);
  vi.mocked(ipc.modelAttachmentRead).mockResolvedValue(
    Array.from(encode("note")),
  );
});

async function ready() {
  const changed = vi.fn();
  const controller = new AttachmentController("model", changed);
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().busy).toBe(false));
  return { controller, changed };
}

it("Markdown 内容保持纯文本，不解析脚本和远程资源", () => {
  const text =
    "<script>alert(1)</script>\n![remote](https://example.com/a.png)";
  expect(validateAttachment("readme.MD", encode(text))).toBe(text);
});

it("拒绝错误扩展名、路径、编码、控制符和超限文件", () => {
  for (const [name, bytes] of [
    ["evil.html", encode("html")],
    ["../a.txt", encode("a")],
    ["a.txt", new Uint8Array([255])],
    ["a.md", encode("\0")],
    ["a.pdf", encode("not PDF")],
    ["a.txt", new Uint8Array(0)],
    ["a.txt", new Uint8Array(1024 * 1024 + 1)],
  ] as const)
    expect(() => validateAttachment(name, bytes)).toThrow(IpcError);
  expect(validateAttachment("a.pdf", encode("%PDF-1.7"))).toBeNull();
});

it("已提交的添加在关闭后完成，不重放写入或误删除附件", async () => {
  const { controller, changed } = await ready();
  let finish!: (id: string) => void;
  vi.mocked(ipc.modelAttachmentAdd).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = controller.add(new File(["note"], "note.txt"));
  await vi.waitFor(() => expect(ipc.modelAttachmentAdd).toHaveBeenCalledOnce());
  controller.stop();
  controller.start();
  finish("new");
  await pending;
  await vi.waitFor(() => expect(controller.snapshot().busy).toBe(false));
  expect(ipc.modelAttachmentAdd).toHaveBeenCalledOnce();
  expect(ipc.modelAttachmentDelete).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();
  controller.stop();
});

it("关闭时未完成的文件读取不会提交新附件", async () => {
  const { controller } = await ready();
  let finish!: (data: ArrayBuffer) => void;
  const file = new File(["note"], "note.txt");
  vi.spyOn(file, "arrayBuffer").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = controller.add(file);
  controller.stop();
  finish(encode("note").buffer);
  await pending;
  expect(ipc.modelAttachmentAdd).not.toHaveBeenCalled();
});

it("关闭后的旧读取不展示到重新打开的面板", async () => {
  const { controller } = await ready();
  let finish!: (data: number[]) => void;
  vi.mocked(ipc.modelAttachmentRead).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = controller.read(entry);
  controller.stop();
  controller.start();
  finish(Array.from(encode("stale")));
  await pending;
  expect(controller.snapshot().selected).toBeNull();
  controller.stop();
});

it("保存使用统一导出与原始字节，取消不显示已保存", async () => {
  const { controller } = await ready();
  vi.mocked(exportBlob).mockResolvedValue("cancelled");
  await controller.save(entry);
  expect(controller.snapshot().saved).toBe(false);
  const [blob, name, action] = vi.mocked(exportBlob).mock.calls[0];
  expect(await blob.text()).toBe("note");
  expect([name, action]).toEqual(["note.md", "save"]);
  controller.stop();
});

it("失败保持结构化错误，重复点击不并发写入", async () => {
  const { controller } = await ready();
  const error = new IpcError({
    kind: "external",
    code: "model:attachment_exists",
    message: "Exists",
    args: {},
  });
  vi.mocked(ipc.modelAttachmentAdd).mockRejectedValue(error);
  await Promise.all([
    controller.add(new File(["note"], "note.txt")),
    controller.add(new File(["note"], "note.txt")),
  ]);
  expect(ipc.modelAttachmentAdd).toHaveBeenCalledOnce();
  expect(controller.snapshot().error).toBe(error);
  controller.stop();
});
