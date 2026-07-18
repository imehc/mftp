import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { gsap } from "gsap";
import {
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
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
import HostForm from "~/features/ssh-sftp/components/hosts/HostForm";
import KeyManager from "~/features/ssh-sftp/components/keys/KeyManager";
import PassphrasePrompt from "~/features/ssh-sftp/components/hosts/PassphrasePrompt";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function SortableHostRow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("group relative", isDragging && "z-10 opacity-80")}
    >
      <button
        type="button"
        className="absolute left-0 top-1/2 z-10 flex h-7 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
        aria-label={t`拖动排序`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="pl-5">{children}</div>
    </li>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const { t } = useLingui();
  const sidebarRef = useRef<HTMLElement>(null);
  const hosts = useHostsStore((s) => s.hosts);
  const keys = useHostsStore((s) => s.keys);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const reorderHosts = useHostsStore((s) => s.reorderHosts);
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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

  const canSortHosts = !collapsed && !query.trim() && filtered.length > 1;
  const sortableHostIds = useMemo(() => hosts.map((host) => host.id), [hosts]);

  async function onHostDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortableHostIds.indexOf(String(active.id));
    const newIndex = sortableHostIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const orderedIds = arrayMove(sortableHostIds, oldIndex, newIndex);
    try {
      await reorderHosts(orderedIds);
    } catch (error) {
      toast.error(t`排序保存失败：${error}`);
    }
  }

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
      toast.error(t`连接失败：${e}`);
    }
  }

  async function disconnect(host: Host) {
    const session = sessionByHost.get(host.id);
    if (!session) return;
    setDisconnecting((current) => new Set(current).add(host.id));
    try {
      await closeSession(session.id);
      toast.success(t`已断开 ${host.label}`);
    } catch (e) {
      toast.error(t`断开失败：${e}`);
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
      toast.success(t`已删除主机 ${name}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleteTarget(null);
    }
  }

  function hostAddress(host: Host) {
    const target = `${host.host}:${host.port}`;
    return host.username ? `${host.username}@${target}` : target;
  }

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      gsap.set(sidebar, { clearProps: "opacity,transform" });
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        sidebar,
        { opacity: 0.86, x: collapsed ? -4 : 4 },
        {
          opacity: 1,
          x: 0,
          duration: 0.28,
          ease: "power2.out",
          clearProps: "opacity,transform",
        },
      );
    }, sidebar);

    return () => context.revert();
  }, [collapsed]);

  function renderHostRow(host: Host) {
    const session = sessionByHost.get(host.id);
    const isConnected = session?.status === "connected";
    const isConnecting = session?.status === "connecting";
    const isDisconnecting = disconnecting.has(host.id);
    const isActive = !!session && session.id === activeId;

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "relative flex h-9 w-full items-center justify-center rounded-lg hover:bg-sidebar-accent",
                isActive && "bg-sidebar-accent",
              )}
              onDoubleClick={() => connect(host)}
              onClick={() => {
                if (session) setActive(session.id);
              }}
            >
              {isConnecting || isDisconnecting ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Server className="size-4" />
              )}
              {isConnected && !isDisconnecting ? (
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-green-500" />
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex flex-col gap-0.5">
              <span>{host.label}</span>
              <span className="text-xs text-muted-foreground">
                {hostAddress(host)}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <div
        className={cn(
          "relative flex items-center rounded-lg px-2 py-1.5 hover:bg-sidebar-accent",
          isActive && "bg-sidebar-accent",
        )}
      >
        <button
          className="min-w-0 flex-1 text-left"
          onDoubleClick={() => connect(host)}
          title={session ? t`双击切换到连接` : t`双击连接`}
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
                ? t`断开中 · ${hostAddress(host)}`
                : t`已连接 · ${hostAddress(host)}`
              : isConnecting
                ? t`连接中 · ${hostAddress(host)}`
                : hostAddress(host)}
          </p>
        </button>
        <div className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 gap-0.5 rounded-md bg-sidebar-accent/95 group-hover:pointer-events-auto group-hover:flex">
          <Button
            variant="ghost"
            size="icon-xs"
            title={isDisconnecting ? t`断开中` : isConnected ? t`断开连接` : t`连接`}
            disabled={isConnecting || isDisconnecting}
            onClick={() =>
              isConnected ? void disconnect(host) : void connect(host)
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
            title={t`编辑`}
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
            title={t`删除`}
            onClick={() => setDeleteTarget(host)}
          >
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar",
        collapsed ? "items-stretch" : "",
      )}
    >
      <div
        className={cn(
          "flex items-center px-3 py-2.5",
          collapsed ? "flex-col gap-1.5 px-2" : "justify-between",
        )}
      >
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            collapsed && "sr-only",
          )}
        >
          <Server className="size-4" /> <Trans>主机</Trans>
        </span>
        <div className={cn("flex gap-0.5", collapsed && "flex-col")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? t`展开侧边栏` : t`折叠侧边栏`}
            </TooltipContent>
          </Tooltip>
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
            <TooltipContent side="right">
              <Trans>密钥管理</Trans>
            </TooltipContent>
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
            <TooltipContent side="right">
              <Trans>新建主机</Trans>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className={cn("px-2 pb-2", collapsed && "hidden")}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t`搜索…`}
          className="h-7"
        />
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto pb-2",
          collapsed ? "px-1.5" : "px-2",
        )}
      >
        {filtered.length === 0 ? (
          collapsed ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Server className="size-4" />
            </div>
          ) : (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Server />
              </EmptyMedia>
              <EmptyTitle>
                {hosts.length === 0 ? t`还没有主机` : t`无匹配结果`}
              </EmptyTitle>
              <EmptyDescription>
                {hosts.length === 0 ? t`点击右上角 + 新建主机` : t`换个关键词试试`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          )
        ) : (
          canSortHosts ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onHostDragEnd}
            >
              <SortableContext
                items={sortableHostIds}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-0.5">
                  {filtered.map((host) => (
                    <SortableHostRow key={host.id} id={host.id}>
                      {renderHostRow(host)}
                    </SortableHostRow>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul
              className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5")}
            >
              {filtered.map((host) => (
                <li key={host.id} className="group">
                  {renderHostRow(host)}
                </li>
              ))}
            </ul>
          )
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
              toast.error(t`连接失败：${e}`);
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
            <AlertDialogTitle>
              <Trans>删除主机</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>确定删除主机 “{deleteTarget?.label}”？此操作不可撤销。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
