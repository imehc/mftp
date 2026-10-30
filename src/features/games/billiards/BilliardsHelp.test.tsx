// @vitest-environment happy-dom
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BilliardsHelp } from "./BilliardsHelp";
import type { BilliardsDiscipline } from "./types";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });

function wrap(discipline: BilliardsDiscipline) {
  return (
    <I18nProvider i18n={i18n}>
      <BilliardsHelp discipline={discipline} />
    </I18nProvider>
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

describe("台球玩法说明入口", () => {
  it.each(["eight-ball", "nine-ball", "snooker"] as const)(
    "%s 使用统一的帮助按钮文案",
    (discipline) => {
      const markup = renderToStaticMarkup(wrap(discipline));
      expect(markup).toContain('aria-label="玩法说明"');
      expect(markup).toContain('data-state="closed"');
    },
  );

  it("中式八球有分组与犯规说明", async () => {
    await act(async () => root.render(wrap("eight-ball")));
    await act(async () => {
      host.querySelector("button")?.click();
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("中式八球玩法");
    expect(dialog?.textContent).toContain("第一颗合法落袋的球决定双方组别");
    expect(dialog?.textContent).toContain("自由球");
  });

  it("九球说明首碰最低号球与三次犯规判负", async () => {
    await act(async () => root.render(wrap("nine-ball")));
    await act(async () => {
      host.querySelector("button")?.click();
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("美式九球玩法");
    expect(dialog?.textContent).toContain("最低号球");
    expect(dialog?.textContent).toContain("三次犯规判负");
  });
});
