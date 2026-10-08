import { beforeEach, expect, it, vi } from "vitest";
import { Group } from "three";
import type { ModelHandle, ModelSource } from "../domain/types";
import { MissingResources } from "../domain/errors";
import { loadModel } from "../loaders/registry";
import type { ModelViewerRuntime } from "./viewer";
import { ModelCollection } from "./collection";
import { ViewerSession } from "./session";

vi.mock("../loaders/registry", () => ({ loadModel: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function source(name = "model.glb"): ModelSource {
  return {
    name,
    size: 4,
    sizeOf: vi.fn(),
    read: vi.fn(),
    attach: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function handle(name: string): ModelHandle {
  return {
    name,
    format: "GLB",
    size: 4,
    scene: new Group(),
    animations: [],
    hasGeometry: true,
    dispose: vi.fn(),
  };
}

function session() {
  const value = new ViewerSession(),
    models = new ModelCollection(vi.fn());
  value.runtime = {
    renderer: {},
    models,
    show: vi.fn(
      async (handle: ModelHandle, signal: AbortSignal, id: string) => {
        signal.throwIfAborted();
        const entry = models.prepare(id, handle);
        models.add(entry);
        return entry.inspection.snapshot;
      },
    ),
    remove: (id: string) => models.remove(id),
    dispose: () => models.dispose(),
  } as unknown as ModelViewerRuntime;
  return value;
}

it("FBX 排队时显示正确格式，加载成功后使用适配器格式且标为仅预览", async () => {
  const pending = deferred<ModelHandle>();
  vi.mocked(loadModel).mockReturnValueOnce(pending.promise);
  const viewer = session();
  const task = viewer.enqueue([
    { name: "scene.FBX", open: () => source("scene.FBX") },
  ]);
  expect(viewer.snapshot().items[0].format).toBe("FBX");
  pending.resolve({ ...handle("scene.FBX"), format: "FBX" });
  await task;
  expect(viewer.snapshot().model).toMatchObject({
    format: "FBX",
    previewOnly: true,
  });
  expect(viewer.snapshot().items[0].status).toBe("ready");
  viewer.dispose();
});

it("批量导入按序执行，部分失败时保留成功项", async () => {
  const old = deferred<ModelHandle>();
  const first = source("a.glb"),
    second = source("b.glb"),
    third = source("c.glb");
  vi.mocked(loadModel)
    .mockReturnValueOnce(old.promise)
    .mockRejectedValueOnce(new Error("bad"))
    .mockResolvedValueOnce(handle("c.glb"));
  const viewer = session();
  const task = viewer.enqueue(
    [first, second, third].map((input) => ({
      name: input.name,
      open: () => input,
    })),
  );
  await Promise.resolve();
  expect(loadModel).toHaveBeenCalledTimes(1);
  old.resolve(handle("a.glb"));
  await task;
  expect(viewer.snapshot().items.map((item) => item.status)).toEqual([
    "ready",
    "error",
    "ready",
  ]);
  expect(viewer.runtime!.models.entries.size).toBe(2);
  [first, second, third].forEach((input) =>
    expect(input.close).toHaveBeenCalledOnce(),
  );
});

it("缺失资源不会阻塞队列，补充资源会指向所属项", async () => {
  vi.mocked(loadModel)
    .mockRejectedValueOnce(new MissingResources(["a.bin", "b.png"]))
    .mockResolvedValueOnce(handle("second"))
    .mockResolvedValueOnce(handle("first"));
  const viewer = session(),
    input = source();
  await viewer.enqueue([
    { name: "first", open: () => input },
    { name: "second", open: () => source() },
  ]);
  const id = viewer.snapshot().awaitingId;
  expect(viewer.snapshot().model?.name).toBe("second");
  expect(input.close).not.toHaveBeenCalled();
  await viewer.attach("a.bin", new File(["x"], "a.bin"), id);
  expect(viewer.snapshot().missing).toEqual(["b.png"]);
  await viewer.attach("b.png", new File(["x"], "b.png"), id);
  expect(viewer.snapshot().model?.name).toBe("first");
  expect(input.close).toHaveBeenCalledOnce();
});

it("取消会一直等待工作线程和源清理完成，被取消的排队工厂绝不运行", async () => {
  const result = deferred<ModelHandle>(),
    cleanup = deferred<void>();
  vi.mocked(loadModel).mockReturnValueOnce(result.promise);
  const viewer = session(),
    input = source(),
    unopened = vi.fn();
  input.close = vi.fn(() => cleanup.promise);
  const task = viewer.enqueue([
    { name: "first", open: () => input },
    { name: "next", open: unopened },
  ]);
  await Promise.resolve();
  viewer.cancel();
  expect(viewer.snapshot().cancelling).toBe(true);
  expect(input.close).not.toHaveBeenCalled();
  const cancelled = handle("cancelled");
  result.resolve(cancelled);
  await Promise.resolve();
  await Promise.resolve();
  expect(viewer.snapshot().cancelling).toBe(true);
  cleanup.resolve();
  await task;
  expect(viewer.snapshot()).toMatchObject({
    cancelling: false,
    error: null,
    model: null,
  });
  expect(cancelled.dispose).toHaveBeenCalledOnce();
  expect(unopened).not.toHaveBeenCalled();
});

it("解码期间删除不能添加延迟到达的模型", async () => {
  const result = deferred<ModelHandle>();
  vi.mocked(loadModel).mockReturnValueOnce(result.promise);
  const viewer = session();
  const task = viewer.open(() => source());
  await Promise.resolve();
  viewer.remove(viewer.snapshot().items[0].id);
  const late = handle("late");
  result.resolve(late);
  await task;
  expect(viewer.snapshot().items).toHaveLength(0);
  expect(viewer.runtime!.models.entries.size).toBe(0);
  expect(late.dispose).toHaveBeenCalledOnce();
});

it("异步创建源期间释放会关闭延迟源且不进行解析", async () => {
  const created = deferred<ModelSource>(),
    viewer = session();
  const task = viewer.open(() => created.promise);
  viewer.dispose();
  const input = source();
  created.resolve(input);
  await task;
  expect(input.close).toHaveBeenCalledOnce();
  expect(loadModel).not.toHaveBeenCalled();
});

it("移除会等待进行中的依赖挂载完成后再关闭其源", async () => {
  vi.mocked(loadModel).mockRejectedValueOnce(new MissingResources(["a.bin"]));
  const viewer = session(),
    input = source(),
    attaching = deferred<void>();
  input.attach = vi.fn(() => attaching.promise);
  await viewer.open(() => input);
  const id = viewer.snapshot().awaitingId!;
  const task = viewer.attach("a.bin", new File(["x"], "a.bin"), id);
  viewer.remove(id);
  expect(input.close).not.toHaveBeenCalled();
  expect(viewer.snapshot().cancelling).toBe(true);
  attaching.resolve();
  await task;
  expect(input.close).toHaveBeenCalledOnce();
  expect(viewer.snapshot().items).toHaveLength(0);
});
