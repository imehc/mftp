// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { usePoetryStore } from "./poetry-store";

beforeEach(() => {
  localStorage.clear();
  usePoetryStore.setState({
    readingView: "original",
    referenceView: "translation",
  });
});

describe("诗词标签偏好的旧数据兼容", () => {
  it("版本一缺少标签字段时采用默认值，保留字体和历史", async () => {
    localStorage.setItem(
      "mftp-poetry",
      JSON.stringify({
        version: 1,
        state: { fontSize: 22, lineHeight: 2.1, searchHistory: ["海"] },
      }),
    );
    await usePoetryStore.persist.rehydrate();
    expect(usePoetryStore.getState()).toMatchObject({
      fontSize: 22,
      lineHeight: 2.1,
      searchHistory: ["海"],
      readingView: "original",
      referenceView: "translation",
    });
  });

  it("非法标签回退，切到原文后仍保留辅助面板偏好", async () => {
    localStorage.setItem(
      "mftp-poetry",
      JSON.stringify({
        version: 1,
        state: { readingView: "bad", referenceView: "original" },
      }),
    );
    await usePoetryStore.persist.rehydrate();
    expect(usePoetryStore.getState().readingView).toBe("original");
    usePoetryStore.getState().setReadingView("annotations");
    usePoetryStore.getState().setReadingView("original");
    expect(usePoetryStore.getState().referenceView).toBe("annotations");
    const saved = JSON.parse(localStorage.getItem("mftp-poetry")!);
    expect(saved.state).toMatchObject({
      readingView: "original",
      referenceView: "annotations",
    });
    expect(saved.state).not.toHaveProperty("positions");
  });
});
