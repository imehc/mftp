import { Trans, useLingui } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
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
