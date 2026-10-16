import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { ImageOff } from "lucide-react";

import type { TodoNoteSummary } from "~/bindings";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";
import type { TodoItem } from "~/types";

import { useNoteImage } from "./notes/use-note-image";
import TodoRowActionsDesktop from "./TodoRowActions.desktop";
import TodoRowActionsMobile from "./TodoRowActions.mobile";
import TodoTimestamps from "./TodoTimestamps";

function NoteThumbnail({
  summary,
  onOpen,
}: {
  summary: TodoNoteSummary;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const { value, error } = useNoteImage(
    summary.firstImage!.id,
    { itemId: summary.itemId, draftId: null },
    true,
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-visible:ring-ring bg-muted relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md outline-none focus-visible:ring-2"
      aria-label={t`查看备注图片`}
      title={error ? describeError(error, t) : t`查看备注图片`}
    >
      {value ? (
        <img
          src={value.url}
          alt={t`备注首图`}
          width={56}
          height={56}
          className="size-full object-cover"
        />
      ) : error ? (
        <ImageOff className="text-muted-foreground size-4" aria-hidden />
      ) : (
        <Spinner className="size-4" />
      )}
      {summary.imageCount > 1 ? (
        <Badge variant="secondary" className="absolute right-0 bottom-0">
          {summary.imageCount}
        </Badge>
      ) : null}
    </button>
  );
}

export default function TodoRow({
  item,
  summary,
  pending,
  compactActions,
  onToggle,
  onEdit,
  onDelete,
  onViewDetails,
}: {
  item: TodoItem;
  summary?: TodoNoteSummary;
  pending: boolean;
  compactActions: boolean;
  onToggle: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
  onViewDetails: (item: TodoItem) => void;
}) {
  const { t } = useLingui();
  const Actions = compactActions ? TodoRowActionsMobile : TodoRowActionsDesktop;
  return (
    <div className="pb-2">
      <div
        className="border-border bg-card relative grid min-h-14 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg border px-2.5 py-2"
        onClick={(event) => {
          const target = event.target;
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, input, label, a, [role="checkbox"]') ||
            !window.getSelection()?.isCollapsed
          )
            return;
          onViewDetails(item);
        }}
      >
        <label
          data-slot="touch-label"
          className="flex shrink-0 items-center justify-center self-start pt-0.5"
        >
          <Checkbox
            checked={item.completed}
            disabled={pending}
            onCheckedChange={() => onToggle(item)}
            aria-label={item.completed ? t`标记为未完成` : t`标记为完成`}
          />
        </label>
        <div className="flex min-w-0 items-start gap-2.5">
          {summary?.firstImage ? (
            <NoteThumbnail
              summary={summary}
              onOpen={() => onViewDetails(item)}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <button
              type="button"
              onClick={() => onViewDetails(item)}
              title={t({
                message: "查看详情",
                comment: "打开待办的完整内容和时间信息",
              })}
              className="focus-visible:ring-ring min-w-0 cursor-pointer text-left outline-none focus-visible:ring-2"
            >
              <span
                className={cn(
                  "block min-w-0 text-sm font-medium wrap-break-word",
                  compactActions && "line-clamp-2",
                )}
              >
                {item.category ? (
                  <Badge
                    variant="outline"
                    className="mr-1.5 max-w-20 min-w-0 align-text-bottom"
                    title={item.category}
                  >
                    <span className="truncate">{item.category}</span>
                  </Badge>
                ) : null}
                <span
                  className={cn(
                    item.completed && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
              </span>
            </button>
            {item.notes ? (
              <p
                className={cn(
                  "text-muted-foreground line-clamp-2 cursor-text text-xs leading-4 wrap-break-word whitespace-pre-wrap select-text",
                  item.completed && "opacity-70",
                )}
              >
                {item.notes}
              </p>
            ) : summary?.imageCount ? (
              <span className="sr-only">
                <Trans>图片备注</Trans>
              </span>
            ) : null}
            <TodoTimestamps item={item} />
          </div>
        </div>
        <Actions
          disabled={pending}
          onEdit={() => onEdit(item)}
          onDelete={() => onDelete(item)}
        />
      </div>
    </div>
  );
}
