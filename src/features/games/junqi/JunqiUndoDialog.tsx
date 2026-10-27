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

import { undoPlies } from "./online-undo";
import type { Side } from "./types";
import type { JunqiView } from "./view-types";

export function JunqiUndoInformation() {
  return (
    <Trans comment="军棋暗棋或翻棋的悔棋提醒：恢复当时显示，不代表玩家忘记已经看到的身份">
      悔棋会恢复当时的棋盘、盖子和阵营状态，但已看见的身份、亮旗和交战信息无法收回。
    </Trans>
  );
}

export function JunqiUndoDialog({
  view,
  localSeat,
  open,
  onOpenChange,
  onRequest,
}: {
  view: JunqiView;
  localSeat: Side;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRequest(): void;
}) {
  const plies = undoPlies(view, localSeat);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans comment="军棋联机悔棋确认框标题">申请悔棋</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Plural
              value={{ plies }}
              one="申请撤销 # 手棋，需对方同意。"
              other="申请撤销 # 手棋，需对方同意。"
            />{" "}
            <JunqiUndoInformation />
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <AlertDialogAction onClick={onRequest}>
            <Trans comment="向联机对手发送悔棋申请">发送请求</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
