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
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import { pieceNames } from "./labels";
import type { ChessTurn, Promotion } from "./types";

export function PromotionDialog({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose(): void;
  onChoose(piece: Promotion): void;
}) {
  const { t } = useLingui();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogLayoutContent>
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans comment="国际象棋兵到达最后一排后的选择">兵的升变</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>选择升变棋子后完成这一步。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <div className="grid grid-cols-2 gap-2">
            {(["q", "r", "b", "n"] as const).map((piece) => (
              <Button
                key={piece}
                variant="outline"
                onClick={() => onChoose(piece)}
              >
                {t(pieceNames[piece])}
              </Button>
            ))}
          </div>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}

export function DrawClaimDialog({
  move,
  onClose,
  onPlay,
  onClaim,
}: {
  move: ChessTurn | null;
  onClose(): void;
  onPlay(): void;
  onClaim(): void;
}) {
  return (
    <Dialog
      open={!!move}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogLayoutContent>
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>可以申领和棋</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              这一步将达到三次重复局面或五十步规则。你可以声明这一步并申领和棋，也可以继续走棋。
            </Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutFooter>
          <Button variant="outline" onClick={onPlay}>
            <Trans>继续走棋</Trans>
          </Button>
          <Button onClick={onClaim}>
            <Trans>申领和棋</Trans>
          </Button>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}

export function ChessHelp() {
  const { t } = useLingui();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t`国际象棋玩法`}>
          <CircleHelp />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent showCloseButton={false}>
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>国际象棋玩法</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>白方先行。将死对方国王获胜；国王不能被吃掉。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <ol className="text-muted-foreground flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed">
            <li>
              <Trans>
                点击棋子，再点击标记的格子走棋；桌面也可以拖动棋子。方向键移动焦点，回车或空格选子、落子。
              </Trans>
            </li>
            <li>
              <Trans>
                支持王车易位、吃过路兵和兵的升变。易位不能穿过受攻击的格子；升变可选择后、车、象或马。
              </Trans>
            </li>
            <li>
              <Trans>
                无合法着法但未被将军时为逼和。王对王、王与单象或单马对王，以及所有象位于同色格等子力不足局面自动和棋。
              </Trans>
            </li>
            <li>
              <Trans>
                三次重复局面或连续五十步没有动兵、吃子时可以申领和棋。五次重复或七十五步时自动和棋，最后一步将死优先。
              </Trans>
            </li>
            <li>
              <Trans>
                同屏悔棋撤回一手；人机和联机回到你最近一次走棋之前。联机悔棋需要对方同意。更多菜单可切换俯视和棋盘朝向。
              </Trans>
            </li>
          </ol>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
