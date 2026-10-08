import { expect, it, vi } from "vitest";

import { RenderBudget } from "./render-budget";

it("持续慢帧触发降级，单次停顿不会触发", () => {
  const resize = vi.fn();
  const budget = new RenderBudget(resize);
  budget.sample(1000, 1000);
  expect(budget.snapshot().level).toBe(0);
  for (let i = 0; i < 140; i++) budget.sample(35, 30);
  expect(budget.snapshot().level).toBe(1);
  expect(resize).toHaveBeenCalledOnce();
});

it("主动限帧不被当成持续慢帧，稳定后迟滞恢复", () => {
  const budget = new RenderBudget(vi.fn());
  budget.setThermal("serious");
  budget.setThermal("nominal");
  for (let i = 0; i < 150; i++) budget.sample(1000 / 30, 5);
  expect(budget.snapshot().level).toBe(1);
  for (let i = 0; i < 900; i++) budget.sample(budget.interval || 1000 / 60, 5);
  expect(budget.snapshot().level).toBe(0);
});

it("系统严重热状态建立画质下限并限制帧率", () => {
  const budget = new RenderBudget(vi.fn());
  budget.setThermal("critical");
  expect(budget.pixelRatio).toBe(1);
  expect(budget.shouldRender(0)).toBe(true);
  expect(budget.shouldRender(20)).toBe(false);
  expect(budget.shouldRender(50)).toBe(true);
  for (let i = 0; i < 1000; i++) budget.sample(50, 3);
  expect(budget.snapshot().level).toBe(2);
});

it("暂停清空采样窗口，恢复不把后台时间计入慢帧", () => {
  const budget = new RenderBudget(vi.fn());
  for (let i = 0; i < 65; i++) budget.sample(35, 30);
  budget.pause();
  for (let i = 0; i < 65; i++) budget.sample(35, 30);
  expect(budget.snapshot().level).toBe(0);
});
