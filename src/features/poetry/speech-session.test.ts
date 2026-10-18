import { describe, expect, it, vi } from "vitest";

import type { SpeechSnapshot } from "~/bindings";

import { newerSpeechSnapshot, PoetrySpeechSession } from "./speech-session";

const input = {
  segments: ["床前明月光，疑是地上霜。"],
  voiceId: null,
  rate: 0.9,
};

function snapshot(sessionId: string, revision = 1): SpeechSnapshot {
  return {
    sessionId,
    revision,
    phase: "speaking",
    segmentIndex: 0,
    segmentCount: 1,
    textRange: null,
    voiceId: "chinese",
    error: null,
  };
}

function port() {
  return {
    speechStart: vi.fn(async (request) => snapshot(request.sessionId)),
    speechControl: vi.fn(async (id) => snapshot(id)),
    speechStop: vi.fn(async (id) => ({
      ...snapshot(id),
      phase: "stopped" as const,
    })),
  };
}

describe("诗词朗读会话", () => {
  it("尚未开始就离开时，不发送朗读请求", async () => {
    const api = port();
    const session = new PoetrySpeechSession(api, vi.fn());
    const pending = session.start(input);
    await session.dispose();
    await pending;
    expect(api.speechStart).not.toHaveBeenCalled();
  });

  it("在途开始完成后先停止旧页面，再开始新页面", async () => {
    const api = port();
    const calls: string[] = [];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    api.speechStart.mockImplementationOnce(async (request) => {
      calls.push("旧开始");
      started();
      await waiting;
      return snapshot(request.sessionId);
    });
    api.speechStop.mockImplementation(async (id) => {
      calls.push("停止");
      return { ...snapshot(id), phase: "stopped" };
    });
    api.speechStart.mockImplementation(async (request) => {
      calls.push("新开始");
      return snapshot(request.sessionId, 3);
    });
    const receive = vi.fn();
    const old = new PoetrySpeechSession(api, receive);
    const oldStart = old.start(input);
    await hasStarted;
    const dispose = old.dispose();
    const next = new PoetrySpeechSession(api, vi.fn());
    const nextStart = next.start(input);
    release();
    await Promise.all([oldStart, dispose, nextStart]);
    expect(calls).toEqual(["旧开始", "停止", "新开始"]);
    expect(receive).not.toHaveBeenCalled();
    await next.dispose();
  });

  it("试听替换会话后忽略旧会话事件", async () => {
    const api = port();
    const session = new PoetrySpeechSession(api, vi.fn());
    await session.start(input);
    const oldId = api.speechStart.mock.calls[0][0].sessionId;
    await session.start({ ...input, voiceId: "another" });
    expect(session.accepts(snapshot(oldId))).toBe(false);
    expect(
      session.accepts(snapshot(api.speechStart.mock.calls[1][0].sessionId)),
    ).toBe(true);
    await session.dispose();
  });

  it("失败不会阻塞后续用户发起的朗读", async () => {
    const api = port();
    const error = {
      kind: "custom",
      code: "speech:voice_missing",
      message: "Missing voice",
      args: {},
    };
    api.speechStart.mockRejectedValueOnce(error);
    const session = new PoetrySpeechSession(api, vi.fn());
    await expect(session.start(input)).rejects.toBe(error);
    await session.start(input);
    expect(api.speechStart).toHaveBeenCalledTimes(2);
    await session.dispose();
  });

  it("暂停继续携带当前会话，停止走独立清理命令", async () => {
    const api = port();
    const session = new PoetrySpeechSession(api, vi.fn());
    await session.start(input);
    const id = api.speechStart.mock.calls[0][0].sessionId;
    await session.control("pause");
    await session.control("resume");
    await session.control("stop");
    expect(api.speechControl.mock.calls).toEqual([
      [id, "pause"],
      [id, "resume"],
    ]);
    expect(api.speechStop).toHaveBeenCalledWith(id);
    await session.dispose();
  });

  it("迟到的 IPC 快照不会覆盖较新的原生事件", () => {
    const current = snapshot("current", 9);
    expect(newerSpeechSnapshot(current, snapshot("old", 3))).toBe(current);
    const next = snapshot("next", 10);
    expect(newerSpeechSnapshot(current, next)).toBe(next);
  });
});
