import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, Play, Users, Wifi } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import AppPageContent from "~/components/AppPageContent";
import FixedSelect from "~/components/FixedSelect";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import type { Difficulty } from "./ai";
import { GameHistoryPanel } from "./GameHistory";
import type { SeatIndex } from "./types";

export type BoardMode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: SeatIndex }
  | { kind: "hotseat" | "online" };

export function GameSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
}) {
  const id = useId();
  return (
    <Field orientation="choice">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FixedSelect value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </FixedSelect>
    </Field>
  );
}

/** 棋类共用模式骨架，游戏规则和历史文案仍由各模块提供。 */
export function BoardModeMenu<P extends { moves: number }>({
  gameId,
  red = false,
  options,
  onStart,
  historyMode,
  historyResult,
  allowOnline = true,
  allowHotseat = true,
  setup,
  seatLabels,
}: {
  gameId: string;
  red?: boolean;
  options?: ReactNode;
  onStart: (mode: BoardMode) => void;
  historyMode: (payload: P) => ReactNode;
  historyResult: (payload: P) => ReactNode;
  allowOnline?: boolean;
  allowHotseat?: boolean;
  setup?: ReactNode;
  seatLabels?: [ReactNode, ReactNode];
}) {
  const { t } = useLingui();
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [localSeat, setLocalSeat] = useState<SeatIndex>(0);
  return (
    <AppPageContent bottomInset="scroll">
      {setup}
      <div
        className={`grid grid-cols-1 gap-3 ${allowOnline || allowHotseat ? "md:grid-cols-2" : ""}`}
      >
        <section className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
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
            value={String(localSeat)}
            onChange={(value) => setLocalSeat(Number(value) as SeatIndex)}
            options={[
              {
                value: "0",
                label:
                  seatLabels?.[0] ?? (red ? t`先手（执红）` : t`先手（执黑）`),
              },
              {
                value: "1",
                label:
                  seatLabels?.[1] ?? (red ? t`后手（执黑）` : t`后手（执白）`),
              },
            ]}
          />
          {options}
          <Button
            fullWidth
            className="md:w-fit md:self-start"
            onClick={() => onStart({ kind: "ai", difficulty, localSeat })}
          >
            <Play />
            <Trans>开始对局</Trans>
          </Button>
        </section>
        {allowOnline || allowHotseat ? (
          <section className="min-w-0 rounded-xl border p-4">
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
                kind: "online" as const,
                icon: Wifi,
                title: t`局域网联机`,
                description: t`创建或加入房间`,
              },
            ]
              .filter((item) =>
                item.kind === "online" ? allowOnline : allowHotseat,
              )
              .map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => onStart({ kind: item.kind })}
                  className="hover:bg-accent focus-visible:ring-ring flex min-h-[max(44px,4rem)] w-full items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:ring-2"
                >
                  <item.icon className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="app-description block">
                      {item.description}
                    </span>
                  </span>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </button>
              ))}
          </section>
        ) : null}
      </div>
      <GameHistoryPanel<P>
        gameId={gameId}
        renderRecord={(payload) => ({
          details: historyMode(payload),
          result: (
            <>
              {historyResult(payload)} ·{" "}
              <Plural
                value={{ moveCount: payload.moves }}
                one="# 手"
                other="# 手"
              />
            </>
          ),
        })}
      />
    </AppPageContent>
  );
}
