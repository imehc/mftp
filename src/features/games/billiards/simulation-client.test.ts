import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSimulationClient,
  type SimulationResponse,
} from "./simulation-client";

/** 只记录收发，不真正启动 worker：用于验证就绪协议本身。 */
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: SimulationResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: unknown[] = [];
  terminate = vi.fn();

  constructor() {
    TestWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  reply(message: SimulationResponse) {
    this.onmessage?.({ data: message });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
});

describe("台球模拟 worker 客户端", () => {
  it("ready 等 worker 确认物理引擎初始化后才兑现", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const client = createSimulationClient();
    const worker = TestWorker.instances[0];
    const ready = client.ready();
    expect(worker.posted).toEqual([{ id: 0, kind: "ready" }]);
    worker.reply({ id: 0, result: null });
    await expect(ready).resolves.toBeUndefined();
    client.dispose();
  });

  it("初始化失败时拒绝，且可以再次请求重试", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const client = createSimulationClient();
    const worker = TestWorker.instances[0];
    const failed = client.ready();
    worker.reply({ id: 0, error: "billiards: simulation failed" });
    await expect(failed).rejects.toThrow("billiards: simulation failed");
    const retried = client.ready();
    expect(worker.posted[1]).toEqual({ id: 1, kind: "ready" });
    worker.reply({ id: 1, result: null });
    await expect(retried).resolves.toBeUndefined();
    client.dispose();
  });

  it("释放后不再受理新的就绪请求", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const client = createSimulationClient();
    client.dispose();
    await expect(client.ready()).rejects.toThrow("Disposed");
  });
});
