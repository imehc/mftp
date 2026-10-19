import { Trans, useLingui } from "@lingui/react/macro";
import { Check, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import type { AppDataResetStep } from "~/bindings";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";

import {
  inspectReset,
  returnFromRejectedReset,
  startReset,
  useResetStore,
} from "./reset-runtime";

export default function ResetBoundary({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const root = useRef<HTMLElement>(null);
  const { phase, progress, errors, failures, canReturn } = useResetStore();
  useEffect(() => {
    void inspectReset();
  }, []);
  useEffect(() => {
    if (phase !== "idle") root.current?.focus();
  }, [phase]);
  if (phase === "idle") return children;
  const busy = phase === "checking" || phase === "running";
  const finished = phase === "finished";
  const labels: Record<AppDataResetStep, string> = {
    poetry: t`诗词库与临时文件`,
    bt: t`BT 内部数据`,
    credentials: t`AI 密钥`,
    translation: t`离线翻译模型`,
  };
  return (
    <div className="app-shell">
      <main
        ref={root}
        tabIndex={-1}
        aria-labelledby="reset-title"
        className="ui-density-adaptive flex h-full overflow-y-auto p-4"
      >
        <Empty className="m-auto max-w-lg">
          <EmptyHeader>
            <EmptyMedia variant="icon" aria-hidden>
              {busy ? (
                <Spinner className="motion-reduce:animate-none" />
              ) : finished ? (
                <Check />
              ) : (
                <RotateCcw />
              )}
            </EmptyMedia>
            <EmptyTitle id="reset-title" role="status" aria-live="polite">
              {phase === "checking"
                ? t`正在检查重置状态`
                : phase === "running"
                  ? t`正在清理应用数据`
                  : finished
                    ? t`应用重置已完成`
                    : progress
                      ? t`应用重置尚未完成`
                      : t`暂时无法完成重置`}
            </EmptyTitle>
            <EmptyDescription>
              {phase === "checking"
                ? t`正在读取此设备的重置记录。`
                : phase === "running"
                  ? t`请稍候，清理结果将保存在此设备上。`
                  : finished
                    ? t`重新打开应用后使用新的初始状态。`
                    : progress
                      ? t`应用记录已清空。继续清理剩余内容后即可重新使用应用；下载和共享目录中的文件会保留。`
                      : t`请检查重置状态后再继续，避免重复清理。`}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {progress ? (
              <div className="flex w-full flex-col gap-2 text-left">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <Trans>应用记录</Trans>
                  </span>
                  <Badge variant="secondary">
                    <Trans comment="重置恢复页面，表示该阶段已经完成清理">
                      已清理
                    </Trans>
                  </Badge>
                </div>
                {(Object.keys(labels) as AppDataResetStep[]).map((step) => (
                  <div
                    key={step}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{labels[step]}</span>
                    <Badge
                      variant={
                        progress.pending.includes(step)
                          ? "outline"
                          : "secondary"
                      }
                    >
                      {progress.pending.includes(step)
                        ? t({
                            message: "待处理",
                            comment: "重置尚未清理完成的阶段",
                          })
                        : t({
                            message: "已清理",
                            comment: "重置恢复页面，表示该阶段已经完成清理",
                          })}
                    </Badge>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <Trans>本地偏好与启动设置</Trans>
                  </span>
                  <Badge variant={finished ? "secondary" : "outline"}>
                    {finished ? t`已完成` : t`待处理`}
                  </Badge>
                </div>
              </div>
            ) : null}
            {failures.map(({ step, error }) => (
              <Alert key={step} variant="destructive">
                <AlertDescription className="text-left wrap-anywhere">
                  {labels[step]}：{describeError(error, t)}
                </AlertDescription>
              </Alert>
            ))}
            {errors.map((error, i) => (
              <Alert key={i} variant="destructive">
                <AlertDescription className="text-left wrap-anywhere">
                  {describeError(error, t)}
                </AlertDescription>
              </Alert>
            ))}
            {!busy ? (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {finished ? (
                  <Button onClick={() => window.location.assign("/")}>
                    <Trans>重新打开应用</Trans>
                  </Button>
                ) : (
                  <>
                    {progress ? (
                      <Button onClick={() => void startReset(true)}>
                        <Trans comment="仅继续当前重置中未完成的清理，不再次清空主数据库">
                          继续完成重置
                        </Trans>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={() => void inspectReset()}
                    >
                      <Trans>检查状态</Trans>
                    </Button>
                    {canReturn ? (
                      <Button
                        variant="outline"
                        onClick={returnFromRejectedReset}
                      >
                        <Trans>返回应用</Trans>
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </EmptyContent>
        </Empty>
      </main>
    </div>
  );
}
