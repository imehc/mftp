// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { isInsideModalDialog } from "./activity-navigation";

afterEach(() => {
  document.body.replaceChildren();
});

describe("活动面板 Esc 归属", () => {
  it("模态弹窗内的焦点由弹窗处理", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);

    expect(isInsideModalDialog(button)).toBe(true);
  });

  it("非模态活动面板与普通内容不拦截 Esc", () => {
    const panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    const button = document.createElement("button");
    panel.append(button);
    document.body.append(panel);

    expect(isInsideModalDialog(button)).toBe(false);
    expect(isInsideModalDialog(document.body)).toBe(false);
    expect(isInsideModalDialog(null)).toBe(false);
  });
});
