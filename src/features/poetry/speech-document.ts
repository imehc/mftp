import type { SpeechSnapshot } from "~/bindings";
import type { PoemDetail } from "~/types";

export interface SpeechTextPart {
  key: string;
  start: number;
  end: number;
  sourceOffset: number;
}

export interface PoetrySpeechDocument {
  key: string;
  segments: { text: string; parts: SpeechTextPart[] }[];
  previewCount: number;
}

export function createSpeechDocument(
  poem: Pick<PoemDetail, "title" | "dynasty" | "author" | "body"> | null,
): PoetrySpeechDocument {
  const segments: PoetrySpeechDocument["segments"] = [];
  if (!poem) return { key: "", segments, previewCount: 0 };
  let text = "";
  const parts: SpeechTextPart[] = [];
  for (const [key, raw, separator] of [
    ["title", poem.title, ""],
    ["dynasty", poem.dynasty ?? "", "。"],
    ["author", poem.author, poem.dynasty?.trim() ? "，" : "。"],
  ]) {
    const content = raw.trim();
    if (!content) continue;
    if (text) text += separator;
    const start = text.length;
    text += content;
    parts.push({
      key,
      start,
      end: text.length,
      sourceOffset: raw.length - raw.trimStart().length,
    });
  }
  if (text) segments.push({ text: `${text}。`, parts });
  const openingCount = segments.length;
  poem.body.forEach((raw, index) => {
    const content = raw.trim();
    if (!content) return;
    segments.push({
      text: content,
      parts: [
        {
          key: `body-${index}`,
          start: 0,
          end: content.length,
          sourceOffset: raw.length - raw.trimStart().length,
        },
      ],
    });
  });
  return {
    key: JSON.stringify([poem.title, poem.dynasty, poem.author, poem.body]),
    segments,
    previewCount: Math.min(segments.length, openingCount + 1),
  };
}

export function locateSpeechText(
  document: PoetrySpeechDocument,
  snapshot: SpeechSnapshot,
): { key: string; offset: number } | null {
  const range = snapshot.textRange;
  const segment = document.segments[snapshot.segmentIndex];
  if (
    !range ||
    !segment ||
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.length) ||
    range.start < 0 ||
    range.length <= 0 ||
    range.start + range.length > segment.text.length
  )
    return null;
  // 标点落在两个展示节点之间时仍归前一节点，不提前高亮下一位作者或朝代。
  let part: SpeechTextPart | undefined;
  for (const candidate of segment.parts) {
    if (candidate.start > range.start) break;
    part = candidate;
  }
  if (!part) return null;
  return {
    key: part.key,
    offset:
      part.sourceOffset +
      Math.min(range.start - part.start, part.end - part.start - 1),
  };
}
