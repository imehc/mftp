import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
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
// 懒加载：监控面板会引入图表库，而应用的其它部分并不需要它；
// 仅在真正打开监控视图时才付出这个代价。
const SystemMonitorPanel = lazy(
  () => import("~/features/ssh-sftp/components/monitor/SystemMonitorPanel"),
);
import { Home, LoaderCircle, PanelLeft, TerminalSquare } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { useMediaQuery } from "~/lib/use-media-query";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
const SIDEBAR_COLLAPSED_SIZE = 52;
function Workspace() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <TabBar />
      <div className="relative flex-1 overflow-hidden">
        {sessions.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TerminalSquare />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>还没有打开的连接</Trans>
              </EmptyTitle>
              <EmptyDescription>
                <Trans>在左侧选择主机并点击连接，或新建主机</Trans>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {/* 保持每个会话都挂载，以便终端保留自身状态。 */}
        {sessions.map((session) => (
          <div
            key={session.id}
            className="absolute inset-0"
            style={{
              display: session.id === activeId ? "block" : "none",
            }}
          >
            {/* 终端保持挂载，使 shell 在视图切换间保持存活。 */}
            <div
              className="h-full"
              style={{
                display: session.view === "terminal" ? "block" : "none",
              }}
            >
              <Terminal session={session} />
            </div>
            {session.view === "sftp" && <SftpPanel session={session} />}
            {session.view === "monitor" && (
              <Suspense
                fallback={
                  <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                    <LoaderCircle className="animate-spin" />
                    <Trans>正在加载系统监控…</Trans>
                  </div>
                }
              >
                <SystemMonitorPanel session={session} />
              </Suspense>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}

/** 紧凑布局：侧边栏放在抽屉里，而不是可缩放面板。 */
function CompactSshSftpTool() {
  const { t } = useLingui();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);

  // 从侧边栏打开 / 激活会话后关闭抽屉。
  const sessionCount = sessions.length;
  const previousRef = useRef({
    sessionCount,
    activeId,
  });
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = {
      sessionCount,
      activeId,
    };
    if (
      sessionCount > previous.sessionCount ||
      activeId !== previous.activeId
    ) {
      setDrawerOpen(false);
    }
  }, [sessionCount, activeId]);
  return (
    <div className="bg-background text-foreground flex h-full w-full flex-col overflow-hidden">
      <header className="border-border flex h-9 shrink-0 items-center justify-between border-b px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="bg-border h-4 w-px" />
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setDrawerOpen(true)}
            aria-label={t`打开主机列表`}
          >
            <PanelLeft data-icon="inline-start" />
            <Trans>主机</Trans>
          </Button>
        </div>
        <div className="text-muted-foreground truncate text-xs font-medium">
          SSH / SFTP
        </div>
      </header>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-80 max-w-[85vw] gap-0 p-0"
          style={{
            paddingTop: "var(--safe-top, 0px)",
            paddingBottom: "var(--safe-bottom, 0px)",
            paddingLeft: "var(--safe-left, 0px)",
          }}
        >
          <SheetTitle className="sr-only">
            <Trans>主机列表</Trans>
          </SheetTitle>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Sidebar
              collapsed={false}
              onToggleCollapsed={() => setDrawerOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Workspace />
      </div>
      <TransferPanel />
    </div>
  );
}
export default function SshSftpTool() {
  const { t } = useLingui();
  const compact = useMediaQuery("(max-width: 760px)");
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarSize = useSettingsStore((s) => s.sidebarSize);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarSize = useSettingsStore((s) => s.setSidebarSize);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  useEffect(() => {
    if (sidebarCollapsed) sidebarPanelRef.current?.collapse();
  }, [sidebarCollapsed]);
  const defaultLayout = {
    sidebar: sidebarSize,
    workspace: Math.max(0, 100 - sidebarSize),
  };
  if (compact) {
    return <CompactSshSftpTool />;
  }
  return (
    <div className="bg-background text-foreground flex h-full w-full flex-col overflow-hidden">
      <ToolPageHeader title="SSH / SFTP" />
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
          className="group bg-border/60 hover:bg-border data-[resize-handle-active]:bg-primary/50 relative w-1 shrink-0 transition-colors"
          aria-label={t`调整左侧面板宽度`}
        >
          <span className="group-hover:bg-foreground/30 absolute top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors" />
        </Separator>
        <Panel
          id="workspace"
          minSize="260px"
          className="h-full overflow-hidden"
        >
          <Workspace />
        </Panel>
      </Group>
      <TransferPanel />
    </div>
  );
}
