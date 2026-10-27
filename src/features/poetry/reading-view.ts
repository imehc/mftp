export type PoetryReadingView = "original" | "annotations" | "translation";

export type PoetryReferenceView = Exclude<PoetryReadingView, "original">;

/** 旧链接的风格参数只用于恢复阅读视图，不再决定生成方式。 */
export function resolvePoetryReadingView(
  view: unknown,
  legacyMode?: unknown,
): PoetryReadingView | undefined {
  if (view === "original" || view === "annotations" || view === "translation")
    return view;
  return legacyMode === "literal" || legacyMode === "literary"
    ? "translation"
    : undefined;
}

export function resolvePoetryReferenceView(
  view: unknown,
): PoetryReferenceView | undefined {
  return view === "annotations" || view === "translation" ? view : undefined;
}
