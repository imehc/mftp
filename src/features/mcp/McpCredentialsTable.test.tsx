import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { McpCredential } from "~/bindings";

import McpCredentialsTable from "./McpCredentialsTable";

const credential: McpCredential = {
  id: "client",
  name: "测试客户端",
  createdAt: 1,
  grants: {
    "*": { read: true, write: true, delete: false },
  },
};

function markup(value = credential) {
  const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <McpCredentialsTable
        credentials={[value]}
        disabled={false}
        available
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onAction={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("MCP 客户端授权列表", () => {
  it("授权名称与弹窗一致，只展示读写删除而不重复范围", () => {
    const rendered = markup();
    expect(rendered).toContain("1 个客户端");
    expect(rendered).not.toContain("/16");
    expect(rendered).not.toContain("筛选 MCP 模块");
    expect(rendered).not.toContain("待办事项");
    expect(rendered).not.toContain("示例模块");
    expect(rendered).not.toContain("第三模块");
    expect(rendered).toContain("测试客户端");
    expect(rendered).toContain("授权名称");
    expect(rendered).not.toContain("授权范围");
    expect(rendered).not.toContain("全部模块");
    expect(rendered).toContain("读取");
    expect(rendered).toContain("写入");
    expect(rendered).toContain("删除");
    expect(rendered).toContain('scope="colgroup"');
    expect(rendered).toContain('colSpan="3"');
  });

  it("读写不隐含删除，开启删除会独立展示", () => {
    const rendered = markup();
    expect(rendered).toContain('aria-label="管理授权 测试客户端"');
    expect(rendered.match(/aria-label="已授权"/g)).toHaveLength(2);
    expect(rendered.match(/aria-label="未授权"/g)).toHaveLength(1);
    expect(
      markup({
        ...credential,
        grants: { "*": { read: true, write: true, delete: true } },
      }).match(/aria-label="已授权"/g),
    ).toHaveLength(3);
  });

  it("权限子列与合并表头的边框不会缺失", () => {
    const rendered = markup();
    const heads = [...rendered.matchAll(/<th\b([^>]*)>/g)];
    expect(
      heads
        .filter((head) => head[1].includes('rowSpan="2"'))
        .every((head) => head[1].includes("border-b")),
    ).toBe(true);
    expect(
      heads
        .filter((head) => head[1].includes("headers="))
        .every((head) => head[1].includes("border-r")),
    ).toBe(true);
    const cells = [...rendered.matchAll(/<td\b([^>]*)>/g)];
    expect(
      cells.slice(0, 3).every((cell) => cell[1].includes("border-r")),
    ).toBe(true);
  });

  it("旧授权明确提示更新而不自动展示为全部模块", () => {
    const rendered = markup({
      ...credential,
      grants: { todo: { read: true, write: false, delete: false } },
    });
    expect(rendered).toContain("旧版授权（需更新）");
    expect(rendered.match(/aria-label="已授权"/g)).toHaveLength(1);
  });

  it("旧版不同模块权限不伪造统一勾号", () => {
    const rendered = markup({
      ...credential,
      grants: {
        todo: { read: true, write: true, delete: false },
        other: { read: true, write: false, delete: false },
      },
    });
    expect(rendered).toContain("旧版授权（需更新）");
    expect(rendered).not.toContain('aria-label="已授权"');
    expect(rendered.match(/aria-label="权限不一致，需更新授权"/g)).toHaveLength(
      3,
    );
  });
});
