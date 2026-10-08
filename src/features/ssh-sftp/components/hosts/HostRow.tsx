import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import {
  Ellipsis,
  LoaderCircle,
  Pencil,
  Server,
  Trash2,
  Unplug,
  Zap,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Host } from "~/types";

/** 同一行结构兼容鼠标与触控；操作无需悬停，连接逻辑由侧栏控制。 */
export default function HostRow({
  host,
  active,
  connected,
  busy,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: {
  host: Host;
  active: boolean;
  connected: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  return (
    <div
      className={cn(
        "flex min-h-16 items-center gap-2 rounded-lg border-b px-2 py-2",
        active && "bg-accent",
      )}
    >
      <Server aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <button
        className="min-h-[max(44px,2.75rem)] min-w-0 flex-1 text-left"
        onClick={onConnect}
        disabled={busy}
        title={t`连接`}
      >
        <span className="block truncate text-sm font-medium">{host.label}</span>
        <span className="text-muted-foreground mt-1 block truncate text-xs">
          {host.username}@{host.host}:{host.port}
        </span>
        {connected ? (
          <span className="text-success text-xs">
            <Trans>已连接</Trans>
          </span>
        ) : null}
      </button>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t`主机操作`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="ui-density-adaptive min-w-0"
        >
          <DropdownMenuItem
            disabled={busy}
            onSelect={connected ? onDisconnect : onConnect}
          >
            {connected ? <Unplug /> : <Zap />}
            {connected ? t`断开连接` : t`连接`}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            <Trans>编辑</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            <Trans>删除</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
