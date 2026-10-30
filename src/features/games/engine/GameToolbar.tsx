import "./game-toolbar.css";

import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

import { GameHeaderActions, useGameHeaderAction } from "./GameHeaderActions";
import { GameInfoPopover } from "./GameInfoPopover";

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

/** 更多菜单里的整行动作；点击后先关闭菜单再执行。 */
export function GameMenuActionButton({
  icon: Icon,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  icon: LucideIcon;
  children: ReactNode;
}) {
  const invoke = useGameHeaderAction();
  return (
    <Button
      variant="ghost"
      size="sm"
      density="adaptive"
      className="w-full justify-start"
      {...props}
      onClick={
        props.onClick
          ? (event) => invoke(() => props.onClick?.(event))
          : undefined
      }
    >
      <Icon data-icon="inline-start" />
      {children}
    </Button>
  );
}

/** 对局负责动作，Portal 只把节点交给当前页面的标题栏和菜单槽位。 */
export function GameToolbar({
  context,
  actions,
  status,
  metrics,
  details,
  parameters,
  menuActions,
  onInfoOpenChange,
}: {
  context?: ReactNode;
  actions?: ReactNode;
  status: ReactNode;
  metrics?: ReactNode;
  details?: ReactNode;
  /** 信息弹层里的参数区，例如开关与选择器。 */
  parameters?: ReactNode;
  /** 只出现在更多菜单的动作，例如翻转棋盘，不受窄屏菜单显隐影响。 */
  menuActions?: ReactNode;
  onInfoOpenChange?(open: boolean): void;
}) {
  return (
    <>
      <GameHeaderActions>
        <div className="game-header-toolbar flex items-center gap-1">
          {actions}
        </div>
      </GameHeaderActions>
      <GameInfoPopover
        parameters={parameters}
        menuLeading={actions}
        onOpenChange={onInfoOpenChange}
      >
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
      </GameInfoPopover>
      {menuActions ? (
        <GameHeaderActions menu>{menuActions}</GameHeaderActions>
      ) : null}
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
