import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Bot,
  Circle,
  CircleDot,
  Home,
  Radio,
  RotateCcw,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { gameRoomLeave } from "~/lib/ipc";
import { useSettingsStore } from "~/store/settings";
import type { GameRoomStatus } from "~/types";
import type { Difficulty } from "../engine/ai";
import {
  AiController,
  LocalController,
  RemoteController,
} from "../engine/controllers";
import { useGameHistory, useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import { OnlineLobby } from "../engine/online/OnlineLobby";
import { hashString, OnlineMatchSession } from "../engine/online/session";
import type { RemoteMove } from "../engine/transport";
import type { PlayerController, SeatIndex } from "../engine/types";
import { gomokuAiStrategy } from "./ai";
import {
  playFinishSound,
  playStoneSound,
  unlockGomokuAudio,
} from "./audio";
import { GomokuStage } from "./GomokuStage";
import type { GomokuMove, GomokuState } from "./types";import { createInitialGomokuState, gomokuGame } from "./rules";

type Mode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: SeatIndex }
  | { kind: "hotseat" }
  | { kind: "online" };

const GAME_ID = "gomoku";

interface GomokuHistoryPayload {
  mode: Mode["kind"];
  difficulty?: Difficulty;
  winnerSeat: SeatIndex | null;
  moves: number;
  /** Local player's seat where one exists (ai: 0, online: varies). */
  localSeat?: SeatIndex;
}

interface Session {
  runner: MatchRunner<GomokuState, GomokuMove, GomokuMove>;
  local: LocalController<GomokuState, GomokuMove>;
}

export default function GomokuGame() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleDot className="size-3.5" />
            <Trans>五子棋</Trans>
          </div>
        </div>
        {mode ? (
          <div className="flex items-center gap-1">
            {mode.kind !== "online" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="xs">
                    <RotateCcw data-icon="inline-start" />
                    <Trans>重开</Trans>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      <Trans>重新开始对局?</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <Trans>当前对局的进度将会丢失。</Trans>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      <Trans>取消</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => setMatchKey((k) => k + 1)}>
                      <Trans>重开</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="xs">
                  <Trans>退出对局</Trans>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    <Trans>退出当前对局?</Trans>
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <Trans>将返回模式选择,当前对局的进度将会丢失。</Trans>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <Trans>取消</Trans>
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={() => setMode(null)}>
                    <Trans>退出</Trans>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </header>
      {mode === null ? (
        <ModeMenu
          onStart={(nextMode) => {
            unlockGomokuAudio();
            setMode(nextMode);
          }}
        />
      ) : mode.kind === "online" ? (
        <OnlineFlow onExit={() => setMode(null)} />
      ) : (
        <Match
          key={`${JSON.stringify(mode)}-${matchKey}`}
          mode={mode}
          onRematch={() => setMatchKey((k) => k + 1)}
          onExit={() => setMode(null)}
        />
      )}
    </main>
  );
}

