import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";

import { GameHelpDialog } from "../engine/GameHelpDialog";
import type { PuzzleSize } from "./types";

export function SlidingPuzzleHelp({
  open,
  onOpenChange,
  size,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  size: PuzzleSize;
}) {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`数字华容道`}
      summary={<Trans>将数字按顺序排列，空位留在右下角。</Trans>}
      open={open}
      onOpenChange={onOpenChange}
      sections={[
        {
          title: (
            <Trans comment="数字华容道完成时的数字排列示意">目标排列</Trans>
          ),
          content: (
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
          ),
          paragraphs: [
            <Trans>
              点击空位上下左右的数字块，将它滑入空位。每次只能移动相邻的一块，不能跨格或斜向移动。
            </Trans>,
          ],
        },
        {
          title: <Trans>键盘操作</Trans>,
          paragraphs: [
            <Trans>
              用 Tab 进入棋盘，方向键移动焦点，Enter
              或空格移动当前数字块。方向键只改变焦点，不直接移动数字。
            </Trans>,
          ],
        },
        {
          title: <Trans>计时与撤销</Trans>,
          paragraphs: [
            <Trans>
              第一次有效移动开始计时，每滑动一块记一步。离开页面、进入后台或打开菜单与帮助时暂停，记录的是有效练习用时。
            </Trans>,
            <Trans>
              撤销后进行新移动会清除重做分支。最多可以撤销最近 500
              步，更早的步数仍计入总数；使用过撤销的成绩会单独标记。
            </Trans>,
          ],
        },
        {
          title: <Trans>重新开始与恢复</Trans>,
          paragraphs: [
            <Trans>
              「重新开始本局」恢复本局最初的打乱排列，并清零用时与步数；「打乱」生成新的有解棋盘。离开后会保留进度，下次可以继续。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
