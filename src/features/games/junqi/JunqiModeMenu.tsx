import { Trans, useLingui } from "@lingui/react/macro";

import { BoardModeMenu } from "../engine/BoardModeMenu";
import { GameSetupSelect } from "../engine/GameSetupSelect";
import { historyMode, historyResult, VARIANT_LABELS } from "./labels";
import {
  JUNQI_GAME_ID,
  type JunqiHistoryPayload,
  type JunqiMode,
  type JunqiVariant,
} from "./types";

export function JunqiModeMenu({
  onStart,
  variant,
  onVariant,
}: {
  onStart(mode: JunqiMode): void;
  variant: JunqiVariant;
  onVariant(variant: JunqiVariant): void;
}) {
  const { t } = useLingui();
  return (
    <BoardModeMenu<JunqiHistoryPayload>
      gameId={JUNQI_GAME_ID}
      red
      allowHotseat={false}
      setup={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <GameSetupSelect
            label={<Trans comment="军棋开局选择明棋、暗棋或翻棋">玩法</Trans>}
            value={variant}
            onChange={(value) => onVariant(value as JunqiVariant)}
            options={Object.entries(VARIANT_LABELS).map(([value, label]) => ({
              value,
              label: t(label),
            }))}
          />
          <p className="text-muted-foreground text-xs">
            {variant === "hidden" ? (
              <Trans>己方身份可见，对方身份隐藏。</Trans>
            ) : variant === "flip" ? (
              <Trans>随机盖放，首翻定边；每回合翻子或走棋。</Trans>
            ) : (
              <Trans>双方身份公开，布阵后开始。</Trans>
            )}
          </p>
        </div>
      }
      seatLabels={
        variant === "flip"
          ? [
              t({ message: "先翻", comment: "翻棋开局由本地玩家首先翻子" }),
              t({ message: "后翻", comment: "翻棋开局由电脑首先翻子" }),
            ]
          : undefined
      }
      onStart={(mode) => {
        if (mode.kind === "online") onStart({ kind: "online", variant });
        if (mode.kind === "ai")
          onStart({
            ...mode,
            variant,
            localSeat: mode.localSeat === 1 ? 1 : 0,
          });
      }}
      historyMode={historyMode}
      historyResult={historyResult}
    />
  );
}
