// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktopLayout } from "~/lib/use-desktop-layout";
import type { PoemDetail as PoemDetailModel } from "~/types";

import { poetryReadingSession } from "../reading-session";
import { usePoetryStore } from "../store/poetry-store";
import PoemDetail from "./PoemDetail";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("~/lib/use-desktop-layout", () => ({
  useDesktopLayout: vi.fn(() => false),
}));
vi.mock("../hooks/use-poetry-speech", () => ({
  usePoetrySpeech: () => ({ snapshot: null }),
}));
vi.mock("../hooks/use-poetry-speech-follow", () => ({
  usePoetrySpeechFollow: vi.fn(),
}));
vi.mock("./PoetrySpeech", () => ({ default: () => <button>朗读原文</button> }));
vi.mock("./PoemAnnotations", () => ({
  AuthorBioSheet: () => null,
  PoemAnnotationContent: () => <p>测试注释</p>,
  CollapsibleStrains: () => null,
}));
vi.mock("./PoetryTranslationSection", () => ({
  default: function TranslationProbe() {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => {
        lifecycle.unmounts += 1;
      };
    }, []);
    return (
      <textarea
        aria-label="测试译文草稿"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));
i18n.load("zh-CN", {});
i18n.activate("zh-CN");
const detail = {
  uid: "poem",
  title: "应天长·一钩初月临妆镜",
  author: "李璟",
  dynasty: "五代",
  rhythmic: "应天长",
  body: ["一钩初月临妆镜，蝉鬓凤钗慵不整。"],
  notes: [],
  strains: [],
  annotation: null,
  authorBio: null,
} as unknown as PoemDetailModel;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(useDesktopLayout).mockReturnValue(false);
  poetryReadingSession.setState({ entries: [], location: null });
  usePoetryStore.setState({
    readingView: "original",
    referenceView: "translation",
  });
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <PoemDetail
          detail={detail}
          loading={false}
          settingsInHeader
          fontSize={18}
          lineHeight={1.8}
          onFontSizeChange={() => {}}
          onLineHeightChange={() => {}}
        />
      </I18nProvider>,
    ),
  );
}

function panel(value: string) {
  return container.querySelector<HTMLElement>(
    `[data-slot="tabs-content"][id$="content-${value}"]`,
  )!;
}

async function choose(label: string) {
  const tab = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((element) => element.textContent === label)!;
  await act(async () => {
    tab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
}

describe("原文与译文的阅读布局生命周期", () => {
  it("移动译文隐藏原文头部，切换时仍保留译文草稿和控制器", async () => {
    await render();
    const draft = container.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(draft, "尚未保存的译文草稿");
    await act(async () =>
      draft.dispatchEvent(new Event("input", { bubbles: true })),
    );
    await choose("译文");
    expect(panel("original").hidden).toBe(true);
    expect(panel("translation").hidden).toBe(false);
    expect(panel("translation").querySelector("h2")).toBeNull();
    expect(panel("original").querySelector("h2")?.textContent).toBe(
      detail.title,
    );
    await choose("原文");
    expect(container.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("尚未保存的译文草稿");
    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
  });

  it("跨桌面断点同时显示原文与译文，不重建译文控制器", async () => {
    await render();
    const draft = container.querySelector("textarea");
    await choose("译文");
    vi.mocked(useDesktopLayout).mockReturnValue(true);
    await render();
    expect(panel("original").hidden).toBe(false);
    expect(panel("translation").hidden).toBe(false);
    expect(container.querySelector("textarea")).toBe(draft);
    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
  });

  it("注释作为平级面板，切换到桌面仍与原文对照且不卸载译文", async () => {
    await render();
    await choose("注释");
    expect(panel("annotations").hidden).toBe(false);
    expect(panel("original").hidden).toBe(true);
    expect(panel("translation").hidden).toBe(true);
    vi.mocked(useDesktopLayout).mockReturnValue(true);
    await render();
    expect(panel("original").hidden).toBe(false);
    expect(panel("annotations").hidden).toBe(false);
    expect(panel("translation").hidden).toBe(true);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(lifecycle.mounts).toBe(1);
  });

  it("从其他页面回来重建详情时恢复注释标签", async () => {
    await render();
    await choose("注释");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(panel("annotations").hidden).toBe(false);
    expect(panel("translation").hidden).toBe(true);
  });

  it("移动切回原文不会抹掉桌面最近的注释面板", async () => {
    await render();
    await choose("注释");
    await choose("原文");
    vi.mocked(useDesktopLayout).mockReturnValue(true);
    await render();
    expect(panel("original").hidden).toBe(false);
    expect(panel("annotations").hidden).toBe(false);
  });
});
