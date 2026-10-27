import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, FlagIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

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

import { GameActionsMenu } from "../engine/GameActionsMenu";
import { GameVolumeControl } from "../engine/GameVolumeControl";

export interface BilliardsHeaderProps {
  active: boolean;
  finished: boolean;
  landscape: boolean;
  onRestart(): void;
  onExit(): void;
  details?: ReactNode;
  onConcede?(): void;
  canConcede?: boolean;
  onMenuOpenChange?(open: boolean): void;
}

export function BilliardsHeader({
  active,
  finished,
  landscape,
  onRestart,
  onExit,
  details,
  onConcede,
  canConcede = false,
  onMenuOpenChange,
}: BilliardsHeaderProps) {
  const { t } = useLingui();
  const [confirmExit, setConfirmExit] = useState(false);
  const back = active ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t`返回模式选择`}
      onClick={() => (finished ? onExit() : setConfirmExit(true))}
    >
      <ArrowLeft />
    </Button>
  ) : (
    <Button variant="ghost" size="icon-sm" asChild>
      <BackLink to="/" search={{ category: "games" }} aria-label={t`返回首页`}>
        <ArrowLeft />
      </BackLink>
    </Button>
  );
  const actions = active ? (
    <GameActionsMenu
      matchFinished={finished}
      canRestart
      onRestart={onRestart}
      onExit={onExit}
      onOpenChange={onMenuOpenChange}
      extraActions={
        onConcede
          ? (closeThen) => (
              <Button
                variant="ghost"
                size="sm"
                disabled={!canConcede}
                className="justify-start"
                onClick={() => closeThen(onConcede)}
              >
                <FlagIcon data-icon="inline-start" />
                <Trans comment="斯诺克主动认输本局">认输</Trans>
              </Button>
            )
          : undefined
      }
    />
  ) : (
    <GameVolumeControl />
  );
  return (
    <>
      {landscape && active ? (
        <div className="billiards-landscape-nav flex items-center justify-center">
          {details}
          {actions}
        </div>
      ) : (
        <ToolPageHeader
          variant="compact"
          showHome={false}
          showActivity={false}
          title={<Trans>台球</Trans>}
          leading={back}
          trailing={
            <>
              {details}
              {actions}
            </>
          }
        />
      )}
      <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialogContent>
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
    </>
  );
}
