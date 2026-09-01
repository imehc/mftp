import { Plural, Trans } from "@lingui/react/macro";
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
export type UndoFlow =
  | {
      kind: "waiting";
    }
  | {
      kind: "incoming";
      atMove: number;
      plies: number;
    }
  | null;
interface OnlineMatchDialogsProps {
  undoFlow: UndoFlow;
  onRespondUndo: (accept: boolean) => void;
  rematchIncoming: boolean;
  onRespondRematch: (accept: boolean) => void;
  endReason: string | null;
  onExit: () => void;
}
export function OnlineMatchDialogs({
  undoFlow,
  onRespondUndo,
  rematchIncoming,
  onRespondRematch,
  endReason,
  onExit,
}: OnlineMatchDialogsProps) {
  const undoPlies = undoFlow?.kind === "incoming" ? undoFlow.plies : 0;
  return (
    <>
      <AlertDialog open={undoFlow?.kind === "incoming"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对方请求悔棋</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Plural
                value={{
                  undoPlies,
                }}
                one="将撤销 # 手棋，是否同意？"
                other="将撤销 # 手棋，是否同意？"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onRespondUndo(false)}>
              <Trans>拒绝</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => onRespondUndo(true)}>
              <Trans>同意</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={rematchIncoming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对方想再来一局</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>同意后双方交换先后手，立即开始新对局。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onRespondRematch(false)}>
              <Trans>拒绝</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => onRespondRematch(true)}>
              <Trans>同意</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={endReason !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对局中断</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>{endReason}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={onExit}>
              <Trans>返回选择</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
