// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { observeBilliardsViewport } from "./viewport";

function setup() {
  const root = document.createElement("main");
  const header = document.createElement("header");
  const stage = document.createElement("section");
  const input = document.createElement("div");
  const canvas = document.createElement("canvas");
  stage.append(input);
  root.append(canvas, header, stage);
  document.body.append(root);
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 700);
  const shell = document.createElement("div");
  const sidebar = document.createElement("aside");
  document.body.append(shell);
  shell.append(sidebar, root);
  let table = new DOMRect(180, 90, 600, 480);
  vi.spyOn(input, "getBoundingClientRect").mockImplementation(() => table);
  const orientation = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => orientation);
  const observe = vi.fn();
  const disconnect = vi.fn();

  let resized = () => {};

  let mutated = () => {};

  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutated = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const changed = vi.fn();
  const viewport = observeBilliardsViewport(input, changed);
  return {
    root,
    shell,
    sidebar,
    header,
    stage,
    input,
    canvas,
    orientation,
    observe,
    disconnect,
    changed,
    viewport,
    resize: () => resized(),
    mutate: () => mutated(),
    bounds: (value: DOMRect) => {
      vi.stubGlobal("innerWidth", value.width);
      vi.stubGlobal("innerHeight", value.height);
    },
    table: (value: DOMRect) => {
      table = value;
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("台球全窗口画布的布局测量", () => {
  it("输出窗口坐标并观察应用侧栏与布局兄弟，重复通知不重置场景", () => {
    const fixture = setup();
    fixture.viewport.measure();
    expect(fixture.changed).toHaveBeenLastCalledWith({
      width: 1000,
      height: 700,
      table: { x: 180, y: 90, width: 600, height: 480 },
      portrait: false,
    });
    for (const element of [
      document.documentElement,
      document.body,
      fixture.shell,
      fixture.sidebar,
      fixture.root,
      fixture.header,
      fixture.stage,
      fixture.input,
    ])
      expect(fixture.observe).toHaveBeenCalledWith(element);
    expect(fixture.observe).not.toHaveBeenCalledWith(fixture.canvas);
    fixture.resize();
    fixture.mutate();
    expect(fixture.changed).toHaveBeenCalledTimes(1);
    fixture.viewport.dispose();
  });

  it("球桌仅平移或方向单独变化时也更新，新增提示被纳入测量", () => {
    const fixture = setup();
    fixture.viewport.measure();
    fixture.table(new DOMRect(180, 105, 600, 480));
    fixture.resize();
    expect(fixture.changed.mock.lastCall?.[0].table.y).toBe(105);
    fixture.orientation.matches = true;
    fixture.orientation.dispatchEvent(new Event("change"));
    expect(fixture.changed.mock.lastCall?.[0].portrait).toBe(true);
    const notice = document.createElement("aside");
    fixture.root.prepend(notice);
    fixture.mutate();
    expect(fixture.observe).toHaveBeenCalledWith(notice);
    expect(fixture.changed).toHaveBeenCalledTimes(3);
    fixture.viewport.dispose();
  });

  it("侧栏变化、滚动和窗口缩放后按窗口坐标更新球桌", () => {
    const fixture = setup();
    fixture.viewport.measure();
    fixture.table(new DOMRect(92, 90, 688, 480));
    fixture.resize();
    expect(fixture.changed.mock.lastCall?.[0].table.x).toBe(92);
    fixture.table(new DOMRect(92, 65, 688, 480));
    window.dispatchEvent(new Event("scroll"));
    expect(fixture.changed.mock.lastCall?.[0].table.y).toBe(65);
    fixture.bounds(new DOMRect(0, 0, 1440, 900));
    window.dispatchEvent(new Event("resize"));
    expect(fixture.changed.mock.lastCall?.[0]).toMatchObject({
      width: 1440,
      height: 900,
    });
    const navigation = document.createElement("nav");
    fixture.shell.prepend(navigation);
    fixture.mutate();
    expect(fixture.observe).toHaveBeenCalledWith(navigation);
    fixture.viewport.dispose();
  });

  it("隐藏区域尺寸有下限，销毁后忽略已排队的通知", () => {
    const fixture = setup();
    fixture.bounds(new DOMRect());
    fixture.table(new DOMRect());
    fixture.viewport.measure();
    expect(fixture.changed.mock.lastCall?.[0]).toMatchObject({
      width: 1,
      height: 1,
      table: { width: 1, height: 1 },
    });
    fixture.viewport.dispose();
    fixture.bounds(new DOMRect(0, 0, 1000, 700));
    fixture.resize();
    fixture.mutate();
    fixture.viewport.measure();
    window.dispatchEvent(new Event("resize"));
    fixture.orientation.dispatchEvent(new Event("change"));
    expect(fixture.changed).toHaveBeenCalledTimes(1);
    expect(fixture.disconnect).toHaveBeenCalled();
  });
});
