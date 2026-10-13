import { beforeEach, describe, expect, it, vi } from "vitest";

import { playImpactEvent } from "./audio";
import { type PlaybackTick, runPresentation } from "./playback";

vi.mock("./audio", () => ({ playImpactEvent: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function setup() {
  let tick: ((ticker: PlaybackTick) => void) | null = null;
  const app = {
    ticker: {
      add: (callback: typeof tick) => {
        tick = callback;
      },
      remove: vi.fn(() => {
        tick = null;
      }),
    },
  };
  const view = { scale: { set: vi.fn() }, alpha: 1, visible: true };
  const hooks = {
    moveBall: vi.fn(),
    ballView: () => view,
    maskPocket: vi.fn(),
    onDone: vi.fn(),
  };
  return {
    app,
    hooks,
    view,
    advance(ms: number) {
      tick?.({ deltaMS: ms });
    },
  };
}

describe("击球回放生命周期", () => {
  it("三维落袋回调完整控制入口移动和下沉，通用回放不重复移动或淡出", async () => {
    const state = setup();
    const sink = vi.fn();
    const view = { visible: true, alpha: 1, sink };
    const event = {
      type: "pocket" as const,
      t: 0,
      ball: 0,
      pocket: 5,
      x: 0,
      y: 0.65,
      vx: 0,
      vy: 1,
    };
    const playback = runPresentation(
      state.app,
      { frames: [{ t: 0, balls: [] }], events: [event] },
      { ...state.hooks, ballView: () => view },
    );
    state.advance(50);
    expect(sink).toHaveBeenLastCalledWith(0.05 / 0.24, event);
    expect(state.hooks.moveBall).not.toHaveBeenCalled();
    expect(view.alpha).toBe(1);
    for (let step = 0; step < 4; step++) state.advance(50);
    await playback.done;
    expect(view.visible).toBe(false);
  });

  it("从零时刻插值，声音仅在事件时间触发一次", async () => {
    const s = setup();
    const playback = runPresentation(
      s.app,
      {
        frames: [
          { t: 0, balls: [0, 0, 0] },
          { t: 0.1, balls: [0, 1, 0] },
        ],
        events: [{ type: "cushion", t: 0.075, ball: 0, impact: 1 }],
      },
      s.hooks,
    );
    s.advance(25);
    expect(s.hooks.moveBall).toHaveBeenLastCalledWith(0, 0.25, 0, true);
    expect(playImpactEvent).not.toHaveBeenCalled();
    s.advance(50);
    expect(playImpactEvent).toHaveBeenCalledTimes(1);
    s.advance(25);
    await playback.done;
    expect(s.hooks.onDone).toHaveBeenCalledTimes(1);
  });

  it("最后一球沿入射方向落袋，遮挡和下沉完成后才结算", async () => {
    const s = setup();
    const playback = runPresentation(
      s.app,
      {
        frames: [
          { t: 0, balls: [0, 0, 0.6] },
          { t: 0.05, balls: [] },
        ],
        events: [
          {
            type: "pocket",
            t: 0.04,
            ball: 0,
            pocket: 5,
            x: 0.01,
            y: 0.65,
            vx: 0.2,
            vy: 1,
          },
        ],
      },
      s.hooks,
    );
    s.advance(50);
    expect(s.hooks.maskPocket).toHaveBeenCalledWith(0, 5);
    expect(s.hooks.onDone).not.toHaveBeenCalled();
    const last = s.hooks.moveBall.mock.lastCall!;
    expect((last[1] - 0.01) / (last[2] - 0.65)).toBeCloseTo(0.2);
    for (let i = 0; i < 5; i++) s.advance(50);
    await playback.done;
    expect(s.view.visible).toBe(false);
    expect(s.hooks.onDone).toHaveBeenCalledTimes(1);
  });

  it("退出取消会兑现等待，并停止位置和声音更新", async () => {
    const s = setup();
    const playback = runPresentation(
      s.app,
      {
        frames: [
          { t: 0, balls: [0, 0, 0] },
          { t: 1, balls: [0, 1, 0] },
        ],
        events: [{ type: "cushion", t: 0.5, ball: 0, impact: 1 }],
      },
      s.hooks,
    );
    playback.cancel();
    playback.cancel();
    await playback.done;
    s.advance(50);
    expect(s.hooks.moveBall).not.toHaveBeenCalled();
    expect(playImpactEvent).not.toHaveBeenCalled();
    expect(s.hooks.onDone).toHaveBeenCalledTimes(1);
  });
});
