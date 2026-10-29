// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages } from "~/locales/zh-CN/messages";

import { BilliardsPowerControl } from "./BilliardsPowerControl";
import { createShotInput } from "./render/shot-input";

vi.mock("./render/audio", () => ({ unlockAudio: vi.fn() }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.loadAndActivate({ locale: "zh-CN", messages });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function fixture(vertical = false) {
  let power = 0;
  const state = { enabled: true, vertical, turn: 0 };
  const fire = vi.fn();
  const angle = vi.fn();
  const input = createShotInput({
    enabled: () => state.enabled,
    cue: () => ({ x: 0, y: 0 }),
    setAngle: angle,
    power: () => power,
    setPower(value) {
      power = value;
      render();
    },
    fire(value) {
      fire(value);
      power = 0;
      render();
    },
    reset() {
      power = 0;
      render();
    },
  });

  function render() {
    root.render(
      <I18nProvider i18n={i18n}>
        <BilliardsPowerControl
          power={Math.round(power * 100)}
          input={input}
          {...state}
        />
      </I18nProvider>,
    );
  }

  await act(render);
  const slider = host.querySelector<HTMLElement>('[data-slot="slider"]')!;
  const thumb = host.querySelector<HTMLElement>('[role="slider"]')!;
  let captured: number | null = null;
  Object.assign(slider, {
    getBoundingClientRect: () => new DOMRect(10, 20, 200, 200),
    setPointerCapture: (id: number) => {
      captured = id;
    },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => {
      captured = null;
    },
  });

  async function pointer(
    type: string,
    x: number,
    y = 120,
    id = 1,
    pointerType = "mouse",
    button = 0,
  ) {
    await act(() =>
      slider.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType,
          button,
          clientX: x,
          clientY: y,
        }),
      ),
    );
  }

  async function key(value: string, repeat = false) {
    await act(() =>
      thumb.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          repeat,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }

  return {
    state,
    input,
    fire,
    angle,
    slider,
    thumb,
    pointer,
    key,
    render,
    power: () => power,
  };
}

describe("台球力度滑块", () => {
  it.each(["mouse", "touch", "pen"])(
    "%s 拖动松手使用末次位置出杆一次且不改瞄准",
    async (pointerType) => {
      const ui = await fixture();
      await ui.pointer("pointerdown", 10, 120, 1, pointerType);
      await ui.pointer("pointermove", 110, 120, 1, pointerType);
      expect(ui.thumb.getAttribute("aria-valuenow")).toBe("50");
      expect(ui.thumb.getAttribute("aria-valuetext")).toBe("50%");
      await ui.pointer("pointerup", 160, 120, 1, pointerType);
      await ui.pointer("lostpointercapture", 160);
      await ui.pointer("pointerup", 160);
      expect(ui.fire).toHaveBeenCalledExactlyOnceWith(0.75);
      expect(ui.angle).not.toHaveBeenCalled();
      expect(ui.power()).toBe(0);
    },
  );

  it("竖条从下向上增大，越界拖动钳制到满力度", async () => {
    const ui = await fixture(true);
    expect(ui.thumb.getAttribute("aria-orientation")).toBe("vertical");
    await ui.pointer("pointerdown", 110, 220);
    await ui.pointer("pointermove", 110, 120);
    expect(ui.power()).toBe(0.5);
    await ui.pointer("pointerup", 110, -20);
    expect(ui.fire).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("点按和微小抖动不击球，拖回零力度也取消", async () => {
    const ui = await fixture();
    await ui.pointer("pointerdown", 160);
    await ui.pointer("pointerup", 162);
    expect(ui.fire).not.toHaveBeenCalled();
    await ui.pointer("pointerdown", 10);
    await ui.pointer("pointermove", 150);
    await ui.pointer("pointerup", -10);
    expect(ui.fire).not.toHaveBeenCalled();
    expect(ui.power()).toBe(0);
  });

  it("多指与鼠标非主键不能抢占或释放当前手势", async () => {
    const ui = await fixture();
    await ui.pointer("pointerdown", 10, 120, 1, "mouse", 2);
    expect(ui.input.source).toBeNull();
    await ui.pointer("pointerdown", 10, 120, 1, "touch");
    await ui.pointer("pointermove", 110, 120, 1, "touch");
    await ui.pointer("pointerdown", 190, 120, 2, "touch");
    await ui.pointer("pointermove", 210, 120, 2, "touch");
    await ui.pointer("pointerup", 210, 120, 2, "touch");
    expect(ui.power()).toBe(0.5);
    expect(ui.fire).not.toHaveBeenCalled();
    await ui.pointer("pointerup", 110, 120, 1, "touch");
    expect(ui.fire).toHaveBeenCalledExactlyOnceWith(0.5);
  });

  it.each([
    "pointercancel",
    "lostpointercapture",
    "blur",
    "hidden",
    "escape",
    "disabled",
    "turn",
    "rotate",
  ])("%s 取消后迟到松手不能出杆", async (reason) => {
    const ui = await fixture();
    await ui.pointer("pointerdown", 10);
    await ui.pointer("pointermove", 110);
    if (reason === "pointercancel" || reason === "lostpointercapture")
      await ui.pointer(reason, 110);
    else if (reason === "blur")
      await act(() => window.dispatchEvent(new Event("blur")));
    else if (reason === "hidden") {
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      await act(() => document.dispatchEvent(new Event("visibilitychange")));
      hidden.mockRestore();
    } else if (reason === "escape") await ui.key("Escape");
    else {
      if (reason === "disabled") ui.state.enabled = false;
      if (reason === "turn") ui.state.turn++;
      if (reason === "rotate") ui.state.vertical = true;
      await act(ui.render);
    }
    await ui.pointer("pointerup", 160);
    expect(ui.fire).not.toHaveBeenCalled();
    expect(ui.power()).toBe(0);
  });

  it("键盘调整仅预览，回车或空格明确击球，重复按键不重复提交", async () => {
    const ui = await fixture();
    await ui.key("End");
    expect(ui.power()).toBe(1);
    expect(ui.fire).not.toHaveBeenCalled();
    await ui.key("Enter");
    await ui.key("Enter", true);
    expect(ui.fire).toHaveBeenCalledExactlyOnceWith(1);
    await ui.key("PageUp");
    await ui.key(" ");
    expect(ui.fire).toHaveBeenLastCalledWith(0.1);
    await ui.key("End");
    await ui.key("Escape");
    await ui.key("Enter");
    expect(ui.fire).toHaveBeenCalledTimes(2);
  });

  it("场景已失效时更新取消，不能借滑块重新触发出杆", async () => {
    const ui = await fixture();
    await ui.pointer("pointerdown", 10);
    await ui.pointer("pointermove", 110);
    ui.input.cancel();
    await ui.pointer("pointerup", 160);
    expect(ui.fire).not.toHaveBeenCalled();
  });
});
