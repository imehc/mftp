import { afterEach, describe, expect, it, vi } from "vitest";

import { createTonePlayer } from "./tone-player";

function makeOscillator() {
  return {
    type: "",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn((node: unknown) => node),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
}

function makeGain() {
  return {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function installAudio() {
  const contexts: FakeContext[] = [];

  class FakeContext {
    state = "running";
    currentTime = 10;
    destination = {};
    oscillators: ReturnType<typeof makeOscillator>[] = [];
    gains: ReturnType<typeof makeGain>[] = [];
    resume = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());

    constructor() {
      contexts.push(this);
    }

    createOscillator() {
      const osc = makeOscillator();
      this.oscillators.push(osc);
      return osc;
    }

    createGain() {
      const gain = makeGain();
      this.gains.push(gain);
      return gain;
    }
  }

  vi.stubGlobal("window", { AudioContext: FakeContext });
  return contexts;
}

afterEach(() => vi.unstubAllGlobals());

describe("游戏音频资源生命周期", () => {
  it("以音频时间轴调度延迟音符并保留音量包络", () => {
    const contexts = installAudio();
    const player = createTonePlayer();
    player.unlock();
    player.play([{ frequency: 659.25, duration: 0.16, delay: 0.09 }], 0.5);
    const ctx = contexts[0];
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(ctx.oscillators[0].start).toHaveBeenCalledWith(10.09);
    expect(ctx.oscillators[0].stop).toHaveBeenCalledWith(10.27);
    expect(ctx.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      659.25,
      10.09,
    );
    expect(ctx.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.09,
      10.102,
    );
    ctx.oscillators[0].onended?.();
    expect(ctx.gains[0].disconnect).toHaveBeenCalledOnce();
    player.stop();
    expect(ctx.oscillators[0].stop).toHaveBeenCalledOnce();
  });

  it("停止同时取消待播音符并断开节点，重复清理无副作用", () => {
    const contexts = installAudio();
    const player = createTonePlayer();
    player.unlock();
    player.play(
      [
        { frequency: 300, duration: 0.1 },
        { frequency: 240, duration: 0.1, delay: 0.06 },
      ],
      1,
    );
    player.stop();
    player.stop();
    for (const osc of contexts[0].oscillators) {
      expect(osc.stop).toHaveBeenLastCalledWith();
      expect(osc.stop).toHaveBeenCalledTimes(2);
      expect(osc.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("静音不创建节点，关闭后迟到播放不重建上下文，重新解锁可恢复", () => {
    const contexts = installAudio();
    const player = createTonePlayer();
    player.unlock();
    const tones = [{ frequency: 340, duration: 0.09 }];
    player.play(tones, 0);
    expect(contexts[0].oscillators).toHaveLength(0);
    player.dispose();
    player.dispose();
    player.play(tones, 1);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    player.unlock();
    player.play(tones, 1);
    expect(contexts[1].oscillators).toHaveLength(1);
  });

  it("不同游戏的停止与关闭互不影响", () => {
    const contexts = installAudio();
    const first = createTonePlayer();
    const second = createTonePlayer();
    first.unlock();
    second.unlock();
    second.play([{ frequency: 380, duration: 0.09 }], 1);
    first.dispose();
    expect(contexts[1].close).not.toHaveBeenCalled();
    expect(contexts[1].oscillators[0].stop).toHaveBeenCalledTimes(1);
  });

  it("解锁与关闭被拒绝时不产生未处理的拒绝", async () => {
    const contexts = installAudio();
    const player = createTonePlayer();
    player.unlock();
    contexts[0].resume.mockRejectedValue(new Error("denied"));
    contexts[0].close.mockRejectedValue(new Error("closed"));
    player.unlock();
    player.dispose();
    await Promise.resolve();
  });

  it("缺少音频接口时可以继续游戏", () => {
    vi.stubGlobal("window", {});
    const player = createTonePlayer();
    expect(() => {
      player.unlock();
      player.play([{ frequency: 340, duration: 0.09 }], 1);
      player.dispose();
    }).not.toThrow();
  });
});
