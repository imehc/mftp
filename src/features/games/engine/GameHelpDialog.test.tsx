// @vitest-environment happy-dom
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameHelpDialog } from "./GameHelpDialog";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });

function wrap(node: ReactNode) {
  return <I18nProvider i18n={i18n}>{node}</I18nProvider>;
}

function example(open?: boolean, onOpenChange?: (next: boolean) => void) {
  return wrap(
    <GameHelpDialog
      name="魔方"
      summary="让六个面分别恢复为同一种颜色。"
      sections={[
        {
          title: "转动与观察",
          paragraphs: ["拖拽彩色面片转动一层。"],
        },
        {
          title: "键盘操作",
          items: ["R、L、U、D、F、B 分别转动六个面。", "按住 Shift 反向转动。"],
        },
      ]}
      open={open}
      onOpenChange={onOpenChange}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("小游戏玩法说明入口", () => {
  it("图标入口使用统一文案，默认不展开正文", () => {
    const markup = renderToStaticMarkup(example());
    expect(markup).toContain('aria-label="玩法说明"');
    expect(markup).toContain('title="玩法说明"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toContain("拖拽彩色面片转动一层。");
  });

  it("展开后标题按游戏名生成，分节顺序与条目数量一致", async () => {
    await act(async () => root.render(example()));
    await act(async () => {
      host.querySelector("button")?.click();
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const title = dialog?.querySelector("h2")?.textContent;
    expect(title).toBe("魔方玩法");
    expect(dialog?.textContent).toContain("让六个面分别恢复为同一种颜色。");
    const headings = [...(dialog?.querySelectorAll("h3") ?? [])].map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(["转动与观察", "键盘操作"]);
    const items = dialog?.querySelectorAll("li") ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("R、L、U、D、F、B");
  });

  it("受控打开时由外部驱动，关闭时回传 false", async () => {
    const onOpenChange = vi.fn();
    await act(async () => root.render(example(true, onOpenChange)));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.render(example(false, onOpenChange)));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
