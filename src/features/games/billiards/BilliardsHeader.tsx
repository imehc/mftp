import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "~/components/ui/button";
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
import { GameActionsMenu } from "../engine/GameActionsMenu";
import { GameVolumeControl } from "../engine/GameVolumeControl";

export function BilliardsHeader({
  active,
  finished,
  landscape,
  mobile,
  onRotate,
  onRestart,
  onExit,
}: {
  active: boolean;
  finished: boolean;
  landscape: boolean;
  mobile: boolean;
  onRotate: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
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
      <Link to="/" search={{ category: "games" }} aria-label={t`返回首页`}>
        <ArrowLeft />
      </Link>
    </Button>
  );
  const rotate =
    active && mobile ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={landscape ? t`返回竖屏` : t`横屏游玩`}
        onClick={onRotate}
      >
        {landscape ? <Minimize2 /> : <Maximize2 />}
      </Button>
    ) : null;
  const actions = active ? (
    <GameActionsMenu
      matchFinished={finished}
      canRestart
      onRestart={onRestart}
      onExit={onExit}
    />
  ) : (
    <GameVolumeControl />
  );
  return (
    <>
      {landscape && active ? (
        <div className="billiards-landscape-nav flex items-center justify-center">
          {rotate}
          {actions}
        </div>
      ) : (
        <ToolPageHeader
          showHome={false}
          title={<Trans>台球</Trans>}
          leading={back}
          trailing={
            <>
              {rotate}
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
              <Trans>将返回模式选择，当前对局的进度将会丢失。</Trans>
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
