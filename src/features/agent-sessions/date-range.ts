export type SessionDateRange = "all" | "today" | "week" | "month" | "custom";

function localDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
}

export function sessionDateBounds(
  range: SessionDateRange,
  from: string,
  to: string,
  now = new Date(),
  month?: string,
) {
  let start: Date | null = null;
  let end: Date | null = null;
  if (range === "today" || range === "week" || range === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === "week") start.setDate(start.getDate() - 6);
    if (range === "month") {
      start = month
        ? localDate(`${month}-01`)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      if (!start) return { valid: false, from: null, to: null };
      end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    }
  } else if (range === "custom") {
    start = from ? localDate(from) : null;
    end = to ? localDate(to) : null;
    if ((from && !start) || (to && !end))
      return { valid: false, from: null, to: null };
    if (end) end.setDate(end.getDate() + 1);
  }
  const fromMs = start?.getTime() ?? null;
  const toMs = end ? end.getTime() - 1 : null;
  return {
    valid: fromMs === null || toMs === null || fromMs <= toMs,
    from: fromMs,
    to: toMs,
  };
}
