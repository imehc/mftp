import gsap from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIntro, hasEntered, markEntered } from "./intro";

function setup(repeat = false, reduced = false, resume = false) {
  const options = {
    repeat,
    reduced,
    resume,
    camera: vi.fn(),
    rack: vi.fn(),
    reveal: vi.fn(),
    update: vi.fn(),
    ready: vi.fn(),
  };
  const spy = vi.spyOn(gsap, "timeline");
  const intro = createIntro(options);
  const timeline = spy.mock.results.at(-1)!.value as gsap.core.Timeline;
  timeline.pause();
  return { options, intro, timeline };
}

afterEach(() => {
  gsap.globalTimeline.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("台球摆球与连贯拉远入场", () => {
  it("显现后推球到位，先抬框再退出，同时连贯拉远后交接输入", () => {
    const { options, timeline } = setup();
    expect(options.camera).toHaveBeenLastCalledWith(1);
    expect(options.reveal).toHaveBeenLastCalledWith(0);
    expect(timeline.duration()).toBeCloseTo(2.2);
    const pace = 2.2 / 1.55;
    timeline.totalTime(0.4 * pace, false);
    expect(options.camera).toHaveBeenLastCalledWith(1);
    expect(options.rack.mock.lastCall![0].push).toBeGreaterThan(0);
    expect(options.rack.mock.lastCall![0].push).toBeLessThan(1);
    expect(options.reveal).toHaveBeenLastCalledWith(1);
    expect(options.ready).not.toHaveBeenCalled();
    timeline.totalTime(0.82 * pace, false);
    expect(options.rack.mock.lastCall![0].push).toBe(1);
    expect(options.rack.mock.lastCall![0].lift).toBeGreaterThan(0);
    expect(options.rack.mock.lastCall![0].exit).toBe(0);
    expect(options.camera.mock.lastCall![0]).toBeLessThan(1);
    timeline.totalTime(1.15 * pace, false);
    expect(options.rack.mock.lastCall![0].lift).toBe(1);
    expect(options.rack.mock.lastCall![0].exit).toBeGreaterThan(0);
    expect(options.camera.mock.lastCall![0]).toBeGreaterThan(0);
    expect(options.ready).not.toHaveBeenCalled();
    timeline.totalTime(2.2, false);
    expect(options.rack.mock.lastCall![0]).toMatchObject({
      push: 1,
      lift: 1,
      exit: 1,
      opacity: 0,
    });
    expect(options.camera).toHaveBeenLastCalledWith(0);
    expect(options.reveal).toHaveBeenLastCalledWith(1);
    expect(options.ready).toHaveBeenCalledTimes(1);
    expect(options.update.mock.invocationCallOrder.at(-1)).toBeLessThan(
      options.ready.mock.invocationCallOrder[0],
    );
  });

  it("同页重开缩短整套摆球拉远而不是省略推球", () => {
    const { options, timeline } = setup(true);
    expect(options.camera).toHaveBeenLastCalledWith(1);
    expect(timeline.duration()).toBeCloseTo(1.3);
    const pace = 1.3 / 0.93;
    timeline.totalTime(0.24 * pace, false);
    expect(options.rack.mock.lastCall![0].push).toBeGreaterThan(0);
    expect(options.rack.mock.lastCall![0].push).toBeLessThan(1);
    timeline.totalTime(0.6 * pace, false);
    expect(options.camera.mock.lastCall![0]).toBeGreaterThan(0);
    expect(options.camera.mock.lastCall![0]).toBeLessThan(1);
    expect(options.reveal).toHaveBeenLastCalledWith(1);
    expect(options.ready).not.toHaveBeenCalled();
    timeline.totalTime(1.3, false);
    expect(options.camera).toHaveBeenLastCalledWith(0);
    expect(options.ready).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "减少动态效果仅淡入，镜头始终静止（重开：%s）",
    (repeat) => {
      const { options, timeline } = setup(repeat, true);
      expect(timeline.duration()).toBeCloseTo(0.16);
      timeline.totalTime(0.08, false);
      expect(options.ready).not.toHaveBeenCalled();
      timeline.totalTime(0.16, false);
      expect(options.camera.mock.calls.every(([value]) => value === 0)).toBe(
        true,
      );
      expect(options.reveal).toHaveBeenLastCalledWith(1);
      expect(options.ready).toHaveBeenCalledTimes(1);
    },
  );

  it("恢复对局覆盖重开标记，仅以最终取景短淡入", () => {
    const { options, timeline } = setup(true, false, true);
    expect(timeline.duration()).toBeCloseTo(0.16);
    timeline.totalTime(0.16, false);
    expect(options.camera.mock.calls.every(([value]) => value === 0)).toBe(
      true,
    );
    expect(options.rack.mock.lastCall![0].push).toBe(0);
    expect(options.ready).toHaveBeenCalledTimes(1);
  });

  it("销毁移除时间线且幂等，迟到更新和完成不再触发场景回调", () => {
    const { options, intro, timeline } = setup();
    timeline.totalTime(0.08, false);
    const update = timeline.eventCallback("onUpdate");
    const complete = timeline.eventCallback("onComplete");
    intro.dispose();
    intro.dispose();
    expect(timeline.parent).toBeNull();
    const updates = options.update.mock.calls.length;
    update?.();
    complete?.();
    gsap.updateRoot(gsap.globalTimeline.time() + 1);
    expect(options.update).toHaveBeenCalledTimes(updates);
    expect(options.ready).not.toHaveBeenCalled();
  });

  it("只对原页面记录已入场，不保留或影响新页面", () => {
    const host = {} as Element;
    const nextHost = {} as Element;
    expect(hasEntered(host)).toBe(false);
    markEntered(host);
    expect(hasEntered(host)).toBe(true);
    expect(hasEntered(nextHost)).toBe(false);
  });
});
