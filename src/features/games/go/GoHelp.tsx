import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";
import { KOMI } from "./types";

export function GoHelp() {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`围棋`}
      summary={<Trans>围住更多的地域即为优势，双方停手后按数子计分。</Trans>}
      sections={[
        {
          title: <Trans>棋盘与计分</Trans>,
          paragraphs: [
            <Trans>可选择 9 路、13 路或 19 路棋盘，默认 19 路。</Trans>,
            <Trans>
              计分采用中国规则数子：一方地域等于盘上己方棋子加上只与己方棋子相邻的空点，双方都相邻的单官双方都不计。白方另加
              {KOMI} 点贴目，因此不会出现平局。
            </Trans>,
          ],
        },
        {
          title: <Trans>提子与禁着</Trans>,
          paragraphs: [
            <Trans>
              棋子没有气时被提走。不能自杀，也不能让盘面回到此前出现过的任一局面，因此单劫不能立即回提。
            </Trans>,
          ],
        },
        {
          title: <Trans>停手与终局</Trans>,
          paragraphs: [
            <Trans>
              标题栏可以「停一手」。双方连续各停一手即结束并立即数子；停手会清除劫的禁着点，也不写入局面历史。落子后连停计数从头开始。
            </Trans>,
          ],
        },
        {
          title: <Trans>操作与悔棋</Trans>,
          paragraphs: [
            <Trans>
              点击交叉点落子，被占据的点与禁着点不响应。悔棋在标题栏右侧：同屏撤回一手，人机和联机回到你最近一次落子之前，联机需要对方同意。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
