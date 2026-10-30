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
import { puzzleRecordSchema } from "./checkpoint";
import { PUZZLE_ID } from "./types";

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function SlidingPuzzleHistory({ open, onOpenChange }: DialogProps) {
  const entries = useGameHistory(PUZZLE_ID);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent placement="responsive-sheet" showCloseButton={false}>
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>数字华容道成绩</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>已完成棋盘的大小、有效用时与步数。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          {entries.length ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex justify-end">
                <GameHistoryClearButton gameId={PUZZLE_ID} />
              </div>
              <GameHistoryList
                records={entries}
                renderRecord={(payload) => {
                  const parsed = puzzleRecordSchema.safeParse(payload);
                  if (!parsed.success)
                    return {
                      details: <Trans>这条成绩记录无法读取。</Trans>,
                      result: null,
                    };
                  const { size, elapsedMs, moves, assisted } = parsed.data;
                  return {
                    details: (
                      <>
                        {size} × {size}
                        {assisted && (
                          <>
                            {" · "}
                            <Trans>使用过撤销</Trans>
                          </>
                        )}
                      </>
                    ),
                    result: (
                      <>
                        {formatGameTime(elapsedMs)}
                        {" · "}
                        <Plural value={moves} other="# 步" />
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
                  <Trans>暂无成绩记录</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>完成数字华容道后，成绩会显示在这里。</Trans>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
