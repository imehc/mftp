import gsap from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIntro, hasEntered, markEntered } from "./intro";

function setup(repeat = false, reduced = false) {
  const options = {
    repeat,
    reduced,
    camera: vi.fn(),
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

describe("台球克制入场与重开", () => {
  it("首次整体显现后仍有可见推近，镜头收稳后才交接输入", () => {
    const { options, timeline } = setup();
    expect(options.camera).toHaveBeenLastCalledWith(1);
    expect(options.reveal).toHaveBeenLastCalledWith(0);
    expect(timeline.duration()).toBeCloseTo(0.5);
    timeline.totalTime(0.18, false);
    expect(options.camera.mock.lastCall![0]).toBeGreaterThan(0.5);
    expect(options.camera.mock.lastCall![0]).toBeLessThan(1);
    expect(options.reveal).toHaveBeenLastCalledWith(1);
    expect(options.ready).not.toHaveBeenCalled();
    timeline.totalTime(0.5, false);
    expect(options.camera).toHaveBeenLastCalledWith(0);
    expect(options.reveal).toHaveBeenLastCalledWith(1);
    expect(options.ready).toHaveBeenCalledTimes(1);
    expect(options.update.mock.invocationCallOrder.at(-1)).toBeLessThan(
      options.ready.mock.invocationCallOrder[0],
    );
  });

  it("同页重开保留半幅短推近，不会退化为瞬间出现", () => {
    const { options, timeline } = setup(true);
    expect(options.camera).toHaveBeenLastCalledWith(0.5);
    expect(timeline.duration()).toBeCloseTo(0.28);
    timeline.totalTime(0.14, false);
    expect(options.camera.mock.lastCall![0]).toBeGreaterThan(0);
    expect(options.camera.mock.lastCall![0]).toBeLessThan(0.5);
    expect(options.reveal).toHaveBeenLastCalledWith(1);
    expect(options.ready).not.toHaveBeenCalled();
    timeline.totalTime(0.28, false);
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
