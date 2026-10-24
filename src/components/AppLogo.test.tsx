// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AppLogo from "./AppLogo";

function renderLogo(props: Parameters<typeof AppLogo>[0] = {}) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<AppLogo {...props} />);
  return container;
}

describe("应用品牌图标", () => {
  it("复用浅深色 PNG 并按应用主题控制可见性", () => {
    const container = renderLogo();
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("src")).toBe("/app-light-icon.png");
    expect(images[0].classList.contains("dark:hidden")).toBe(true);
    expect(images[1].getAttribute("src")).toBe("/app-dark-icon.png");
    expect(images[1].classList.contains("hidden")).toBe(true);
    expect(images[1].classList.contains("dark:block")).toBe(true);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("独立标识提供品牌名称，图片不重复朗读", () => {
    const container = renderLogo();
    expect(
      container.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toBe("MFTP");
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("draggable")).toBe("false");
    }
  });

  it("关于页装饰图标隐藏于辅助技术并允许调整尺寸", () => {
    const container = renderLogo({
      decorative: true,
      className: "size-10 rounded-xl",
    });
    const logo = container.querySelector("span");
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
    expect(logo?.hasAttribute("aria-label")).toBe(false);
    expect(logo?.hasAttribute("role")).toBe(false);
    expect(logo?.classList.contains("size-10")).toBe(true);
    expect(logo?.classList.contains("size-9")).toBe(false);
  });
});
