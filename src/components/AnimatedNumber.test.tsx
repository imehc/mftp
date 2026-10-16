// @vitest-environment happy-dom

import gsap from "gsap";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnimatedNumber } from "./AnimatedNumber";

const env = vi.hoisted(() => ({ reduced: false }));
vi.mock("~/lib/motion", () => ({
  prefersReducedMotion: () => env.reduced,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  env.reduced = false;
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

/** 每个数字位的滚轮元素（按从左到右的展示顺序）。 */
function strips(): HTMLElement[] {
  return [...container.querySelectorAll("span[aria-hidden='true'] > span")].map(
    (slot) => slot.firstElementChild as HTMLElement,
  );
}

function yPercent(strip: HTMLElement): number {
  return Number(gsap.getProperty(strip, "yPercent"));
}

function accessibleText(): string | null | undefined {
  return container.querySelector("span.sr-only")?.textContent;
}

describe("数字平滑滚动动画", () => {
  it("挂载时直接显示当前值，不播放滚动", async () => {
    await act(async () => root.render(<AnimatedNumber value={7} />));
    expect(accessibleText()).toBe("7");
    expect(strips()).toHaveLength(1);
    expect(yPercent(strips()[0]!)).toBe(-70);
  });

  it("减少动画时数值立即落位", async () => {
    env.reduced = true;
    await act(async () => root.render(<AnimatedNumber value={0} />));
    await act(async () => root.render(<AnimatedNumber value={12} />));
    expect(accessibleText()).toBe("12");
    expect(strips()).toHaveLength(2);
    const [tens, ones] = strips();
    expect(yPercent(tens!)).toBe(-10);
    expect(yPercent(ones!)).toBe(-20);
  });

  it("滚动结束后停在目标数字", async () => {
    await act(async () =>
      root.render(<AnimatedNumber value={0} duration={0.1} />),
    );
    await act(async () =>
      root.render(<AnimatedNumber value={9} duration={0.1} />),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(accessibleText()).toBe("9");
    expect(yPercent(strips()[0]!)).toBe(-90);
  });

  it("按从左到右的位序展示每一位数字", async () => {
    await act(async () => root.render(<AnimatedNumber value={0} />));
    await act(async () => root.render(<AnimatedNumber value={147} />));
    expect(accessibleText()).toBe("147");
    expect(strips()).toHaveLength(3);
  });
});
