import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageText } from "./MessageText";

describe("历史对话正文排版", () => {
  it("保留标题、列表、代码块与表格结构", () => {
    const html = renderToStaticMarkup(
      <MessageText
        text={
          "## 结果\n\n- 项目\n\n```ts\nconst value = 1;\n```\n\n| 名称 |\n| --- |\n| 示例 |"
        }
        search=""
      />,
    );
    for (const tag of ["<h3", "<ul", "<pre", "<table"])
      expect(html).toContain(tag);
  });

  it("转义原始 HTML，并将特殊字符关键词作为文本匹配", () => {
    const html = renderToStaticMarkup(
      <MessageText text={"<script>alert(1)</script> **[x]**"} search="[x]" />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("<mark");
    expect(html).toContain("[x]");
  });
});
