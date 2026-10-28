// @vitest-environment happy-dom
import { Vector2, Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installCubeInput } from "./input";
import type { CubeScene } from "./scene";

let cleanup = () => {};

function setup() {
  const canvas = document.createElement("canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: 400 },
    clientHeight: { value: 500 },
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => false },
  });
  const scene = {
    canvas,
    cancel: vi.fn(),
    orbit: vi.fn(),
    zoom: vi.fn(),
    preview: vi.fn(),
    pick: vi.fn(() => ({
      point: new Vector3(1, 1, 1.5),
      normal: [0, 0, 1],
      position: [2, 2, 2],
    })),
    project: (v: Vector3) => new Vector2(v.x, -v.y),
  };
  const turn = vi.fn();
  const enabled = vi.fn(() => true);
  const controls = installCubeInput(scene as unknown as CubeScene, {
    enabled,
    busy: () => false,
    observe: () => false,
    order: () => 3,
    turn,
  });
  cleanup = controls.dispose;
  const pointer = (type: string, x: number, y: number, id = 1) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        clientX: x,
        clientY: y,
        button: 0,
      }),
    );
  return { canvas, scene, turn, pointer, enabled };
}

afterEach(() => cleanup());

describe("魔方指针与键盘操作", () => {
  it("前面向右拖动选择水平层，松手只提交一次", () => {
    const { pointer, turn, scene } = setup();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 180, 100);
    expect(scene.preview).toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
    pointer("pointerup", 180, 100);
    expect(turn).toHaveBeenCalledExactlyOnceWith({
      axis: 1,
      layer: 2,
      turns: 1,
    });
    pointer("pointerup", 180, 100);
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it("微小拖动与取消不会产生转层", () => {
    const { pointer, turn, scene } = setup();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 104, 100);
    pointer("pointerup", 104, 100);
    expect(turn).not.toHaveBeenCalled();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 180, 100);
    pointer("pointercancel", 180, 100);
    expect(turn).not.toHaveBeenCalled();
    expect(scene.cancel).toHaveBeenCalled();
  });

  it("第二根手指取消预览，捏合后剩余手指不会误转层", () => {
    const { pointer, turn, scene } = setup();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 100);
    pointer("pointerdown", 200, 100, 2);
    pointer("pointermove", 250, 100, 2);
    expect(scene.zoom).toHaveBeenCalled();
    pointer("pointerup", 250, 100, 2);
    pointer("pointermove", 300, 100);
    pointer("pointerup", 300, 100);
    expect(turn).not.toHaveBeenCalled();
  });

  it("失去捕获会取消预览，后台禁止快捷键", () => {
    const { canvas, pointer, turn, enabled, scene } = setup();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 100);
    pointer("lostpointercapture", 160, 100);
    pointer("pointerup", 160, 100);
    expect(turn).not.toHaveBeenCalled();
    expect(scene.cancel).toHaveBeenCalled();
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "R", shiftKey: true }),
    );
    expect(turn).toHaveBeenCalledExactlyOnceWith({
      axis: 0,
      layer: 2,
      turns: 1,
    });
    enabled.mockReturnValue(false);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(turn).toHaveBeenCalledTimes(1);
  });
});
