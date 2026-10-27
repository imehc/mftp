// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

it("指针点击不常驻焦点环，键盘操作恢复焦点提示并保留调用方事件", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pointer = vi.fn();
  const key = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one" onPointerDown={pointer} onKeyDown={key}>
              一
            </TabsTrigger>
            <TabsTrigger value="two">二</TabsTrigger>
          </TabsList>
        </Tabs>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('[role="tab"]')!;
    await act(async () =>
      trigger.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(trigger.dataset.pointerFocus).toBe("true");
    expect(pointer).toHaveBeenCalledOnce();
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(trigger.dataset.pointerFocus).toBeUndefined();
    expect(key).toHaveBeenCalledOnce();
    await act(async () =>
      trigger.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    await act(async () =>
      trigger.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    expect(trigger.dataset.pointerFocus).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
