import { linkOptions } from "@tanstack/react-router";

import {
  parsePoetryManageSearch,
  poetryManageReturnLink,
  poetryResumeLink,
} from "./reading-navigation";

/** 先恢复真实列表父级，再进入作品，让 WebKit 有可交互返回的页面。 */
export function mobilePoetryEntry() {
  const destination = poetryResumeLink({ resume: true });
  if (!destination) return undefined;
  const detail =
    destination.to === "/library/$id" ||
    ("poem" in destination.search && !!destination.search.poem);
  if (!detail) return undefined;
  return {
    parent: linkOptions({
      to: "/library",
      search: { q: destination.search.q },
    }),
    destination,
  };
}

export function poetryBackLink(path: string, search: Record<string, unknown>) {
  if (path === "/library/manage")
    return poetryManageReturnLink(parsePoetryManageSearch(search));
  return linkOptions({
    to: "/library",
    search: { q: typeof search.q === "string" ? search.q : undefined },
  });
}
