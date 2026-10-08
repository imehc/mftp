import { Group } from "three";
import { beforeEach, expect, it, vi } from "vitest";

import type { ModelViewState } from "~/bindings";
import * as ipc from "~/lib/ipc";

import type { ModelHandle } from "../domain/types";
import { librarySource, originalResources, saveModel } from "./storage";

vi.mock("~/lib/ipc", () => ({
  modelLibraryBegin: vi.fn(),
  modelLibraryWrite: vi.fn(),
  modelLibraryCommit: vi.fn(),
  modelLibraryDelete: vi.fn(),
  modelLibraryRead: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.modelLibraryBegin).mockResolvedValue("draft");
});

const view = {} as ModelViewState;

function handle(): ModelHandle {
  const shared = new Blob(["A"]);
  return {
    name: "model.gltf",
    size: 2,
    format: "glTF",
    scene: new Group(),
    animations: [],
    hasGeometry: true,
    dispose() {},
    archive: new Map([
      ["", new Blob(["{}"])],
      ["one/a b.bin", shared],
      ["two/a b.bin", new Blob(["B"])],
    ]),
  };
}

it("保存独立归档资源时保留完整路径和原始条目，不要求规范验证能力", async () => {
  const model = handle();
  const resources = originalResources(model);
  expect([...resources.keys()]).toEqual(["", "one/a b.bin", "two/a b.bin"]);
  await saveModel(model, view, new AbortController().signal, vi.fn());
  expect(ipc.modelLibraryBegin).toHaveBeenCalledWith({
    name: "model.gltf",
    view,
    resources: [
      { key: "", size: 2 },
      { key: "one/a b.bin", size: 1 },
      { key: "two/a b.bin", size: 1 },
    ],
  });
  expect(ipc.modelLibraryWrite).toHaveBeenNthCalledWith(
    1,
    "draft",
    "",
    0,
    [123, 125],
  );
  expect(ipc.modelLibraryCommit).toHaveBeenCalledOnce();
});

it("仅有规范验证能力不能触发模型库写入", async () => {
  const model = handle();
  model.archive = undefined;
  model.validationSource = { entry: new Blob(["{}"]), resources: new Map() };
  await expect(
    saveModel(model, view, new AbortController().signal, vi.fn()),
  ).rejects.toMatchObject({ payload: { code: "model:invalid" } });
  expect(ipc.modelLibraryBegin).not.toHaveBeenCalled();
});

it("等待实际数据块写入后再清理中止操作，且绝不发布该数据块", async () => {
  let finish!: () => void;
  vi.mocked(ipc.modelLibraryWrite).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const abort = new AbortController();
  const saving = saveModel(handle(), view, abort.signal, vi.fn());
  await vi.waitFor(() => expect(finish).toBeDefined());
  abort.abort();
  expect(ipc.modelLibraryDelete).not.toHaveBeenCalled();
  const assertion = expect(saving).rejects.toMatchObject({
    name: "AbortError",
  });
  finish();
  await assertion;
  expect(ipc.modelLibraryCommit).not.toHaveBeenCalled();
  expect(ipc.modelLibraryDelete).toHaveBeenCalledWith("draft", true);
});

it("保留写入错误并单独报告清理失败，且不重放操作", async () => {
  const error = { kind: "Io", code: "io:full", message: "disk full", args: {} };
  const cleanup = {
    kind: "Custom",
    code: "app:maintenance_in_progress",
    message: "busy",
    args: {},
  };
  vi.mocked(ipc.modelLibraryWrite).mockRejectedValue(error);
  vi.mocked(ipc.modelLibraryDelete).mockRejectedValue(cleanup);
  const report = vi.fn();
  await expect(
    saveModel(handle(), view, new AbortController().signal, report),
  ).rejects.toBe(error);
  expect(report).toHaveBeenCalledWith(cleanup);
  expect(ipc.modelLibraryWrite).toHaveBeenCalledOnce();
});

it("按路径重新打开依赖字节，并拒绝被截断的已存储数据块", async () => {
  const source = librarySource("saved", {
    sourceName: "model.gltf",
    view,
    resources: [
      { key: "", size: 2 },
      { key: "sub/a.bin", size: 3 },
    ],
  });
  vi.mocked(ipc.modelLibraryRead).mockResolvedValueOnce([1, 2, 3]);
  expect(
    await source.read("sub/a.bin", new AbortController().signal, vi.fn()),
  ).toEqual(new Uint8Array([1, 2, 3]));
  expect(ipc.modelLibraryRead).toHaveBeenCalledWith("saved", "sub/a.bin", 0);
  vi.mocked(ipc.modelLibraryRead).mockResolvedValueOnce([1]);
  await expect(
    source.read("", new AbortController().signal, vi.fn()),
  ).rejects.toMatchObject({ payload: { code: "model:invalid" } });
});

it("开始阶段取消时仍只清理产生的草稿", async () => {
  const abort = new AbortController();
  vi.mocked(ipc.modelLibraryBegin).mockImplementation(async () => {
    abort.abort();
    return "pending";
  });
  await expect(
    saveModel(handle(), view, abort.signal, vi.fn()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(ipc.modelLibraryDelete).toHaveBeenCalledWith("pending", true);
  expect(ipc.modelLibraryWrite).not.toHaveBeenCalled();
});
