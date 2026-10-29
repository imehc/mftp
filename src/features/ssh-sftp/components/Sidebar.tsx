import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { gsap } from "gsap";
import {
  KeyRound,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Server,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";
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
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import HostForm from "~/features/ssh-sftp/components/hosts/HostForm";
import PassphrasePrompt from "~/features/ssh-sftp/components/hosts/PassphrasePrompt";
import KeyManager from "~/features/ssh-sftp/components/keys/KeyManager";
import { describeError } from "~/lib/errors";
import { prefersReducedMotion } from "~/lib/motion";
import { useHostsStore } from "~/store/hosts";
import type { Host } from "~/types";

import HostRow from "./hosts/HostRow";
import SortableHostRow from "./hosts/SortableHostRow";
import { useHostActions } from "./hosts/use-host-actions";

interface SidebarProps {
  collapsed: boolean;
  overlay?: boolean;
  singleSession?: boolean;
  onToggleCollapsed: () => void;
}

export default function Sidebar({
  collapsed,
  overlay = false,
  singleSession = false,
  onToggleCollapsed,
}: SidebarProps) {
  const { t } = useLingui();
  const {
    activeId,
    sessionByHost,
    pendingHost,
    setPendingHost,
    deleteTarget,
    setDeleteTarget,
    disconnecting,
    connect,
    disconnect,
    confirmDelete,
    reorder,
    submitPassphrase,
  } = useHostActions(singleSession);
  const sidebarRef = useRef<HTMLElement>(null);
  const hosts = useHostsStore((s) => s.hosts);
  const loadError = useHostsStore((s) => s.loadError);
  const loading = useHostsStore((s) => s.loading);
  const retryLoad = useHostsStore((s) => s.ensureLoaded);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.host.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q),
    );
  })();
  const canSortHosts = !collapsed && !query.trim() && filtered.length > 1;
  const sortableHostIds = hosts.map((host) => host.id);

  async function onHostDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortableHostIds.indexOf(String(active.id));
    const newIndex = sortableHostIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const orderedIds = arrayMove(sortableHostIds, oldIndex, newIndex);
    await reorder(orderedIds);
  }

  function hostAddress(host: Host) {
    const target = `${host.host}:${host.port}`;
    return host.username ? `${host.username}@${target}` : target;
  }

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const reduceMotion = prefersReducedMotion();
    if (reduceMotion) {
      gsap.set(sidebar, {
        clearProps: "opacity,transform",
      });
      return;
    }
    const context = gsap.context(() => {
      gsap.fromTo(
        sidebar,
        {
          opacity: 0.86,
          x: collapsed ? -4 : 4,
        },
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
              aria-label={host.label}
              className={cn(
                "hover:bg-sidebar-accent relative flex h-9 w-full items-center justify-center rounded-lg",
                isActive && "bg-sidebar-accent",
              )}
              onClick={() => void connect(host)}
            >
              {isConnecting || isDisconnecting ? (
                <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
              ) : (
                <Server className="size-4" />
              )}
              {isConnected && !isDisconnecting ? (
                <span className="bg-success absolute top-2 right-2 size-1.5 rounded-full" />
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex flex-col gap-0.5">
              <span>{host.label}</span>
              <span className="text-muted-foreground text-xs">
                {hostAddress(host)}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }
    return (
      <HostRow
        host={host}
        active={isActive}
        connected={isConnected}
        busy={isConnecting || isDisconnecting}
        onConnect={() => void connect(host)}
        onDisconnect={() => void disconnect(host)}
        onEdit={() => {
          setEditing(host);
          setFormOpen(true);
        }}
        onDelete={() => setDeleteTarget(host)}
      />
    );
  }

  const value = deleteTarget?.label;
  return (
    <aside
      ref={sidebarRef}
      className={cn(
        "ui-density-adaptive bg-background flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
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
                aria-label={
                  overlay ? t`关闭` : collapsed ? t`展开侧边栏` : t`折叠侧边栏`
                }
                onClick={onToggleCollapsed}
              >
                {overlay ? (
                  <X />
                ) : collapsed ? (
                  <PanelLeftOpen />
                ) : (
                  <PanelLeftClose />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {overlay ? t`关闭` : collapsed ? t`展开侧边栏` : t`折叠侧边栏`}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t`密钥管理`}
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
                aria-label={t`新建主机`}
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
          aria-label={t`搜索主机`}
        />
      </div>

      <div
        className={cn(
          "app-scroll-safe-end min-h-0 flex-1 overflow-y-auto",
          collapsed ? "px-1.5" : "px-2",
        )}
      >
        {loadError ? (
          <Alert variant="destructive" className="m-2">
            <AlertDescription>{describeError(loadError, t)}</AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                density="adaptive"
                onClick={() => void retryLoad().catch(() => undefined)}
              >
                <Trans>重试</Trans>
              </Button>
            </AlertAction>
          </Alert>
        ) : loading ? (
          <div
            role="status"
            className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm"
          >
            <Spinner aria-label={t`正在加载`} />
            <Trans>正在加载</Trans>
          </div>
        ) : filtered.length === 0 ? (
          collapsed ? (
            <div className="text-muted-foreground flex justify-center py-4">
              <Server className="size-4" />
            </div>
          ) : (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Server />
                </EmptyMedia>
                <EmptyTitle>
                  {hosts.length === 0 ? t`暂无主机` : t`无匹配结果`}
                </EmptyTitle>
                <EmptyDescription>
                  {hosts.length === 0 ? t`点右上角 + 新建` : t`换个关键词试试`}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : canSortHosts ? (
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
          <ul className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5")}>
            {filtered.map((host) => (
              <li key={host.id} className="group">
                {renderHostRow(host)}
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
        onSubmit={submitPassphrase}
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
              <Trans>确定删除主机 “{value}”？此操作不可撤销。</Trans>
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
