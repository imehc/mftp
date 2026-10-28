import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";

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
import { useGameHistory } from "../engine/history";
import { puzzleRecordSchema } from "./checkpoint";
import { PUZZLE_ID, type PuzzleSize } from "./types";

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function SlidingPuzzleHelp({
  open,
  onOpenChange,
  size,
}: DialogProps & { size: PuzzleSize }) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent placement="responsive-sheet">
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>数字华容道玩法</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>将数字按顺序排列，空位留在右下角。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4 text-sm">
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">
              <Trans comment="数字华容道完成时的数字排列示意">目标排列</Trans>
            </h3>
            <div
              role="img"
              aria-label={t`数字从左到右、从上到下递增，最后一格为空位。`}
              className="sliding-puzzle-target"
              style={{ "--puzzle-size": size } as CSSProperties}
            >
              {Array.from({ length: size * size }, (_, i) => (
                <span key={i} aria-hidden="true">
                  {i === size * size - 1 ? "" : i + 1}
                </span>
              ))}
            </div>
          </section>
          <p>
            <Trans>
              点击空位上下左右的数字块，将它滑入空位。每次只能移动相邻的一块，不能跨格或斜向移动。
            </Trans>
          </p>
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">
              <Trans>键盘操作</Trans>
            </h3>
            <p>
              <Trans>
                用 Tab 进入棋盘，方向键移动焦点，Enter
                或空格移动当前数字块。方向键只改变焦点，不直接移动数字。
              </Trans>
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">
              <Trans>计时与撤销</Trans>
            </h3>
            <p>
              <Trans>
                第一次有效移动开始计时，每滑动一块记一步。离开页面、进入后台或打开菜单与帮助时暂停，记录的是有效练习用时。
              </Trans>
            </p>
            <p>
              <Trans>
                撤销后进行新移动会清除重做分支。最多可以撤销最近 500
                步，更早的步数仍计入总数；使用过撤销的成绩会单独标记。
              </Trans>
            </p>
          </section>
          <p>
            <Trans>
              「重新开始本局」恢复本局最初的打乱排列，并清零用时与步数；「打乱」生成新的有解棋盘。离开后会保留进度，下次可以继续。
            </Trans>
          </p>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}

export function SlidingPuzzleHistory({ open, onOpenChange }: DialogProps) {
  const entries = useGameHistory(PUZZLE_ID);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent placement="responsive-sheet">
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>数字华容道成绩</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>已完成棋盘的大小、有效用时与步数。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          {entries.length ? (
            <ul className="divide-border divide-y">
              {entries.map((entry) => {
                const parsed = puzzleRecordSchema.safeParse(entry.payload);
                if (!parsed.success)
                  return (
                    <li
                      key={entry.id}
                      className="text-muted-foreground py-3 text-sm"
                    >
                      <Trans>这条成绩记录无法读取。</Trans>
                    </li>
                  );
                const { size, elapsedMs, moves, assisted } = parsed.data;
                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      {size} × {size}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatGameTime(elapsedMs)}
                    </span>
                    <span>
                      <Plural value={moves} other="# 步" />
                    </span>
                    {assisted && (
                      <span className="text-muted-foreground text-xs">
                        <Trans>使用过撤销</Trans>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
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
