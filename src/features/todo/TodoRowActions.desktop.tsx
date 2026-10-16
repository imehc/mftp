import { useLingui } from "@lingui/react/macro";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";

import type { TodoRowActionsProps } from "./todo-row-actions";

/** 宽屏精细指针布局；业务动作由共享 controller 提供。 */
export default function TodoRowActionsDesktop({
  disabled,
  abandoned,
  onEdit,
  onDelete,
  onToggleAbandon,
}: TodoRowActionsProps) {
  const { t } = useLingui();
  const AbandonIcon = abandoned ? ArchiveRestore : Archive;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onEdit}
        aria-label={t`编辑待办`}
        title={t`编辑待办`}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onToggleAbandon}
        aria-label={abandoned ? t`恢复待办` : t`标记为已废弃`}
        title={abandoned ? t`恢复待办` : t`标记为已废弃`}
      >
        <AbandonIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onDelete}
        aria-label={t`删除待办`}
        title={t`删除待办`}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
