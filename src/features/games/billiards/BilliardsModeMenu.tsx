/** Mode selection menu: practice, vs-AI setup, hotseat, and history. */
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Bot, Target, Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { Difficulty } from "../engine/ai";
import { useGameHistory, useGamesHistoryStore } from "../engine/history";
import {
  BILLIARDS_GAME_ID,
  type BilliardsHistoryPayload,
  type BilliardsMode,
} from "./types";

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

export function BilliardsModeMenu({
  onStart,
}: {
  onStart: (mode: BilliardsMode) => void;
}) {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerBreaks, setPlayerBreaks] = useState(true);
  const records = useGameHistory<BilliardsHistoryPayload>(BILLIARDS_GAME_ID);
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
              onClick={() => onStart({ kind: "ai", difficulty, playerBreaks })}
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
            value={playerBreaks ? "me" : "ai"}
            onValueChange={(value) => {
              if (value) setPlayerBreaks(value === "me");
            }}
            className="w-full"
          >
            <ToggleGroupItem value="me" className="flex-1">
              <Trans>我先开</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="ai" className="flex-1">
              <Trans>AI 先开</Trans>
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
                onClick={() => clearGame(BILLIARDS_GAME_ID)}
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
