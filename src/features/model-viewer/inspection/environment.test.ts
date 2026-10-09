import { Scene, type WebGLRenderer } from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { isTauriRuntime } from "~/lib/files";

import {
  readEnvironment,
  saveEnvironment,
} from "../library/environment-storage";

vi.mock("~/lib/files", () => ({ isTauriRuntime: vi.fn(() => false) }));
vi.mock("../library/environment-storage", () => ({
  readEnvironment: vi.fn(),
  saveEnvironment: vi.fn(),
}));
vi.mock("three", async (original) => {
  const module = await original<typeof import("three")>();
  return {
    ...module,
    PMREMGenerator: class {
      fromEquirectangular() {
        return { texture: {}, dispose: vi.fn() };
      }
      dispose() {}
    },
  };
});

beforeEach(() => {
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  vi.mocked(readEnvironment).mockReset();
  vi.mocked(saveEnvironment).mockReset();
});

import { ViewerEnvironment } from "./environment";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
});

it("清理已取消的 HDR 任务，忽略其延迟错误并在释放时终止", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const environment = new ViewerEnvironment(
    new Scene(),
    {} as WebGLRenderer,
    vi.fn(),
  );
  const first = environment.load(new File(["a"], "a.hdr"));
  const second = environment.load(new File(["b"], "b.hdr"));
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  TestWorker.instances[0].onerror?.();
  expect(environment.snapshot()).toMatchObject({
    busy: true,
    error: null,
    name: null,
  });
  environment.dispose();
  await Promise.all([first, second]);
  expect(TestWorker.instances[1].terminate).toHaveBeenCalledOnce();
  expect(environment.snapshot()).toMatchObject({
    busy: false,
    error: null,
    name: null,
  });
});

it("清理工作线程并报告无效的 HDR 数据", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const environment = new ViewerEnvironment(
    new Scene(),
    {} as WebGLRenderer,
    vi.fn(),
  );
  const job = environment.load(new File(["bad"], "bad.hdr"));
  TestWorker.instances[0].onmessage?.({ data: { error: true } });
  await job;
  expect(environment.snapshot().error).not.toBeNull();
  expect(environment.snapshot().busy).toBe(false);
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  environment.dispose();
});

function decoded(worker: TestWorker) {
  worker.onmessage?.({
    data: { result: { data: new Uint16Array(4), width: 1, height: 1 } },
  });
}

it("恢复已保存环境不重复写入，销毁仅释放资源", async () => {
  vi.stubGlobal("Worker", TestWorker);
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(readEnvironment).mockResolvedValue(new File(["hdr"], "saved.hdr"));
  const environment = new ViewerEnvironment(
    new Scene(),
    {} as WebGLRenderer,
    vi.fn(),
  );
  const pending = environment.restore();
  await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
  decoded(TestWorker.instances[0]);
  await pending;
  expect(environment.snapshot().name).toBe("saved.hdr");
  expect(saveEnvironment).not.toHaveBeenCalled();
  environment.dispose();
  expect(saveEnvironment).not.toHaveBeenCalled();
});

it("读取失败后的显式重试只读取，不误清除已保存环境", async () => {
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(readEnvironment).mockRejectedValue(new Error("read failed"));
  const environment = new ViewerEnvironment(
    new Scene(),
    {} as WebGLRenderer,
    vi.fn(),
  );
  await environment.restore();
  expect(environment.snapshot().storageError).not.toBeNull();
  vi.mocked(readEnvironment).mockResolvedValue(null);
  await environment.retrySave();
  expect(readEnvironment).toHaveBeenCalledTimes(2);
  expect(saveEnvironment).not.toHaveBeenCalled();
  environment.dispose();
});

it("用户清除优先于迟到恢复，并持久清除一次", async () => {
  vi.stubGlobal("Worker", TestWorker);
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  let finish!: (file: File) => void;
  vi.mocked(readEnvironment).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const environment = new ViewerEnvironment(
    new Scene(),
    {} as WebGLRenderer,
    vi.fn(),
  );
  const pending = environment.restore();
  environment.clear();
  finish(new File(["hdr"], "old.hdr"));
  await pending;
  expect(TestWorker.instances).toHaveLength(0);
  expect(saveEnvironment).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveEnvironment).mock.calls[0][0]).toBeNull();
  environment.dispose();
});

it("新 HDR 解码成功后才保存，存储失败保留预览并允许显式重试", async () => {
  vi.stubGlobal("Worker", TestWorker);
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(saveEnvironment).mockRejectedValueOnce(new Error("save failed"));
  const environment = new ViewerEnvironment(
    new Scene(),
    {} as WebGLRenderer,
    vi.fn(),
  );
  const file = new File(["hdr"], "new.hdr");
  const pending = environment.load(file);
  expect(saveEnvironment).not.toHaveBeenCalled();
  decoded(TestWorker.instances[0]);
  await pending;
  expect(environment.snapshot()).toMatchObject({
    name: "new.hdr",
    busy: false,
  });
  expect(environment.snapshot().storageError).not.toBeNull();
  vi.mocked(saveEnvironment).mockResolvedValue();
  await environment.retrySave();
  expect(saveEnvironment).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveEnvironment).mock.calls[1][0]).toBe(file);
  expect(environment.snapshot().storageError).toBeNull();
  environment.dispose();
});

it("替换环境解码失败保留旧环境且不覆盖已保存数据", async () => {
  vi.stubGlobal("Worker", TestWorker);
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(saveEnvironment).mockResolvedValue();
  const scene = new Scene();
  const environment = new ViewerEnvironment(
    scene,
    {} as WebGLRenderer,
    vi.fn(),
  );
  const first = environment.load(new File(["hdr"], "kept.hdr"));
  decoded(TestWorker.instances[0]);
  await first;
  const texture = scene.environment;
  const replacement = environment.load(new File(["bad"], "invalid.hdr"));
  TestWorker.instances[1].onmessage?.({ data: { error: true } });
  await replacement;
  expect(environment.snapshot().name).toBe("kept.hdr");
  expect(environment.snapshot().error).not.toBeNull();
  expect(scene.environment).toBe(texture);
  expect(saveEnvironment).toHaveBeenCalledTimes(1);
  environment.dispose();
});
