import { Trans, useLingui } from "@lingui/react/macro";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "~/components/ui/dropdown-menu";
import type { RowActionsProps } from "./types";

export default function RowActionsMobile(props: RowActionsProps) {
  const { t } = useLingui();
  return (
    <div className="flex shrink-0 items-center gap-1">
      {!props.current ? (
        <Button
          variant="outline"
          density="adaptive"
          size="sm"
          disabled={props.disabled}
          onClick={props.onSelect}
        >
          <Trans>选用</Trans>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            density="adaptive"
            variant="ghost"
            size="icon"
            disabled={props.disabled}
            aria-label={t`更多操作`}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="ui-density-adaptive w-max min-w-0"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={props.onEdit}>
              <Pencil />
              <Trans>编辑</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!props.canDelete}
              onSelect={props.onDelete}
            >
              <Trash2 />
              {props.canDelete ? (
                <Trans>删除</Trans>
              ) : (
                <Trans>至少保留一项</Trans>
              )}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
