import type { ComponentProps } from "react";
import { useLingui } from "@lingui/react/macro";
import { MoreHorizontal } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { GameMatchActions } from "./GameHeaderControls";
import { GameVolumeControl } from "./GameVolumeControl";

/** 棋类与台球共用操作弹层，行宽由最长文案决定，图标和文字统一左对齐。 */
export function GameActionsMenu(
  props: ComponentProps<typeof GameMatchActions>,
) {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t`更多操作`}>
          <MoreHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="ui-density-adaptive flex w-fit max-w-[calc(100vw-2rem)] flex-col gap-1 p-2"
      >
        <GameVolumeControl presentation="menu" />
        <GameMatchActions {...props} />
      </PopoverContent>
    </Popover>
  );
}
