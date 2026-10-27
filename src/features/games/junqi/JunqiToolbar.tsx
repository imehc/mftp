import { Plural, Trans } from "@lingui/react/macro";
import { Shuffle } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

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
}: {
  mode: JunqiMode;
  state: JunqiView;
  interactive: boolean;
  localSeat: Side;
  peerName?: string;
  undoWaiting?: boolean;
  onArrange(): void;
  onReady(): void;
}) {
  const deployment = state.phase === "deployment";
  const finished = state.phase === "finished";
  const opponentTurn = state.turnSeat !== localSeat;
  return (
    <div className="junqi-toolbar flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">
          {state.viewerSide === null ? (
            localSeat === 0 ? (
              <Trans comment="翻棋首翻前，本地玩家先翻棋子决定阵营">先翻</Trans>
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
        <span className="text-muted-foreground text-xs">
          <VariantLabel variant={state.variant} />
        </span>
        <span className="text-muted-foreground text-xs">
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
      </div>
      {deployment ? (
        <p className="text-muted-foreground min-w-0 flex-[1_1_12rem] text-xs">
          {opponentTurn ? (
            <Trans>等待对方布阵</Trans>
          ) : (
            <Trans>选择两枚己方棋子交换位置</Trans>
          )}
        </p>
      ) : null}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        <div
          role="status"
          className="flex flex-wrap items-center justify-end gap-1.5"
        >
          <Badge variant="secondary">
            {undoWaiting ? (
              <Trans>等待对方同意悔棋…</Trans>
            ) : finished ? (
              <ResultLabel
                winner={state.winner}
                localSide={state.viewerSide}
                online={mode.kind === "online"}
              />
            ) : deployment ? (
              <>
                <SideLabel side={state.turnSide ?? state.turnSeat} /> ·{" "}
                <Trans>布阵</Trans>
              </>
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
            )}
          </Badge>
          {!deployment ? (
            <Badge variant="outline">
              <Plural
                value={{ moves: state.ply }}
                one="已走 # 手"
                other="已走 # 手"
              />
            </Badge>
          ) : null}
          {!deployment && !finished && state.lastCombat ? (
            <span className="text-muted-foreground text-xs">
              {state.lastCombat === "both" ? (
                <Trans>双方棋子同归于尽</Trans>
              ) : state.lastCombat === "attacker" ? (
                <Trans>进攻方获胜</Trans>
              ) : (
                <Trans>防守方获胜</Trans>
              )}
            </span>
          ) : null}
        </div>
        {deployment ? (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!interactive}
              onClick={onArrange}
            >
              <Shuffle data-icon="inline-start" />
              <Trans>随机布阵</Trans>
            </Button>
            <Button size="sm" disabled={!interactive} onClick={onReady}>
              <Trans>确认布阵</Trans>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
