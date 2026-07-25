/**
 * Billiards game screen: mode menu (practice / vs AI / hot-seat), the
 * Pixi stage, and the HUD. Shooting is a slingshot gesture on the table
 * (drag behind the cue ball to aim + charge, release to fire) — the
 * bottom bar only hosts the spin toggle and a live power readout.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import {
  Bot,
  CircleDot,
  Home,
  RotateCcw,
  Target,
  Users,
  Volume2,
  VolumeX,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Slider } from "~/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { useSettingsStore } from "~/store/settings";
import { AiController, LocalController } from "../engine/controllers";
import type { Difficulty } from "../engine/ai";
import {
  useGameHistory,
  useGamesHistoryStore,
} from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import type { PlayerController } from "../engine/types";
import { billiardsAiStrategy } from "./ai";
import { BALL_HEX } from "./colors";
import { ensurePhysicsReady } from "./physics";
import { setGameAudioVolume, unlockAudio } from "./render/audio";
import { createBilliardsGame, createInitialState } from "./rules";
import {
  BilliardsStage,
  type BilliardsStageHandle,
} from "./render/BilliardsStage";
import type {
  BilliardsMove,
  BilliardsPresentation,
  BilliardsState,
  FoulReason,
} from "./types";

type Mode =
  | { kind: "practice" }
  | { kind: "ai"; difficulty: Difficulty }
  | { kind: "hotseat" };

const GAME_ID = "billiards";

interface BilliardsHistoryPayload {
  mode: Mode["kind"];
  difficulty?: Difficulty;
  winnerSeat: number | null;
  shots: number;
  fouls: number[];
}

interface Session {
  runner: MatchRunner<BilliardsState, BilliardsMove, BilliardsPresentation>;
  local: LocalController<BilliardsState, BilliardsMove>;
  stageRef: { current: BilliardsStageHandle | null };
}

export default function BilliardsGame() {
  const [physicsReady, setPhysicsReady] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const gamesVolume = useSettingsStore((s) => s.gamesVolume);
  const setGamesVolume = useSettingsStore((s) => s.setGamesVolume);

  // Keep the WebAudio master gain in sync with the persisted setting.
  useEffect(() => {
    setGameAudioVolume(gamesVolume);
  }, [gamesVolume]);

  useEffect(() => {
    let cancelled = false;
    void ensurePhysicsReady().then(() => {
      if (!cancelled) setPhysicsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
            <Trans>台球</Trans>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="音量">
                {gamesVolume > 0 ? <Volume2 /> : <VolumeX />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setGamesVolume(gamesVolume > 0 ? 0 : 0.7)}
                >
                  {gamesVolume > 0 ? (
                    <Volume2 className="size-4" />
                  ) : (
                    <VolumeX className="size-4" />
                  )}
                </button>
                <Slider
                  value={[Math.round(gamesVolume * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(values: number[]) =>
                    setGamesVolume(values[0] / 100)
                  }
                />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {Math.round(gamesVolume * 100)}
                </span>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {mode ? (
            <>
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
            </>
          ) : null}
        </div>
      </header>
      {!physicsReady ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Trans>正在加载物理引擎…</Trans>
        </div>
      ) : mode === null ? (
        <ModeMenu
          onStart={(nextMode) => {
            // Entering a match is a user gesture — the right moment to
            // unlock WebAudio (iOS autoplay policy).
            unlockAudio();
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

function historyModeLabel(payload: BilliardsHistoryPayload) {
  if (payload.mode === "practice") return <Trans>练习</Trans>;
  if (payload.mode === "hotseat") return <Trans>双人</Trans>;
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

function historyResult(payload: BilliardsHistoryPayload) {
  if (payload.mode === "practice") return <Trans>清台</Trans>;
  if (payload.mode === "ai") {
    return payload.winnerSeat === 0 ? <Trans>胜</Trans> : <Trans>负</Trans>;
  }
  return payload.winnerSeat === 0 ? (
    <Trans>玩家 1 胜</Trans>
  ) : (
    <Trans>玩家 2 胜</Trans>
  );
}

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ModeMenu({ onStart }: { onStart: (mode: Mode) => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const records = useGameHistory<BilliardsHistoryPayload>(GAME_ID);
  const clearGame = useGamesHistoryStore((s) => s.clearGame);
  return (
    <div className="flex flex-1 justify-center overflow-auto p-3">
      <div className="flex w-full max-w-xs flex-col gap-2 self-center">
        <Button
          variant="outline"
          size="sm"
          className="justify-between"
          onClick={() => onStart({ kind: "practice" })}
        >
          <span className="flex items-center gap-2">
            <Target className="size-4" />
            <Trans>练习模式</Trans>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            <Trans>自由清台</Trans>
          </span>
        </Button>
        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Bot className="size-4" />
              <Trans>人机对战</Trans>
            </span>
            <Button
              size="xs"
              onClick={() => onStart({ kind: "ai", difficulty })}
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
        {records.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                <Trans>历史记录</Trans>
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => clearGame(GAME_ID)}
              >
                <Trans>清空</Trans>
              </Button>
            </div>
            <ul className="flex max-h-44 flex-col gap-1 overflow-auto text-xs">
              {records.slice(0, 12).map((record) => (
                <li
                  key={record.id}
                  className="grid grid-cols-3 gap-2"
                >
                  <span className="shrink-0 text-muted-foreground tabular-nums text-left">
                    {formatHistoryTime(record.finishedAt)}
                  </span>
                  <span className="min-w-0 truncate text-center">
                    {historyModeLabel(record.payload)}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-right">
                    {historyResult(record.payload)}
                    {" · "}
                    <Trans>{record.payload.shots} 杆</Trans>
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

function foulLabel(foul: FoulReason) {
  switch (foul) {
    case "cue-potted":
      return <Trans>犯规:母球落袋</Trans>;
    case "no-contact":
      return <Trans>犯规:未碰到任何球</Trans>;
    case "wrong-first-contact":
      return <Trans>犯规:首先碰到的不是本方球</Trans>;
    case "potted-eight-early":
      return <Trans>犯规:提前打进黑八</Trans>;
  }
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
  const stageRef = useRef<BilliardsStageHandle | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const variant = mode.kind === "practice" ? "practice" : "eight-ball";
    const game = createBilliardsGame(variant);
    const local = new LocalController<BilliardsState, BilliardsMove>();
    const controllers: PlayerController<BilliardsState, BilliardsMove>[] =
      mode.kind === "practice"
        ? [local]
        : mode.kind === "hotseat"
          ? [local, local]
          : [local, new AiController(billiardsAiStrategy, mode.difficulty)];
    const runner = new MatchRunner(
      game,
      createInitialState(variant),
      controllers,
      {
        onMoveResolved: async ({ resolution }) => {
          await stageRef.current?.playPresentation(resolution.presentation);
        },
        onError: (error) => console.error("billiards match error", error),
      },
    );
    runner.start();
    setSession({ runner, local, stageRef });
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

function seatName(mode: Mode, seat: number) {
  if (mode.kind === "ai") return seat === 0 ? <Trans>你</Trans> : "AI";
  return seat === 0 ? <Trans>玩家 1</Trans> : <Trans>玩家 2</Trans>;
}

function BallIcon({ id, potted }: { id: number; potted: boolean }) {
  const striped = id >= 9 && id <= 15;
  const color = BALL_HEX[id];
  return (
    <span
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full",
        potted && "opacity-25 saturate-0",
      )}
      style={{ backgroundColor: striped ? "#f6f1e7" : color }}
    >
      {striped ? (
        <span
          className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="relative inline-flex size-2.5 items-center justify-center rounded-full bg-[#f6f1e7] text-[7px] leading-none font-bold text-neutral-900">
        {id}
      </span>
    </span>
  );
}

/** Remaining-target strip: potted balls stay visible but dimmed. */
function BallTray({
  state,
  ids,
}: {
  state: BilliardsState;
  ids: readonly number[];
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {ids.map((id) => (
        <BallIcon
          key={id}
          id={id}
          potted={state.balls.find((ball) => ball.id === id)?.potted ?? false}
        />
      ))}
    </span>
  );
}

