import { Trans, useLingui } from "@lingui/react/macro";
import { CircleHelp } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

export function ReversiHelp() {
  const { t } = useLingui();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t`黑白棋玩法`}>
          <CircleHelp />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent showCloseButton={false}>
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>黑白棋玩法</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>黑棋先行，结束时棋子更多的一方获胜。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <ol className="text-muted-foreground flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed">
            <li>
              <Trans>
                在标记的空格落子，沿横、竖或斜线夹住对方棋子，所有被夹住的棋子都会翻为己方颜色。
              </Trans>
            </li>
            <li>
              <Trans>
                一方没有合法落点时自动跳过，由另一方继续。双方都无法落子时结束，即使棋盘尚未填满。
              </Trans>
            </li>
            <li>
              <Trans>
                同屏悔棋撤回上一手；人机和联机悔棋回到你最近一次落子之前。联机需要对方同意。
              </Trans>
            </li>
            <li>
              <Trans>
                点击标记的空格落子；也可用方向键移动焦点，回车或空格落子。
              </Trans>
            </li>
          </ol>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
