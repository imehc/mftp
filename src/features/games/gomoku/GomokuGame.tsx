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
  Users,
} from "lucide-react";
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
import { useSettingsStore } from "~/store/settings";
import type { Difficulty } from "../engine/ai";
import { AiController, LocalController } from "../engine/controllers";
import { useGameHistory, useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
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
  | { kind: "ai"; difficulty: Difficulty }
  | { kind: "hotseat" }
  | { kind: "online" };

const GAME_ID = "gomoku";

interface GomokuHistoryPayload {
  mode: Mode["kind"];
  difficulty?: Difficulty;
  winnerSeat: SeatIndex | null;
  moves: number;
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
  const { t } = useLingui();
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
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
            <Button size="xs" onClick={() => onStart({ kind: "ai", difficulty })}>
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
          disabled
          title={t`联机对战将在联机传输通道完成后开放`}
        >
          <span className="flex items-center gap-2">
            <Radio className="size-4" />
            <Trans>联机对战</Trans>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            <Trans>入口已保留</Trans>
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
    const controllers: PlayerController<GomokuState, GomokuMove>[] =
      mode.kind === "hotseat"
        ? [local, local]
        : [local, new AiController(gomokuAiStrategy, mode.kind === "ai" ? mode.difficulty : "medium", 350)];
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

function MatchView({
  mode,
  session,
  onRematch,
  onExit,
}: {
  mode: Mode;
  session: Session;
  onRematch: () => void;
  onExit: () => void;
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
      } satisfies GomokuHistoryPayload,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  return (
    <>
      <div className="border-b border-border px-2 py-1 text-xs">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {state.finished ? (
            snapshot.winnerSeat === null ? (
              <Badge variant="secondary">
                <Trans>平局</Trans>
              </Badge>
            ) : (
              <Badge variant="secondary">
                {seatName(mode, snapshot.winnerSeat)} <Trans>获胜</Trans>
              </Badge>
            )
          ) : (
            <Badge variant="secondary">
              <Trans>轮到</Trans> {seatName(mode, state.turnSeat)}
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
                  {snapshot.winnerSeat === null ? (
                    <Trans>平局</Trans>
                  ) : (
                    <span>
                      {seatName(mode, snapshot.winnerSeat)} <Trans>获胜</Trans>
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <Trans>共 {state.moveCount} 手</Trans>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={onRematch}>
                  <Trans>再来一局</Trans>
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

function seatName(mode: Mode, seat: SeatIndex) {
  if (mode.kind === "ai") return seat === 0 ? <Trans>你</Trans> : "AI";
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
  if (payload.mode === "ai") return payload.winnerSeat === 0 ? <Trans>胜</Trans> : <Trans>负</Trans>;
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
