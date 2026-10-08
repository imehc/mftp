import { afterEach, expect, it, vi } from "vitest";
import { Scene, type WebGLRenderer } from "three";
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
