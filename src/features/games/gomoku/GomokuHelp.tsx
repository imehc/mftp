import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";

export function GomokuHelp() {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`五子棋`}
      summary={<Trans>横、竖或斜线先连成五子的一方获胜。</Trans>}
      sections={[
        {
          title: <Trans>棋盘与先后</Trans>,
          paragraphs: [
            <Trans>棋盘为 15 × 15，黑棋先行，之后双方交替落子。</Trans>,
          ],
        },
        {
          title: <Trans>胜负</Trans>,
          paragraphs: [
            <Trans>
              横、竖或斜向连成五子即获胜。超过五子的长连同样算胜，本应用不设三三、四四或长连禁手。
            </Trans>,
            <Trans>棋盘填满且无人连成五子时为和棋。</Trans>,
          ],
        },
        {
          title: <Trans>操作与悔棋</Trans>,
          paragraphs: [
            <Trans>
              点击空交叉点落子，已落子的点不响应。悔棋在标题栏右侧：同屏撤回一手，人机和联机回到你最近一次落子之前，联机需要对方同意。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
