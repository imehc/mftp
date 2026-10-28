import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

import {
  type GameHistoryRecord,
  useGameHistory,
  useGamesHistoryStore,
} from "./history";

interface HistoryCells {
  details: ReactNode;
  result: ReactNode;
}

/** 台球与其他小游戏共用时间、模式和结果三列，窄容器将模式移到第二行。 */
export function GameHistoryList<P>({
  records,
  renderRecord,
}: {
  records: GameHistoryRecord<P>[];
  renderRecord(payload: P): HistoryCells;
}) {
  const { i18n } = useLingui();
  const formatter = new Intl.DateTimeFormat(i18n.locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <ul className="@container flex flex-col gap-2 text-xs @lg:gap-1">
      {records.map((record) => {
        const { details, result } = renderRecord(record.payload);
        return (
          <li
            key={record.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 @lg:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <time
              dateTime={new Date(record.finishedAt).toISOString()}
              className="text-muted-foreground col-start-1 row-start-1 whitespace-nowrap tabular-nums"
            >
              {formatter.format(record.finishedAt)}
            </time>
            <span className="col-span-2 row-start-2 min-w-0 wrap-anywhere @lg:col-span-1 @lg:col-start-2 @lg:row-start-1 @lg:text-center">
              {details}
            </span>
            <span className="text-muted-foreground col-start-2 row-start-1 min-w-0 text-right wrap-anywhere tabular-nums @lg:col-start-3">
              {result}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GameHistoryClearButton({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const clearGame = useGamesHistoryStore((state) => state.clearGame);
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Trans comment="清除此小游戏在本机保存的全部完成记录">清空</Trans>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>清空历史记录？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>此游戏在本机的历史记录将被清空，无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => clearGame(gameId)}>
              <Trans comment="确认清空此小游戏的历史记录">确认</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function GameHistoryPanel<P>({
  gameId,
  renderRecord,
}: {
  gameId: string;
  renderRecord(payload: P): HistoryCells;
}) {
  const records = useGameHistory<P>(gameId);
  if (!records.length) return null;
  return (
    <section className="border-border @container flex min-w-0 flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-medium">
          <Trans>历史记录</Trans>
        </h2>
        <GameHistoryClearButton gameId={gameId} />
      </div>
      <div className="max-h-44 overflow-auto overscroll-contain">
        <GameHistoryList
          records={records.slice(0, 12)}
          renderRecord={renderRecord}
        />
      </div>
    </section>
  );
}
