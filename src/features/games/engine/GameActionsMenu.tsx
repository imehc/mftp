import { useLingui } from "@lingui/react/macro";
import { MoreHorizontal } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

import { GameMatchActions } from "./GameHeaderControls";
import { GameVolumeControl } from "./GameVolumeControl";

/** 棋类与台球共用操作弹层，行宽由最长文案决定，图标和文字统一左对齐。 */
export function GameActionsMenu({
  extraActions,
  onOpenChange,
  ...props
}: ComponentProps<typeof GameMatchActions> & {
  extraActions?: (closeThen: (action: () => void) => void) => ReactNode;
  onOpenChange?(open: boolean): void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`更多操作`}
          data-game-more
        >
          <MoreHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="ui-density-adaptive flex w-fit max-w-[calc(100vw-2rem)] flex-col gap-1 p-2 motion-safe:data-closed:animate-none"
        onCloseAutoFocus={(event) => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) {
            event.preventDefault();
            action();
          }
        }}
      >
        <GameVolumeControl presentation="menu" />
        {extraActions?.((action) => {
          setPendingAction(() => action);
          changeOpen(false);
        })}
        <GameMatchActions {...props} />
      </PopoverContent>
    </Popover>
  );
}
