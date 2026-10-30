import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";
import type { BilliardsDiscipline } from "./types";

/** 击球操作的说明，各玩法共用，避免在游戏信息里重复一份。 */
function shotSection() {
  return {
    title: <Trans>操作</Trans>,
    paragraphs: [
      <Trans>
        在母球后方拖动可瞄准并蓄力，松手击球。在更多菜单开启「仅瞄准」后，球桌拖动只瞄准，松手不击球。也可保持当前方向，拖动力度条后松手击球；拖回零力度或按
        Esc 取消。键盘方向键调整力度，回车或空格击球。
      </Trans>,
    ],
  };
}

export function BilliardsHelp({
  discipline,
}: {
  discipline: BilliardsDiscipline;
}) {
  const { t } = useLingui();
  const name =
    discipline === "nine-ball"
      ? t`美式九球`
      : discipline === "snooker"
        ? t`斯诺克`
        : t`中式八球`;
  const summary =
    discipline === "nine-ball" ? (
      <Trans>依次首碰台面最低号球，合法打进 9 号球获胜。</Trans>
    ) : discipline === "snooker" ? (
      <Trans>红球与彩球交替击打，得分更高的一方获胜。</Trans>
    ) : (
      <Trans>先清完己方组别，再合法打进 8 号球获胜。</Trans>
    );
  return (
    <GameHelpDialog
      name={name}
      summary={summary}
      sections={
        discipline === "nine-ball"
          ? [
              {
                title: <Trans>摆球与开球</Trans>,
                paragraphs: [
                  <Trans>
                    九颗球紧排成菱形，9
                    号在脚点。开球需落袋球数与越过开球线的球数合计不少于三颗，否则视为违规开球，由对手决定重摆或继续。
                  </Trans>,
                  <Trans>
                    合法开球后对手可以选择推杆：推杆那一杆不计犯规，只需碰到任意球，之后恢复正常判定。
                  </Trans>,
                ],
              },
              {
                title: <Trans>击球顺序</Trans>,
                paragraphs: [
                  <Trans>
                    每一杆必须首先碰到台面最低号球，落袋任意球都算有效；有球落袋可以继续击球，否则交换球权。
                  </Trans>,
                ],
              },
              {
                title: <Trans>犯规与胜负</Trans>,
                paragraphs: [
                  <Trans>
                    母球落袋、未碰到任何球、首碰不是最低号球、未进球且没有球碰库都算犯规，对手获得自由球。连续三次犯规判负；第二次犯规会给出警告。
                  </Trans>,
                  <Trans>
                    合法打进 9 号球获胜。犯规、推杆或违规开球时打进的 9
                    号会被摆回台面。
                  </Trans>,
                ],
              },
              shotSection(),
            ]
          : discipline === "snooker"
            ? [
                {
                  title: <Trans>得分</Trans>,
                  paragraphs: [
                    <Trans>
                      红球 1 分，彩球依次为黄 2 分、绿 3 分、棕 4 分、蓝 5
                      分、粉 6 分、黑 7
                      分。先红后彩交替击打，彩球落袋后摆回原位。
                    </Trans>,
                    <Trans>
                      红球清完后按黄、绿、棕、蓝、粉、黑的顺序依次清彩，此后打入的彩球不再摆回。得分更高的一方获胜。
                    </Trans>,
                  ],
                },
                {
                  title: <Trans>漏击与犯规</Trans>,
                  paragraphs: [
                    <Trans>
                      六红球采用五次漏击规则，十红球沿用十五红球的流程。自动裁判只对「明确直达却没有击中目标球」判漏击，目标球被完全遮挡时只判普通犯规，不判断主观是否尽力。
                    </Trans>,
                  ],
                },
                {
                  title: <Trans>练习模式</Trans>,
                  paragraphs: [
                    <Trans>练习为自由清台，不计算正式比赛的单杆得分。</Trans>,
                  ],
                },
                shotSection(),
              ]
            : [
                {
                  title: <Trans>摆球与开球</Trans>,
                  paragraphs: [
                    <Trans>
                      8
                      号球固定在第三排中间，最后一排两个底角一颗全色、一颗花色，其余球随机摆放。开球时打进
                      8 号会被摆回脚点，不算犯规。
                    </Trans>,
                  ],
                },
                {
                  title: <Trans>分组</Trans>,
                  paragraphs: [
                    <Trans>
                      开球结束后，第一颗合法落袋的球决定双方组别：一方全色
                      1–7，另一方花色 9–15。分组前台面处于未分组状态，此时首碰 8
                      号算犯规。
                    </Trans>,
                  ],
                },
                {
                  title: <Trans>首碰与犯规</Trans>,
                  paragraphs: [
                    <Trans>
                      分组后每一杆必须首先碰到己方组别的球；清完己方组别后，首碰改为
                      8
                      号球。母球落袋、没有碰到任何球、首碰错误都是犯规，犯规后对手获得自由球，可以在台面任意位置摆放母球。
                    </Trans>,
                  ],
                },
                {
                  title: <Trans>胜负</Trans>,
                  paragraphs: [
                    <Trans>
                      清完己方组别后合法打进 8 号球获胜。提前打进 8 号，或打进 8
                      号时同时犯规，判负。
                    </Trans>,
                  ],
                },
                {
                  title: <Trans>本应用的简化</Trans>,
                  paragraphs: [
                    <Trans>
                      不要求击球后必须碰库，也不需要指定袋口。练习模式为自由清台，不分组、不计犯规胜负。
                    </Trans>,
                  ],
                },
                shotSection(),
              ]
      }
    />
  );
}
