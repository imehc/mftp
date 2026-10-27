import type { PoetryPackTranslation, PoetryTranslation } from "~/bindings";

/** 保留人工修订；用户后来生成的统一译文应在重开页面后仍然可见。 */
export function selectPoetryTranslation(
  translations: readonly PoetryTranslation[],
): PoetryTranslation | null {
  const newest = [...translations].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  const edited = newest.find((item) => item.source === "user");
  const literal = newest.find((item) => item.mode === "literal");
  if (edited && (!literal || edited.updatedAt >= literal.updatedAt))
    return edited;
  return literal ?? edited ?? newest[0] ?? null;
}

/** 同一译文包同一语言只保留一种正文，不合并不同来源的内容或署名。 */
export function selectPoetryPackTranslations(
  translations: readonly PoetryPackTranslation[],
): PoetryPackTranslation[] {
  const selected = new Map<string, PoetryPackTranslation>();
  for (const item of translations) {
    const key = JSON.stringify([item.packId, item.language]);
    const previous = selected.get(key);
    if (!previous || (previous.mode !== "literal" && item.mode === "literal"))
      selected.set(key, item);
  }
  return [...selected.values()];
}
