// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { applyAppIcon } from "./app-icon";

afterEach(() => {
  document.head.innerHTML = "";
});

it("浅色外观使用浅色图标", () => {
  document.head.innerHTML = '<link id="app-favicon" href="/app-icon.png" />';

  applyAppIcon("light");

  expect(document.querySelector("#app-favicon")?.getAttribute("href")).toBe(
    "/app-light-icon.png",
  );
});

it("深色外观使用深色图标", () => {
  document.head.innerHTML = '<link id="app-favicon" href="/app-icon.png" />';

  applyAppIcon("dark");

  expect(document.querySelector("#app-favicon")?.getAttribute("href")).toBe(
    "/app-dark-icon.png",
  );
});

it("缺少 favicon 节点时不抛错", () => {
  expect(() => applyAppIcon("dark")).not.toThrow();
});
