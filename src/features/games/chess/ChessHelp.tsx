import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";

export function ChessHelp() {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`国际象棋`}
      summary={<Trans>白方先行。将死对方国王获胜，国王不能被吃掉。</Trans>}
      sections={[
        {
          title: <Trans>操作</Trans>,
          items: [
            <Trans>
              点击棋子，再点击标记的格子走棋；桌面也可以拖动棋子。方向键移动焦点，回车或空格选子、落子。
            </Trans>,
            <Trans>
              悔棋在标题栏右侧：同屏撤回一手，人机和联机回到你最近一次走棋之前，联机需要对方同意。
            </Trans>,
          ],
        },
        {
          title: <Trans>特殊走法</Trans>,
          items: [
            <Trans>
              支持王车易位、吃过路兵和兵的升变。易位不能穿过受攻击的格子；升变可选择后、车、象或马。
            </Trans>,
          ],
        },
        {
          title: <Trans>胜负</Trans>,
          items: [
            <Trans>
              将死对方国王即获胜。无合法着法但未被将军时为逼和；王对王、王与单象或单马对王，以及所有象位于同色格等子力不足局面自动和棋。
            </Trans>,
          ],
        },
        {
          title: <Trans>和棋</Trans>,
          items: [
            <Trans>
              三次重复局面或连续五十步没有动兵、吃子时可以申领和棋。五次重复或七十五步时自动和棋，最后一步将死优先。
            </Trans>,
          ],
        },
        {
          title: <Trans>视角与翻转</Trans>,
          items: [
            <Trans>
              更多菜单可以翻转棋盘，翻转只改变显示方向，不影响走棋。游戏信息里可以切换立体视角与正上方俯视。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
