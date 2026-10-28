import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";
import { useSettingsStore } from "~/store/settings";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { OnlineLobby } from "../engine/online/OnlineLobby";
import { OnlineMatchDialogs } from "../engine/online/OnlineMatchDialogs";
import { playJunqiMove } from "./audio";
import { JunqiMatchView } from "./JunqiMatchView";
import { JunqiUndoInformation } from "./JunqiUndoDialog";
import type { JunqiOnlineController } from "./online-controller";
import { junqiRoomGameId, parseJunqiFrame } from "./online-protocol";
import { junqiRoom } from "./online-session";
import { canRequestUndo } from "./online-undo";
import { junqiSessions } from "./session";
import type { JunqiVariant } from "./types";

export function JunqiOnlineFlow({
  variant,
  onExit,
}: {
  variant: JunqiVariant;
  onExit(): void;
}) {
  const [room] = useState(() => junqiRoom(variant));
  const snapshot = useSyncExternalStore(
    room.owner.subscribe,
    room.owner.getSnapshot,
  );
  useEffect(() => {
    room.activate();
  }, [room]);
  if (!snapshot.ready || !room.controller)
    return (
      <OnlineLobby
        gameId={junqiRoomGameId(variant)}
        parseMove={parseJunqiFrame}
        owner={room.owner}
        onExit={onExit}
      />
    );
  return (
    <OnlineMatch
      controller={room.controller}
      variant={variant}
      peerName={snapshot.ready.session.peerName}
      onExit={onExit}
    />
  );
}

function OnlineMatch({
  controller,
  variant,
  peerName,
  onExit,
}: {
  controller: JunqiOnlineController;
  variant: JunqiVariant;
  peerName: string;
  onExit(): void;
}) {
  const { t } = useLingui();
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const volume = useSettingsStore((state) => state.gamesVolume);
  const lightNotice = s.undoNotice
    ? {
        id: `undo-${s.undoNotice.requestId}`,
        message:
          s.undoNotice.kind === "declined"
            ? t`对方拒绝了悔棋`
            : t`局面已更新，悔棋请求已失效。`,
      }
    : null;
  const previous = useRef({ round: s.round, ply: s.view?.ply ?? 0 });
  useEffect(() => {
    if (
      s.view &&
      previous.current.round === s.round &&
      s.view.ply > previous.current.ply
    )
      playJunqiMove(volume, s.view.lastCombat !== null);
    previous.current = { round: s.round, ply: s.view?.ply ?? 0 };
  }, [s.round, s.view, volume]);
  const endReason =
    s.end === "peer-left"
      ? t`对方已离开或连接已断开。未完成的对局不计胜负。`
      : s.end === "timeout"
        ? t`等待对方响应超时，请重新创建或加入房间。`
        : s.end === "protocol"
          ? t`对局数据不一致，连接已停止。`
          : s.end === "send-failed"
            ? t`操作发送失败，对局已停止，不会自动重发。`
            : null;
  const notice = (
    <>
      <GameSessionNotice store={junqiSessions} />
      {s.error || s.rejected ? (
        <div className="px-3 py-1">
          <Alert variant="destructive">
            <AlertDescription>
              {s.error
                ? describeError(s.error, t)
                : s.rejected === "stale"
                  ? t`局面已更新，请重新选择走法。`
                  : t`该操作不符合当前规则，请重新选择。`}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {s.pending ? (
        <div
          role="status"
          className="text-muted-foreground flex items-center gap-2 px-3 text-xs"
        >
          <Spinner />
          <Trans>正在同步对局…</Trans>
        </div>
      ) : null}
    </>
  );
  return (
    <>
      {s.view ? (
        <JunqiMatchView
          key={s.round}
          mode={{ kind: "online", variant }}
          view={s.view}
          localSeat={s.localSeat}
          peerName={peerName}
          recordId={`${s.matchId}:${s.round}`}
          canRecord={!s.end && !s.pending}
          interactive={
            !s.end &&
            !s.pending &&
            !s.rematch &&
            !s.undo &&
            s.view.turnSeat === s.localSeat
          }
          onAction={controller.submit}
          undo={{
            enabled: canRequestUndo(s),
            waiting: s.undo?.direction === "outgoing",
            request: controller.requestUndo,
          }}
          onRestart={controller.requestRematch}
          onExit={onExit}
          rematchWaiting={s.rematch?.direction === "outgoing"}
          notice={notice}
          lightNotice={lightNotice}
        />
      ) : (
        <>
          <BoardGameHeader
            title={<Trans>陆战棋</Trans>}
            active
            finished={false}
            canRestart={false}
            onRestart={() => {}}
            onExit={onExit}
          />
          {notice}
          <div
            role="status"
            className="flex flex-1 items-center justify-center gap-2"
          >
            <Spinner />
            <Trans>正在同步对局…</Trans>
          </div>
        </>
      )}
      <OnlineMatchDialogs
        undoFlow={
          s.undo?.direction === "incoming" && !s.pending
            ? {
                kind: "incoming",
                atMove: s.view?.ply ?? 0,
                plies: s.undo.request.plies,
              }
            : s.undo
              ? { kind: "waiting" }
              : null
        }
        undoInformation={
          variant !== "open" ? <JunqiUndoInformation /> : undefined
        }
        onRespondUndo={controller.respondUndo}
        rematchIncoming={s.rematch?.direction === "incoming" && !s.pending}
        onRespondRematch={controller.respondRematch}
        endReason={endReason}
        onExit={onExit}
      />
    </>
  );
}
