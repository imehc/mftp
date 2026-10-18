// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { followScrollDelta, SpeechLines } from "./speech-lines";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("诗词实际显示行定位", () => {
  it("长段换成多行时只选中当前行，并缓存同一行", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "床前明月光疑是地上霜举头望明月低头思故乡";
    const measure = vi
      .spyOn(Range.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Range) {
        return new DOMRect(0, Math.floor(this.startOffset / 5) * 24, 10, 20);
      });
    const lines = new SpeechLines(paragraph);
    const second = lines.lineAt(7);
    expect(second?.toString()).toBe("疑是地上霜");
    const calls = measure.mock.calls.length;
    expect(lines.lineAt(8)).toBe(second);
    expect(measure).toHaveBeenCalledTimes(calls);
    expect(lines.lineAt(19)?.toString()).toBe("低头思故乡");
  });

  it("增补汉字和组合字符不会在高亮边界被切开", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "𠮷人e\u0301安";
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Range) {
        return new DOMRect(0, this.startOffset < 3 ? 0 : 24, 10, 20);
      },
    );
    const lines = new SpeechLines(paragraph);
    expect(lines.lineAt(1)?.toString()).toBe("𠮷人");
    expect(lines.lineAt(4)?.toString()).toBe("e\u0301安");
  });

  it("当前行可见时不滚动，仅补足被裁切的距离", () => {
    const viewport = { top: 100, bottom: 500 };
    expect(followScrollDelta({ top: 100, bottom: 120 }, viewport, 16)).toBe(0);
    expect(followScrollDelta({ top: 480, bottom: 500 }, viewport, 16)).toBe(0);
    expect(followScrollDelta({ top: 490, bottom: 510 }, viewport, 16)).toBe(26);
    expect(followScrollDelta({ top: 90, bottom: 110 }, viewport, 16)).toBe(-26);
  });
});
