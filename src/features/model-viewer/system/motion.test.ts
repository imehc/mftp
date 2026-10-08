import { PerspectiveCamera, Vector3 } from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { deviceQuaternion, MotionControl } from "./motion";

let events: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("screen", { orientation: { angle: 0 } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture() {
  const canvas = new EventTarget() as HTMLCanvasElement;
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, 5);
  return {
    canvas,
    camera,
    motion: new MotionControl(canvas, camera, new Vector3(), vi.fn(), vi.fn()),
  };
}

function orient(alpha: number) {
  const event = new Event("deviceorientation");
  Object.assign(event, { alpha, beta: 0, gamma: 0 });
  events.dispatchEvent(event);
}

it("拒绝权限不启用传感器，保留手动控制", async () => {
  vi.stubGlobal("DeviceOrientationEvent", {
    requestPermission: async () => "denied",
  });
  const { motion } = fixture();
  await motion.start();
  expect(motion.snapshot()).toBe("denied");
  expect(motion.active).toBe(false);
  motion.dispose();
});

it("权限请求期间停止，迟到授权不能重新启用", async () => {
  let finish!: (permission: string) => void;
  vi.stubGlobal("DeviceOrientationEvent", {
    requestPermission: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const { motion } = fixture();
  const pending = motion.start();
  motion.stop();
  finish("granted");
  await pending;
  orient(0);
  expect(motion.active).toBe(false);
  motion.dispose();
});

it("首个传感器姿态保持当前视角，手动触碰停止订阅", async () => {
  vi.stubGlobal("DeviceOrientationEvent", {});
  const { motion, camera, canvas } = fixture();
  const initial = camera.quaternion.clone();
  await motion.start();
  orient(45);
  expect(camera.quaternion.angleTo(initial)).toBeCloseTo(0);
  expect(motion.active).toBe(true);
  orient(65);
  expect(camera.quaternion.angleTo(initial)).toBeGreaterThan(0.1);
  canvas.dispatchEvent(new Event("pointerdown"));
  const stopped = camera.quaternion.clone();
  orient(90);
  expect(camera.quaternion.angleTo(stopped)).toBeCloseTo(0);
  expect(motion.active).toBe(false);
  motion.dispose();
});

it("无事件超时转为不支持，屏幕方向参与姿态转换", async () => {
  vi.stubGlobal("DeviceOrientationEvent", {});
  const { motion } = fixture();
  await motion.start();
  await vi.advanceTimersByTimeAsync(5000);
  expect(motion.snapshot()).toBe("unsupported");
  expect(
    deviceQuaternion(0, 0, 0, 0).angleTo(deviceQuaternion(0, 0, 0, 90)),
  ).toBeCloseTo(Math.PI / 2);
  motion.dispose();
});
