import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHINESE_EIGHT } from "../../equipment";
import { createTableCamera } from "./camera";
import { createTableInput } from "./input";

vi.mock("../audio", () => ({ unlockAudio: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(portrait: boolean) {
  vi.stubGlobal("window", new EventTarget());
  const target = new EventTarget();
  const rect = { left: 23, top: 47, width: portrait ? 390 : 1024, height: 600 };
  let captured: number | null = null;
  const surface = Object.assign(target, {
    getBoundingClientRect: () => rect,
    setPointerCapture: (pointer: number) => {
      captured = pointer;
    },
    hasPointerCapture: (pointer: number) => captured === pointer,
    releasePointerCapture: () => {
      captured = null;
    },
  }) as unknown as HTMLDivElement;
  const rig = createTableCamera(CHINESE_EIGHT);
  rig.resize(rect.width, rect.height, portrait);
  rig.entrance(0);
  const handlers = {
    enabled: vi.fn(() => true),
    down: vi.fn(),
    move: vi.fn(),
    up: vi.fn(),
    cancel: vi.fn(),
  };
  const input = createTableInput(surface, rig.camera, handlers);

  function pointer(type: string, x: number, y: number) {
    const projected = new Vector3(x, 0, y).project(rig.camera);
    const event = Object.assign(new Event(type), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: rect.left + ((projected.x + 1) / 2) * rect.width,
      clientY: rect.top + ((1 - projected.y) / 2) * rect.height,
    });
    target.dispatchEvent(event);
  }

  return { handlers, input, pointer, rig, rect, surface };
}

describe("正俯视指针输入", () => {
  it.each(["mouse", "touch", "pen"])(
    "%s 从全屏绘制坐标命中原输入面，越界释放仍对应正确台面位置",
    (pointerType) => {
      const { handlers, input, rig, rect, surface } = setup(false);
      const width = rect.width + 200;
      const height = rect.height + 150;
      rig.resize(rect.width, rect.height, false, {
        width,
        height,
        table: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
        portrait: false,
      });
      for (const [type, x, y] of [
        ["pointerdown", -0.6, 0.2],
        ["pointermove", -3, 1],
        ["pointerup", -3.2, 1.2],
      ] as const) {
        const projected = new Vector3(x, 0, y).project(rig.renderCamera);
        surface.dispatchEvent(
          Object.assign(new Event(type), {
            pointerId: 1,
            pointerType,
            button: 0,
            clientX: ((projected.x + 1) * width) / 2,
            clientY: ((1 - projected.y) * height) / 2,
          }),
        );
      }
      expect(handlers.down.mock.lastCall![0].x).toBeCloseTo(-0.6, 10);
      expect(handlers.up.mock.lastCall![0].x).toBeCloseTo(-3.2, 10);
      expect(handlers.up.mock.lastCall![0].y).toBeCloseTo(1.2, 10);
      expect(handlers.cancel).not.toHaveBeenCalled();
      input.dispose();
    },
  );

  it.each([false, true])(
    "瞄准拖动与自由球落点保持台面坐标（竖屏：%s）",
    (portrait) => {
      const { handlers, input, pointer } = setup(portrait);
      pointer("pointerdown", -0.6, 0.2);
      pointer("pointermove", -0.8, 0.3);
      pointer("pointerup", -0.9, 0.4);
      for (const [handler, expected] of [
        [handlers.down, { x: -0.6, y: 0.2 }],
        [handlers.move, { x: -0.8, y: 0.3 }],
        [handlers.up, { x: -0.9, y: 0.4 }],
      ] as const) {
        const point = handler.mock.lastCall![0];
        expect(point.x).toBeCloseTo(expected.x, 10);
        expect(point.y).toBeCloseTo(expected.y, 10);
      }
      expect(handlers.cancel).not.toHaveBeenCalled();
      input.dispose();
    },
  );

  it("入场未就绪时不接受指针，旋转与尺寸变化后按当前相机求交", () => {
    const { handlers, input, pointer, rig, rect } = setup(false);
    handlers.enabled.mockReturnValue(false);
    rig.entrance(0.7);
    pointer("pointerdown", -0.4, 0.1);
    expect(handlers.down).not.toHaveBeenCalled();
    rect.width = 390;
    rig.resize(rect.width, rect.height, true);
    rig.entrance(0);
    handlers.enabled.mockReturnValue(true);
    pointer("pointerdown", -0.4, 0.1);
    pointer("pointerup", 0.2, -0.3);
    expect(handlers.up.mock.lastCall![0].x).toBeCloseTo(0.2, 10);
    expect(handlers.up.mock.lastCall![0].y).toBeCloseTo(-0.3, 10);
    input.dispose();
  });

  it("销毁取消拖动并移除指针处理器", () => {
    const { handlers, input, pointer } = setup(false);
    pointer("pointerdown", -0.4, 0.1);
    input.dispose();
    pointer("pointermove", 0, 0);
    pointer("pointerup", 0, 0);
    pointer("pointerdown", 0, 0);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(handlers.down).toHaveBeenCalledTimes(1);
    expect(handlers.move).not.toHaveBeenCalled();
    expect(handlers.up).not.toHaveBeenCalled();
  });
});
