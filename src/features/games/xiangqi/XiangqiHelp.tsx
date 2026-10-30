import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";

export function XiangqiHelp() {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`中国象棋`}
      summary={<Trans>红方先行，将死或无子可动的一方判负。</Trans>}
      sections={[
        {
          title: <Trans>棋盘与走法</Trans>,
          paragraphs: [
            <Trans>棋盘为 9 列 10 行，红方先行。</Trans>,
            <Trans>
              车沿直线任意走；马走日字，蹩马腿时不能走；象走田字且不过河，塞象眼时不能走；士在九宫内斜走；将帅在九宫内直走一格；炮吃子需隔一个棋子；兵过河后可以横走。
            </Trans>,
          ],
        },
        {
          title: <Trans>将帅照面</Trans>,
          paragraphs: [
            <Trans>
              双方将帅在同一列且中间没有棋子时，可以直接吃掉对方将帅。因此照面视为被将军，必须应将。
            </Trans>,
          ],
        },
        {
          title: <Trans>胜负</Trans>,
          paragraphs: [
            <Trans>
              将死对方、对方无合法着法（困毙），或直接吃掉对方将帅，均获胜。
            </Trans>,
          ],
        },
        {
          title: <Trans>和棋</Trans>,
          paragraphs: [
            <Trans>
              同一局面连同行棋方出现三次，或连续 60 回合（120
              个半回合）没有吃子，自动和棋。
            </Trans>,
          ],
        },
        {
          title: <Trans>操作与悔棋</Trans>,
          paragraphs: [
            <Trans>
              点击己方棋子，再点击标记的落点走棋。更多菜单可以翻转棋盘，翻转只改变显示方向，不影响落子。
            </Trans>,
            <Trans>
              悔棋在标题栏右侧：同屏撤回一手，人机和联机回到你最近一次走棋之前，联机需要对方同意。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
