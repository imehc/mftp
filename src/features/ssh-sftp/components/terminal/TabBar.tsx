import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { PanelLeft, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { describeError } from "~/lib/errors";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { useSessionsStore } from "~/store/sessions";
import type { Session } from "~/types";

const statusClassNames: Record<Session["status"], string> = {
  connecting: "bg-warning",
  connected: "bg-success",
  closed: "bg-muted-foreground/50",
  error: "bg-destructive",
};

function SessionStatus({ session }: { session: Session }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        statusClassNames[session.status],
      )}
    />
  );
}

function ViewTabs({
  active,
  onViewChange,
}: {
  active: Session;
  onViewChange: (view: Session["view"]) => void;
}) {
  const { t } = useLingui();
  return (
    <Tabs
      value={active.view}
      onValueChange={(view) => onViewChange(view as Session["view"])}
      className="min-w-0"
    >
      <TabsList density="adaptive" aria-label={t`连接视图`}>
        <TabsTrigger value="terminal">
          <Trans>终端</Trans>
        </TabsTrigger>
        <TabsTrigger value="sftp" disabled={active.status !== "connected"}>
          <Trans>文件</Trans>
        </TabsTrigger>
        <TabsTrigger value="monitor" disabled={active.status !== "connected"}>
          <Trans>监控</Trans>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function MobileSessionLabel({
  active,
  statusLabels,
  closing,
  onClose,
}: {
  active: Session;
  statusLabels: Record<Session["status"], string>;
  closing: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <div
      className="flex max-w-[45%] min-w-0 flex-none items-center gap-1"
      title={`${active.title} · ${statusLabels[active.status]}`}
    >
      <SessionStatus session={active} />
      <span className="min-w-0 truncate text-xs font-medium">
        {active.title}
      </span>
      <span className="sr-only">{statusLabels[active.status]}</span>
      <button
        type="button"
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 relative flex size-5 shrink-0 items-center justify-center rounded-md before:absolute before:-inset-3 before:content-[''] focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        aria-label={t`关闭连接`}
        disabled={closing}
        onClick={onClose}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function DesktopSessionTabs({
  sessions,
  activeId,
  statusLabels,
  closingId,
  onHosts,
  onSelect,
  onClose,
}: {
  sessions: Session[];
  activeId: string;
  statusLabels: Record<Session["status"], string>;
  closingId: string | null;
  onHosts: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useLingui();
  return (
    <Tabs value={activeId} onValueChange={onSelect} className="min-w-0 flex-1">
      <TabsList
        density="adaptive"
        aria-label={t`已打开的连接`}
        className="h-9 w-full min-w-0 justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0"
      >
        {sessions.map((session) => (
          <ContextMenu key={session.id}>
            <ContextMenuTrigger asChild>
              <div
                data-active={session.id === activeId || undefined}
                className="group/session data-active:bg-background flex h-8 w-fit max-w-48 min-w-0 flex-none items-center rounded-md data-active:shadow-sm"
              >
                <TabsTrigger
                  value={session.id}
                  title={`${session.title} · ${statusLabels[session.status]}`}
                  className="text-muted-foreground data-[state=active]:text-foreground h-8 max-w-40 min-w-0 flex-none justify-start gap-1.5 px-2 pr-0.5 data-[state=active]:shadow-none"
                >
                  <SessionStatus session={session} />
                  <span className="min-w-0 truncate">{session.title}</span>
                </TabsTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-active={session.id === activeId || undefined}
                  className="pointer-events-none mr-1 size-5 shrink-0 rounded-md opacity-0 group-hover/session:pointer-events-auto group-hover/session:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-active:pointer-events-auto data-active:opacity-100 motion-safe:transition-opacity"
                  aria-label={t`关闭连接`}
                  tabIndex={session.id === activeId ? 0 : -1}
                  disabled={closingId !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(session.id);
                  }}
                >
                  <X />
                </Button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="ui-density-adaptive">
              <ContextMenuItem onSelect={onHosts}>
                <PanelLeft />
                {t`打开主机列表`}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={closingId !== null}
                onSelect={() => onClose(session.id)}
              >
                <X />
                {t`关闭连接`}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </TabsList>
    </Tabs>
  );
}

export default function TabBar({ onHosts }: { onHosts: () => void }) {
  const { t } = useLingui();
  const desktop = useDesktopLayout();
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const setView = useSessionsStore((s) => s.setView);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const [closingId, setClosingId] = useState<string | null>(null);
  const active = sessions.find((session) => session.id === activeId);
  if (!active) return null;

  const statusLabels = {
    connecting: t`连接中`,
    connected: t`已连接`,
    closed: t`已断开`,
    error: t`失败`,
  };

  async function handleClose(id: string) {
    setClosingId(id);
    try {
      await closeSession(id);
    } catch (error) {
      toast.error(describeError(error, t));
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-11 min-w-0 shrink-0 items-center gap-2 border-b px-2 py-1",
        desktop && "bg-muted/30",
      )}
    >
      {desktop ? (
        <DesktopSessionTabs
          sessions={sessions}
          activeId={active.id}
          statusLabels={statusLabels}
          closingId={closingId}
          onHosts={onHosts}
          onSelect={setActive}
          onClose={(id) => void handleClose(id)}
        />
      ) : (
        <MobileSessionLabel
          active={active}
          statusLabels={statusLabels}
          closing={closingId !== null}
          onClose={() => void handleClose(active.id)}
        />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ViewTabs
          active={active}
          onViewChange={(view) => setView(active.id, view)}
        />
      </div>
    </div>
  );
}
