import { useLingui } from "@lingui/react/macro";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Separator } from "~/components/ui/separator";

import { GameHeaderActions } from "./GameHeaderActions";

/**
 * 所有小游戏共用的「游戏信息」入口。
 * 桌面端在标题栏显示图标，窄屏改为更多菜单里的一块内容，图标与文案在此锁定。
 */
export function GameInfoPopover({
  children,
  parameters,
  menuLeading,
  open,
  onOpenChange,
}: {
  /** 状态、计数与对局详情。 */
  children: ReactNode;
  /** 参数区，固定置顶于信息正文，例如开关与选择器。 */
  parameters?: ReactNode;
  /** 窄屏菜单里排在信息之前的内容，通常是局内动作。 */
  menuLeading?: ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const { t } = useLingui();
  const label = t({
    message: "游戏信息",
    comment: "展开小游戏的模式、计数、参数及完整状态",
  });
  const body = (
    <>
      {parameters ? (
        <>
          <div className="flex flex-col gap-2">{parameters}</div>
          <Separator />
        </>
      ) : null}
      {children}
    </>
  );
  return (
    <>
      <GameHeaderActions>
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button
              className="game-header-information"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              title={label}
            >
              <Info />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="ui-density-adaptive app-scroll-safe-end max-h-(--radix-popover-content-available-height) max-w-[calc(100vw-1.5rem)] overflow-y-auto"
          >
            <PopoverHeader>
              <PopoverTitle>{label}</PopoverTitle>
            </PopoverHeader>
            {body}
          </PopoverContent>
        </Popover>
      </GameHeaderActions>
      <GameHeaderActions menu>
        <div className="game-toolbar-menu flex max-w-72 flex-col gap-3 py-2">
          <div className="game-toolbar-menu-actions flex flex-col gap-1">
            {menuLeading}
          </div>
          <span className="text-muted-foreground text-xs font-medium">
            {label}
          </span>
          {body}
        </div>
      </GameHeaderActions>
    </>
  );
}