function ModeMenu({ onStart }: { onStart: (mode: Mode) => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [aiSeat, setAiSeat] = useState<SeatIndex>(0);
  const records = useGameHistory<GomokuHistoryPayload>(GAME_ID);
  const clearGame = useGamesHistoryStore((s) => s.clearGame);
  return (
    <div className="flex flex-1 justify-center overflow-auto p-3">
      <div className="flex w-full max-w-sm flex-col gap-2 self-center">
        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Bot className="size-4" />
              <Trans>人机对战</Trans>
            </span>
            <Button
              size="xs"
              onClick={() => onStart({ kind: "ai", difficulty, localSeat: aiSeat })}
            >
              <Trans>开始</Trans>
            </Button>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={difficulty}
            onValueChange={(value) => {
              if (value) setDifficulty(value as Difficulty);
            }}
            className="w-full"
          >
            <ToggleGroupItem value="easy" className="flex-1">
              <Trans>简单</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="medium" className="flex-1">
              <Trans>中等</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="hard" className="flex-1">
              <Trans>困难</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(aiSeat)}
            onValueChange={(value) => {
              if (value) setAiSeat(Number(value) as SeatIndex);
            }}
            className="w-full"
          >
            <ToggleGroupItem value="0" className="flex-1">
              <Trans>先手（执黑）</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="1" className="flex-1">
              <Trans>后手（执白）</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="justify-between"
          onClick={() => onStart({ kind: "hotseat" })}
        >
          <span className="flex items-center gap-2">
            <Users className="size-4" />
            <Trans>双人对战</Trans>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            <Trans>同屏轮流</Trans>
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="justify-between"
          onClick={() => onStart({ kind: "online" })}
        >
          <span className="flex items-center gap-2">
            <Radio className="size-4" />
            <Trans>联机对战</Trans>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            <Trans>局域网</Trans>
          </span>
        </Button>
        {records.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                <Trans>历史记录</Trans>
              </span>
              <Button variant="ghost" size="xs" onClick={() => clearGame(GAME_ID)}>
                <Trans>清空</Trans>
              </Button>
            </div>
            <ul className="flex max-h-44 flex-col gap-1 overflow-auto text-xs">
              {records.slice(0, 12).map((record) => (
                <li key={record.id} className="grid grid-cols-3 gap-2">
                  <span className="text-left tabular-nums text-muted-foreground">
                    {formatHistoryTime(record.finishedAt)}
                  </span>
                  <span className="min-w-0 truncate text-center">
                    {historyModeLabel(record.payload)}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {historyResult(record.payload)}
                    {" · "}
                    <Trans>{record.payload.moves} 手</Trans>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Match({
  mode,
  onRematch,
  onExit,
}: {
  mode: Mode;
  onRematch: () => void;
  onExit: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const volume = useSettingsStore((s) => s.gamesVolume);

  useEffect(() => {
    const local = new LocalController<GomokuState, GomokuMove>();
    let controllers: PlayerController<GomokuState, GomokuMove>[];
    if (mode.kind === "hotseat") {
      controllers = [local, local];
    } else {
      const ai = new AiController(
        gomokuAiStrategy,
        mode.kind === "ai" ? mode.difficulty : "medium",
        350,
      );
      // 执白后手: the AI takes seat 0 (black) and opens the game.
      controllers =
        mode.kind === "ai" && mode.localSeat === 1 ? [ai, local] : [local, ai];
    }
    const runner = new MatchRunner(gomokuGame, createInitialGomokuState(), controllers, {
      onMoveResolved: ({ resolution }) => {
        playStoneSound(volume);
        if (resolution.state.finished) playFinishSound(volume);
      },
      onError: (error) => console.error("gomoku match error", error),
    });
    runner.start();
    setSession({ runner, local });
    return () => {
      runner.dispose();
      setSession(null);
    };
    // mode identity is stable per <Match key=...> instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return <div className="flex-1" />;
  return (
    <MatchView
      mode={mode}
      session={session}
      onRematch={onRematch}
      onExit={onExit}
    />
  );
}

/** Extra view state when the match runs over the LAN room channel. */
interface OnlineViewProps {
  peerName: string;
  localSeat: SeatIndex;
  undoWaiting: boolean;
  rematchWaiting: boolean;
  onRequestUndo(plies: number): void;
}

function MatchView({
  mode,
  session,
  onRematch,
  onExit,
  online,
}: {
  mode: Mode;
  session: Session;
  onRematch: () => void;
  onExit: () => void;
  online?: OnlineViewProps;
}) {
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const addRecord = useGamesHistoryStore((s) => s.addRecord);
  const recordedRef = useRef(false);
  // Hold the result overlay back so the winning-line blink stays visible.
  const [showResult, setShowResult] = useState(false);
  const activeIsLocal =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "local";
  const aiThinking =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "ai";
  const localSeat =
    mode.kind === "online"
      ? online?.localSeat ?? 0
      : mode.kind === "ai"
        ? mode.localSeat
        : 0;
  // 悔棋 rolls back to the local player's turn: two plies once the
  // opponent (AI or remote peer) has replied, one while they are still
  // deciding. Online mode routes through a consent request instead of
  // undoing directly.
  const undoPlies =
    (mode.kind === "ai" || mode.kind === "online") &&
    snapshot.activeSeat === localSeat
      ? 2
      : 1;
  const canUndo =
    snapshot.phase === "awaiting-move" &&
    state.moveCount >= undoPlies &&
    !online?.undoWaiting;

  useEffect(() => {
    if (!state.finished) {
      setShowResult(false);
      return;
    }
    const timer = setTimeout(
      () => setShowResult(true),
      state.winningLine.length > 0 ? 1600 : 500,
    );
    return () => clearTimeout(timer);
  }, [state.finished, state.winningLine.length]);

  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: crypto.randomUUID(),
      gameId: GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: snapshot.winnerSeat,
        moves: state.moveCount,
        localSeat:
          mode.kind === "online"
            ? online?.localSeat
            : mode.kind === "ai"
              ? mode.localSeat
              : undefined,
      } satisfies GomokuHistoryPayload,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  return (
    <>
      <div className="border-b border-border px-2 py-1 text-xs">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {state.finished ? (
            <Badge variant="secondary">
              {matchResultLabel(mode, snapshot.winnerSeat, online)}
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Trans>轮到</Trans> {seatName(mode, state.turnSeat, online)}
            </Badge>
          )}
          <Badge variant="outline">
            <Trans>第 {state.moveCount + (state.finished ? 0 : 1)} 手</Trans>
          </Badge>
          {aiThinking ? (
            <Badge variant="outline">
              <Trans>AI 思考中…</Trans>
            </Badge>
          ) : null}
          {online &&
          !state.finished &&
          snapshot.phase === "awaiting-move" &&
          snapshot.activeSeat !== online.localSeat ? (
            <Badge variant="outline">
              <Trans>等待对方落子…</Trans>
            </Badge>
          ) : null}
          {online?.undoWaiting ? (
            <Badge variant="outline">
              <Trans>等待对方同意悔棋…</Trans>
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            disabled={!canUndo}
            onClick={() =>
              online ? online.onRequestUndo(undoPlies) : runner.undo(undoPlies)
            }
          >
            <Undo2 data-icon="inline-start" />
            <Trans>悔棋</Trans>
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 p-1.5">
        <GomokuStage
          board={state.board}
          lastMove={state.lastMove}
          winningLine={state.winningLine}
          ghostSeat={state.turnSeat}
          interactive={activeIsLocal && !state.finished}
          onPlay={(move) => local.submit(move)}
        />
        {state.finished && showResult ? (
          <div className="absolute inset-0 z-20 flex animate-in items-center justify-center bg-black/35 p-4 backdrop-blur-[2px] fade-in duration-300">
            <div className="flex w-full max-w-[18rem] animate-in flex-col gap-3 rounded-lg border border-white/25 bg-background/95 p-4 text-foreground shadow-2xl fade-in zoom-in-95 duration-300">
              <div className="text-center">
                <div className="text-base font-semibold">
                  {matchResultLabel(mode, snapshot.winnerSeat, online)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <Trans>共 {state.moveCount} 手</Trans>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={online?.rematchWaiting}
                  onClick={onRematch}
                >
                  {online?.rematchWaiting ? (
                    <Trans>等待对方…</Trans>
                  ) : (
                    <Trans>再来一局</Trans>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={onExit}
                >
                  <Trans>返回选择</Trans>
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function seatName(
  mode: Mode,
  seat: SeatIndex,
  online?: { peerName: string; localSeat: SeatIndex },
) {
  if (mode.kind === "online" && online) {
    return (
      <span className="inline-flex items-center gap-1">
        <Circle
          className={
            seat === 0 ? "size-3 fill-current" : "size-3 fill-background"
          }
        />
        {seat === online.localSeat ? (
          <Trans>你</Trans>
        ) : (
          online.peerName || <Trans>对方</Trans>
        )}
      </span>
    );
  }
  if (mode.kind === "ai") {
    return seat === mode.localSeat ? <Trans>你</Trans> : "AI";
  }
  return seat === 0 ? (
    <span className="inline-flex items-center gap-1">
      <Circle className="size-3 fill-current" />
      <Trans>黑棋</Trans>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Circle className="size-3 fill-background" />
      <Trans>白棋</Trans>
    </span>
  );
}

/**
 * Result line from the local player's perspective where one exists
 * (vs-AI and online); hotseat keeps the neutral 黑棋/白棋 获胜 form.
 */
function matchResultLabel(
  mode: Mode,
  winnerSeat: SeatIndex | null,
  online?: { peerName: string; localSeat: SeatIndex },
) {
  if (winnerSeat === null) return <Trans>平局</Trans>;
  const localSeat =
    mode.kind === "online"
      ? online?.localSeat
      : mode.kind === "ai"
        ? mode.localSeat
        : null;
  if (localSeat != null) {
    return winnerSeat === localSeat ? (
      <Trans>你赢了</Trans>
    ) : (
      <Trans>你输了</Trans>
    );
  }
  return (
    <span>
      {seatName(mode, winnerSeat, online)} <Trans>获胜</Trans>
    </span>
  );
}

function historyModeLabel(payload: GomokuHistoryPayload) {
  if (payload.mode === "hotseat") return <Trans>双人</Trans>;
  if (payload.mode === "online") return <Trans>联机</Trans>;
  return (
    <span>
      <Trans>人机</Trans>
      {" · "}
      {payload.difficulty === "easy" ? (
        <Trans>简单</Trans>
      ) : payload.difficulty === "hard" ? (
        <Trans>困难</Trans>
      ) : (
        <Trans>中等</Trans>
      )}
    </span>
  );
}

function historyResult(payload: GomokuHistoryPayload) {
  if (payload.winnerSeat === null) return <Trans>平局</Trans>;
  if (payload.mode === "ai") {
    return payload.winnerSeat === (payload.localSeat ?? 0) ? (
      <Trans>胜</Trans>
    ) : (
      <Trans>负</Trans>
    );
  }
  if (payload.mode === "online" && payload.localSeat != null) {
    return payload.winnerSeat === payload.localSeat ? (
      <Trans>胜</Trans>
    ) : (
      <Trans>负</Trans>
    );
  }
  return payload.winnerSeat === 0 ? <Trans>黑棋胜</Trans> : <Trans>白棋胜</Trans>;
}

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Divergence tripwire compared against the peer's RemoteMove.stateHash. */
function hashGomokuState(state: GomokuState): string {
  const cells = state.board
    .map((stone) => (stone === null ? "." : String(stone)))
    .join("");
  return hashString(`${cells}|${state.turnSeat}|${state.moveCount}`);
}

function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [ready, setReady] = useState<{
    session: OnlineMatchSession<GomokuMove>;
    status: GameRoomStatus;
  } | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Leaving online mode always tears the room down.
  useEffect(
    () => () => {
      readyRef.current?.session.close();
      void gameRoomLeave().catch(() => {});
    },
    [],
  );

  if (!ready) {
    return <OnlineLobby<GomokuMove> gameId={GAME_ID} onReady={setReady} />;
  }
  return <OnlineMatch session={ready.session} onExit={onExit} />;
}

type UndoFlow =
  | { kind: "waiting" }
  | { kind: "incoming"; atMove: number; plies: number }
  | null;

function OnlineMatch({
  session,
  onExit,
}: {
  session: OnlineMatchSession<GomokuMove>;
  onExit: () => void;
}) {
  const { t } = useLingui();
  const volume = useSettingsStore((s) => s.gamesVolume);
  const [nonce, setNonce] = useState(0);
  const [match, setMatch] = useState<Session | null>(null);
  const [undoFlow, setUndoFlow] = useState<UndoFlow>(null);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchIncoming, setRematchIncoming] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);
  const lastRemoteRef = useRef<RemoteMove<GomokuMove> | null>(null);
  const matchRef = useRef<Session | null>(null);
  matchRef.current = match;

  useEffect(() => {
    lastRemoteRef.current = null;
    setUndoFlow(null);
    setRematchWaiting(false);
    setRematchIncoming(false);
    // 换先: seats swap every rematch. Both peers bump `nonce` through the
    // consent flow, so parity — and thus the seat mapping — stays in
    // lockstep without extra protocol.
    const seatThisRound: SeatIndex =
      nonce % 2 === 0 ? session.localSeat : ((1 - session.localSeat) as SeatIndex);
    const local = new LocalController<GomokuState, GomokuMove>();
    const remote = new RemoteController<GomokuState, GomokuMove>();
    const controllers: PlayerController<GomokuState, GomokuMove>[] =
      seatThisRound === 0 ? [local, remote] : [remote, local];
    const runner = new MatchRunner(
      gomokuGame,
      createInitialGomokuState(),
      controllers,
      {
        onMoveResolved: ({ seat, move, moveIndex, resolution }) => {
          playStoneSound(volume);
          if (resolution.state.finished) playFinishSound(volume);
          const hash = hashGomokuState(resolution.state);
          if (seat === seatThisRound) {
            void session
              .sendMove({ seq: moveIndex, seat, move, stateHash: hash })
              .catch(() => {
                setEndReason(t`消息发送失败，连接可能已断开。`);
              });
          } else if (
            lastRemoteRef.current &&
            lastRemoteRef.current.stateHash !== hash
          ) {
            setEndReason(t`双方棋局状态不一致，本局无法继续。`);
          }
        },
        onError: (error) => console.error("gomoku online match error", error),
      },
    );
    const offMove = session.onRemoteMove((remoteMove) => {
      lastRemoteRef.current = remoteMove;
      remote.push(remoteMove.move);
    });
    runner.start();
    setMatch({ runner, local });
    return () => {
      offMove();
      runner.dispose();
      setMatch(null);
    };
    // volume is read per-move; a change mid-match must not rebuild the runner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, session]);

  /** Roll both peers back to the same absolute move index. */
  const applyUndo = (atMove: number, plies: number) => {
    const runner = matchRef.current?.runner;
    if (!runner) return;
    const target = Math.max(0, atMove - plies);
    const current = runner.getSnapshot().moveCount;
    if (current > target) runner.undo(current - target);
  };

  useEffect(() => {
    const offControl = session.onControl((msg) => {
      if (msg.t === "undo-request") {
        setUndoFlow({ kind: "incoming", atMove: msg.atMove, plies: msg.plies });
      } else if (msg.t === "undo-response") {
        setUndoFlow((flow) => (flow?.kind === "waiting" ? null : flow));
        if (msg.accept) applyUndo(msg.atMove, msg.plies);
        else toast(t`对方拒绝了悔棋`);
      } else if (msg.t === "rematch-request") {
        setRematchIncoming(true);
      } else if (msg.t === "rematch-response") {
        setRematchWaiting(false);
        if (msg.accept) setNonce((n) => n + 1);
        else toast(t`对方拒绝了再来一局`);
      }
    });
    const offPresence = session.onPeerPresence((connected) => {
      if (!connected) setEndReason(t`对方已离开房间。`);
    });
    const offClosed = session.onClosed(() => {
      setEndReason(t`与对方的连接已断开。`);
    });
    return () => {
      offControl();
      offPresence();
      offClosed();
    };
    // applyUndo only reads refs; resubscribing per render is pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, t]);

  const requestUndo = (plies: number) => {
    const runner = matchRef.current?.runner;
    if (!runner || undoFlow !== null) return;
    const atMove = runner.getSnapshot().moveCount;
    setUndoFlow({ kind: "waiting" });
    void session
      .sendControl({ t: "undo-request", atMove, plies })
      .catch(() => setUndoFlow(null));
  };

  const respondUndo = (accept: boolean) => {
    const flow = undoFlow;
    if (flow?.kind !== "incoming") return;
    setUndoFlow(null);
    if (accept) applyUndo(flow.atMove, flow.plies);
    void session
      .sendControl({
        t: "undo-response",
        accept,
        atMove: flow.atMove,
        plies: flow.plies,
      })
      .catch(() => {});
  };

  const requestRematch = () => {
    if (rematchWaiting) return;
    setRematchWaiting(true);
    void session
      .sendControl({ t: "rematch-request" })
      .catch(() => setRematchWaiting(false));
  };

  const respondRematch = (accept: boolean) => {
    setRematchIncoming(false);
    void session.sendControl({ t: "rematch-response", accept }).catch(() => {});
    if (accept) setNonce((n) => n + 1);
  };

  if (!match) return <div className="flex-1" />;
  const mode: Mode = { kind: "online" };
  const gameSeat: SeatIndex =
    nonce % 2 === 0 ? session.localSeat : ((1 - session.localSeat) as SeatIndex);
  return (
    <>
      <MatchView
        key={nonce}
        mode={mode}
        session={match}
        online={{
          peerName: session.peerName,
          localSeat: gameSeat,
          undoWaiting: undoFlow?.kind === "waiting",
          rematchWaiting,
          onRequestUndo: requestUndo,
        }}
        onRematch={requestRematch}
        onExit={onExit}
      />
      <AlertDialog open={undoFlow?.kind === "incoming"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对方请求悔棋</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                将撤销 {undoFlow?.kind === "incoming" ? undoFlow.plies : 0}{" "}
                手棋，是否同意？
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => respondUndo(false)}>
              <Trans>拒绝</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => respondUndo(true)}>
              <Trans>同意</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={rematchIncoming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对方想再来一局</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>同意后双方交换先后手，立即开始新对局。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => respondRematch(false)}>
              <Trans>拒绝</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => respondRematch(true)}>
              <Trans>同意</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={endReason !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对局中断</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>{endReason}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={onExit}>
              <Trans>返回选择</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
