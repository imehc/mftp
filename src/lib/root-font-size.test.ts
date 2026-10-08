import { afterEach, expect, it, vi } from "vitest";

import { observeRootFontSize } from "./root-font-size";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("根字号变化重新测量，相同尺寸不重复通知并释放探针", () => {
  let height = 16;
  let notify!: () => void;
  const remove = vi.fn(),
    disconnect = vi.fn();
  const probe = {
    setAttribute: vi.fn(),
    style: { cssText: "" },
    getBoundingClientRect: () => ({ height }),
    remove,
  };
  vi.stubGlobal("document", {
    createElement: () => probe,
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const changed = vi.fn();
  const stop = observeRootFontSize(changed);
  expect(changed).toHaveBeenLastCalledWith(16);
  notify();
  expect(changed).toHaveBeenCalledTimes(1);
  height = 20;
  notify();
  expect(changed).toHaveBeenLastCalledWith(20);
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
});
