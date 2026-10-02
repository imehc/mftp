import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useDebouncedQuery } from "./use-poetry-search";

function initialMarkup(initialInput?: string) {
  function Probe() {
    const { input, query } = useDebouncedQuery(300, initialInput);
    return createElement("output", {
      "data-input": input,
      "data-query": query,
    });
  }
  // 服务端渲染不执行 effect，直接验证首帧，不能依赖防抖或 URL 镜像补救。
  return renderToStaticMarkup(createElement(Probe));
}

describe("诗词查询的首帧恢复", () => {
  it("从管理页返回或直接打开链接时立即进入来源查询", () => {
    expect(initialMarkup("观沧海")).toBe(
      '<output data-input="观沧海" data-query="观沧海"></output>',
    );
  });

  it("保留输入草稿的空格，但稳定查询沿用去空格规则", () => {
    expect(initialMarkup("  观沧海  ")).toBe(
      '<output data-input="  观沧海  " data-query="观沧海"></output>',
    );
  });

  it("没有来源查询时仍从空列表查询开始", () => {
    expect(initialMarkup()).toBe(
      '<output data-input="" data-query=""></output>',
    );
  });
});
