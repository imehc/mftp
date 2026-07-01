import { useMemo, useState } from "react";
import {
  LoaderCircle,
  Pencil,
  Plus,
  Server,
  KeyRound,
  Trash2,
  Unplug,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { Host } from "~/types";
import { useHostsStore } from "~/store/hosts";
import { useSessionsStore } from "~/store/sessions";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import HostForm from "~/components/hosts/HostForm";
import KeyManager from "~/components/keys/KeyManager";
import PassphrasePrompt from "~/components/hosts/PassphrasePrompt";
import ThemeMenu from "~/components/layout/ThemeMenu";
import TransferPanel from "~/components/layout/TransferPanel";

export default function Sidebar() {
  const hosts = useHostsStore((s) => s.hosts);
  const keys = useHostsStore((s) => s.keys);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const openSession = useSessionsStore((s) => s.openSession);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const setActive = useSessionsStore((s) => s.setActive);
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);

  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [pendingHost, setPendingHost] = useState<Host | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null);
  const [disconnecting, setDisconnecting] = useState<Set<string>>(
    () => new Set(),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.host.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q),
    );
  }, [hosts, query]);

  const sessionByHost = useMemo(() => {
    const map = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (session.status === "connecting" || session.status === "connected") {
        map.set(session.hostId, session);
      }
    }
    return map;
  }, [sessions]);

  async function connect(host: Host) {
    const existing = sessionByHost.get(host.id);
    if (existing) {
      setActive(existing.id);
      return;
    }
    // A key with a passphrase needs the user to enter it before connecting.
    if (host.authType === "key") {
      const key = keys.find((k) => k.id === host.keyId);
      if (key?.hasPassphrase) {
        setPendingHost(host);
        return;
      }
    }
    try {
      await openSession(host);
    } catch (e) {
      toast.error(`连接失败: ${e}`);
    }
  }

  async function disconnect(host: Host) {
    const session = sessionByHost.get(host.id);
    if (!session) return;
    setDisconnecting((current) => new Set(current).add(host.id));
    try {
      await closeSession(session.id);
      toast.success(`已断开 ${host.label}`);
    } catch (e) {
      toast.error(`断开失败: ${e}`);
    } finally {
      setDisconnecting((current) => {
        const next = new Set(current);
        next.delete(host.id);
        return next;
      });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.label;
    try {
      await deleteHost(deleteTarget.id);
      toast.success(`已删除主机 ${name}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Server className="size-4" /> 主机
        </span>
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setKeysOpen(true)}
              >
                <KeyRound />
              </Button>
            </TooltipTrigger>
            <TooltipContent>密钥管理</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>新建主机</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="px-2 pb-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索…"
          className="h-7"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Server />
              </EmptyMedia>
              <EmptyTitle>
                {hosts.length === 0 ? "还没有主机" : "无匹配结果"}
              </EmptyTitle>
              <EmptyDescription>
                {hosts.length === 0 ? "点击右上角 + 新建主机" : "换个关键词试试"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((host) => {
              const session = sessionByHost.get(host.id);
              const isConnected = session?.status === "connected";
              const isConnecting = session?.status === "connecting";
              const isDisconnecting = disconnecting.has(host.id);
              const isActive = !!session && session.id === activeId;
              return (
                <li key={host.id} className="group">
                  <div
                    className={cn(
                      "relative flex items-center rounded-lg px-2 py-1.5 hover:bg-sidebar-accent",
                      isActive && "bg-sidebar-accent",
                    )}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onDoubleClick={() => connect(host)}
                      title={session ? "双击切换到连接" : "双击连接"}
                    >
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{host.label}</span>
                        {isConnecting || isDisconnecting ? (
                          <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
                        ) : isConnected ? (
                          <span className="size-1.5 shrink-0 rounded-full bg-green-500" />
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {isConnected
                          ? isDisconnecting
                            ? `断开中 · ${host.username}@${host.host}:${host.port}`
                            : `已连接 · ${host.username}@${host.host}:${host.port}`
                          : isConnecting
                            ? `连接中 · ${host.username}@${host.host}:${host.port}`
                            : `${host.username}@${host.host}:${host.port}`}
                      </p>
                    </button>
                    <div className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 gap-0.5 rounded-md bg-sidebar-accent/95 group-hover:pointer-events-auto group-hover:flex">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={
                          isDisconnecting
                            ? "断开中"
                            : isConnected
                              ? "断开连接"
                              : "连接"
                        }
                        disabled={isConnecting || isDisconnecting}
                        onClick={() =>
                          isConnected
                            ? void disconnect(host)
                            : void connect(host)
                        }
                      >
                        {isConnecting || isDisconnecting ? (
                          <LoaderCircle className="animate-spin" />
                        ) : isConnected ? (
                          <Unplug />
                        ) : (
                          <Zap />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="编辑"
                        onClick={() => {
                          setEditing(host);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="删除"
                        onClick={() => setDeleteTarget(host)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TransferPanel />

      <div className="border-t border-border p-2">
        <ThemeMenu />
      </div>

      <HostForm open={formOpen} onOpenChange={setFormOpen} host={editing} />
      <KeyManager open={keysOpen} onOpenChange={setKeysOpen} />
      <PassphrasePrompt
        host={pendingHost}
        onClose={() => setPendingHost(null)}
        onSubmit={async (passphrase) => {
          const host = pendingHost;
          setPendingHost(null);
          if (host) {
            try {
              await openSession(host, passphrase);
            } catch (e) {
              toast.error(`连接失败: ${e}`);
            }
          }
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除主机</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除主机 “{deleteTarget?.label}”？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
