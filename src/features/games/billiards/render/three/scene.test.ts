import { Group, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHINESE_EIGHT } from "../../equipment";
import { createInitialState } from "../../rules";
import { createCue } from "./cue";
import { createTableInput } from "./input";
import { createIntro } from "./intro";
import { createScene } from "./scene";

const mocks = vi.hoisted(() => ({
  disposeIntro: vi.fn(),
  disposeInput: vi.fn(),
  disposeResources: vi.fn(),
}));

vi.mock("../audio", () => ({
  playCueImpact: vi.fn(),
  stopBilliardsAudio: vi.fn(),
}));
vi.mock("../aim-preview", () => ({
  createAimPreview: () => ({
    invalidate: vi.fn(),
    get: () => null,
    dispose: vi.fn(),
  }),
}));
vi.mock("./balls", () => ({
  createBallLayer: () => ({
    layer: new Group(),
    meshes: new Map(),
    sync: vi.fn(),
  }),
}));
vi.mock("./ball-selection", () => ({
  createBallSelection: () => ({
    layer: new Group(),
    active: false,
    set: vi.fn(),
    preview: vi.fn(),
    select: vi.fn(),
    resize: vi.fn(),
    reconcile: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock("./table", () => ({ buildTable: () => new Group() }));
vi.mock("./cue", () => ({
  createCue: vi.fn(() => ({ layer: new Group(), pose: vi.fn() })),
}));
vi.mock("./hud", () => ({
  createHud: () => ({
    layer: new Group(),
    clear: vi.fn(),
    guide: vi.fn(),
    opacity: vi.fn(),
    resize: vi.fn(),
  }),
}));
vi.mock("./lighting", () => ({
  createLighting: () => ({ entrance: vi.fn(), dispose: vi.fn() }),
}));
vi.mock("./resources", () => ({
  createResources: () => ({ dispose: mocks.disposeResources }),
}));
vi.mock("./clock", () => ({
  createRenderClock: () => ({ invalidate: vi.fn(), dispose: vi.fn() }),
}));
vi.mock("./input", () => ({
  createTableInput: vi.fn(() => ({
    cancel: vi.fn(),
    dispose: mocks.disposeInput,
  })),
}));
vi.mock("./intro", () => ({
  createIntro: vi.fn(() => ({ dispose: mocks.disposeIntro })),
}));

function setup(compile: Promise<void> = Promise.resolve()) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const renderer = {
    domElement: {
      style: { opacity: "1" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    compileAsync: vi.fn(() => compile),
  } as unknown as WebGLRenderer;
  const callbacks = {
    onPowerPreview: vi.fn(),
    onShot: vi.fn(),
    onPlaceCue: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn(),
  };
  const state = createInitialState("practice");
  const scene = createScene(
    renderer,
    callbacks,
    CHINESE_EIGHT,
    state.balls.map((ball) => ball.id),
    false,
  );
  scene.resize(1024, 600);
  scene.setPosition(state, true);
  const input = vi.mocked(createTableInput).mock.lastCall![2];
  return { scene, state, callbacks, input, renderer };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("台球入场场景生命周期", () => {
  it("预热和入场期间锁定输入，完成时才交接最新请求的交互状态", async () => {
    const { scene, state, callbacks, input, renderer } = setup();
    expect(input.enabled()).toBe(false);
    expect(renderer.domElement.style.opacity).toBe("0");
    await Promise.resolve();
    expect(createIntro).toHaveBeenCalledTimes(1);
    const cue = vi.mocked(createCue).mock.results.at(-1)!.value;
    const poses = cue.pose.mock.calls.length;
    const intro = vi.mocked(createIntro).mock.lastCall![0];
    // 预热完成后也保持隐藏，由时间线统一显现场景，避免先闪出完整球桌。
    expect(renderer.domElement.style.opacity).toBe("0");
    intro.reveal(0.5);
    intro.update();
    expect(renderer.domElement.style.opacity).toBe("0.5");
    expect(cue.pose).toHaveBeenCalledTimes(poses + 1);
    scene.setPosition(state, false);
    vi.mocked(createIntro).mock.lastCall![0].ready();
    expect(input.enabled()).toBe(false);
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    scene.setPosition(state, true);
    expect(input.enabled()).toBe(true);
    expect(createIntro).toHaveBeenCalledTimes(1);
    scene.destroy();
  });

  it("着色器预热结束前销毁，不创建入场动画也不再通知就绪", async () => {
    let finishCompile = () => {};

    const compile = new Promise<void>((resolve) => {
      finishCompile = resolve;
    });
    const { scene, callbacks, input } = setup(compile);
    scene.destroy();
    finishCompile();
    await Promise.resolve();
    expect(createIntro).not.toHaveBeenCalled();
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(input.enabled()).toBe(false);
    expect(mocks.disposeResources).toHaveBeenCalledTimes(1);
  });

  it("入场中销毁幂等，迟到完成不会重新开启输入或通知游戏", async () => {
    const { scene, callbacks, input } = setup();
    await Promise.resolve();
    const complete = vi.mocked(createIntro).mock.lastCall![0].ready;
    scene.destroy();
    scene.destroy();
    complete();
    expect(input.enabled()).toBe(false);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(mocks.disposeIntro).toHaveBeenCalledTimes(1);
    expect(mocks.disposeInput).toHaveBeenCalledTimes(1);
    expect(mocks.disposeResources).toHaveBeenCalledTimes(1);
  });
});
