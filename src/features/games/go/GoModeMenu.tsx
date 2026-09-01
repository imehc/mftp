/** 模式选择菜单：棋盘大小、人机设置、同屏对战、联机、历史记录。 */
import { useState } from "react";
import { Plural, Trans } from "@lingui/react/macro";
import { Bot, Radio, Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { Difficulty } from "../engine/ai";
import { useGameHistory, useGamesHistoryStore } from "../engine/history";
import type { SeatIndex } from "../engine/types";
import { formatHistoryTime, historyModeLabel, historyResult } from "./labels";
import {
  BOARD_SIZES,
  DEFAULT_BOARD_SIZE,
  GO_GAME_ID,
  type BoardSize,
  type GoHistoryPayload,
  type GoMode,
} from "./types";
export function GoModeMenu({ onStart }: { onStart: (mode: GoMode) => void }) {
  const [boardSize, setBoardSize] = useState<BoardSize>(DEFAULT_BOARD_SIZE);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [aiSeat, setAiSeat] = useState<SeatIndex>(0);
  const records = useGameHistory<GoHistoryPayload>(GO_GAME_ID);
  const clearGame = useGamesHistoryStore((s) => s.clearGame);
  return (
    <div className="flex flex-1 justify-center overflow-auto p-3">
      <div className="flex w-full max-w-sm flex-col gap-2 self-center">
        <div className="border-border flex flex-col gap-2 rounded-md border p-2.5">
          <span className="text-sm font-medium">
            <Trans>棋盘大小</Trans>
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(boardSize)}
            onValueChange={(value) => {
              if (value) setBoardSize(Number(value) as BoardSize);
            }}
            className="w-full"
          >
            {BOARD_SIZES.map((size) => (
              <ToggleGroupItem
                key={size}
                value={String(size)}
                className="flex-1"
              >
                {size} × {size}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="border-border flex flex-col gap-2 rounded-md border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Bot className="size-4" />
              <Trans>人机对战</Trans>
            </span>
            <Button
              size="xs"
              onClick={() =>
                onStart({
                  kind: "ai",
                  difficulty,
                  localSeat: aiSeat,
                  boardSize,
                })
              }
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
          onClick={() =>
            onStart({
              kind: "hotseat",
              boardSize,
            })
          }
        >
          <span className="flex items-center gap-2">
            <Users className="size-4" />
            <Trans>双人对战</Trans>
          </span>
          <span className="text-muted-foreground text-xs font-normal">
            <Trans>同屏轮流</Trans>
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="justify-between"
          onClick={() =>
            onStart({
              kind: "online",
              boardSize,
            })
          }
        >
          <span className="flex items-center gap-2">
            <Radio className="size-4" />
            <Trans>联机对战</Trans>
          </span>
          <span className="text-muted-foreground text-xs font-normal">
            <Trans>局域网</Trans>
          </span>
        </Button>
        {records.length > 0 ? (
          <div className="border-border flex flex-col gap-1 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">
                <Trans>历史记录</Trans>
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => clearGame(GO_GAME_ID)}
              >
                <Trans>清空</Trans>
              </Button>
            </div>
            <ul className="flex max-h-44 flex-col gap-1 overflow-auto text-xs">
              {records.slice(0, 12).map((record) => (
                <li key={record.id} className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground text-left tabular-nums">
                    {formatHistoryTime(record.finishedAt)}
                  </span>
                  <span className="min-w-0 truncate text-center">
                    {historyModeLabel(record.payload)}
                    {" · "}
                    {record.payload.boardSize} × {record.payload.boardSize}
                  </span>
                  <span className="text-muted-foreground text-right">
                    {historyResult(record.payload)}
                    {" · "}
                    <Plural
                      value={{
                        moveCount: record.payload.moves,
                      }}
                      one="# 手"
                      other="# 手"
                    />
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
