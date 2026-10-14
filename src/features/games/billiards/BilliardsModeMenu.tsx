/** 模式选择菜单：练习、人机设置、同屏对战，以及历史记录。 */
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, Play, Target, Users } from "lucide-react";
import { useState } from "react";

import AppPageContent from "~/components/AppPageContent";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import type { Difficulty } from "../engine/ai";
import { GameSelect } from "../engine/BoardModeMenu";
import { useGameHistory, useGamesHistoryStore } from "../engine/history";
import {
  BILLIARDS_GAME_ID,
  type BilliardsDiscipline,
  type BilliardsHistoryPayload,
  type BilliardsMode,
  type RedCount,
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
  discipline,
  onDisciplineChange,
  onStart,
}: {
  discipline: BilliardsDiscipline;
  onDisciplineChange(discipline: BilliardsDiscipline): void;
  onStart: (mode: BilliardsMode) => void;
}) {
  const { t } = useLingui();
  const [reds, setReds] = useState<RedCount>(15);
  const config =
    discipline === "snooker" ? ({ discipline, reds } as const) : { discipline };
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerBreaks, setPlayerBreaks] = useState(true);
  const records = useGameHistory<BilliardsHistoryPayload>(BILLIARDS_GAME_ID);
  const clearGame = useGamesHistoryStore((s) => s.clearGame);
  return (
    <AppPageContent bottomInset="scroll">
      <Field orientation="horizontal">
        <FieldLabel htmlFor="billiards-discipline">
          <Trans comment="台球开局菜单，选择中式八球、九球或斯诺克规则">
            玩法
          </Trans>
        </FieldLabel>
        <Select
          value={discipline}
          onValueChange={(value) =>
            onDisciplineChange(value as BilliardsDiscipline)
          }
        >
          <SelectTrigger id="billiards-discipline" wrapValue>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="eight-ball">
                <Trans>中式八球</Trans>
              </SelectItem>
              <SelectItem value="snooker">
                <Trans>斯诺克</Trans>
              </SelectItem>
              <SelectItem value="nine-ball">
                <Trans>美式九球</Trans>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {discipline === "snooker" ? (
        <GameSelect
          label={<Trans>红球数</Trans>}
          value={String(reds)}
          onChange={(value) => setReds(Number(value) as RedCount)}
          options={[
            { value: "6", label: t`六红球` },
            { value: "10", label: t`十红球变体` },
            { value: "15", label: t`十五红球` },
          ]}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">
            <Trans>人机对战</Trans>
          </h2>
          <GameSelect
            label={<Trans>难度</Trans>}
            value={difficulty}
            onChange={(value) => setDifficulty(value as Difficulty)}
            options={[
              { value: "easy", label: t`简单` },
              { value: "medium", label: t`中等` },
              { value: "hard", label: t`困难` },
            ]}
          />
          <GameSelect
            label={<Trans>先后手</Trans>}
            value={playerBreaks ? "me" : "ai"}
            onChange={(value) => setPlayerBreaks(value === "me")}
            options={[
              { value: "me", label: t`我先开球` },
              { value: "ai", label: t`AI 先开球` },
            ]}
          />
          <Button
            fullWidth
            className="md:w-fit md:self-start"
            onClick={() =>
              onStart({ kind: "ai", difficulty, playerBreaks, ...config })
            }
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
              onClick={() => onStart({ kind: item.kind, ...config })}
              className="hover:bg-accent focus-visible:ring-ring flex min-h-[max(44px,4rem)] w-full items-center gap-3 border-b text-left last:border-0 focus-visible:ring-2"
            >
              <item.icon className="text-muted-foreground size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.title}</span>
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
        <div className="border-border @container flex flex-col gap-2 rounded-xl border p-3">
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
          <ul className="flex max-h-44 flex-col gap-2 overflow-auto text-xs @lg:gap-1">
            {records.slice(0, 12).map((record) => (
              <li
                key={record.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 @lg:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <span className="text-muted-foreground col-start-1 row-start-1 text-left whitespace-nowrap tabular-nums">
                  {formatHistoryTime(record.finishedAt)}
                </span>
                <span className="col-span-2 row-start-2 min-w-0 @lg:col-span-1 @lg:col-start-2 @lg:row-start-1 @lg:text-center">
                  {record.payload.discipline === "snooker" ? (
                    <span>
                      <Trans>斯诺克</Trans>
                      {" · "}
                      {record.payload.reds === 6 ? (
                        <Trans>六红球</Trans>
                      ) : record.payload.reds === 10 ? (
                        <Trans>十红球变体</Trans>
                      ) : (
                        <Trans>十五红球</Trans>
                      )}
                    </span>
                  ) : record.payload.discipline === "nine-ball" ? (
                    <Trans>美式九球</Trans>
                  ) : (
                    <Trans>中式八球</Trans>
                  )}
                  {" · "}
                  {historyModeLabel(record.payload)}
                </span>
                <span className="text-muted-foreground col-start-2 row-start-1 min-w-0 text-right @lg:col-start-3">
                  {historyResult(record.payload)}
                  {record.payload.scores ? (
                    <span className="whitespace-nowrap tabular-nums">
                      {" · "}
                      {record.payload.scores.join(" : ")}
                    </span>
                  ) : null}
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
    </AppPageContent>
  );
}
