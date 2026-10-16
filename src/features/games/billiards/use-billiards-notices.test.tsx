import { describe, expect, it } from "vitest";

import { planNotices } from "./use-billiards-notices";

const empty = { order: [], suppressed: [] };

describe("台球提示展示上限", () => {
  it("不超过上限时全部展示", () => {
    const plan = planNotices(empty, ["a", "b"], 2);
    expect(plan.visible).toEqual(["a", "b"]);
    expect(plan.suppressed).toEqual([]);
  });

  it("超过上限时只展示最近出现的两条，并挤出最早出现的一条", () => {
    const plan = planNotices(empty, ["a", "b", "c"], 2);
    expect(plan.visible).toEqual(["b", "c"]);
    expect(plan.suppressed).toEqual(["a"]);
  });

  it("被挤出的提示在状态消失前不再重新出现", () => {
    const first = planNotices(empty, ["a", "b", "c"], 2);
    const next = planNotices(first, ["a", "b"], 2);
    expect(next.visible).toEqual(["b"]);
    expect(next.suppressed).toEqual(["a"]);
  });

  it("状态消失后同一 id 可再次展示", () => {
    const first = planNotices(empty, ["a", "b", "c"], 2);
    const cleared = planNotices(first, ["b", "c"], 2);
    expect(cleared.suppressed).toEqual([]);
    const reAppear = planNotices(cleared, ["b", "c", "a"], 2);
    expect(reAppear.visible).toEqual(["c", "a"]);
    expect(reAppear.suppressed).not.toContain("a");
  });
});
