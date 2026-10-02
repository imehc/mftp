/** 模式选择菜单：练习、人机设置、同屏对战，以及历史记录。 */
import { useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, Play, Target, Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Label } from "~/components/ui/label";
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
  const { t } = useLingui();
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerBreaks, setPlayerBreaks] = useState(true);
  const records = useGameHistory<BilliardsHistoryPayload>(BILLIARDS_GAME_ID);
  const clearGame = useGamesHistoryStore((s) => s.clearGame);
  return (
    <div className="app-scroll-safe-end min-h-0 flex-1 overflow-auto px-3 pt-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-xl border p-4">
            <h2 className="text-sm font-semibold">
              <Trans>人机对战</Trans>
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="billiards-difficulty">
                <Trans>难度</Trans>
              </Label>
              <Select
                value={difficulty}
                onValueChange={(value) => setDifficulty(value as Difficulty)}
              >
                <SelectTrigger id="billiards-difficulty" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">
                    <Trans>简单</Trans>
                  </SelectItem>
                  <SelectItem value="medium">
                    <Trans>中等</Trans>
                  </SelectItem>
                  <SelectItem value="hard">
                    <Trans>困难</Trans>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billiards-break">
                <Trans>先后手</Trans>
              </Label>
              <Select
                value={playerBreaks ? "me" : "ai"}
                onValueChange={(value) => setPlayerBreaks(value === "me")}
              >
                <SelectTrigger id="billiards-break" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">
                    <Trans>我先开球</Trans>
                  </SelectItem>
                  <SelectItem value="ai">
                    <Trans>AI 先开球</Trans>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              fullWidth
              className="md:w-fit md:self-start"
              onClick={() => onStart({ kind: "ai", difficulty, playerBreaks })}
            >
              <Play />
              <Trans>开始对局</Trans>
            </Button>
          </section>
          <section className="rounded-xl border p-4">
            <h2 className="mb-2 text-sm font-semibold">
              <Trans>其他方式</Trans>
            </h2>
            {[
              {
                kind: "hotseat" as const,
                icon: Users,
                title: t`双人对战`,
                description: t`同屏轮流`,
              },
              {
                kind: "practice" as const,
                icon: Target,
                title: t`练习模式`,
                description: t`自由清台`,
              },
            ].map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => onStart({ kind: item.kind })}
                className="hover:bg-accent focus-visible:ring-ring flex min-h-[max(44px,4rem)] w-full items-center gap-3 border-b text-left last:border-0 focus-visible:ring-2"
              >
                <item.icon className="text-muted-foreground size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {item.description}
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4" />
              </button>
            ))}
          </section>
        </div>
        {records.length > 0 ? (
          <div className="border-border flex flex-col gap-2 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">
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
                <li key={record.id} className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground shrink-0 text-left tabular-nums">
                    {formatHistoryTime(record.finishedAt)}
                  </span>
                  <span className="min-w-0 truncate text-center">
                    {historyModeLabel(record.payload)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-right">
                    {historyResult(record.payload)}
                    {" · "}
                    <Plural
                      value={{
                        shotCount: record.payload.shots,
                      }}
                      one="# 杆"
                      other="# 杆"
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
