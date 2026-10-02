import { useId, useState, type ReactNode } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, Play, Users, Wifi } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { Difficulty } from "./ai";
import type { SeatIndex } from "./types";
import { useGameHistory, useGamesHistoryStore } from "./history";

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
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
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
      </Select>
    </div>
  );
}

/** 三种棋类共用模式骨架，游戏规则和历史文案仍由各模块提供。 */
export function BoardModeMenu<P extends { moves: number }>({
  gameId,
  red = false,
  options,
  onStart,
  historyMode,
  historyResult,
}: {
  gameId: string;
  red?: boolean;
  options?: ReactNode;
  onStart: (mode: BoardMode) => void;
  historyMode: (payload: P) => ReactNode;
  historyResult: (payload: P) => ReactNode;
}) {
  const { t, i18n } = useLingui();
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [localSeat, setLocalSeat] = useState<SeatIndex>(0);
  const records = useGameHistory<P>(gameId);
  const clear = useGamesHistoryStore((s) => s.clearGame);
  return (
    <div className="app-scroll-safe-end min-h-0 flex-1 overflow-auto px-3 pt-3 md:px-4 md:pt-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
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
              value={String(localSeat)}
              onChange={(value) => setLocalSeat(Number(value) as SeatIndex)}
              options={[
                { value: "0", label: red ? t`先手（执红）` : t`先手（执黑）` },
                { value: "1", label: red ? t`后手（执黑）` : t`后手（执白）` },
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
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </button>
            ))}
          </section>
        </div>
        <section className="rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              <Trans>历史记录</Trans>
            </h2>
            {records.length ? (
              <Button
                variant="ghost"
                size="sm"
                density="adaptive"
                onClick={() => clear(gameId)}
              >
                <Trans comment="清除此游戏在本机保存的对局记录">清空</Trans>
              </Button>
            ) : null}
          </div>
          {records.length ? (
            <ul className="mt-2 divide-y">
              {records.slice(0, 12).map((record) => (
                <li
                  key={record.id}
                  className="flex min-w-0 items-center justify-between gap-3 py-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {historyMode(record.payload)}
                    </div>
                    <time
                      className="text-muted-foreground mt-1 block tabular-nums"
                      dateTime={new Date(record.finishedAt).toISOString()}
                    >
                      {new Intl.DateTimeFormat(i18n.locale, {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(record.finishedAt)}
                    </time>
                  </div>
                  <span className="shrink-0 text-right">
                    {historyResult(record.payload)} ·{" "}
                    <Plural
                      value={{ moveCount: record.payload.moves }}
                      one="# 手"
                      other="# 手"
                    />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              <Trans>暂无对局记录</Trans>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
