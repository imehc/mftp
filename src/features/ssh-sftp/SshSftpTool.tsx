import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { useSettingsStore } from "~/store/settings";
import { useSessionsStore } from "~/store/sessions";
import Sidebar from "~/features/ssh-sftp/components/Sidebar";
import TransferPanel from "~/features/transfers/TransferPanel";
import TabBar from "~/features/ssh-sftp/components/terminal/TabBar";
import Terminal from "~/features/ssh-sftp/components/terminal/Terminal";
import SftpPanel from "~/features/ssh-sftp/components/sftp/SftpPanel";
import { Home, TerminalSquare } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

const SIDEBAR_COLLAPSED_SIZE = 52;

export default function SshSftpTool() {
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const sidebarSize = useSettingsStore((s) => s.sidebarSize);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarSize = useSettingsStore((s) => s.setSidebarSize);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);

  useEffect(() => {
    if (sidebarCollapsed) sidebarPanelRef.current?.collapse();
  }, [sidebarCollapsed]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const syncCompactSidebar = () => {
      if (!media.matches) return;
      setSidebarCollapsed(true);
      sidebarPanelRef.current?.collapse();
    };
    syncCompactSidebar();
    media.addEventListener("change", syncCompactSidebar);
    return () => media.removeEventListener("change", syncCompactSidebar);
  }, [setSidebarCollapsed]);

  const defaultLayout = {
    sidebar: sidebarSize,
    workspace: Math.max(0, 100 - sidebarSize),
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              首页
            </Link>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
            SSH / SFTP
          </div>
        </div>
      </header>
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={(layout) => {
          const sidebar = layout.sidebar;
          if (typeof sidebar !== "number") return;
          const collapsed =
            sidebarPanelRef.current?.isCollapsed() ?? sidebar <= 6;
          if (!collapsed && Math.abs(sidebar - sidebarSize) > 0.1) {
            setSidebarSize(sidebar);
          }
        }}
        className="panel-group min-h-0 flex-1 overflow-hidden"
      >
        <Panel
          panelRef={sidebarPanelRef}
          id="sidebar"
          className="sidebar-panel h-full overflow-hidden"
          onResize={(size, _id, previousSize) => {
            if (!previousSize) return;
            const collapsed =
              sidebarPanelRef.current?.isCollapsed() ??
              size.inPixels <= SIDEBAR_COLLAPSED_SIZE + 0.5;
            if (collapsed !== sidebarCollapsed) {
              setSidebarCollapsed(collapsed);
            }
          }}
          minSize="180px"
          maxSize="480px"
          collapsedSize={`${SIDEBAR_COLLAPSED_SIZE}px`}
          collapsible
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => {
              if (sidebarCollapsed) {
                setSidebarCollapsed(false);
                sidebarPanelRef.current?.expand();
              } else {
                setSidebarCollapsed(true);
                sidebarPanelRef.current?.collapse();
              }
            }}
          />
        </Panel>
        <Separator
          className="group relative w-1 shrink-0 bg-border/60 transition-colors hover:bg-border data-[resize-handle-active]:bg-primary/50"
          aria-label="调整左侧面板宽度"
        >
          <span className="absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-foreground/30" />
        </Separator>
        <Panel id="workspace" minSize="260px" className="h-full overflow-hidden">
          <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            <TabBar />
            <div className="relative flex-1 overflow-hidden">
              {sessions.length === 0 ? (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <TerminalSquare />
                    </EmptyMedia>
                    <EmptyTitle>还没有打开的连接</EmptyTitle>
                    <EmptyDescription>
                      在左侧选择主机并点击连接，或新建主机
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {/* Keep every session mounted so terminals preserve their state. */}
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="absolute inset-0"
                  style={{ display: session.id === activeId ? "block" : "none" }}
                >
                  {/* Terminal stays mounted to keep the shell alive across view switches. */}
                  <div
                    className="h-full"
                    style={{
                      display: session.view === "terminal" ? "block" : "none",
                    }}
                  >
                    <Terminal session={session} />
                  </div>
                  {session.view === "sftp" && <SftpPanel session={session} />}
                </div>
              ))}
            </div>
          </main>
        </Panel>
      </Group>
      <TransferPanel />
    </div>
  );
}
