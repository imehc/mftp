import { afterEach, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh } from "three";
import { ModelDiagnostics } from "./diagnostics";
import { ModelCollection } from "../runtime/collection";

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
function entry() {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(2, 3, 4)));
  return new ModelCollection(vi.fn()).prepare("test", {
    scene,
    name: "test",
    format: "GLB",
    size: 0,
    animations: [],
    hasGeometry: true,
    validationSource: { entry: new Blob(), resources: new Map() },
    dispose() {},
  });
}
it("终止已取消的工作线程，并忽略另一请求之后的过期报告", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const diagnostics = new ModelDiagnostics();
  const model = entry();
  await diagnostics.run(model, "validation", 1e-5);
  const first = TestWorker.instances[0];
  await diagnostics.run(model, "validation", 1e-5);
  const second = TestWorker.instances[1];
  expect(first.terminate).toHaveBeenCalledOnce();
  first.onmessage?.({ data: { result: { validatorVersion: "old" } } });
  expect(diagnostics.snapshot().validation).toBeNull();
  expect(diagnostics.snapshot().busy).toBe("validation");
  second.onmessage?.({ data: { result: { validatorVersion: "new" } } });
  expect(diagnostics.snapshot().validation?.validatorVersion).toBe("new");
  expect(second.terminate).toHaveBeenCalledOnce();
  diagnostics.dispose();
});
it("在工作线程启动前取消几何采样，并丢弃依赖姿态的报告", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const diagnostics = new ModelDiagnostics();
  const model = entry();
  const running = diagnostics.run(model, "topology", 1e-5);
  diagnostics.clear();
  await running;
  expect(TestWorker.instances).toHaveLength(0);
  expect(diagnostics.snapshot().dimensions).toBeNull();
  await diagnostics.run(model, "dimensions", 1e-5);
  expect(diagnostics.snapshot().dimensions).toEqual([2, 3, 4]);
  diagnostics.invalidatePose();
  expect(diagnostics.snapshot().dimensions).toBeNull();
  diagnostics.dispose();
});
