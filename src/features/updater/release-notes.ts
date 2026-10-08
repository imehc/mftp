export const RELEASES_URL = "https://github.com/imehc/mftp/releases";
export const MAX_RELEASE_NOTES_LENGTH = 32_000;
const MAX_RELEASE_NOTES_LINES = 500;

export function prepareReleaseNotes(body: string) {
  const text = body
    .slice(0, MAX_RELEASE_NOTES_LENGTH)
    .split(/\r?\n/)
    .slice(0, MAX_RELEASE_NOTES_LINES)
    .join("\n");
  return { text, truncated: text.length < body.replace(/\r\n/g, "\n").length };
}

export interface ReleaseNote {
  kind: "heading" | "item" | "paragraph";
  text: string;
}

/** 只转换展示格式，远端内容始终作为文本渲染，不执行 HTML 或链接。 */
export function parseReleaseNotes(body: string): ReleaseNote[] {
  return body.split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line) return [];
    const heading = /^#{1,6}\s+/.test(line);
    const item = /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
    const text = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*/i, "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    return [{ kind: heading ? "heading" : item ? "item" : "paragraph", text }];
  });
}
