// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  poetryReadingSession,
  type ReadingPositionKey,
} from "../reading-session";
import { usePoetryReadingPosition } from "./use-poetry-reading-position";

let root: Root;
let container: HTMLDivElement;
let viewport: HTMLDivElement;
let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;
let contentHeight: number;

function Probe({
  uid,
  positionKey,
  ready,
}: {
  uid: string;
  positionKey: ReadingPositionKey;
  ready: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePoetryReadingPosition({ uid, positionKey, ready, viewport: ref });
  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (element) {
          viewport = element;
          Object.defineProperty(element, "scrollHeight", {
            configurable: true,
            get: () => contentHeight,
          });
          Object.defineProperty(element, "clientHeight", {
            configurable: true,
            value: 200,
          });
        }
      }}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callbacks = new Map();
  nextFrame = 0;
  contentHeight = 2000;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  poetryReadingSession.setState({ entries: [], location: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  positionKey: ReadingPositionKey,
  ready = true,
  uid = "甲",
) {
  await act(async () =>
    root.render(<Probe uid={uid} positionKey={positionKey} ready={ready} />),
  );
}

async function frames() {
  await act(async () => {
    await Promise.resolve();
    for (let i = 0; i < 3; i++) {
      const current = [...callbacks.values()];
      callbacks.clear();
      current.forEach((callback) => callback(0));
    }
  });
}

async function scroll(top: number) {
  viewport.scrollTop = top;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
}

describe("诗词面板滚动恢复", () => {
  it("等待异步内容后恢复，加载态不会把保存位置覆盖为零", async () => {
    poetryReadingSession
      .getState()
      .update("甲", { positions: { "mobile-translation": 800 } });
    await render("mobile-translation", false);
    await frames();
    expect(viewport.scrollTop).toBe(0);
    await render("mobile-translation");
    await frames();
    expect(viewport.scrollTop).toBe(800);
  });

  it("独立保存各个标签的位置，切换后再返回恢复原位置", async () => {
    await render("mobile-annotations");
    await frames();
    await scroll(620);
    await render("mobile-translation");
    await frames();
    expect(viewport.scrollTop).toBe(0);
    await scroll(410);
    await render("mobile-annotations");
    await frames();
    expect(viewport.scrollTop).toBe(620);
    expect(
      poetryReadingSession.getState().entries[0].positions[
        "mobile-translation"
      ],
    ).toBe(410);
  });

  it("内容变短安全收敛，跨布局不会套用移动坐标", async () => {
    poetryReadingSession
      .getState()
      .update("甲", { positions: { "mobile-annotations": 800 } });
    contentHeight = 500;
    await render("mobile-annotations");
    await frames();
    expect(viewport.scrollTop).toBe(300);
    await render("desktop-annotations");
    await frames();
    expect(viewport.scrollTop).toBe(0);
  });

  it("桌面首次切换辅助内容保留标签所在位置", async () => {
    await render("desktop-annotations");
    await frames();
    await scroll(700);
    await render("desktop-translation");
    await frames();
    expect(viewport.scrollTop).toBe(700);
  });

  it("用户在译文到达前已经滚动时不强行拉回旧位置", async () => {
    poetryReadingSession
      .getState()
      .update("甲", { positions: { "desktop-translation": 800 } });
    await render("desktop-translation", false);
    viewport.dispatchEvent(new Event("wheel"));
    await scroll(120);
    await render("desktop-translation");
    await frames();
    expect(viewport.scrollTop).toBe(120);
  });

  it("离开作品会取消尚未执行的恢复，不污染下一首诗", async () => {
    poetryReadingSession
      .getState()
      .update("甲", { positions: { "mobile-translation": 800 } });
    await render("mobile-translation");
    await render("mobile-translation", true, "乙");
    await frames();
    expect(viewport.scrollTop).toBe(0);
    expect(
      poetryReadingSession
        .getState()
        .entries.find((entry) => entry.uid === "甲")?.positions[
        "mobile-translation"
      ],
    ).toBe(800);
  });
});
