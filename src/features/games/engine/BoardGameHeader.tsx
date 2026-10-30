import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { BackLink } from "~/features/navigation/BackLink";

import { GameActionsMenu } from "./GameActionsMenu";
import { GameHeaderActionsSlot } from "./GameHeaderActions";
import { GameVolumeControl } from "./GameVolumeControl";

/**
 * 小游戏共用的标题栏。
 * `match` 是棋类与台球的对局页，离开对局需确认；`puzzle` 是单人或单人谜题页，
 * 返回始终回到小游戏列表，不渲染对局动作与退出确认。
 */
export function BoardGameHeader({
  title,
  active,
  finished,
  canRestart,
  onRestart,
  onExit,
  help,
  extraActions,
  variant = "match",
  landscape = false,
  onMenuOpenChange,
}: {
  title: ReactNode;
  active: boolean;
  finished: boolean;
  canRestart: boolean;
  onRestart: () => void;
  onExit: () => void;
  help?: ReactNode;
  extraActions?: ComponentProps<typeof GameActionsMenu>["extraActions"];
  variant?: "match" | "puzzle";
  /** 横屏窄导航：对局中只保留操作区，不显示标题与返回。 */
  landscape?: boolean;
  onMenuOpenChange?(open: boolean): void;
}) {
  const { t } = useLingui();
  const [confirm, setConfirm] = useState(false);
  const puzzle = variant === "puzzle";
  const confirmBack = active && !puzzle;
  const menu =
    active || puzzle ? (
      <GameActionsMenu
        matchFinished={finished}
        canRestart={canRestart}
        onRestart={onRestart}
        onExit={onExit}
        extraActions={extraActions}
        showMatchActions={!puzzle}
        onOpenChange={onMenuOpenChange}
      />
    ) : (
      <GameVolumeControl />
    );
  const back = confirmBack ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t`返回模式选择`}
      onClick={() => (finished ? onExit() : setConfirm(true))}
    >
      <ArrowLeft />
    </Button>
  ) : (
    <Button variant="ghost" size="icon-sm" asChild>
      <BackLink
        to="/"
        search={{ category: "games" }}
        aria-label={t`返回小游戏列表`}
      >
        <ArrowLeft />
      </BackLink>
    </Button>
  );
  return (
    <>
      {landscape && active ? (
        <div className="game-landscape-nav flex items-center justify-center">
          <GameHeaderActionsSlot />
          {help}
          {menu}
        </div>
      ) : (
        <ToolPageHeader
          variant="compact"
          showHome={false}
          showActivity={false}
          title={title}
          leading={back}
          trailing={
            <>
              <GameHeaderActionsSlot />
              {help}
              {menu}
            </>
          }
        />
      )}
      {puzzle ? null : (
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent className="ui-density-adaptive">
            <AlertDialogHeader>
              <AlertDialogTitle>
                <Trans>退出当前对局？</Trans>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <Trans>当前对局的进度将会丢失。</Trans>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Trans>取消</Trans>
              </AlertDialogCancel>
              <AlertDialogAction onClick={onExit}>
                <Trans>退出</Trans>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
