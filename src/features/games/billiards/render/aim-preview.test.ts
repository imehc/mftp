import { beforeEach, expect, it, vi } from "vitest";

import type { BallState } from "../types";
import { createAimPreview } from "./aim-preview";
import type { AimGuide } from "./guides";

const client = vi.hoisted(() => ({ preview: vi.fn(), dispose: vi.fn() }));
vi.mock("../simulation-client", () => ({
  createSimulationClient: () => client,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function deferred() {
  let resolve: (guide: AimGuide | null) => void = () => undefined;
  const promise = new Promise<AimGuide | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const balls: BallState[] = [{ id: 0, x: 0, y: 0, potted: false }];
const guide: AimGuide = {
  cue: { x: 0, y: 0 },
  dir: { x: 1, y: 0 },
  contact: { x: 1, y: 0 },
  target: null,
  cueDeflection: null,
  cueLength: 0,
};

it("角度与力度变化期间保留有效指示线，并合并中间输入", async () => {
  const first = deferred();
  const second = deferred();
  client.preview
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const preview = createAimPreview(vi.fn());
  preview.get(balls, 0, 0.5, 0);
  first.resolve(guide);
  await first.promise;
  expect(preview.get(balls, 0.1, 0.6, 0)).toBe(guide);
  expect(preview.get(balls, 0.2, 0.7, 0)).toBe(guide);
  expect(client.preview).toHaveBeenCalledTimes(2);
  preview.dispose();
});

it("连续拖动仍发布完成的结果，不因输入持续变化而饿死", async () => {
  const first = deferred();
  const second = deferred();
  client.preview
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const update = vi.fn();
  const preview = createAimPreview(update);
  preview.get(balls, 0, 0.5, 0);
  preview.get(balls, 0.1, 0.5, 0);
  first.resolve(guide);
  await first.promise;
  expect(update).toHaveBeenCalledOnce();
  expect(preview.get(balls, 0.1, 0.5, 0)).toBe(guide);
  expect(client.preview).toHaveBeenLastCalledWith(balls, {
    balls,
    angle: 0.1,
    power: 0.5,
    followDraw: 0,
  });
  preview.dispose();
});

it("球局变化和销毁后不会发布旧局面的轨迹", async () => {
  const first = deferred();
  const second = deferred();
  client.preview
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const update = vi.fn();
  const preview = createAimPreview(update);
  preview.get(balls, 0, 0.5, 0);
  const nextBalls = [...balls];
  expect(preview.get(nextBalls, 0, 0.5, 0)).toBeNull();
  first.resolve(guide);
  await first.promise;
  expect(update).not.toHaveBeenCalled();
  preview.dispose();
  second.resolve(guide);
  await second.promise;
  expect(update).not.toHaveBeenCalled();
});

it("默认方向重置后，同一组球的旧预览也不能重新出现", async () => {
  const first = deferred();
  const second = deferred();
  client.preview
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const update = vi.fn();
  const preview = createAimPreview(update);
  preview.get(balls, 0, 0.5, 0);
  preview.invalidate();
  expect(preview.get(balls, Math.PI / 2, 0.5, 0)).toBeNull();
  first.resolve(guide);
  await first.promise;
  expect(update).not.toHaveBeenCalled();
  const nextGuide = { ...guide, dir: { x: 0, y: 1 } };
  second.resolve(nextGuide);
  await second.promise;
  expect(preview.get(balls, Math.PI / 2, 0.5, 0)).toBe(nextGuide);
  preview.dispose();
});
