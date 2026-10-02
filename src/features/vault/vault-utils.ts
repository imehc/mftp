import type { VaultEntry } from "~/types";
export const ALL_CATEGORIES = "__all__";
export function filterVaultEntries(
  entries: VaultEntry[],
  search: string,
  category: string,
) {
  const keyword = search.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (category === ALL_CATEGORIES || entry.category === category) &&
      (!keyword ||
        [entry.title, entry.username, entry.url, entry.notes].some((text) =>
          text?.toLocaleLowerCase().includes(keyword),
        )),
  );
}
