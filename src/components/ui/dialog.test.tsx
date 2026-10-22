import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DialogFooter } from "./dialog";

describe("弹窗页脚表面", () => {
  it("无底色页脚不带背景和负边距", () => {
    const rendered = renderToStaticMarkup(
      <DialogFooter surface="plain">
        <button>确认</button>
      </DialogFooter>,
    );
    expect(rendered).not.toContain("bg-muted");
    expect(rendered).not.toContain("-mx-4");
    expect(rendered).not.toContain("-mb-4");
    expect(rendered).toContain("border-t");
  });

  it("其他既有弹窗仍沿用默认页脚样式", () => {
    expect(renderToStaticMarkup(<DialogFooter />)).toContain("bg-muted/50");
  });
});
