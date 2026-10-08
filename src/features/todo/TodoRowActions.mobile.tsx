import { Trans, useLingui } from "@lingui/react/macro";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

import type { TodoRowActionsProps } from "./todo-row-actions";

/** 卡片右上角的次级操作不参与正文行高，仍保留独立的 24px 点击区。 */
export default function TodoRowActionsMobile({
  disabled,
  onEdit,
  onDelete,
}: TodoRowActionsProps) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="bg-card/40 hover:bg-card/70"
          style={{ minWidth: 24, minHeight: 24 }}
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
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            <Trans>删除待办</Trans>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
