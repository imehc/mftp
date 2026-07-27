/** Mode selection menu: vs-AI setup, hotseat, online entry, and history. */
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Bot, Radio, Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { Difficulty } from "../engine/ai";
import { useGameHistory, useGamesHistoryStore } from "../engine/history";
import type { SeatIndex } from "../engine/types";
import { formatHistoryTime, historyModeLabel, historyResult } from "./labels";
import {
  GOMOKU_GAME_ID,
  type GomokuHistoryPayload,
  type GomokuMode,
} from "./types";

export function GomokuModeMenu({
  onStart,
}: {
  onStart: (mode: GomokuMode) => void;
}) {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [aiSeat, setAiSeat] = useState<SeatIndex>(0);
  const records = useGameHistory<GomokuHistoryPayload>(GOMOKU_GAME_ID);
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
              <Button
                variant="ghost"
                size="xs"
                onClick={() => clearGame(GOMOKU_GAME_ID)}
              >
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
