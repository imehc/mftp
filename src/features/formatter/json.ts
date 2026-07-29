export type FormatResult =
  | { ok: true; value: string }
  | { ok: false; error: string; line?: number; column?: number };

export interface FormatOptions {
  /** Indentation passed to the serializer, e.g. "  " or "\t". */
  indent: string;
}

/** Convert a 0-based character offset to 1-based line/column. */
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

/** Extract the character offset from a JSON.parse error message, if present. */
export function jsonErrorOffset(message: string): number | null {
  // V8/WebKit both mention "position N" in SyntaxError messages.
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

export function formatJson(input: string, options: FormatOptions): FormatResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value, null, options.indent) };
}

export function minifyJson(input: string): FormatResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value) };
}

/** Validate only; ok means parseable, value echoes the input untouched. */
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
    value: JSON.stringify(sortValueKeys(parsed.value, direction), null, options.indent),
  };
}

/** Escape the whole document as a JSON string literal body ({"a":1} → {\"a\":1}).
 * Valid JSON is minified first so the escaped output carries no whitespace. */
export function escapeJsonString(input: string): FormatResult {
  const parsed = parseJson(input);
  const source = parsed.ok ? JSON.stringify(parsed.value) : input;
  return { ok: true, value: JSON.stringify(source).slice(1, -1) };
}

/** Reverse of escapeJsonString; also tolerates input wrapped in quotes. */
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
