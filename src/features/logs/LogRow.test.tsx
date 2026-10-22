// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "~/locales/en/messages";
import { messages as zhMessages } from "~/locales/zh-CN/messages";
import type { ActivityLog } from "~/types";

import LogRow from "./LogRow";
import type { ActivityLogsController } from "./use-activity-logs";

const row: ActivityLog = {
  id: "long-internal-id",
  operationId: "operation-identity",
  createdAt: 1000,
  source: "sftp",
  requestType: "sftp_list",
  ip: "/home/user",
  result: "success",
  detail: null,
  error: null,
};
const select = vi.fn();
const controller = {
  sourceLabels: { sftp: "SFTP" },
  resultLabels: { success: "成功", failed: "失败" },
  setSelected: select,
} as unknown as ActivityLogsController;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  select.mockClear();
  i18n.load("zh-CN", zhMessages);
  i18n.load("en", enMessages);
  i18n.activate("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(log: ActivityLog) {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <LogRow log={log} controller={controller} />
      </I18nProvider>,
    ),
  );
}

describe("历史日志紧凑摘要", () => {
  it("没有有效正文只显示摘要，不展示详情控件或内部标识", async () => {
    await render({ ...row, detail: "  \n " });
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[data-history-log-detail]")).toBeNull();
    expect(container.textContent).toContain("列出目录");
    expect(container.textContent).not.toMatch(
      /long-internal-id|operation-identity|详情|—/,
    );
  });

  it("实际正文整行进入详情，不在摘要重复正文或增加按钮行", async () => {
    const log = { ...row, detail: "actual captured summary" };
    await render(log);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")?.click(),
    );
    expect(select).toHaveBeenCalledWith(log);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).not.toContain(log.detail);
  });

  it("只有结构化错误仍可查看，语言切换更新动作和无障碍名称", async () => {
    await render({
      ...row,
      result: "failed",
      error: {
        kind: "external",
        code: "sftp:failed",
        message: "Failure",
        args: {},
      },
    });
    expect(
      container.querySelector("button")?.getAttribute("aria-label"),
    ).toContain("列出目录");
    await act(async () => i18n.activate("en"));
    expect(
      container.querySelector("button")?.getAttribute("aria-label"),
    ).toContain("List directory");
    expect(container.textContent).not.toContain("列出目录");
  });
});
