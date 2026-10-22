import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";
import type { AppError, RsyncCapabilities, RsyncToolStatus } from "~/types";

const INSTALL_COMMANDS = [
  "brew install rsync          # macOS",
  "sudo apt install rsync      # Debian / Ubuntu",
  "sudo dnf install rsync      # Fedora / RHEL",
].join("\n");

function needsInstall(status: RsyncToolStatus | undefined): boolean {
  return status?.status === "missing" || status?.status === "unsupported";
}

function available(status: RsyncToolStatus | undefined): boolean {
  return status?.status === "available";
}

function StatusRow({
  label,
  status,
}: {
  label: string;
  status: RsyncToolStatus;
}) {
  const { t } = useLingui();
  const summary =
    status.status === "missing"
      ? t`未找到 rsync`
      : status.status === "unsupported"
        ? t`版本不受支持（需要 3.1 或更高版本）`
        : status.status === "timeout"
          ? t`检测超时`
          : status.status === "failed"
            ? t`检测失败`
            : null;
  if (!summary) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-foreground font-medium">{label}</span>
      <span>{summary}</span>
      {status.version ? (
        <span className="font-mono">
          {status.version}
          {status.protocol ? ` · protocol ${status.protocol}` : ""}
        </span>
      ) : null}
      {status.status === "failed" && status.message ? (
        <span className="font-mono break-all">{status.message}</span>
      ) : null}
    </div>
  );
}

export default function RsyncCapabilityNotice({
  capabilities,
  loading,
  error,
  onRefresh,
}: {
  capabilities: RsyncCapabilities | null;
  loading: boolean;
  error: AppError | null;
  onRefresh: () => void;
}) {
  const { t } = useLingui();
  const local = capabilities?.local;
  const remote = capabilities?.remote;
  const localNeedsInstall = needsInstall(local);
  const remoteNeedsInstall = needsInstall(remote);
  const needsCommands = localNeedsInstall || remoteNeedsInstall;
  const unavailable =
    !!error ||
    (local != null && !available(local)) ||
    (remote != null && !available(remote));
  if (!unavailable) return null;

  const installHint =
    localNeedsInstall && remoteNeedsInstall
      ? t`在本机和远端服务器上执行对应命令。`
      : localNeedsInstall
        ? t`在本机终端执行对应命令。`
        : t`在远端服务器上执行对应命令。`;

  async function copyCommands() {
    try {
      if (isTauri()) await writeText(INSTALL_COMMANDS);
      else await navigator.clipboard.writeText(INSTALL_COMMANDS);
      toast.success(t`安装命令已复制`);
    } catch {
      toast.error(t`复制失败，请手动选择命令`);
    }
  }

  return (
    <Alert className="mx-3 mt-3 shrink-0">
      <TriangleAlert />
      <AlertTitle>
        <Trans>rsync 暂不可用</Trans>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {error ? <p>{describeError(error, t)}</p> : null}
        {local && !available(local) ? (
          <StatusRow label={t`本机`} status={local} />
        ) : null}
        {remote && !available(remote) ? (
          <StatusRow label={t`远端`} status={remote} />
        ) : null}
        {needsCommands ? (
          <>
            <p>{installHint}</p>
            <pre className="bg-muted text-foreground overflow-x-auto rounded-md px-2 py-1.5 font-mono text-xs">
              <code>{INSTALL_COMMANDS}</code>
            </pre>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="xs"
            density="adaptive"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            <Trans>重新检测</Trans>
          </Button>
          {needsCommands ? (
            <Button
              variant="ghost"
              size="xs"
              density="adaptive"
              onClick={() => void copyCommands()}
            >
              <Copy data-icon="inline-start" />
              <Trans>复制安装命令</Trans>
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
