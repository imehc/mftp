import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PresentedModule } from "./catalog-presentation";
import McpToolsTable from "./McpToolsTable";

function markup(modules: PresentedModule[]) {
  const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <McpToolsTable modules={modules} available onCopyError={vi.fn()} />
    </I18nProvider>,
  );
}

const modules: PresentedModule[] = [
  {
    id: "first",
    title: "第一模块",
    tools: [
      {
        title: "读取内容",
        name: "first_read",
        description: "Read",
        permission: "read",
      },
      {
        title: "编辑内容",
        name: "first_write",
        description: "Write",
        permission: "write",
      },
    ],
  },
  {
    id: "second",
    title: "第二模块",
    tools: [
      {
        title: "删除内容",
        name: "second_delete",
        description: "Delete",
        permission: "delete",
      },
    ],
  },
];

describe("MCP 工具目录表", () => {
  it("模块作为首列合并单元格，名称和调用名称排在后续列", () => {
    const rendered = markup(modules);
    expect(rendered).toMatch(/scope="rowgroup" rowSpan="2"/);
    expect(rendered.indexOf("第一模块")).toBeLessThan(
      rendered.indexOf("读取内容"),
    );
    expect(rendered.indexOf("读取内容")).toBeLessThan(
      rendered.indexOf("first_read"),
    );
    expect(rendered).toContain("第二模块");
    expect(rendered).not.toMatch(/colspan="4"[^>]*>第一模块/);
  });

  it("调用名复用共享复制按钮且多层表头有关联", () => {
    const rendered = markup(modules);
    expect(rendered).toContain('aria-label="复制调用名 first_read"');
    expect(rendered).toContain('headers="');
    expect(rendered).toContain('scope="colgroup"');
  });

  it("合并模块表头与工具各列都有完整分隔线", () => {
    const rendered = markup(modules);
    const heads = [...rendered.matchAll(/<th\b([^>]*)>/g)];
    expect(
      heads.find(
        (head) =>
          head[1].includes('scope="col"') && head[1].includes('rowSpan="2"'),
      )?.[1],
    ).toContain("border-b");
    const cells = [...rendered.matchAll(/<td\b([^>]*)>/g)];
    expect(cells.every((cell) => /border-[lr]/.test(cell[1]))).toBe(true);
  });
});
