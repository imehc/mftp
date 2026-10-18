// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpeechSnapshot } from "~/bindings";

import { createSpeechDocument } from "./speech-document";
import { PoetrySpeechFollow, SPEECH_FOLLOW_IDLE_MS } from "./speech-follow";
import { SpeechLines } from "./speech-lines";

vi.mock("~/lib/motion", () => ({ prefersReducedMotion: () => true }));

const snapshot: SpeechSnapshot = {
  revision: 1,
  sessionId: "test",
  phase: "speaking",
  segmentIndex: 1,
  segmentCount: 2,
  textRange: { start: 0, length: 2 },
  voiceId: null,
  error: null,
};
let follow: PoetrySpeechFollow;
let viewport: HTMLDivElement;
let visibleTop = 600;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  visibleTop = 600;
  viewport = document.createElement("div");
  const root = document.createElement("article");
  const paragraph = document.createElement("p");
  paragraph.dataset.poetrySpeech = "body-0";
  paragraph.textContent = "床前明月光";
  root.append(paragraph);
  viewport.append(root);
  document.body.append(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { value: 300 },
    scrollHeight: { value: 1200 },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 300, 300),
  );
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const rect = () => new DOMRect(0, visibleTop - viewport.scrollTop, 100, 20);
  vi.spyOn(range, "getBoundingClientRect").mockImplementation(rect);
  vi.spyOn(range, "getClientRects").mockImplementation(
    () => [rect()] as unknown as DOMRectList,
  );
  vi.spyOn(SpeechLines.prototype, "lineAt").mockReturnValue(range);
  follow = new PoetrySpeechFollow(
    root,
    viewport,
    createSpeechDocument({
      title: "静夜思",
      dynasty: "唐",
      author: "李白",
      body: ["床前明月光"],
    }),
  );
});

afterEach(() => {
  follow?.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("朗读跟随与用户操作仲裁", () => {
  it("当前行可见时不改变阅读位置", () => {
    visibleTop = 100;
    follow.update(snapshot, false);
    expect(viewport.scrollTop).toBe(0);
  });

  it("没有用户操作时仅将不可见行带入正文视口", () => {
    follow.update(snapshot, false);
    expect(viewport.scrollTop).toBe(344);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("连续滚轮操作重置空闲时间，满三秒后才跟随", () => {
    document.dispatchEvent(new WheelEvent("wheel"));
    follow.update(snapshot, false);
    vi.advanceTimersByTime(2000);
    document.dispatchEvent(new WheelEvent("wheel"));
    vi.advanceTimersByTime(SPEECH_FOLLOW_IDLE_MS - 1);
    expect(viewport.scrollTop).toBe(0);
    vi.advanceTimersByTime(1);
    expect(viewport.scrollTop).toBe(344);
  });

  it("拖动未结束时不因计时结束而跟随，松开后重新计时", () => {
    document.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1 }));
    follow.update(snapshot, false);
    vi.advanceTimersByTime(5000);
    expect(viewport.scrollTop).toBe(0);
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    vi.advanceTimersByTime(SPEECH_FOLLOW_IDLE_MS);
    expect(viewport.scrollTop).toBe(344);
  });

  it("保留选区期间不抢滚动，取消选区后等待空闲", () => {
    const selected = vi
      .spyOn(document, "getSelection")
      .mockReturnValue({ isCollapsed: false } as Selection);
    follow.update(snapshot, false);
    vi.advanceTimersByTime(5000);
    expect(viewport.scrollTop).toBe(0);
    selected.mockReturnValue({ isCollapsed: true } as Selection);
    document.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(SPEECH_FOLLOW_IDLE_MS);
    expect(viewport.scrollTop).toBe(344);
  });

  it("暂停和弹窗阻止跟随，恢复后只跟随当前行", () => {
    follow.update({ ...snapshot, phase: "paused" }, false);
    vi.advanceTimersByTime(5000);
    expect(viewport.scrollTop).toBe(0);
    follow.update(snapshot, true);
    expect(viewport.scrollTop).toBe(0);
    follow.update(snapshot, false);
    expect(viewport.scrollTop).toBe(344);
  });

  it("停止和卸载清除计时与高亮，不移动后来打开的页面", () => {
    document.dispatchEvent(new WheelEvent("wheel"));
    follow.update(snapshot, false);
    follow.update({ ...snapshot, phase: "stopped", textRange: null }, false);
    vi.advanceTimersByTime(5000);
    expect(viewport.scrollTop).toBe(0);
    follow.update(snapshot, true);
    follow.dispose();
    document.dispatchEvent(new WheelEvent("wheel"));
    vi.advanceTimersByTime(5000);
    expect(viewport.querySelector(".poetry-speech-overlay")).toBeNull();
    expect(viewport.scrollTop).toBe(0);
  });
});
