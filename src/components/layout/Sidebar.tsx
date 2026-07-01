import { useMemo, useState } from "react";
import { Pencil, Plus, Server, KeyRound, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import type { Host } from "~/types";
import { useHostsStore } from "~/store/hosts";
import { useSessionsStore } from "~/store/sessions";
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

export default function Sidebar() {
  const hosts = useHostsStore((s) => s.hosts);
  const keys = useHostsStore((s) => s.keys);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const openSession = useSessionsStore((s) => s.openSession);

  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [pendingHost, setPendingHost] = useState<Host | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null);

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

  async function connect(host: Host) {
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
            {filtered.map((host) => (
              <li key={host.id} className="group">
                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onDoubleClick={() => connect(host)}
                    title="双击连接"
                  >
                    <p className="truncate text-sm font-medium">{host.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {host.username}@{host.host}:{host.port}
                    </p>
                  </button>
                  <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="连接"
                      onClick={() => connect(host)}
                    >
                      <Zap />
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
            ))}
          </ul>
        )}
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
