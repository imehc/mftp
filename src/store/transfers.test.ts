import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { useTransfersStore } from "./transfers";

// store 内的 phase 文案走全局 i18n，未激活 locale 会直接抛错。
i18n.load("zh-CN", {});
i18n.activate("zh-CN");

afterEach(() => {
  useTransfersStore.setState({ transfers: [], dismissed: new Set() });
});

describe("传输任务的来源类型", () => {
  it("显式传入的 kind 优先", () => {
    useTransfersStore.getState().start("t1", "上传 a.zip", { kind: "upload" });
    expect(useTransfersStore.getState().transfers[0].kind).toBe("upload");
  });

  it("BT 任务由 source 推导，恢复的任务同样成立", () => {
    useTransfersStore
      .getState()
      .restore("bt:abc", "某个种子", { source: "bt" });
    expect(useTransfersStore.getState().transfers[0].kind).toBe("bt");
  });

  it("未声明来源时回退到通用类型", () => {
    useTransfersStore.getState().start("t2", "未知任务");
    expect(useTransfersStore.getState().transfers[0].kind).toBe("other");
  });
});

describe("传输任务的结束时刻", () => {
  it("结束时记录 finishedAt，运行中没有该字段", () => {
    useTransfersStore
      .getState()
      .start("t3", "下载 b.zip", { kind: "download" });
    expect(
      useTransfersStore.getState().transfers[0].finishedAt,
    ).toBeUndefined();
    useTransfersStore.getState().finish("t3", "success");
    expect(useTransfersStore.getState().transfers[0].finishedAt).toBeTypeOf(
      "number",
    );
  });
});
