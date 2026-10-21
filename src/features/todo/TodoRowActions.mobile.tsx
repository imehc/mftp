import { Trans, useLingui } from "@lingui/react/macro";
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

import type { TodoRowActionsProps } from "./todo-row-actions";

export default function TodoRowActionsMobile({
  disabled,
  abandoned,
  onEdit,
  onDelete,
  onToggleAbandon,
}: TodoRowActionsProps) {
  const { t } = useLingui();
  const AbandonIcon = abandoned ? ArchiveRestore : Archive;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          density="adaptive"
          className="bg-card/40 hover:bg-card/70"
          disabled={disabled}
          aria-label={t({
            message: "待办操作",
            comment: "待办列表行的更多操作菜单",
          })}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="ui-density-adaptive min-w-0">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            <Trans>编辑待办</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleAbandon}>
            <AbandonIcon />
            {abandoned ? <Trans>恢复待办</Trans> : <Trans>标记为已废弃</Trans>}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            <Trans>删除待办</Trans>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
