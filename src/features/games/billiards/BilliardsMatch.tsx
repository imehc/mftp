/**
 * Match wiring and view: builds the MatchRunner for the chosen mode and
 * renders the HUD (seat cells, ball trays, foul messages), the Pixi
 * stage, the result overlay, and the spin/power bottom bar.
 */
import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { AiController, LocalController } from "../engine/controllers";
import { useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import type { PlayerController } from "../engine/types";
import { billiardsAiStrategy } from "./ai";
import { BALL_HEX } from "./colors";
import { createBilliardsGame, createInitialState } from "./rules";
import {
  BilliardsStage,
  type BilliardsStageHandle,
} from "./render/BilliardsStage";
import {
  BILLIARDS_GAME_ID,
  type BilliardsHistoryPayload,
  type BilliardsMode,
  type BilliardsMove,
  type BilliardsPresentation,
  type BilliardsState,
  type FoulReason,
} from "./types";

interface Session {
  runner: MatchRunner<BilliardsState, BilliardsMove, BilliardsPresentation>;
  local: LocalController<BilliardsState, BilliardsMove>;
  stageRef: { current: BilliardsStageHandle | null };
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

export function BilliardsMatch({
  mode,
  onRematch,
  onExit,
}: {
  mode: BilliardsMode;
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
      createInitialState(
        variant,
        mode.kind === "ai" && !mode.playerBreaks ? 1 : 0,
      ),
      controllers,
      {
        onMoveResolved: async ({ seat, move, resolution }) => {
          if (move.type === "shot" && controllers[seat]?.kind === "ai") {
            await stageRef.current?.animateAiCue(move.angle, move.power);
          }
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
    // mode identity is stable per <BilliardsMatch key=...> instance.
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

function seatName(mode: BilliardsMode, seat: number) {
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
  mode: BilliardsMode;
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
  mode: BilliardsMode;
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
      gameId: BILLIARDS_GAME_ID,
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
