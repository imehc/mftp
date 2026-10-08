import { Trans, useLingui } from "@lingui/react/macro";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";
import type { ViewerState } from "../runtime/session";

export function ImportStatus({
  state,
  onCancel,
  onAttach,
}: {
  state: ViewerState;
  onCancel: () => void;
  onAttach: (key: string) => void;
}) {
  const { t } = useLingui();
  const { progress, error, missing, cancelling } = state;
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            <Trans>模型导入失败</Trans>
          </AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      ) : null}
      {progress || cancelling ? (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <div
              role="status"
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              <Spinner
                aria-hidden="true"
                className="motion-reduce:animate-none"
              />
              <span>
                {cancelling ? (
                  <Trans>正在取消并释放资源</Trans>
                ) : progress?.phase === "reading" ? (
                  <Trans>正在读取模型资源</Trans>
                ) : progress?.phase === "decoding" ? (
                  <Trans>正在解析模型</Trans>
                ) : (
                  <Trans>正在准备 3D 显示</Trans>
                )}
              </span>
            </div>
            <Button
              density="adaptive"
              variant="outline"
              disabled={cancelling}
              onClick={onCancel}
            >
              <Trans comment="停止本次模型导入，保留当前已打开模型。">
                取消导入
              </Trans>
            </Button>
          </div>
          {progress?.name ? (
            <p className="text-muted-foreground truncate text-xs">
              {progress.name}
            </p>
          ) : null}
          {progress?.total !== undefined && progress.total > 0 ? (
            <Progress
              aria-label={t({
                message: "当前文件读取进度",
                comment: "模型导入时当前资源文件的字节读取进度。",
              })}
              value={((progress.loaded ?? 0) / progress.total) * 100}
            />
          ) : null}
        </div>
      ) : null}
      {missing.length ? (
        <Alert>
          <AlertTitle>
            <Trans>需要补充依赖文件</Trans>
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p className="font-medium break-all">
              {state.items.find((item) => item.id === state.awaitingId)?.name}
            </p>
            <p>
              <Trans>
                请为下列路径选择对应文件。文件名相同但目录不同时，请确认每一项。
              </Trans>
            </p>
            <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
              {missing.map((key) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 font-mono text-xs break-all">
                    {key}
                  </span>
                  <Button
                    density="adaptive"
                    variant="outline"
                    onClick={() => onAttach(key)}
                    aria-label={t({
                      message: `补充文件：${key}`,
                      comment:
                        "为模型缺少的资源选择本地文件；key 是模型内的完整相对路径。",
                    })}
                  >
                    <Trans comment="为列表中指定的模型资源路径选择文件。">
                      补充文件
                    </Trans>
                  </Button>
                </li>
              ))}
            </ul>
            <Button density="adaptive" variant="outline" onClick={onCancel}>
              <Trans comment="停止本次模型导入，保留当前已打开模型。">
                取消导入
              </Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
