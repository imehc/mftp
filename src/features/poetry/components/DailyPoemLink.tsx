import { Trans } from "@lingui/react/macro";
import { CalendarDays } from "lucide-react";
import type { PoemDetail } from "~/types";

/** 设计未单列每日推荐，保留为紧凑入口，避免挤压主要作品列表。 */
export default function DailyPoemLink({
  poem,
  onSelect,
}: {
  poem: PoemDetail;
  onSelect: (uid: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(poem.uid)}
      className="hover:bg-accent flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-2 text-left text-xs"
    >
      <CalendarDays className="size-4 shrink-0" aria-hidden />
      <span className="text-muted-foreground shrink-0">
        <Trans>每日一诗</Trans>
      </span>
      <span className="truncate font-medium">{poem.title}</span>
    </button>
  );
}
