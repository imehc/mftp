import { Trans, useLingui } from "@lingui/react/macro";

import { GameHelpDialog } from "../engine/GameHelpDialog";

export function MagicCubeHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useLingui();
  return (
    <GameHelpDialog
      name={t`魔方`}
      summary={<Trans>让六个面分别恢复为同一种颜色。</Trans>}
      open={open}
      onOpenChange={onOpenChange}
      sections={[
        {
          title: <Trans>转动与观察</Trans>,
          paragraphs: [
            <Trans>
              拖拽彩色面片转动一层，松手后吸附到位；小幅拖动不会走步。拖拽空白旋转视角，滚轮或双指捏合缩放。「观察模式」下也可以拖拽魔方旋转视角。
            </Trans>,
          ],
        },
        {
          title: <Trans>精确转动</Trans>,
          paragraphs: [
            <Trans>
              通过「精确转动」选择一个面和层号，再点击转动按钮。层号从所选面向内数，第一层是最外层。方向以正对所选面为准，镜头旋转不会改变面名称；可在更多菜单开启面标识。
            </Trans>,
          ],
        },
        {
          title: <Trans>键盘操作</Trans>,
          paragraphs: [
            <Trans>
              先点击或聚焦魔方画布。R、L、U、D、F、B
              分别顺时针转动右、左、上、下、前、后面；按住 Shift
              反向转动。方向键旋转视角，Esc
              取消拖动。精确转动面板也支持键盘操作。
            </Trans>,
          ],
        },
        {
          title: <Trans>练习与挑战</Trans>,
          paragraphs: [
            <Trans>
              可以直接转动复原魔方练习，也可以点击「打乱」开始挑战。首次有效转层后开始计时，每次转层记一步，180°
              也记一步。切页、后台或打开帮助时暂停计时，这是练习用时，不是比赛计时。
            </Trans>,
            <Trans>
              撤销和重做不跨越打乱起点；撤销后转动会清除重做分支。最多保留最近
              500
              步的撤销记录，更早的步数仍会计入总数。使用过撤销的挑战会单独标记。
            </Trans>,
          ],
        },
        {
          title: <Trans>重置与恢复</Trans>,
          paragraphs: [
            <Trans>
              重置魔方回到复原状态，不会自动求解或记为挑战成功。切换阶数、重置或重新打乱会替换当前进度。离开页面会保留进度，下次打开可以继续。
            </Trans>,
          ],
        },
      ]}
    />
  );
}
