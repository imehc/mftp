import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";

import type { TodoItem } from "~/types";

import { formatTodoDate, formatTodoTimestamp } from "./todo-utils";

/** 详情优先展示已有的计划/完成时间，没有时才回退到创建时间。 */
export default function TodoTimestamps({
  item,
  details = false,
}: {
  item: TodoItem;
  details?: boolean;
}) {
  const { i18n, t } = useLingui();

  const timestamp = (value: number) => {
    const full = formatTodoTimestamp(value, i18n.locale);
    return (
      <time
        dateTime={new Date(value).toISOString()}
        title={full}
        aria-label={full}
      >
        {formatTodoTimestamp(value, i18n.locale, true)}
      </time>
    );
  };

  const created = {
    key: "created",
    label: t({
      message: "创建",
      context: "timestamp label",
      comment: "待办创建时间的紧凑标签",
    }),
    fullLabel: t`创建时间`,
    value: timestamp(item.createdAt),
  };
  const completed = {
    key: "completed",
    label: t({
      message: "完成",
      context: "timestamp label",
      comment: "待办完成时间的紧凑标签",
    }),
    fullLabel: t`完成时间`,
    value:
      item.completedAt != null ? (
        timestamp(item.completedAt)
      ) : (
        <Trans comment="旧待办未记录完成时刻，不使用更新时间推测">未记录</Trans>
      ),
  };
  const planned = {
    key: "planned",
    label: t({
      message: "计划",
      context: "timestamp label",
      comment: "待办计划时间的紧凑标签",
    }),
    fullLabel: t`计划时间`,
    value:
      item.dueAt != null ? (
        timestamp(item.dueAt)
      ) : item.dueDate ? (
        <time
          dateTime={item.dueDate}
          title={formatTodoDate(item.dueDate, i18n.locale)}
          aria-label={formatTodoDate(item.dueDate, i18n.locale)}
        >
          {formatTodoDate(item.dueDate, i18n.locale, true)}
        </time>
      ) : null,
  };
  const detailFields = [
    ...(planned.value ? [planned] : []),
    ...(item.completed && item.completedAt != null ? [completed] : []),
  ];
  const fields = details
    ? detailFields.length
      ? detailFields
      : [created]
    : [created, ...(item.completed ? [completed] : [])];

  return (
    <dl
      className={cn(
        "text-muted-foreground flex min-w-0 items-center gap-x-3 gap-y-1 text-xs leading-4",
        details && "flex-wrap",
      )}
    >
      {fields.map((field) => (
        <div
          key={field.key}
          className={cn(
            "flex items-baseline gap-1 whitespace-nowrap",
            details ? "shrink-0" : "min-w-0",
          )}
        >
          <dt
            title={field.fullLabel}
            aria-label={field.fullLabel}
            className="shrink-0"
          >
            {field.label}
          </dt>
          <dd className={cn("tabular-nums", !details && "min-w-0 truncate")}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
