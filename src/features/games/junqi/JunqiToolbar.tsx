import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Check, Shuffle } from "lucide-react";
import type { ReactNode } from "react";

import { GameToolbar, GameToolbarAction } from "../engine/GameToolbar";
import { ResultLabel, SideLabel, VariantLabel } from "./labels";
import type { JunqiMode, Side } from "./types";
import type { JunqiView } from "./view-types";

export function JunqiToolbar({
  mode,
  state,
  interactive,
  onArrange,
  onReady,
  localSeat,
  peerName,
  undoWaiting = false,
  actions,
}: {
  mode: JunqiMode;
  state: JunqiView;
  interactive: boolean;
  localSeat: Side;
  peerName?: string;
  undoWaiting?: boolean;
  actions?: ReactNode;
  onArrange(): void;
  onReady(): void;
}) {
  const { t } = useLingui();
  const deployment = state.phase === "deployment";
  const finished = state.phase === "finished";
  const opponentTurn = state.turnSeat !== localSeat;
  return (
    <GameToolbar
      context={
        <>
          <span>
            {state.viewerSide === null ? (
              localSeat === 0 ? (
                <Trans comment="翻棋首翻前，本地玩家先翻棋子决定阵营">
                  先翻
                </Trans>
              ) : (
                <Trans comment="翻棋首翻前，本地玩家后翻棋子，等待对方定边">
                  后翻
                </Trans>
              )
            ) : state.viewerSide === 0 ? (
              <Trans>你执红</Trans>
            ) : (
              <Trans>你执黑</Trans>
            )}
          </span>
          <span>
            <VariantLabel variant={state.variant} />
          </span>
          <span>
            {mode.kind === "ai" ? (
              <>
                <Trans>电脑</Trans> ·{" "}
                {mode.difficulty === "easy" ? (
                  <Trans>简单</Trans>
                ) : mode.difficulty === "hard" ? (
                  <Trans>困难</Trans>
                ) : (
                  <Trans>中等</Trans>
                )}
              </>
            ) : (
              <>
                <Trans>对方</Trans> · {peerName || <Trans>玩家</Trans>}
              </>
            )}
          </span>
        </>
      }
      actions={
        <>
          {actions}
          {deployment ? (
            <>
              <GameToolbarAction
                secondary
                icon={Shuffle}
                label={t`随机布阵`}
                disabled={!interactive}
                onClick={onArrange}
              />
              <GameToolbarAction
                icon={Check}
                label={t`确认布阵`}
                variant="default"
                disabled={!interactive}
                onClick={onReady}
              />
            </>
          ) : null}
        </>
      }
      status={
        undoWaiting ? (
          <Trans>等待对方同意悔棋…</Trans>
        ) : finished ? (
          <ResultLabel
            winner={state.winner}
            localSide={state.viewerSide}
            online={mode.kind === "online"}
          />
        ) : deployment ? (
          opponentTurn ? (
            <Trans>等待对方布阵</Trans>
          ) : (
            <>
              <SideLabel side={state.turnSide ?? state.turnSeat} /> ·{" "}
              <Trans>布阵</Trans>
            </>
          )
        ) : opponentTurn ? (
          mode.kind === "online" ? (
            <Trans>对方走棋</Trans>
          ) : (
            <Trans comment="军棋当前回合由电脑走棋，显示在棋盘右上方状态区">
              电脑走棋
            </Trans>
          )
        ) : state.turnSide === null ? (
          <Trans comment="翻棋的第一个回合，翻开棋子决定双方阵营">
            翻子定边
          </Trans>
        ) : (
          <>
            <SideLabel side={state.turnSide} /> · <Trans>走棋</Trans>
          </>
        )
      }
      metrics={
        !deployment ? (
          <span>
            <Plural
              value={{ moves: state.ply }}
              one="已走 # 手"
              other="已走 # 手"
            />
          </span>
        ) : null
      }
      details={
        <>
          {deployment ? <Trans>选择两枚己方棋子交换位置</Trans> : null}
          {!deployment && !finished && state.lastCombat ? (
            <span>
              {state.lastCombat === "both" ? (
                <Trans>双方棋子同归于尽</Trans>
              ) : state.lastCombat === "attacker" ? (
                <Trans>进攻方获胜</Trans>
              ) : (
                <Trans>防守方获胜</Trans>
              )}
            </span>
          ) : null}
        </>
      }
    />
  );
}
