/** 模式选择菜单：练习、人机设置、同屏对战，以及历史记录。 */
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, Play, Target, Users } from "lucide-react";
import { useState } from "react";

import AppPageContent from "~/components/AppPageContent";
import { Button } from "~/components/ui/button";

import type { Difficulty } from "../engine/ai";
import { GameSelect } from "../engine/BoardModeMenu";
import { GameHistoryPanel } from "../engine/GameHistory";
import { GameSetupSelect } from "../engine/GameSetupSelect";
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
      <Trans>电脑</Trans>
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
  return (
    <AppPageContent bottomInset="scroll">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <GameSetupSelect
          label={
            <Trans comment="台球开局菜单，选择中式八球、九球或斯诺克规则">
              玩法
            </Trans>
          }
          value={discipline}
          onChange={(value) => onDisciplineChange(value as BilliardsDiscipline)}
          options={[
            { value: "eight-ball", label: t`中式八球` },
            { value: "snooker", label: t`斯诺克` },
            { value: "nine-ball", label: t`美式九球` },
          ]}
        />
        {discipline === "snooker" ? (
          <GameSetupSelect
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
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">
            <Trans>电脑对战</Trans>
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
              { value: "ai", label: t`电脑先开球` },
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
              className="hover:bg-accent focus-visible:ring-ring flex min-h-[max(44px,4rem)] w-full items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:ring-2"
            >
              <item.icon className="text-muted-foreground size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="text-muted-foreground block text-xs">
                  {item.description}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </button>
          ))}
        </section>
      </div>
      <GameHistoryPanel<BilliardsHistoryPayload>
        gameId={BILLIARDS_GAME_ID}
        renderRecord={(payload) => ({
          details: (
            <>
              {payload.discipline === "snooker" ? (
                <span>
                  <Trans>斯诺克</Trans>
                  {" · "}
                  {payload.reds === 6 ? (
                    <Trans>六红球</Trans>
                  ) : payload.reds === 10 ? (
                    <Trans>十红球变体</Trans>
                  ) : (
                    <Trans>十五红球</Trans>
                  )}
                </span>
              ) : payload.discipline === "nine-ball" ? (
                <Trans>美式九球</Trans>
              ) : (
                <Trans>中式八球</Trans>
              )}
              {" · "}
              {historyModeLabel(payload)}
            </>
          ),
          result: (
            <>
              {historyResult(payload)}
              {payload.scores ? (
                <span className="whitespace-nowrap tabular-nums">
                  {" · "}
                  {payload.scores.join(" : ")}
                </span>
              ) : null}
              {" · "}
              <Plural
                value={{ shotCount: payload.shots }}
                one="# 杆"
                other="# 杆"
              />
            </>
          ),
        })}
      />
    </AppPageContent>
  );
}
