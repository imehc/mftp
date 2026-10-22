import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TODO_CHANGED } from "~/lib/events";
import { isTauriRuntime } from "~/lib/files";

import { startTodoLiveSync } from "./todo-live-sync";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("~/lib/files", () => ({ isTauriRuntime: vi.fn(() => true) }));

function controller() {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    externalChanged: vi.fn(),
  };
}

describe("待办外部更新订阅生命周期", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { hidden: false }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("监听就绪补读覆盖注册窗口，提交事件立即通知且不常规轮询", async () => {
    const unlisten = vi.fn();

    let ready: (value: () => void) => void = () => {};

    vi.mocked(listen).mockReturnValueOnce(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    const target = controller();
    const stop = startTodoLiveSync(target);
    expect(target.start).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(TODO_CHANGED, expect.any(Function));
    expect(target.externalChanged).not.toHaveBeenCalled();
    ready(unlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(target.externalChanged).toHaveBeenCalledTimes(1);
    const listener = vi.mocked(listen).mock.calls[0][1];
    listener({ event: TODO_CHANGED, id: 1, payload: { itemId: "test" } });
    expect(target.externalChanged).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(target.externalChanged).toHaveBeenCalledTimes(2);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
    listener({ event: TODO_CHANGED, id: 1, payload: {} });
    expect(target.externalChanged).toHaveBeenCalledTimes(2);
  });

  it("监听失败仅启动有界只读兜底，隐藏时暂停，卸载释放", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("event unavailable"));
    const target = controller();
    const stop = startTodoLiveSync(target);
    await vi.advanceTimersByTimeAsync(0);
    const initial = target.externalChanged.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(target.externalChanged.mock.calls.length).toBe(initial + 1);
    Object.assign(document, { hidden: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(target.externalChanged.mock.calls.length).toBe(initial + 1);
    Object.assign(document, { hidden: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(target.externalChanged.mock.calls.length).toBeGreaterThan(
      initial + 1,
    );
    stop();
    const stopped = target.externalChanged.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(target.externalChanged.mock.calls.length).toBe(stopped);
    expect(target.stop).toHaveBeenCalledTimes(1);
  });

  it("窗口恢复焦点或可见立即补读，不在隐藏时读取", async () => {
    vi.mocked(listen).mockResolvedValueOnce(vi.fn());
    const target = controller();
    const stop = startTodoLiveSync(target);
    await Promise.resolve();
    await Promise.resolve();
    target.externalChanged.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(target.externalChanged).toHaveBeenCalledTimes(1);
    Object.assign(document, { hidden: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(target.externalChanged).toHaveBeenCalledTimes(1);
    Object.assign(document, { hidden: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(target.externalChanged).toHaveBeenCalledTimes(2);
    stop();
  });

  it("页面卸载后才完成注册立即解除且不迟到刷新", async () => {
    let ready: (value: () => void) => void = () => {};

    vi.mocked(listen).mockReturnValueOnce(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    const target = controller();
    const stop = startTodoLiveSync(target);
    stop();
    const unlisten = vi.fn();
    ready(unlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(target.externalChanged).not.toHaveBeenCalled();
  });
});
