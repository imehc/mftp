import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

import type { DiagnosticOperation } from "~/bindings";

export default function ExecutionLogMetadata({
  operation,
}: {
  operation: DiagnosticOperation;
}) {
  const { t, i18n } = useLingui();
  const bodies = [
    ...(operation.trace
      ? [
          {
            label: t(
              msg({
                comment: "日志元信息里的 SDK 库边界调用记录字节统计",
                message: "协议调用",
              }),
            ),
            body: operation.trace,
          },
        ]
      : []),
    ...operation.details.flatMap((detail) =>
      detail.kind === "command"
        ? [
            {
              label: t(
                msg({
                  comment: "日志元信息里的 SSH 命令字节统计",
                  message: "命令",
                }),
              ),
              body: detail.command,
            },
            { label: "stdout", body: detail.stdout },
            { label: "stderr", body: detail.stderr },
          ]
        : [
            {
              label:
                detail.kind === "httpRequest"
                  ? t(
                      msg({
                        comment: "日志元信息里的 HTTP 请求正文字节统计",
                        message: "请求",
                      }),
                    )
                  : detail.kind === "httpResponse"
                    ? t(
                        msg({
                          comment: "日志元信息里的 HTTP 响应正文字节统计",
                          message: "响应",
                        }),
                      )
                    : t(
                        msg({
                          comment: "日志元信息里的原始传输错误字节统计",
                          message: "传输原始错误",
                        }),
                      ),
              body: detail.body,
            },
          ],
    ),
  ];
  return bodies.map(({ label, body }, index) => {
    const captured = i18n.number(body.capturedBytes);
    const received = i18n.number(body.receivedBytes);
    return (
      <div
        key={index}
        className="col-span-2 flex min-w-0 flex-wrap gap-x-2 gap-y-1"
      >
        <dt>{label}</dt>
        <dd>
          {t({
            comment:
              "日志元信息中的捕获/读取字节数，数字已本地化，不在正文常驻展示",
            message: `已捕获 ${captured} / 已读取 ${received} 字节`,
          })}
        </dd>
      </div>
    );
  });
}
