import { describe, expect, it } from "vitest";

import type { SpeechSnapshot } from "~/bindings";

import { createSpeechDocument, locateSpeechText } from "./speech-document";

const poem = {
  title: " 靜夜思 ",
  dynasty: "唐",
  author: " 李白 ",
  body: ["  床前明月光，疑是地上霜。", "", "舉頭望明月，低頭思故鄉。"],
};

function position(
  segmentIndex: number,
  start: number,
  length = 1,
): SpeechSnapshot {
  return {
    phase: "speaking",
    revision: 1,
    sessionId: "test",
    segmentIndex,
    segmentCount: 3,
    textRange: { start, length },
    voiceId: null,
    error: null,
  };
}

describe("朗读文本到诗词展示的映射", () => {
  it("按题目、朝代、作者和正文构建朗读，试听包含开场与第一段", () => {
    const document = createSpeechDocument(poem);
    expect(document.segments.map((part) => part.text)).toEqual([
      "靜夜思。唐，李白。",
      "床前明月光，疑是地上霜。",
      "舉頭望明月，低頭思故鄉。",
    ]);
    expect(document.previewCount).toBe(2);
  });

  it("保留去空格和跳过空段后的原始 DOM 位置", () => {
    const document = createSpeechDocument(poem);
    expect(locateSpeechText(document, position(0, 0))).toEqual({
      key: "title",
      offset: 1,
    });
    expect(locateSpeechText(document, position(0, 4))).toEqual({
      key: "dynasty",
      offset: 0,
    });
    expect(locateSpeechText(document, position(0, 6))).toEqual({
      key: "author",
      offset: 1,
    });
    expect(locateSpeechText(document, position(1, 0))).toEqual({
      key: "body-0",
      offset: 2,
    });
    expect(locateSpeechText(document, position(2, 0))).toEqual({
      key: "body-2",
      offset: 0,
    });
  });

  it("缺失朝代不会生成空的朗读段或多余分隔符", () => {
    const document = createSpeechDocument({ ...poem, dynasty: "" });
    expect(document.segments[0].text).toBe("靜夜思。李白。");
    expect(locateSpeechText(document, position(0, 4))).toEqual({
      key: "author",
      offset: 1,
    });
  });

  it("按 UTF-16 而非字节定位增补汉字，拒绝越界回调", () => {
    const document = createSpeechDocument({ ...poem, body: ["𠮷人天相"] });
    expect(locateSpeechText(document, position(1, 2))).toEqual({
      key: "body-0",
      offset: 2,
    });
    expect(locateSpeechText(document, position(1, 4, 2))).toBeNull();
    expect(locateSpeechText(document, position(20, 0))).toBeNull();
  });
});
