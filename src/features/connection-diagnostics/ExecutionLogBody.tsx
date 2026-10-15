import { Trans, useLingui } from "@lingui/react/macro";

import type { DiagnosticText } from "~/bindings";

export function ExecutionLogBody({ body }: { body: DiagnosticText }) {
  const { t, i18n } = useLingui();
  const captured = i18n.number(body.capturedBytes);
  const received = i18n.number(body.receivedBytes);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        <Trans comment="执行日志正文的捕获字节数与实际读取字节数，均已按语言格式化">
          已捕获 {captured} / 已读取 {received} 字节
        </Trans>
        {body.redacted ? (
          <>
            {" "}
            · <Trans>凭据已脱敏</Trans>
          </>
        ) : null}
        {body.truncated ? (
          <>
            {" "}
            · <Trans>内容已截断</Trans>
          </>
        ) : null}
        {body.encoding === "hex" ? (
          <>
            {" "}
            · <Trans>原始字节（十六进制）</Trans>
          </>
        ) : null}
        {body.end === "interrupted" ? (
          <>
            {" "}
            · <Trans>读取未完成</Trans>
          </>
        ) : null}
        {body.end === "protocolEnd" ? (
          <>
            {" "}
            · <Trans>捕获至协议结束事件</Trans>
          </>
        ) : null}
      </p>
      <pre className="bg-muted min-w-0 rounded-lg p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {body.text || (body.end === "receiving" ? t`等待接收正文` : t`空正文`)}
      </pre>
    </div>
  );
}
