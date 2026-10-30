// @vitest-environment happy-dom
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GameHeaderActionsProvider,
  GameHeaderActionsSlot,
  GameMenuActionsSlot,
} from "./GameHeaderActions";
import { GameInfoPopover } from "./GameInfoPopover";
import { GameToolbar } from "./GameToolbar";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });

function wrap(node: ReactNode) {
  return <I18nProvider i18n={i18n}>{node}</I18nProvider>;
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

describe("游戏信息入口", () => {
  it("标题栏图标使用统一文案，展开后显示参数与状态", async () => {
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(
        wrap(
          <GameHeaderActionsProvider>
            <GameHeaderActionsSlot />
            <GameInfoPopover
              parameters={<span>显示棋子名称</span>}
              onOpenChange={onOpenChange}
            >
              <span>轮到红方</span>
            </GameInfoPopover>
          </GameHeaderActionsProvider>,
        ),
      ),
    );
    const trigger = host.querySelector(
      'button[aria-label="游戏信息"]',
    ) as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.title).toBe("游戏信息");
    await act(async () => trigger.click());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    const popover = document.body.querySelector(
      '[data-slot="popover-content"]',
    );
    expect(popover?.textContent).toContain("显示棋子名称");
    expect(popover?.textContent).toContain("轮到红方");
  });

  it("受控打开时由外部驱动", async () => {
    const view = (open: boolean) =>
      wrap(
        <GameHeaderActionsProvider>
          <GameHeaderActionsSlot />
          <GameInfoPopover open={open}>
            <span>对局已结束</span>
          </GameInfoPopover>
        </GameHeaderActionsProvider>,
      );
    await act(async () => root.render(view(true)));
    expect(document.body.textContent).toContain("对局已结束");
    await act(async () => root.render(view(false)));
    expect(document.body.textContent).not.toContain("对局已结束");
  });

  it("更多菜单动作不落在只在窄屏显示的菜单内容里", async () => {
    await act(async () =>
      root.render(
        wrap(
          <GameHeaderActionsProvider>
            <GameHeaderActionsSlot />
            <GameToolbar
              status="轮到红方"
              metrics={<span data-info>第 12 手</span>}
              menuActions={<span data-flip>翻转棋盘</span>}
            />
            <GameMenuActionsSlot closeThen={() => {}} />
          </GameHeaderActionsProvider>,
        ),
      ),
    );
    const flip = host.querySelector("[data-flip]");
    expect(flip).not.toBeNull();
    expect(flip?.closest(".game-toolbar-menu")).toBeNull();
    const menu = host.querySelector(".game-toolbar-menu");
    expect(menu?.textContent).toContain("游戏信息");
    expect(menu?.textContent).toContain("第 12 手");
  });
});
