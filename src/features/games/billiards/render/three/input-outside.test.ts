// @vitest-environment happy-dom
import { PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTableInput } from "./input";

vi.mock("../audio", () => ({ unlockAudio: vi.fn() }));

function setup() {
  const surface = document.createElement("div");
  const outside = document.createElement("span");
  document.body.append(surface, outside);
  let captured: number | null = null;
  surface.setPointerCapture = (id) => {
    captured = id;
  };
  surface.hasPointerCapture = (id) => captured === id;
  surface.releasePointerCapture = () => {
    captured = null;
  };
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 80, 600, 400),
  );
  const camera = new PerspectiveCamera(35, 1.5, 0.01, 40);
  camera.position.set(0, 4, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const handlers = {
    enabled: () => true,
    outsideHit: vi.fn(() => true),
    down: vi.fn(),
    move: vi.fn(),
    up: vi.fn(),
    cancel: vi.fn(),
  };
  const input = createTableInput(surface, camera, handlers);
  return { surface, outside, handlers, input, captured: () => captured };
}

function pointer(target: HTMLElement, type: string, pointerType = "mouse") {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType,
    button: 0,
    clientX: 40,
    clientY: 260,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("球桌外可见球杆的输入", () => {
  it.each(["mouse", "touch", "pen"])(
    "%s 命中球杆后捕获手势并阻止文字选择",
    (type) => {
      const { surface, outside, handlers, input, captured } = setup();
      expect(pointer(outside, "pointerdown", type).defaultPrevented).toBe(true);
      expect(captured()).toBe(1);
      expect(handlers.down).toHaveBeenCalledTimes(1);
      pointer(surface, "pointermove", type);
      pointer(surface, "pointerup", type);
      expect(handlers.move).toHaveBeenCalledTimes(1);
      expect(handlers.up).toHaveBeenCalledTimes(1);
      expect(captured()).toBeNull();
      input.dispose();
    },
  );

  it.each(["button", "a", "label", "input", "textarea", "select"])(
    "球杆覆盖 %s 时仍交给原控件",
    (tag) => {
      const { outside, handlers, input } = setup();
      const control = document.createElement(tag);
      outside.append(control);
      expect(pointer(control, "pointerdown").defaultPrevented).toBe(false);
      expect(handlers.outsideHit).not.toHaveBeenCalled();
      expect(handlers.down).not.toHaveBeenCalled();
      input.dispose();
    },
  );

  it("力度条、可编辑文本和可聚焦控件的后代不启动拖杆", () => {
    const { outside, handlers, input } = setup();
    for (const attributes of [
      { "data-slot": "slider" },
      { contenteditable: "true" },
      { tabindex: "0" },
    ]) {
      const control = document.createElement("div");
      for (const [key, value] of Object.entries(attributes))
        control.setAttribute(key, value!);
      const child = document.createElement("span");
      control.append(child);
      outside.replaceChildren(control);
      expect(pointer(child, "pointerdown").defaultPrevented).toBe(false);
    }
    expect(handlers.down).not.toHaveBeenCalled();
    input.dispose();
  });

  it("未命中不拦截，原球桌输入不重复执行，销毁后不残留全局监听", () => {
    const { surface, outside, handlers, input } = setup();
    handlers.outsideHit.mockReturnValue(false);
    expect(pointer(outside, "pointerdown").defaultPrevented).toBe(false);
    expect(handlers.down).not.toHaveBeenCalled();
    pointer(surface, "pointerdown");
    expect(handlers.down).toHaveBeenCalledTimes(1);
    input.dispose();
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    handlers.outsideHit.mockReturnValue(true);
    expect(pointer(outside, "pointerdown").defaultPrevented).toBe(false);
    expect(handlers.down).toHaveBeenCalledTimes(1);
  });

  it("只在已命中的触摸手势期间阻止滚动，取消后恢复", () => {
    const { surface, outside, input } = setup();
    pointer(outside, "pointerdown", "touch");
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    outside.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    pointer(surface, "pointercancel", "touch");
    const next = new Event("touchmove", { bubbles: true, cancelable: true });
    outside.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
    input.dispose();
  });
});
