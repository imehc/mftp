import { afterEach, describe, expect, it, vi } from "vitest";

import { playCueImpact, playImpactEvent } from "./audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("台球后台反馈", () => {
  it("进入后台后不创建音频上下文，也不触发击球震动", () => {
    const audioContext = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal("document", { hidden: true });
    vi.stubGlobal("AudioContext", audioContext);
    vi.stubGlobal("navigator", { vibrate });

    playCueImpact(0.8);
    playImpactEvent({ type: "ball-ball", impact: 4, a: 0, b: 1, t: 0 });

    expect(audioContext).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
