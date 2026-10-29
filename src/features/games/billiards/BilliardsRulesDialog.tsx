import { Trans, useLingui } from "@lingui/react/macro";
import { CircleHelpIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import { BilliardsShotHelp } from "./BilliardsShotHelp";
import type { BilliardsDiscipline } from "./types";

export function BilliardsRulesDialog({
  discipline,
}: {
  discipline: BilliardsDiscipline;
}) {
  const { t } = useLingui();
  if (discipline === "eight-ball") return null;
  const label = t({
    message: "查看游戏规则",
    comment: "台球开局页标题栏图标，打开当前所选玩法的规则说明",
  });
  return (
    <Dialog key={discipline}>
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          density="adaptive"
          aria-label={label}
          title={label}
        >
          <CircleHelpIcon />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent placement="center" aria-describedby={undefined}>
        <DialogLayoutHeader>
          <DialogTitle>
            {discipline === "snooker" ? (
              <Trans>斯诺克</Trans>
            ) : (
              <Trans>美式九球</Trans>
            )}
            {" · "}
            <Trans comment="台球开局页的玩法说明弹窗标题">游戏规则</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <div className="flex flex-col gap-3 text-sm leading-relaxed">
            {discipline === "snooker" ? (
              <>
                <p>
                  <Trans>
                    红彩交替后依次清彩。六红球含五次漏击规则；十红球沿用十五红球流程。自动裁判仅对明确直达却未击中目标判漏击，完全被遮挡时只判普通犯规，不判断主观尽力程度。
                  </Trans>
                </p>
                <p>
                  <Trans>练习为自由清台，不计算正式比赛单杆。</Trans>
                </p>
              </>
            ) : (
              <p>
                <Trans>
                  依次首碰最低号球，合法进 9
                  号获胜。采用三球开球、推杆选择及连续三犯规则。
                </Trans>
              </p>
            )}
            <BilliardsShotHelp />
          </div>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
