// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PromptDialog from "./prompt-dialog";

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const invalidName = "名称不能为空，且不能包含斜杠";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPrompt(onConfirm: (value: string) => void) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <PromptDialog
          open
          title="新建文件夹"
          placeholder="文件夹名称"
          confirmText="创建"
          validate={(value) => (value.includes("/") ? invalidName : null)}
          onOpenChange={() => {}}
          onConfirm={onConfirm}
        />
      </I18nProvider>,
    );
  });
}

function input() {
  return document.querySelector<HTMLInputElement>(
    'input[aria-label="文件夹名称"]',
  );
}

async function type(value: string) {
  const field = input();
  if (!field) throw new Error("找不到名称输入框");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    // 表单校验是异步的，等待状态落定后再断言。
    for (let index = 0; index < 8; index++) await Promise.resolve();
  });
}

describe("单输入对话框", () => {
  it("校验失败时在输入框旁提示且不提交", async () => {
    const onConfirm = vi.fn();
    await renderPrompt(onConfirm);
    await type("a/b");
    await submit();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      invalidName,
    );
    expect(input()?.getAttribute("aria-describedby")).toBeTruthy();
    expect(input()?.getAttribute("aria-invalid")).toBe("true");
  });

  it("校验通过后提交去空格后的名称", async () => {
    const onConfirm = vi.fn();
    await renderPrompt(onConfirm);
    await type("  报告  ");
    await submit();
    expect(onConfirm).toHaveBeenCalledWith("报告");
  });
});
