// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebGLRenderer } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialState } from "../rules";
import { BilliardsStage } from "./BilliardsStage";
import { createScene } from "./three/scene";

vi.mock("./audio", () => ({ stopBilliardsAudio: vi.fn() }));
vi.mock("./three/intro", () => ({
  hasEntered: () => false,
  markEntered: vi.fn(),
}));
vi.mock("./three/scene", () => ({ createScene: vi.fn() }));
vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: vi.fn(function () {
    return {
      domElement: document.createElement("canvas"),
      shadowMap: {},
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
    };
  }),
}));

let root: Root;
let host: HTMLDivElement;
let scene: ReturnType<typeof sceneFixture>;
let resized: () => void;

function sceneFixture() {
  return {
    resize: vi.fn(),
    destroy: vi.fn(),
    setPosition: vi.fn(),
    setFollowDraw: vi.fn(),
    setAimOnly: vi.fn(),
    setSelection: vi.fn(),
    cancelInput: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 700);
  vi.stubGlobal("matchMedia", () =>
    Object.assign(new EventTarget(), { matches: false }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-billiards-input")
        ? new DOMRect(120, 90, 600, 400)
        : new DOMRect(20, 10, 800, 600);
    },
  );
  scene = sceneFixture();
  vi.mocked(createScene).mockReturnValue(
    scene as unknown as ReturnType<typeof createScene>,
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(onError = vi.fn(), key = 0, aimOnly = false) {
  await act(() =>
    root.render(
      <main className="billiards-game">
        <header>
          <button>操作</button>
        </header>
        <section className="billiards-stage">
          <BilliardsStage
            key={key}
            state={createInitialState("practice")}
            interactive
            aimOnly={aimOnly}
            followDraw={0}
            onPowerPreview={vi.fn()}
            onShot={() => true}
            onPlaceCue={vi.fn()}
            onError={onError}
          />
        </section>
      </main>,
    ),
  );
  return vi.mocked(WebGLRenderer).mock.results.at(-1)!.value as WebGLRenderer;
}

describe("台球全屏画布挂载与清理", () => {
  it("画布挂到文档根且不接收点击，包含导航偏移且输入仍绑定原球桌矩形", async () => {
    const renderer = await render();
    const input = host.querySelector<HTMLElement>("[data-billiards-input]");
    expect(renderer.domElement.parentElement).toBe(document.body);
    expect(renderer.domElement.style.pointerEvents).toBe("none");
    expect(renderer.domElement.getAttribute("aria-hidden")).toBe("true");
    expect(createScene).toHaveBeenCalledWith(
      renderer,
      input,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false,
      false,
      false,
    );
    expect(scene.resize).toHaveBeenLastCalledWith({
      width: 1000,
      height: 700,
      table: { x: 120, y: 90, width: 600, height: 400 },
      portrait: false,
    });
    expect(renderer.setSize).toHaveBeenCalledWith(1000, 700);
    expect(input?.contains(renderer.domElement)).toBe(false);
  });

  it("偏好更新同步到当前场景，不重建画布", async () => {
    const renderer = await render();
    expect(scene.setAimOnly).toHaveBeenLastCalledWith(false);
    await render(vi.fn(), 0, true);
    expect(scene.setAimOnly).toHaveBeenLastCalledWith(true);
    expect(WebGLRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  it("重开与卸载销毁旧画布和观察器，迟到测量不更新已释放的渲染器", async () => {
    const first = await render();
    const lateResize = resized;
    const firstScene = scene;
    scene = sceneFixture();
    vi.mocked(createScene).mockReturnValue(
      scene as unknown as ReturnType<typeof createScene>,
    );
    const second = await render(vi.fn(), 1);
    expect(first.domElement.isConnected).toBe(false);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(firstScene.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".billiards-canvas")).toHaveLength(1);
    const calls = vi.mocked(first.setSize).mock.calls.length;
    lateResize();
    expect(first.setSize).toHaveBeenCalledTimes(calls);
    await act(() => root.render(null));
    expect(second.domElement.isConnected).toBe(false);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(scene.destroy).toHaveBeenCalledTimes(1);
  });

  it("上下文丢失立即移除全屏画布并上报结构化错误", async () => {
    const error = vi.fn();
    const renderer = await render(error);
    await act(() =>
      renderer.domElement.dispatchEvent(
        new Event("webglcontextlost", { cancelable: true }),
      ),
    );
    expect(renderer.domElement.isConnected).toBe(false);
    expect(scene.destroy).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    resized();
    expect(scene.destroy).toHaveBeenCalledTimes(1);
  });
});
