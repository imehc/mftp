import { describe, expect, it } from "vitest";

import type { PoetryPackTranslation, PoetryTranslation } from "~/bindings";

import {
  selectPoetryPackTranslations,
  selectPoetryTranslation,
} from "./translation-selection";

function translation(
  mode: PoetryTranslation["mode"],
  source: PoetryTranslation["source"] = "ai",
  updatedAt = 1,
): PoetryTranslation {
  return {
    id: mode,
    poemUid: "poem",
    bodyFingerprint: "body",
    language: "zh-CN",
    mode,
    promptVersion: 2,
    content: `${mode} 正文`,
    source,
    model: "model",
    createdAt: 1,
    updatedAt,
  };
}

function pack(
  mode: PoetryPackTranslation["mode"],
  packId = "pack",
): PoetryPackTranslation {
  return {
    packId,
    packName: packId,
    packAuthor: "作者",
    packSource: "来源",
    packLicense: "CC0",
    language: "zh-CN",
    mode,
    content: `${packId} ${mode}`,
  };
}

describe("统一现代文译文的历史选择", () => {
  it("没有记录时返回空，有任一种历史记录时均可阅读", () => {
    expect(selectPoetryTranslation([])).toBeNull();
    for (const mode of ["literal", "literary"] as const) {
      const item = translation(mode);
      expect(selectPoetryTranslation([item])).toBe(item);
    }
  });

  it("两种生成记录并存时优先显示白话，不修改原数组", () => {
    const literal = translation("literal");
    const literary = translation("literary", "ai", 2);
    const items = [literary, literal];
    expect(selectPoetryTranslation(items)).toBe(literal);
    expect(items).toEqual([literary, literal]);
  });

  it("保留较新的人工修订，同一时间也优先人工内容", () => {
    const literal = translation("literal", "ai", 2);
    const edited = translation("literary", "user", 2);
    expect(selectPoetryTranslation([literal, edited])).toBe(edited);
    expect(
      selectPoetryTranslation([translation("literal", "user", 1), edited]),
    ).toBe(edited);
  });

  it("确认重新生成后显示新白话，重新读取也不回退旧修订", () => {
    const edited = translation("literary", "user", 2);
    const generated = translation("literal", "ai", 3);
    expect(selectPoetryTranslation([edited, generated])).toBe(generated);
    expect(selectPoetryTranslation([generated, edited])).toBe(generated);
    expect(selectPoetryTranslation([edited])).toBe(edited);
  });
});

describe("统一开放译文", () => {
  it("同包同语言只显示一种译文，优先白话并保留署名来源", () => {
    const literal = pack("literal");
    expect(selectPoetryPackTranslations([pack("literary"), literal])).toEqual([
      literal,
    ]);
    expect(selectPoetryPackTranslations([literal, pack("literary")])).toEqual([
      literal,
    ]);
  });

  it("只有文学译文时继续显示，不合并不同来源或语言", () => {
    const first = pack("literary");
    const second = pack("literal", "second");
    const english = { ...first, language: "en" };
    expect(selectPoetryPackTranslations([first, second, english])).toEqual([
      first,
      second,
      english,
    ]);
  });
});
