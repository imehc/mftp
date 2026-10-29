import { describe, expect, it, vi } from "vitest";

import { createShotInput } from "./shot-input";

function fixture() {
  let power = 0;
  const options = {
    enabled: vi.fn(() => true),
    cue: vi.fn(() => ({ x: 0, y: 0 }) as { x: number; y: number } | null),
    setAngle: vi.fn(),
    power: () => power,
    setPower: (value: number) => {
      power = value;
    },
    fire: vi.fn(),
    reset: vi.fn(() => {
      power = 0;
    }),
  };
  const input = createShotInput(options);
  return { input, options };
}

describe("台球共用蓄力输入", () => {
  it("力度条保留瞄准方向，夹取越界力度并只出杆一次", () => {
    const { input, options } = fixture();
    expect(input.beginPowerShot()).toBe(true);
    expect(input.updateShotPower(1.5)).toBe(true);
    expect(options.power()).toBe(1);
    input.releasePowerShot();
    input.releasePowerShot();
    expect(options.fire).toHaveBeenCalledExactlyOnceWith(1);
    expect(options.setAngle).not.toHaveBeenCalled();
    expect(input.source).toBeNull();
  });

  it("仅瞄准模式下远距离拖动只改变角度，松手后力度条仍能击球", () => {
    const { input, options } = fixture();
    input.setAimOnly(true);
    input.beginTable({ x: -0.8, y: 0 });
    input.drag({ x: 0, y: -2 });
    expect(options.setAngle).toHaveBeenLastCalledWith(Math.PI / 2);
    expect(options.power()).toBe(0);
    input.releaseTable();
    expect(options.fire).not.toHaveBeenCalled();
    expect(input.source).toBeNull();
    expect(input.beginPowerShot()).toBe(true);
    input.updateShotPower(0.8);
    input.releasePowerShot();
    expect(options.fire).toHaveBeenCalledExactlyOnceWith(0.8);
  });

  it("切换偏好取消当前手势，迟到释放不击球，关闭后恢复拖动出杆", () => {
    const { input, options } = fixture();
    input.beginTable({ x: -1, y: 0 });
    input.setAimOnly(true);
    input.releaseTable();
    expect(options.fire).not.toHaveBeenCalled();
    input.beginTable({ x: -1, y: 0 });
    input.setAimOnly(false);
    input.releaseTable();
    expect(options.fire).not.toHaveBeenCalled();
    input.beginTable({ x: -1, y: 0 });
    input.releaseTable();
    expect(options.fire).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("球桌和力度条不能抢占彼此的手势", () => {
    const { input, options } = fixture();
    input.beginTable({ x: -0.4, y: 0 });
    const angleCalls = options.setAngle.mock.calls.length;
    expect(input.beginPowerShot()).toBe(false);
    input.cancelPowerShot();
    input.releasePowerShot();
    expect(input.source).toBe("table");
    input.cancel();
    expect(input.beginPowerShot()).toBe(true);
    input.updateShotPower(0.7);
    input.beginTable({ x: 0.5, y: 0.3 });
    input.drag({ x: 0.6, y: 0.4 });
    input.releaseTable();
    expect(options.setAngle).toHaveBeenCalledTimes(angleCalls);
    expect(options.power()).toBe(0.7);
    input.releasePowerShot();
    expect(options.fire).toHaveBeenCalledExactlyOnceWith(0.7);
  });

  it.each([-1, 0, 0.049])("低力度 %s 松手回位而不击球", (power) => {
    const { input, options } = fixture();
    input.beginPowerShot();
    input.updateShotPower(power);
    input.releasePowerShot();
    expect(options.fire).not.toHaveBeenCalled();
    expect(options.reset).toHaveBeenCalledWith(true);
  });

  it("延用球桌的出杆阈值与最小实际力度", () => {
    const { input, options } = fixture();
    input.beginPowerShot();
    input.updateShotPower(0.05);
    input.releasePowerShot();
    expect(options.fire).toHaveBeenCalledWith(0.06);
    input.beginTable({ x: -0.62, y: 0 });
    input.releaseTable();
    expect(options.setAngle).toHaveBeenLastCalledWith(-0);
    expect(options.fire).toHaveBeenLastCalledWith(1);
  });

  it("取消后迟到的更新与松手无效，下一次操作可以重新开始", () => {
    const { input, options } = fixture();
    input.beginPowerShot();
    input.updateShotPower(0.8);
    input.cancel();
    expect(input.updateShotPower(0.9)).toBe(false);
    input.releasePowerShot();
    expect(options.fire).not.toHaveBeenCalled();
    expect(options.power()).toBe(0);
    expect(input.beginPowerShot()).toBe(true);
  });

  it("释放时重新核对可操作状态，不能在回合失效后击球", () => {
    const { input, options } = fixture();
    input.beginPowerShot();
    input.updateShotPower(0.8);
    options.enabled.mockReturnValue(false);
    input.releasePowerShot();
    expect(input.source).toBeNull();
    expect(options.fire).not.toHaveBeenCalled();
    expect(options.power()).toBe(0);
    expect(input.beginPowerShot()).toBe(false);
  });

  it("缺少母球或无效数值不会产生击球", () => {
    const { input, options } = fixture();
    options.cue.mockReturnValue(null);
    expect(input.beginPowerShot()).toBe(false);
    options.cue.mockReturnValue({ x: 0, y: 0 });
    input.beginPowerShot();
    expect(input.updateShotPower(Number.NaN)).toBe(false);
    input.releasePowerShot();
    expect(options.fire).not.toHaveBeenCalled();
  });
});
