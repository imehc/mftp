// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingMenuTrigger from "./SettingMenuTrigger";

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

describe("设置行菜单触发器", () => {
  it("透传点击事件与 ref，保证菜单能打开", async () => {
    const onClick = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    await act(async () => {
      root.render(
        <SettingMenuTrigger
          ref={(node) => {
            ref.current = node;
          }}
          id="settings-demo"
          label="增量同步(rsync)"
          aria-label="文件传输"
          onClick={onClick}
        />,
      );
    });
    const button = container.querySelector("button");
    expect(button?.id).toBe("settings-demo");
    expect(button?.getAttribute("aria-label")).toBe("文件传输");
    expect(ref.current).toBe(button);
    await act(async () => button?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
