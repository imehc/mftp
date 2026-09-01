export type FormatResult =
  | { ok: true; value: string }
  | { ok: false; error: string; line?: number; column?: number };

export interface FormatOptions {
  /** 传给序列化器的缩进，例如 "  " 或 "\t"。 */
  indent: string;
}

/** 将 0 基字符偏移转换为 1 基的行 / 列。 */
export function offsetToLineColumn(
  input: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, input.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (input.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

/** 若 JSON.parse 的错误信息中包含偏移量，则提取出来。 */
export function jsonErrorOffset(message: string): number | null {
  // V8/WebKit 都会在 SyntaxError 信息里写明 "position N"。
  const match = /position (\d+)/i.exec(message);
  return match ? Number(match[1]) : null;
}

function parseJson(input: string): { ok: true; value: unknown } | FormatResult {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const offset = jsonErrorOffset(message);
    if (offset !== null) {
      const { line, column } = offsetToLineColumn(input, offset);
      return { ok: false, error: message, line, column };
    }
    return { ok: false, error: message };
  }
}

export function formatJson(
  input: string,
  options: FormatOptions,
): FormatResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: JSON.stringify(parsed.value, null, options.indent),
  };
}

export function minifyJson(input: string): FormatResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value) };
}

/** 仅做校验；ok 表示可解析，value 原样返回输入内容。 */
export function validateJson(input: string): FormatResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: input };
}

export type SortDirection = "asc" | "desc";

function sortValueKeys(value: unknown, direction: SortDirection): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValueKeys(item, direction));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (direction === "desc") keys.reverse();
    const sorted: Record<string, unknown> = {};
    for (const key of keys) {
      sorted[key] = sortValueKeys(record[key], direction);
    }
    return sorted;
  }
  return value;
}

export function sortJsonKeys(
  input: string,
  options: FormatOptions,
  direction: SortDirection,
): FormatResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: JSON.stringify(
      sortValueKeys(parsed.value, direction),
      null,
      options.indent,
    ),
  };
}

/** 将整个文档转义为 JSON 字符串字面量主体。
 * 合法的 JSON 会先压缩，使转义后的输出不含空白。 */
export function escapeJsonString(input: string): FormatResult {
  const parsed = parseJson(input);
  const source = parsed.ok ? JSON.stringify(parsed.value) : input;
  return { ok: true, value: JSON.stringify(source).slice(1, -1) };
}

/** escapeJsonString 的逆操作；也接受带外层引号包裹的输入。 */
export function unescapeJsonString(input: string): FormatResult {
  const trimmed = input.trim();
  const literal =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed
      : `"${input}"`;
  try {
    const value = JSON.parse(literal);
    if (typeof value !== "string") {
      return { ok: false, error: "not a string literal" };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
