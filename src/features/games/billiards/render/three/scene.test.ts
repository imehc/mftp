import { Group, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHINESE_EIGHT, SNOOKER, type TableEquipment } from "../../equipment";
import { createInitialState } from "../../rules";
import { createSnookerState } from "../../snooker";
import { createCue } from "./cue";
import { createTableInput } from "./input";
import { createIntro } from "./intro";
import { createScene } from "./scene";

const mocks = vi.hoisted(() => ({
  disposeIntro: vi.fn(),
  disposeInput: vi.fn(),
  disposeResources: vi.fn(),
  syncBalls: vi.fn(),
  prepareRack: vi.fn((_state: unknown) => true),
  updateRack: vi.fn(),
  finishRack: vi.fn(),
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
    sync: mocks.syncBalls,
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
vi.mock("./rack-intro", () => ({
  createRackIntro: () => {
    let active = false;
    return {
      layer: new Group(),
      get active() {
        return active;
      },
      prepare(state: unknown) {
        active = mocks.prepareRack(state);
        return active;
      },
      update: mocks.updateRack,
      finish() {
        active = false;
        mocks.finishRack();
      },
    };
  },
}));

function setup(
  compile: Promise<void> = Promise.resolve(),
  resume = false,
  reduced = false,
  equipment: TableEquipment = CHINESE_EIGHT,
) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
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
  const state =
    equipment.id === "snooker"
      ? createSnookerState(15)
      : createInitialState("practice");
  const scene = createScene(
    renderer,
    callbacks,
    equipment,
    state.balls.map((ball) => ball.id),
    false,
    false,
    resume,
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
  it("斯诺克直接全桌淡入且不创建摆球工具", async () => {
    const { scene, callbacks } = setup(
      Promise.resolve(),
      false,
      false,
      SNOOKER,
    );
    await Promise.resolve();
    expect(mocks.prepareRack).not.toHaveBeenCalled();
    const intro = vi.mocked(createIntro).mock.lastCall![0];
    expect(intro.resume).toBe(true);
    intro.ready();
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    scene.destroy();
  });

  it("预热和入场期间锁定输入，完成时才交接最新请求的交互状态", async () => {
    const { scene, state, callbacks, input, renderer } = setup();
    expect(input.enabled()).toBe(false);
    expect(renderer.domElement.style.opacity).toBe("0");
    await Promise.resolve();
    expect(createIntro).toHaveBeenCalledTimes(1);
    const cue = vi.mocked(createCue).mock.results.at(-1)!.value;
    const poses = cue.pose.mock.calls.length;
    const intro = vi.mocked(createIntro).mock.lastCall![0];
    expect(renderer.domElement.style.opacity).toBe("0");
    intro.reveal(0.5);
    intro.update();
    expect(renderer.domElement.style.opacity).toBe("0.5");
    expect(cue.pose).toHaveBeenCalledTimes(poses);
    expect(mocks.prepareRack).toHaveBeenCalledTimes(1);
    expect(mocks.updateRack).toHaveBeenCalled();
    const syncs = mocks.syncBalls.mock.calls.length;
    scene.setPosition(state, false);
    expect(mocks.syncBalls).toHaveBeenCalledTimes(syncs);
    vi.mocked(createIntro).mock.lastCall![0].ready();
    expect(input.enabled()).toBe(false);
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(mocks.finishRack).toHaveBeenCalledTimes(1);
    intro.ready();
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    scene.setPosition(state, true);
    expect(input.enabled()).toBe(true);
    expect(createIntro).toHaveBeenCalledTimes(1);
    scene.destroy();
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    "恢复或减少动态效果不创建球框（恢复：%s，减少：%s）",
    async (resume, reduced) => {
      const { scene } = setup(Promise.resolve(), resume, reduced);
      await Promise.resolve();
      expect(mocks.prepareRack).not.toHaveBeenCalled();
      expect(vi.mocked(createIntro).mock.lastCall![0].resume).toBe(true);
      scene.destroy();
    },
  );

  it("预热失败沿用错误回调且不交接输入", async () => {
    const error = new Error("shader warmup failed");
    const { scene, callbacks, input } = setup(Promise.reject(error));
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.onError).toHaveBeenCalledWith(error);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(input.enabled()).toBe(false);
    scene.destroy();
  });

  it("入场同步不打断临时球位，完成时以最新真实快照收尾", async () => {
    const { scene, state } = setup();
    await Promise.resolve();
    const next = {
      ...state,
      balls: state.balls.map((ball) => ({ ...ball, x: ball.x + 0.01 })),
    };
    const syncs = mocks.syncBalls.mock.calls.length;
    scene.setPosition(next, true);
    expect(mocks.syncBalls).toHaveBeenCalledTimes(syncs);
    vi.mocked(createIntro).mock.lastCall![0].ready();
    expect(mocks.syncBalls).toHaveBeenLastCalledWith(next.balls);
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
