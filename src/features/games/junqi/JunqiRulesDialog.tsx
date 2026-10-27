import { Trans, useLingui } from "@lingui/react/macro";
import { CircleHelpIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import { JunqiUndoInformation } from "./JunqiUndoDialog";
import { VariantLabel } from "./labels";
import type { JunqiVariant } from "./types";

export function JunqiRulesDialog({
  variant = "open",
  online = false,
}: {
  variant?: JunqiVariant;
  online?: boolean;
}) {
  const { t } = useLingui();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          density="adaptive"
          aria-label={t({
            message: "玩法与规则",
            comment: "军棋标题栏帮助按钮，打开规则说明",
          })}
          title={t`玩法与规则`}
        >
          <CircleHelpIcon />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent placement="center" aria-describedby={undefined}>
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>陆战棋 · 玩法与规则</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <div className="flex flex-col gap-4 text-sm leading-relaxed">
            <p className="font-medium">
              <VariantLabel variant={variant} />
            </p>
            <p>
              {variant === "open" ? (
                <Trans>
                  陆战棋又称军棋。当前采用双人明棋，双方棋子公开；夺取对方军旗即获胜。
                </Trans>
              ) : variant === "hidden" ? (
                <Trans>
                  各自布阵，己方棋子可见，对方身份隐藏。通过走棋和交战推断身份，夺取对方军旗即获胜。
                </Trans>
              ) : (
                <Trans>
                  棋子随机盖放，翻开后身份公开。首翻决定阵营，之后每回合选择翻子或走棋，夺取对方军旗即获胜。
                </Trans>
              )}
            </p>
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">
                {variant === "flip" ? (
                  <Trans>翻子与阵营</Trans>
                ) : (
                  <Trans>布阵</Trans>
                )}
              </h3>
              <p>
                {variant === "flip" ? (
                  <Trans>
                    50
                    枚棋子随机盖放在非行营位置，行营为空。先翻者取得首枚棋子的阵营，另一方取相反阵营；翻到军旗或地雷也能定边。盖子不能移动或被攻击，会阻挡道路；任何一方都可翻开，每次消耗一个回合。
                  </Trans>
                ) : (
                  <Trans>
                    每方 25
                    枚棋子。军旗放大本营，地雷放最后两排，炸弹不能放第一排，行营初始为空。点击两枚己方棋子交换位置，或随机布阵；双方确认后红方先行。
                  </Trans>
                )}
              </p>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">
                <Trans>道路与安全区</Trans>
              </h3>
              <svg
                viewBox="0 0 280 64"
                role="img"
                aria-label={t`单线表示公路，双轨表示铁路，圆形表示行营，方框表示大本营`}
                className="text-muted-foreground h-16 w-full"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M8 32h45M76 28h70M76 36h70M85 23v18m12-18v18m12-18v18m12-18v18m12-18v18" />
                <circle cx="187" cy="32" r="19" />
                <rect x="229" y="14" width="40" height="36" rx="3" />
              </svg>
              <p>
                <Trans>
                  公路走相邻一步，可沿行营斜线移动。铁路上可沿直线走任意距离，工兵还可转弯；所有棋子都不能越子。
                </Trans>
              </p>
              <p>
                {variant === "flip" ? (
                  <Trans>
                    行营内棋子不能被攻击，但可以走出。翻棋中大本营视为普通站点，不锁住棋子；地雷和军旗随机盖放，翻开后仍不能移动。
                  </Trans>
                ) : (
                  <Trans>
                    行营内的棋子不能被攻击，但可以主动走出。棋子进入大本营后不能再移动。地雷和军旗始终不能移动。
                  </Trans>
                )}
              </p>
            </section>
            {variant === "hidden" ? (
              <section className="flex flex-col gap-2">
                <h3 className="font-semibold">
                  <Trans>隐藏身份</Trans>
                </h3>
                <p>
                  <Trans>
                    交战只公开进攻方存活、防守方存活或同归于尽，不直接揭示存活敌子的身份。司令阵亡后己方军旗位置公开，终局后才公开剩余身份。
                  </Trans>
                </p>
                <p>
                  <Trans>
                    电脑对战始终显示你的视角，电脑只能依据它已知的信息行动。
                  </Trans>
                </p>
              </section>
            ) : null}
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">
                <Trans>交战</Trans>
              </h3>
              <p>
                <Trans>
                  司令、军长各 1 枚；师长、旅长、团长、营长各 2
                  枚；连长、排长、工兵各 3 枚；炸弹 2 枚、地雷 3 枚、军旗 1 枚。
                </Trans>
              </p>
              <p>
                <Trans>
                  司令 ＞ 军长 ＞ 师长 ＞ 旅长 ＞ 团长 ＞ 营长 ＞ 连长 ＞ 排长
                  ＞ 工兵。大吃小，同级同归于尽。
                </Trans>
              </p>
              <p>
                <Trans>
                  工兵可排雷并存活；其他普通棋子碰地雷时阵亡，地雷保留。炸弹与任何非军旗棋子交战均同归于尽。炸弹也可夺旗，无须先排光地雷。
                </Trans>
              </p>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">
                <Trans>胜负与和棋</Trans>
              </h3>
              <p>
                {variant === "flip" ? (
                  <Trans>
                    军旗被夺、主动认输，或既没有盖子可翻也没有合法走法时判负。相同公开局面且同一方走棋出现三次，或连续
                    100 手仅移动且未吃子，自动和棋；翻子或吃子会重置无进展计数。
                  </Trans>
                ) : (
                  <Trans>
                    军旗被夺、主动认输，或轮到自己时无合法走法，均判负。本应用约定：同一方走棋的相同局面出现三次，或连续
                    100 手没有棋子被移除，自动和棋。
                  </Trans>
                )}
              </p>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">
                <Trans>操作</Trans>
              </h3>
              <p>
                {variant === "flip" ? (
                  <Trans>
                    点击盖子立即翻开，或选择已翻开的己方棋子，再点击标记位置移动。
                  </Trans>
                ) : null}
                {online ? (
                  <Trans>
                    联机对局由房主裁判，每台设备只显示本方视角。断线将中断对局，不自动判负；再次开局需双方同意。
                  </Trans>
                ) : null}
                <Trans>
                  点击己方棋子，再点击标记位置移动。方向键选择位置，Enter
                  或空格确认，Esc 取消选择。更多菜单中可认输或退出。
                </Trans>
                {!online ? (
                  <Trans>电脑对局可重新开局；离开页面会暂停并保留进度。</Trans>
                ) : null}
              </p>
              {online ? (
                <p>
                  <Trans>
                    对局中可在更多菜单申请悔棋：撤销自己刚走的 1
                    手；对方已回应时撤销 2
                    手，回到自己的回合。翻子也算一手，须对方同意；布阵和终局不可悔棋，最多保留最近
                    100 手供回退。
                  </Trans>
                  {variant !== "open" ? (
                    <>
                      {" "}
                      <JunqiUndoInformation />
                    </>
                  ) : null}
                </p>
              ) : null}
            </section>
          </div>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
