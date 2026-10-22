import { Trans, useLingui } from "@lingui/react/macro";
import { CircleHelp, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { McpSnapshot } from "~/bindings";
import { CopyButton } from "~/components/CopyButton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";

export default function McpServiceBar({
  snapshot,
  busy,
  pending,
  loading,
  readFailed,
  onConfigure,
  onStart,
  onStop,
  onRefresh,
  config,
  onCopyError,
  onHelp,
}: {
  snapshot: McpSnapshot | null;
  busy: boolean;
  pending: string | null;
  loading: boolean;
  readFailed: boolean;
  onConfigure: (port: number) => Promise<boolean>;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  config: string;
  onCopyError: (error: unknown) => void;
  onHelp: () => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<{ base: number; value: string } | null>(
    null,
  );
  const port = snapshot
    ? draft?.base === snapshot.port
      ? draft.value
      : String(snapshot.port)
    : "";
  const changed = !!snapshot && port !== String(snapshot.port);
  const valid =
    /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535;
  const disabled = busy || loading || readFailed || !snapshot;
  const address = snapshot ? `127.0.0.1:${snapshot.port}/mcp` : "—";
  const status = loading
    ? t`正在读取`
    : readFailed
      ? t`状态不可用`
      : pending === "start"
        ? t`正在启动`
        : pending === "stop" || snapshot?.stopping
          ? t`正在停止`
          : snapshot?.running
            ? t`运行中`
            : t`已关闭`;

  async function savePort() {
    if (valid && changed && (await onConfigure(Number(port)))) setDraft(null);
  }

  return (
    <section
      aria-labelledby="mcp-service-heading"
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3"
    >
      <div className="flex items-center gap-2">
        <h2 id="mcp-service-heading" className="text-sm font-semibold">
          <Trans>本机服务</Trans>
        </h2>
        <Badge variant="secondary" role="status">
          {pending === "start" || pending === "stop" || loading ? (
            <Spinner />
          ) : null}
          {status}
        </Badge>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void savePort();
        }}
      >
        <Label htmlFor="mcp-port" className="shrink-0 text-xs">
          <Trans comment="MCP HTTP 服务监听端口">端口</Trans>
        </Label>
        <Input
          id="mcp-port"
          type="text"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={5}
          value={port}
          disabled={disabled || !!snapshot?.running || !!snapshot?.stopping}
          onChange={(event) => {
            if (snapshot)
              setDraft({ base: snapshot.port, value: event.target.value });
          }}
          aria-label={t`监听端口，范围 1024 至 65535`}
          className="w-20 font-mono"
        />
        {changed ? (
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={disabled || !valid}
          >
            <Trans>保存端口</Trans>
          </Button>
        ) : null}
      </form>
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-1">
        <code className="min-w-0 text-xs break-all">{address}</code>
        <CopyButton
          variant="ghost"
          size="icon-sm"
          disabled={!snapshot}
          value={config}
          label={t`复制连接配置模板`}
          onError={onCopyError}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={snapshot?.running ? "outline" : "default"}
          disabled={
            disabled || !!snapshot?.stopping || (!snapshot?.running && changed)
          }
          onClick={snapshot?.running ? onStop : onStart}
        >
          {snapshot?.running ? t`停止服务` : t`启动服务`}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={onRefresh}
          aria-label={readFailed ? t`重新读取 MCP 设置` : t`刷新 MCP 状态`}
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onHelp}
          aria-label={t`MCP 服务帮助`}
        >
          <CircleHelp />
        </Button>
      </div>
    </section>
  );
}
