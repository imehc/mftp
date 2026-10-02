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
import { useHostsStore } from "~/store/hosts";
import Sidebar from "~/features/ssh-sftp/components/Sidebar";
import ActivityMenu from "~/features/transfers/ActivityMenu";
import TabBar from "~/features/ssh-sftp/components/terminal/TabBar";
import Terminal from "~/features/ssh-sftp/components/terminal/Terminal";
import SftpPanel from "~/features/ssh-sftp/components/sftp/SftpPanel";
// 懒加载：监控面板会引入图表库，而应用的其它部分并不需要它；
// 仅在真正打开监控视图时才付出这个代价。
const SystemMonitorPanel = lazy(
  () => import("~/features/ssh-sftp/components/monitor/SystemMonitorPanel"),
);
import {
  ArrowLeft,
  LoaderCircle,
  PanelLeft,
  TerminalSquare,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
const SIDEBAR_COLLAPSED_REM = 3.25;
function Workspace({ onHosts }: { onHosts: () => void }) {
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const [fileSessions, setFileSessions] = useState<string[]>([]);
  const nextFileSessions = sessions
    .filter(
      (session) => session.view === "sftp" || fileSessions.includes(session.id),
    )
    .map((session) => session.id);
  if (nextFileSessions.join() !== fileSessions.join())
    setFileSessions(nextFileSessions);
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <TabBar onHosts={onHosts} actionRef={setToolbarTarget} />
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
                <Trans>打开主机列表，选择已有主机或新建主机</Trans>
              </EmptyDescription>
              <Button variant="outline" onClick={onHosts}>
                <Trans>打开主机列表</Trans>
              </Button>
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
            {/* 文件视图首次打开后保留目录与滚动，关闭会话才卸载。 */}
            {fileSessions.includes(session.id) && (
              <div
                className="h-full"
                style={{ display: session.view === "sftp" ? "block" : "none" }}
              >
                <SftpPanel
                  session={session}
                  toolbarTarget={
                    session.id === activeId && session.view === "sftp"
                      ? toolbarTarget
                      : null
                  }
                />
              </div>
            )}
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

/** 窄屏断点：侧栏从可缩放面板切换为抽屉。 */

export default function SshSftpTool() {
  const { t } = useLingui();
  const ensureHosts = useHostsStore((s) => s.ensureLoaded);
  // 主机/密钥只在这个功能里用；不再由应用启动统一读取。
  useEffect(() => {
    // 错误保存在主机 store，由列表展示重试入口。
    void ensureHosts().catch(() => undefined);
  }, [ensureHosts]);
  const compact = !useDesktopLayout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 断点切换时收起抽屉：在渲染期修正状态，避免先渲染一帧旧布局。
  const [drawerBreakpoint, setDrawerBreakpoint] = useState(compact);
  if (drawerBreakpoint !== compact) {
    setDrawerBreakpoint(compact);
    setDrawerOpen(false);
  }
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarSize = useSettingsStore((s) => s.sidebarSize);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarSize = useSettingsStore((s) => s.setSidebarSize);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);

  // 从抽屉里连接 / 切换会话后自动收起抽屉。
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
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

  useEffect(() => {
    if (compact) return;
    if (sidebarCollapsed) sidebarPanelRef.current?.collapse();
  }, [sidebarCollapsed, compact]);

  // 断点切换只改变侧栏的呈现方式：会话所在的 Workspace 始终挂在同一位置，
  // 旋转屏幕或拖动窗口不会重建终端 / SFTP 面板，也不会重复订阅。
  const wasCompactRef = useRef(compact);
  useEffect(() => {
    if (wasCompactRef.current === compact) return;
    wasCompactRef.current = compact;
    if (compact) {
      sidebarPanelRef.current?.collapse();
    } else if (!useSettingsStore.getState().sidebarCollapsed) {
      sidebarPanelRef.current?.expand();
    }
  }, [compact]);

  const defaultLayout = {
    sidebar: compact ? 0 : sidebarSize,
    workspace: Math.max(0, 100 - (compact ? 0 : sidebarSize)),
  };

  return (
    <div className="ui-density-adaptive bg-background text-foreground flex h-full w-full flex-col overflow-hidden">
      {/* 紧凑布局沿用统一标题栏：标题在所有宽度可见，操作满足触控尺寸。 */}
      <ToolPageHeader
        title={t`SSH / SFTP`}
        showHome={false}
        leading={
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label={t`返回首页`}>
              <ArrowLeft />
            </Link>
          </Button>
        }
        trailing={
          <div className="flex items-center gap-1">
            <ActivityMenu />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDrawerOpen(true)}
              aria-label={t`打开主机列表`}
            >
              <PanelLeft />
            </Button>
          </div>
        }
      />
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={(layout) => {
          // 紧凑布局下面板被强制收起，此时的尺寸变化不代表用户偏好。
          if (compact) return;
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
            if (compact || !previousSize) return;
            const collapsed =
              sidebarPanelRef.current?.isCollapsed() ??
              size.inPixels <=
                SIDEBAR_COLLAPSED_REM *
                  parseFloat(
                    getComputedStyle(document.documentElement).fontSize,
                  ) +
                  0.5;
            if (collapsed !== sidebarCollapsed) {
              setSidebarCollapsed(collapsed);
            }
          }}
          minSize="15rem"
          maxSize="30rem"
          collapsedSize={compact ? "0px" : `${SIDEBAR_COLLAPSED_REM}rem`}
          collapsible
        >
          {compact ? null : (
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
          )}
        </Panel>
        <Separator
          className={
            compact
              ? "hidden"
              : "group bg-border/60 hover:bg-border data-[resize-handle-active]:bg-primary/50 relative w-1 shrink-0 transition-colors"
          }
          aria-label={t`调整左侧面板宽度`}
        >
          <span className="group-hover:bg-foreground/30 absolute top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors" />
        </Separator>
        <Panel
          id="workspace"
          minSize="16.25rem"
          className="h-full overflow-hidden"
        >
          <Workspace onHosts={() => setDrawerOpen(true)} />
        </Panel>
      </Group>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="ui-density-adaptive w-full max-w-full gap-0 p-0 md:max-w-md"
          style={{
            paddingTop: "var(--safe-top, 0px)",
            paddingLeft: "var(--safe-left, 0px)",
          }}
        >
          <SheetTitle className="sr-only">
            <Trans>主机列表</Trans>
          </SheetTitle>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Sidebar
              overlay
              collapsed={false}
              onToggleCollapsed={() => setDrawerOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
