import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Ellipsis, Eye, EyeOff, GripVertical, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "~/components/CopyButton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { describeError } from "~/lib/errors";
import type { VaultEntry } from "~/types";

export default function VaultEntryCard({
  entry,
  sortable,
  busy,
  onEdit,
  onDelete,
}: {
  entry: VaultEntry;
  sortable: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const [visible, setVisible] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled: !sortable });
  return (
    <section
      ref={setNodeRef}
      className="border-border bg-card relative flex min-w-0 flex-col rounded-lg border"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <h2
          className="min-w-0 truncate text-sm font-semibold"
          title={entry.title}
        >
          {entry.title}
        </h2>
        {sortable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            className="touch-none"
            {...attributes}
            {...listeners}
            aria-label={t`拖动排序`}
          >
            <GripVertical />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={t`更多操作`}
                disabled={busy}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ui-density-adaptive">
              <DropdownMenuGroup>
                {entry.url ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      void openUrl(entry.url!).catch((error) =>
                        toast.error(describeError(error)),
                      );
                    }}
                  >
                    <Trans>打开网址</Trans>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trans>删除</Trans>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex flex-1 flex-col px-3">
        <div className="flex min-w-0 items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium">
              <Trans>账号</Trans>
            </p>
            <p
              className="text-muted-foreground mt-1 truncate text-xs"
              title={entry.username ?? undefined}
            >
              {entry.username || "—"}
            </p>
          </div>
          <CopyButton
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            value={entry.username ?? ""}
            disabled={!entry.username}
            label={t`复制账号`}
            onError={(error) => toast.error(describeError(error))}
          />
        </div>
        <div className="border-border flex min-w-0 items-center justify-between gap-2 border-t py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium">
              <Trans>密码</Trans>
            </p>
            <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
              {entry.password
                ? visible
                  ? entry.password
                  : "••••••••••••"
                : "—"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              disabled={!entry.password}
              aria-label={visible ? t`隐藏密码` : t`显示密码`}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff /> : <Eye />}
            </Button>
            <CopyButton
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              value={entry.password ?? ""}
              disabled={!entry.password}
              label={t`复制密码`}
              onError={(error) => toast.error(describeError(error))}
            />
          </div>
        </div>
        {entry.notes ? (
          <p className="text-muted-foreground mb-3 line-clamp-2 text-xs break-all whitespace-pre-wrap">
            {entry.notes}
          </p>
        ) : null}
      </div>
      <div className="border-border flex items-center justify-between gap-2 border-t px-3 py-2">
        <div className="min-w-0">
          {entry.category ? (
            <Badge variant="secondary" className="max-w-full">
              <span className="truncate">{entry.category}</span>
            </Badge>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          density="adaptive"
          disabled={busy}
          onClick={onEdit}
        >
          <Pencil />
          <Trans>编辑</Trans>
        </Button>
      </div>
    </section>
  );
}
