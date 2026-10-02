import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Activity, ChevronRight } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useTransfersStore } from "~/store/transfers";
import { describeError } from "~/lib/errors";

/** 首页只读运行期摘要，任务动作和完整记录由活动面板/日志承接。 */
export default function HomeRecentActivity() {
  const { t } = useLingui();
  const transfers = useTransfersStore((state) => state.transfers);
  const runtimeError = useTransfersStore((state) => state.runtimeError);
  const recent = [...transfers]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
  const status = {
    running: t`进行中`,
    success: t`已完成`,
    error: t`失败`,
    cancelled: t`已取消`,
  };
  return (
    <section className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          <Trans>最近活动</Trans>
        </h2>
        <Button variant="ghost" density="adaptive" asChild>
          <Link to="/logs">
            <Trans>查看日志</Trans>
            <ChevronRight />
          </Link>
        </Button>
      </div>
      {runtimeError ? (
        <p role="alert" className="text-destructive text-sm">
          {describeError(runtimeError)}
        </p>
      ) : null}
      {recent.length ? (
        recent.map((item) => (
          <div
            key={item.id}
            className="flex min-h-14 items-center gap-3 border-t py-2"
          >
            <Activity
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
            <span
              className="min-w-0 flex-1 truncate text-sm"
              title={item.label}
            >
              {item.label}
            </span>
            <Badge
              variant={item.status === "error" ? "destructive" : "secondary"}
            >
              {status[item.status]}
            </Badge>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground py-2 text-sm">
          <Trans>暂无传输活动</Trans>
        </p>
      )}
    </section>
  );
}
