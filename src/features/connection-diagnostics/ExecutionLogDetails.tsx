import { Trans, useLingui } from "@lingui/react/macro";

import type { DiagnosticDetail, DiagnosticText } from "~/bindings";

import ExecutionCommandDetails from "./ExecutionCommandDetails";
import { ExecutionLogBody } from "./ExecutionLogBody";

export default function ExecutionLogDetails({
  details,
  trace,
}: {
  details: DiagnosticDetail[];
  trace: DiagnosticText | null;
}) {
  const { t } = useLingui();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {details.length === 0 && !trace ? (
        <p className="text-muted-foreground text-xs">
          <Trans>尚未发送外部请求。</Trans>
        </p>
      ) : null}
      {trace ? (
        <section className="flex min-w-0 flex-col gap-2">
          <h4 className="text-sm font-medium">
            <Trans comment="SSH/SFTP 实际 SDK 调用记录，不是网络抓包">
              协议调用（库边界）
            </Trans>
          </h4>
          <p className="text-muted-foreground text-xs">
            <Trans>
              记录实际库调用及其返回；网络报文、终端输入输出和文件内容未采集。高频文件读写按次数、字节数和偏移汇总。
            </Trans>
          </p>
          <ExecutionLogBody body={trace} />
        </section>
      ) : null}
      {details.map((detail, index) =>
        detail.kind === "command" ? (
          <ExecutionCommandDetails key={index} detail={detail} />
        ) : (
          <section key={index} className="flex min-w-0 flex-col gap-2">
            <h4 className="text-sm font-medium">
              {detail.kind === "httpRequest" ? (
                <Trans>实际请求</Trans>
              ) : detail.kind === "httpResponse" ? (
                <Trans>原始响应</Trans>
              ) : (
                <Trans>传输原始错误</Trans>
              )}
            </h4>
            {detail.kind === "httpRequest" ? (
              <>
                <p className="font-mono text-xs break-all">
                  {detail.method} {detail.url}
                </p>
                <p className="text-muted-foreground text-xs">
                  <Trans>
                    请求构造完成时采集；传输层自动添加的请求头未采集。
                  </Trans>
                </p>
              </>
            ) : null}
            {detail.kind === "httpResponse" ? (
              <p className="font-mono text-xs">HTTP {detail.status}</p>
            ) : null}
            {detail.kind !== "transportError" ? (
              <>
                <pre className="bg-muted min-w-0 rounded-lg p-3 font-mono text-xs break-all whitespace-pre-wrap">
                  {detail.headers
                    .map(
                      (header) =>
                        `${header.name}: ${header.value}${header.encoding === "hex" ? ` (${t`十六进制`})` : ""}${header.redacted ? ` (${t`凭据已脱敏`})` : ""}`,
                    )
                    .join("\n")}
                </pre>
                {detail.headersTruncated ? (
                  <p className="text-muted-foreground text-xs">
                    <Trans>部分响应头或请求头超出记录上限。</Trans>
                  </p>
                ) : null}
              </>
            ) : null}
            <ExecutionLogBody body={detail.body} />
          </section>
        ),
      )}
    </div>
  );
}
