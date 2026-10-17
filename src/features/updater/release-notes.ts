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

/** 整理更新条目，远端内容始终作为文本渲染，不执行 HTML 或链接。 */
export function parseReleaseNotes(body: string): ReleaseNote[] {
  return body.split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line) return [];
    const heading = /^#{1,6}\s+/.test(line);
    const item = /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
    const content = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    // 兼容已发布的带类型说明；普通段落中的冒号不作为提交前缀处理。
    const prefix =
      /^(feat|fix|perf|refactor|docs|test|build|ci|style|revert|chore)(?:\([^)]*\))?!?:\s*/i.exec(
        content,
      );
    if (
      prefix &&
      !["feat", "fix", "refactor", "perf"].includes(prefix[1].toLowerCase())
    )
      return [];
    const text = content.slice(prefix?.[0].length ?? 0);
    return [{ kind: heading ? "heading" : item ? "item" : "paragraph", text }];
  });
}