const SOLID_TRAY = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const STRIPE_TRAY = [9, 10, 11, 12, 13, 14, 15, 8] as const;
const ALL_TRAY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

function seatTray(state: BilliardsState, seat: number): readonly number[] | null {
  const group = state.groups[seat];
  if (group === "solids") return SOLID_TRAY;
  if (group === "stripes") return STRIPE_TRAY;
  return null;
}

/** One side of the versus HUD: player badge + remaining-ball tray. */
function SeatCell({
  mode,
  state,
  seat,
  active,
  align,
}: {
  mode: Mode;
  state: BilliardsState;
  seat: number;
  active: boolean;
  align: "start" | "end";
}) {
  const tray = seatTray(state, seat);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1",
        align === "end" ? "flex-row-reverse justify-self-end" : "justify-self-start",
      )}
    >
      <Badge variant={active ? "secondary" : "outline"}>
        {seatName(mode, seat)}
      </Badge>
      {tray ? <BallTray state={state} ids={tray} /> : null}
    </div>
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
  const [followDraw, setFollowDraw] = useState(0);
  const [powerPreview, setPowerPreview] = useState(0);
  const addRecord = useGamesHistoryStore((s) => s.addRecord);
  const recordedRef = useRef(false);

  // Persist one history record per finished match.
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
        shots: state.shotCount,
        fouls: state.foulCounts,
      } satisfies BilliardsHistoryPayload,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  const activeIsLocal =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "local";
  const aiThinking =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "ai";
  const ballInHand = activeIsLocal && state.ballInHand;
  const outcome = state.lastOutcome;
  const remaining = state.balls.filter(
    (ball) => !ball.potted && ball.id !== 0,
  ).length;
  const powerPercent = Math.round(powerPreview * 100);

  return (
    <>
      <div className="min-h-8 border-b border-border px-2 py-1 text-xs">
        {state.finished ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant="secondary">
              {state.variant === "practice" ? (
                <Trans>清台完成!</Trans>
              ) : snapshot.winnerSeat !== null ? (
                <span>
                  {seatName(mode, snapshot.winnerSeat)} <Trans>获胜</Trans>
                </span>
              ) : (
                <Trans>对局结束</Trans>
              )}
            </Badge>
            <Badge variant="outline">
              <Trans>共 {state.shotCount} 杆</Trans>
            </Badge>
          </div>
        ) : mode.kind === "practice" ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant="outline">
              <Trans>第 {state.shotCount + 1} 杆</Trans>
            </Badge>
            <Badge variant="outline">
              <Trans>剩余 {remaining} 球</Trans>
            </Badge>
            <BallTray state={state} ids={ALL_TRAY} />
            {outcome?.foul ? (
              <Badge variant="destructive">{foulLabel(outcome.foul)}</Badge>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <SeatCell
              mode={mode}
              state={state}
              seat={0}
              active={snapshot.activeSeat === 0}
              align="start"
            />
            <div className="flex max-w-[50vw] flex-wrap items-center justify-center gap-1.5">
              <Badge variant="outline">
                <Trans>第 {state.shotCount + 1} 杆</Trans>
              </Badge>
              {aiThinking ? (
                <Badge variant="outline">
                  <Trans>AI 思考中…</Trans>
                </Badge>
              ) : null}
              {ballInHand ? (
                <Badge variant="secondary">
                  <Trans>自由球:拖动母球放置</Trans>
                </Badge>
              ) : null}
              {outcome?.foul ? (
                <Badge variant="destructive">{foulLabel(outcome.foul)}</Badge>
              ) : null}
              {outcome?.respottedEight ? (
                <Badge variant="outline">
                  <Trans>黑八已重置</Trans>
                </Badge>
              ) : null}
            </div>
            <SeatCell
              mode={mode}
              state={state}
              seat={1}
              active={snapshot.activeSeat === 1}
              align="end"
            />
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <BilliardsStage
          ref={session.stageRef}
          balls={state.balls}
          interactive={activeIsLocal}
          ballInHand={ballInHand}
          onPowerPreview={setPowerPreview}
          onShot={(angle, power) => {
            if (!activeIsLocal || state.ballInHand) return;
            local.submit({ type: "shot", angle, power, followDraw });
          }}
          onPlaceCue={(x, y) => {
            local.submit({ type: "place-cue", x, y });
          }}
        />
        {state.finished ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
            <div className="flex w-full max-w-xs flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
              <div className="text-center text-base font-semibold">
                {state.variant === "practice" ? (
                  <Trans>清台完成!</Trans>
                ) : snapshot.winnerSeat !== null ? (
                  <span>
                    {seatName(mode, snapshot.winnerSeat)} <Trans>获胜</Trans>
                  </span>
                ) : (
                  <Trans>对局结束</Trans>
                )}
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    <Trans>总杆数</Trans>
                  </span>
                  <span className="tabular-nums">{state.shotCount}</span>
                </div>
                {mode.kind !== "practice"
                  ? [0, 1].map((seat) => {
                      const tray = seatTray(state, seat);
                      return (
                        <div
                          key={seat}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-muted-foreground">
                            {seatName(mode, seat)}
                          </span>
                          <span className="flex items-center gap-2">
                            {tray ? <BallTray state={state} ids={tray} /> : null}
                            <span className="text-muted-foreground tabular-nums">
                              <Trans>犯规 {state.foulCounts[seat] ?? 0}</Trans>
                            </span>
                          </span>
                        </div>
                      );
                    })
                  : null}
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

      <div
        className="flex items-center gap-3 border-t border-border px-3 py-2"
        style={{ paddingBottom: "calc(var(--safe-bottom, 0px) + 0.5rem)" }}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(followDraw)}
          onValueChange={(value) => {
            if (value) setFollowDraw(Number(value));
          }}
        >
          <ToggleGroupItem value="-0.7">
            <Trans>拉杆</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="0">
            <Trans>中杆</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="0.7">
            <Trans>推杆</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {powerPercent > 0 ? (
            <>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${powerPercent}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {powerPercent}%
              </span>
            </>
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {activeIsLocal && !ballInHand ? (
                <Trans>按住桌面向母球后方拖动蓄力,松手击球</Trans>
              ) : null}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
