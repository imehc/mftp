// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialReversiState } from "./rules";
import { useReversiScene } from "./use-reversi-scene";

const { createScene } = vi.hoisted(() => ({ createScene: vi.fn() }));
vi.mock("./scene", () => ({ createReversiScene: createScene }));

function Harness() {
  const { canvas, status, generation, retry } = useReversiScene(
    createInitialReversiState(),
  );
  return (
    <>
      <canvas ref={canvas} key={generation} />
      <button onClick={retry}>{status}</button>
    </>
  );
}

function scene() {
  return { resize: vi.fn(), sync: vi.fn(), dispose: vi.fn() };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  createScene.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("黑白棋渲染器生命周期", () => {
  it("初始化尚未完成就离开页面时释放迟到的画布资源", async () => {
    let resolve!: (value: ReturnType<typeof scene>) => void;
    createScene.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      root.unmount();
    });
    const late = scene();
    await act(async () => resolve(late));
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(late.sync).not.toHaveBeenCalled();
    root = createRoot(host);
  });

  it("上下文丢失时退回基础棋盘，重试重新建立渲染器", async () => {
    const first = scene();
    const second = scene();
    createScene.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await act(async () => {
      root.render(<Harness />);
    });
    expect(host.querySelector("button")?.textContent).toBe("ready");
    await act(async () => {
      host
        .querySelector("canvas")
        ?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(host.querySelector("button")?.textContent).toBe("failed");
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(createScene).toHaveBeenCalledTimes(2);
    expect(second.sync).toHaveBeenCalledWith(createInitialReversiState());
    expect(host.querySelector("button")?.textContent).toBe("ready");
  });
});
