import "./game-toolbar.css";

import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { Info, type LucideIcon, SlidersHorizontal } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

import { GameHeaderActions, useGameHeaderAction } from "./GameHeaderActions";

/** 共用状态区外壳；复杂比分仍由游戏自己的组件呈现。 */
export function GameDisplayBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="game-display-bar"
      className={cn(
        "game-toolbar border-border shrink-0 border-b px-3 py-1.5 md:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 次要动作在窄屏移入更多菜单；悔棋保持右上角直接可用。 */
export function GameToolbarAction({
  icon: Icon,
  label,
  className,
  secondary = false,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  icon: LucideIcon;
  label: string;
  secondary?: boolean;
}) {
  const invoke = useGameHeaderAction();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="game-toolbar-action-wrap inline-flex shrink-0"
          data-secondary={secondary}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            {...props}
            onClick={
              props.onClick
                ? (event) => invoke(() => props.onClick?.(event))
                : undefined
            }
            className={cn("game-toolbar-action", className)}
          >
            <Icon data-icon="inline-start" />
            <span className="game-toolbar-action-label">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{props.title || label}</TooltipContent>
    </Tooltip>
  );
}

/** 对局负责动作，Portal 只把节点交给当前页面的标题栏和菜单槽位。 */
export function GameToolbar({
  context,
  actions,
  status,
  metrics,
  details,
  options,
  onOptionsOpenChange,
}: {
  context?: ReactNode;
  actions?: ReactNode;
  status: ReactNode;
  metrics?: ReactNode;
  details?: ReactNode;
  options?: ReactNode;
  onOptionsOpenChange?(open: boolean): void;
}) {
  const { t } = useLingui();
  const label = options
    ? t({ message: "游戏选项", comment: "展开小游戏的次要参数和完整状态" })
    : t({ message: "游戏信息", comment: "展开小游戏的模式、计数及完整状态" });
  const information = (
    <>
      {options}
      {context ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {context}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status}
        {metrics}
      </div>
      {details ? (
        <div className="text-muted-foreground flex flex-col gap-2 text-xs">
          {details}
        </div>
      ) : null}
    </>
  );
  return (
    <>
      <GameHeaderActions>
        <div className="game-header-toolbar flex items-center gap-1">
          {actions}
          <Popover onOpenChange={onOptionsOpenChange}>
            <PopoverTrigger asChild>
              <Button
                className="game-header-information"
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                title={label}
              >
                {options ? <SlidersHorizontal /> : <Info />}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="ui-density-adaptive app-scroll-safe-end max-h-(--radix-popover-content-available-height) max-w-[calc(100vw-1.5rem)] overflow-y-auto"
            >
              <PopoverHeader>
                <PopoverTitle>{label}</PopoverTitle>
              </PopoverHeader>
              {information}
            </PopoverContent>
          </Popover>
        </div>
      </GameHeaderActions>
      <GameHeaderActions menu>
        <div className="game-toolbar-menu flex max-w-72 flex-col gap-3 py-2">
          <div className="game-toolbar-menu-actions flex flex-col gap-1">
            {actions}
          </div>
          <span className="text-muted-foreground text-xs font-medium">
            {label}
          </span>
          {information}
        </div>
      </GameHeaderActions>
      <GameDisplayBar>
        <div className="game-toolbar-content">
          {context ? (
            <div className="game-toolbar-context text-muted-foreground text-xs">
              {context}
            </div>
          ) : null}
          <div className="game-toolbar-status text-xs">
            <span
              className="game-toolbar-primary"
              role="status"
              aria-atomic="true"
            >
              {status}
            </span>
            {metrics ? (
              <div className="game-toolbar-metrics text-muted-foreground tabular-nums">
                {metrics}
              </div>
            ) : null}
          </div>
        </div>
      </GameDisplayBar>
    </>
  );
}
