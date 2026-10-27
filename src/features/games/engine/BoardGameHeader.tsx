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
import { GameVolumeControl } from "./GameVolumeControl";

export function BoardGameHeader({
  title,
  active,
  finished,
  canRestart,
  onRestart,
  onExit,
  help,
  extraActions,
}: {
  title: ReactNode;
  active: boolean;
  finished: boolean;
  canRestart: boolean;
  onRestart: () => void;
  onExit: () => void;
  help?: ReactNode;
  extraActions?: ComponentProps<typeof GameActionsMenu>["extraActions"];
}) {
  const { t } = useLingui();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <ToolPageHeader
        variant="compact"
        showHome={false}
        showActivity={false}
        title={title}
        leading={
          active ? (
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
                aria-label={t`返回首页`}
              >
                <ArrowLeft />
              </BackLink>
            </Button>
          )
        }
        trailing={
          <>
            {help}
            {active ? (
              <GameActionsMenu
                matchFinished={finished}
                canRestart={canRestart}
                onRestart={onRestart}
                onExit={onExit}
                extraActions={extraActions}
              />
            ) : (
              <GameVolumeControl />
            )}
          </>
        }
      />
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
    </>
  );
}
