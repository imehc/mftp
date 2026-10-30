import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";

export function ReversiHelp() {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`黑白棋`}
      summary={<Trans>黑棋先行，结束时棋子更多的一方获胜。</Trans>}
      sections={[
        {
          title: <Trans>落子与翻子</Trans>,
          items: [
            <Trans>
              在标记的空格落子，沿横、竖或斜线夹住对方棋子，所有被夹住的棋子都会翻为己方颜色。
            </Trans>,
          ],
        },
        {
          title: <Trans>轮次与终局</Trans>,
          items: [
            <Trans>
              一方没有合法落点时自动跳过，由另一方继续。双方都无法落子时结束，即使棋盘尚未填满。
            </Trans>,
          ],
        },
        {
          title: <Trans>操作</Trans>,
          items: [
            <Trans>
              点击标记的空格落子；也可用方向键移动焦点，回车或空格落子。
            </Trans>,
          ],
        },
        {
          title: <Trans>悔棋</Trans>,
          items: [
            <Trans>
              同屏悔棋撤回上一手；人机和联机悔棋回到你最近一次落子之前。联机需要对方同意。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
