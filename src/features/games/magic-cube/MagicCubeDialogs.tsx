import { Plural, Trans } from "@lingui/react/macro";

import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";

import { formatGameTime } from "../engine/format-game-time";
import { GameHistoryClearButton, GameHistoryList } from "../engine/GameHistory";
import { useGameHistory } from "../engine/history";
import type { CubeRecord } from "./types";

export function MagicCubeHistory({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const records = useGameHistory<CubeRecord>("magic-cube");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent placement="responsive-sheet" showCloseButton={false}>
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>魔方挑战记录</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>已完成挑战的阶数、有效用时和步数。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          {records.length ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex justify-end">
                <GameHistoryClearButton gameId="magic-cube" />
              </div>
              <GameHistoryList
                records={records}
                renderRecord={(payload) => {
                  const order = payload.order;
                  return {
                    details: (
                      <>
                        <Trans comment="魔方阶数，order 是每条边的小块数量">
                          {order} 阶魔方
                        </Trans>
                        {payload.assisted && (
                          <>
                            {" · "}
                            <Trans>使用过撤销</Trans>
                          </>
                        )}
                      </>
                    ),
                    result: (
                      <>
                        {formatGameTime(payload.elapsedMs)}
                        {" · "}
                        <Plural value={payload.moves} other="# 步" />
                      </>
                    ),
                  };
                }}
              />
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  <Trans>暂无挑战记录</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>打乱魔方并完成还原后，成绩会显示在这里。</Trans>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
