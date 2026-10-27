import { linkOptions } from "@tanstack/react-router";

import {
  type PoetryReadingLocation,
  poetryReadingSession,
} from "./reading-session";
import {
  type PoetryReadingView,
  resolvePoetryReadingView,
} from "./reading-view";

export interface PoetryLibrarySearch {
  q?: string;
  poem?: string;
  view?: PoetryReadingView;
  resume?: boolean;
}

export interface PoetryManageSearch {
  q?: string;
  poem?: string;
  view?: PoetryReadingView;
  from?: "detail";
}

export function parsePoetryLibrarySearch(
  search: Record<string, unknown>,
): PoetryLibrarySearch {
  return {
    q: typeof search.q === "string" ? search.q : undefined,
    poem: typeof search.poem === "string" ? search.poem : undefined,
    view: resolvePoetryReadingView(search.view, search.mode),
    resume:
      search.resume === true || search.resume === "true" ? true : undefined,
  };
}

export function parsePoetryManageSearch(
  search: Record<string, unknown>,
): PoetryManageSearch {
  const { q, poem, view } = parsePoetryLibrarySearch(search);
  return {
    q,
    poem,
    view,
    from: search.from === "detail" ? "detail" : undefined,
  };
}

/** 只构造诗词内部的已知路由，不接受任意返回 URL。 */
export function poetryReadingLink(location: PoetryReadingLocation) {
  return location.page === "detail" && location.uid
    ? linkOptions({
        to: "/library/$id",
        params: { id: location.uid },
        search: { q: location.q, view: location.view },
      })
    : linkOptions({
        to: "/library",
        search: { q: location.q, poem: location.uid, view: location.view },
      });
}

export function poetryManageReturnLink(search: PoetryManageSearch) {
  return poetryReadingLink({
    page: search.from === "detail" ? "detail" : "library",
    uid: search.poem,
    q: search.q,
    view: search.view,
  });
}

/** 只有显式的恢复入口读取会话；新链接及返回列表不被旧作品劫持。 */
export function poetryResumeLink(search: PoetryLibrarySearch) {
  if (!search.resume) return undefined;
  if (
    search.q !== undefined ||
    search.poem !== undefined ||
    search.view !== undefined
  )
    return poetryReadingLink({
      page: "library",
      q: search.q,
      uid: search.poem,
      view: search.view,
    });
  return poetryReadingLink(
    poetryReadingSession.getState().location ?? { page: "library" },
  );
}
