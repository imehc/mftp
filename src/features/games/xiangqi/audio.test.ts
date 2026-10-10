import { afterEach, describe, expect, it, vi } from "vitest";

import {
  playCheckSound,
  playFinishSound,
  playMoveSound,
  unlockXiangqiAudio,
  xiangqiAudio,
} from "./audio";

function parameter() {
  return {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

function node() {
  return {
    type: "",
    buffer: null as unknown,
    frequency: parameter(),
    Q: parameter(),
    gain: parameter(),
    connect: vi.fn((target: unknown) => target),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
}

function installAudio() {
  const contexts: FakeContext[] = [];

  class FakeContext {
    state = "running";
    currentTime = 10;
    sampleRate = 48000;
    destination = {};
    sources: ReturnType<typeof node>[] = [];
    nodes: ReturnType<typeof node>[] = [];
    resume = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    createBuffer = vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }));

    constructor() {
      contexts.push(this);
    }

    createOscillator() {
      const source = node();
      this.sources.push(source);
      return source;
    }

    createBufferSource() {
      return this.createOscillator();
    }

    createGain() {
      const gain = node();
      this.nodes.push(gain);
      return gain;
    }

    createBiquadFilter() {
      return this.createGain();
    }
  }

  vi.stubGlobal("window", { AudioContext: FakeContext });
  return contexts;
}

afterEach(() => {
  xiangqiAudio.dispose();
  vi.unstubAllGlobals();
});

describe("象棋音效资源", () => {
  it("保留吃子木音参数，退出取消第二次待播敲击并断开全部节点", () => {
    const contexts = installAudio();
    unlockXiangqiAudio();
    playMoveSound(1, true);
    const ctx = contexts[0];
    expect(ctx.sources).toHaveLength(4);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(10);
    expect(ctx.sources[2].start).toHaveBeenCalledWith(10.065);
    expect(ctx.nodes[0].frequency.setValueAtTime).toHaveBeenCalledWith(820, 10);
    expect(ctx.nodes[3].frequency.setValueAtTime).toHaveBeenCalledWith(
      610,
      10.065,
    );
    expect(ctx.createBuffer).toHaveBeenCalledOnce();
    xiangqiAudio.stop();
    xiangqiAudio.stop();
    for (const source of ctx.sources) {
      expect(source.stop).toHaveBeenCalledTimes(2);
      expect(source.stop).toHaveBeenLastCalledWith();
    }
    for (const part of [...ctx.sources, ...ctx.nodes]) {
      expect(part.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("自然结束断开节点，结束音仍按原频率和延迟调度", () => {
    const contexts = installAudio();
    unlockXiangqiAudio();
    playFinishSound(0.5);
    const ctx = contexts[0];
    for (const [index, frequency, delay] of [
      [0, 261.63, 0.12],
      [1, 392, 0.2],
      [2, 523.25, 0.3],
    ]) {
      const source = ctx.sources[index];
      expect(source.type).toBe("triangle");
      expect(source.frequency.setValueAtTime).toHaveBeenCalledWith(
        frequency,
        10 + delay,
      );
      source.onended?.();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    xiangqiAudio.stop();
    for (const source of ctx.sources)
      expect(source.stop).toHaveBeenCalledOnce();
    for (const gain of ctx.nodes)
      expect(gain.disconnect).toHaveBeenCalledOnce();
  });

  it("静音不创建节点，页面释放后迟到音效不能重建上下文", () => {
    const contexts = installAudio();
    unlockXiangqiAudio();
    playMoveSound(0, true);
    playCheckSound(0, true);
    playFinishSound(0);
    expect(contexts[0].sources).toHaveLength(0);
    playMoveSound(1, false);
    xiangqiAudio.dispose();
    playFinishSound(1);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    unlockXiangqiAudio();
    playMoveSound(1, false);
    expect(contexts[1].createBuffer).toHaveBeenCalledOnce();
    expect(contexts[1].sources[0].buffer).not.toBe(
      contexts[0].sources[0].buffer,
    );
  });

  it("解锁被拒绝后仍允许下次手势重试", async () => {
    const contexts = installAudio();
    unlockXiangqiAudio();
    contexts[0].resume.mockRejectedValueOnce(new Error("denied"));
    unlockXiangqiAudio();
    await Promise.resolve();
    unlockXiangqiAudio();
    expect(contexts[0].resume).toHaveBeenCalledTimes(3);
    expect(contexts).toHaveLength(1);
  });
});
