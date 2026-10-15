import { Trans, useLingui } from "@lingui/react/macro";

import type { DiagnosticDetail } from "~/bindings";

import { ExecutionLogBody } from "./ExecutionLogBody";

export default function ExecutionCommandDetails({
  detail,
}: {
  detail: Extract<DiagnosticDetail, { kind: "command" }>;
}) {
  const { i18n } = useLingui();
  const { exitStatus, exitSignal } = detail;
  const bytes = i18n.number(detail.stdout.receivedBytes);
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-medium">
        <Trans>实际执行命令</Trans>
      </h4>
      <ExecutionLogBody body={detail.command} />
      <h5 className="text-xs font-medium">
        <Trans comment="SSH 命令的标准输出流">标准输出（stdout）</Trans>
      </h5>
      {detail.stdoutCaptured ? (
        <ExecutionLogBody body={detail.stdout} />
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans comment="打包下载命令的标准输出属于文件载荷，仅显示实际读取字节数">
            文件载荷未采集 · 已读取 {bytes} 字节
          </Trans>
        </p>
      )}
      <h5 className="text-xs font-medium">
        <Trans comment="SSH 命令的标准错误流">标准错误（stderr）</Trans>
      </h5>
      <ExecutionLogBody body={detail.stderr} />
      {detail.exitStatus !== null ? (
        <p className="text-xs">
          <Trans comment="远端 SSH 命令原样返回的数字退出码">
            退出码：{exitStatus}
          </Trans>
        </p>
      ) : null}
      {detail.exitSignal !== null ? (
        <p className="text-xs break-all">
          <Trans comment="远端 SSH 命令退出信号名称，名称不翻译">
            退出信号：{exitSignal}
          </Trans>
        </p>
      ) : null}
    </section>
  );
}
