import { describe, expect, it, vi } from "vitest";

import type {
  McpCredentialInput,
  McpIssuedCredential,
  McpModuleInfo,
  McpSnapshot,
} from "~/bindings";

import { createMcpController } from "./mcp-controller";

const snapshot: McpSnapshot = {
  running: false,
  stopping: false,
  port: 6021,
  endpoint: null,
  credentials: [],
};
const input: McpCredentialInput = {
  name: "客户端",
  grants: { todo: { read: true, write: true, delete: false } },
};
const issued: McpIssuedCredential = {
  credential: { ...input, id: "client", createdAt: 1 },
  token: "test-only-secret",
};
const failure = {
  kind: "custom" as const,
  code: "mcp:transport",
  message: "Isolated failure",
  args: {},
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const api = {
    snapshot: vi.fn(async (): Promise<McpSnapshot> => snapshot),
    catalog: vi.fn(async (): Promise<McpModuleInfo[]> => []),
    configure: vi.fn(async (_port: number) => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    create: vi.fn(async (_input: McpCredentialInput) => issued),
    update: vi.fn(async (_id: string, _input: McpCredentialInput) => {}),
    rotate: vi.fn(async (_id: string, _input: McpCredentialInput) => issued),
    revoke: vi.fn(async (_id: string) => {}),
  };
  const controller = createMcpController(api);
  return { controller, api, state: controller.store.getState };
}

describe("MCP 管理控制器", () => {
  it("启动失败只产生一次消息且不自动重放写入", async () => {
    const { controller, api, state } = setup();
    await controller.start();
    api.start.mockRejectedValueOnce(failure);
    expect(await controller.startServer()).toBe(false);
    expect(state().notice).toBe(1);
    expect(state().error).toEqual(failure);
    expect(state().snapshot?.running).toBe(false);
    await controller.refresh();
    expect(state().notice).toBe(1);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("后台读取同类失败去重并在恢复后重新提示", async () => {
    const { controller, api, state } = setup();
    api.snapshot.mockRejectedValue(failure);
    await controller.start();
    await controller.refresh();
    expect(state().notice).toBe(1);
    expect(state().readFailed).toBe(true);
    expect(state().snapshot).toBeNull();
    expect(await controller.startServer()).toBe(false);
    expect(api.start).not.toHaveBeenCalled();
    api.snapshot.mockResolvedValueOnce(snapshot);
    await controller.refresh();
    await controller.refresh();
    expect(state().notice).toBe(2);
  });

  it("写入锁保持到权威状态重读结束", async () => {
    const { controller, api, state } = setup();
    await controller.start();
    const pending = deferred<McpSnapshot>();
    api.snapshot.mockImplementationOnce(() => pending.promise);
    const starting = controller.startServer();
    await vi.waitFor(() => expect(api.snapshot).toHaveBeenCalledTimes(2));
    expect(state().pending).toBe("start");
    expect(await controller.stopServer()).toBe(false);
    pending.resolve({ ...snapshot, running: true });
    expect(await starting).toBe(true);
    expect(state().busy).toBe(false);
    expect(state().snapshot?.running).toBe(true);
    expect(api.stop).not.toHaveBeenCalled();
  });

  it("已提交授权不会因后续读取失败再次创建", async () => {
    const { controller, api, state } = setup();
    await controller.start();
    api.snapshot.mockRejectedValueOnce(failure);
    expect(await controller.create(input)).toBe(true);
    expect(state().issued).toEqual(issued);
    expect(state().readFailed).toBe(true);
    expect(api.create).toHaveBeenCalledTimes(1);
    controller.dismissIssued();
    expect(state().issued).toBeNull();
  });

  it("关闭页面后实际请求仍被锁住且不展示迟到凭据", async () => {
    const { controller, api, state } = setup();
    await controller.start();
    const pending = deferred<McpIssuedCredential>();
    api.create.mockImplementationOnce(() => pending.promise);
    const creating = controller.create(input);
    controller.close();
    await controller.start();
    expect(await controller.create(input)).toBe(false);
    pending.resolve(issued);
    expect(await creating).toBe(false);
    expect(state().issued).toBeNull();
    expect(state().busy).toBe(false);
  });

  it("关闭页面后的失败不产生消息", async () => {
    const { controller, api, state } = setup();
    await controller.start();
    const pending = deferred<void>();
    api.start.mockImplementationOnce(() => pending.promise);
    const starting = controller.startServer();
    controller.close();
    pending.reject(failure);
    await starting;
    expect(state().notice).toBe(0);
  });

  it("旧读取不能覆盖较新快照", async () => {
    const { controller, api, state } = setup();
    await controller.start();
    const pending = deferred<McpSnapshot>();
    api.snapshot.mockImplementationOnce(() => pending.promise);
    const old = controller.refresh();
    api.snapshot.mockResolvedValueOnce({ ...snapshot, port: 1490 });
    await controller.refresh();
    pending.resolve(snapshot);
    await old;
    expect(state().snapshot?.port).toBe(1490);
  });
});
