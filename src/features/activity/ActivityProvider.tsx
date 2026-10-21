import {
  type Context,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import {
  type ExecutionLogs,
  useExecutionLogs,
} from "~/features/connection-diagnostics/use-execution-logs";

import { isLeavingActivityPath } from "./activity-navigation";

export const ACTIVITY_PANEL_ID = "activity-panel";

interface ActivityPanelState {
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

const ActivityPanelContext = createContext<ActivityPanelState | null>(null);
const ExecutionLogsContext = createContext<ExecutionLogs | null>(null);

/**
 * 应用级活动外壳：面板开关保持跨页面，执行日志只维护一个会话。
 * 具体任务状态仍归各自模块，活动中心只聚合展示和调用既有动作。
 */
export function ActivityProvider({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panel: ActivityPanelState = {
    panelOpen,
    openPanel: () => setPanelOpen(true),
    closePanel: () => setPanelOpen(false),
    togglePanel: () => setPanelOpen((open) => !open),
  };
  return (
    <ActivityPanelContext.Provider value={panel}>
      <ExecutionLogsProvider pathname={pathname}>
        {children}
      </ExecutionLogsProvider>
    </ActivityPanelContext.Provider>
  );
}

function ExecutionLogsProvider({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const logs = useExecutionLogs();
  useDiscardLogsOnLeave(pathname, logs.clear);
  return (
    <ExecutionLogsContext.Provider value={logs}>
      {children}
    </ExecutionLogsContext.Provider>
  );
}

function useDiscardLogsOnLeave(pathname: string, clear: () => void) {
  const previousPathname = useRef(pathname);
  const discard = useEffectEvent(clear);
  useEffect(() => {
    const previous = previousPathname.current;
    previousPathname.current = pathname;
    if (isLeavingActivityPath(previous, pathname)) discard();
  }, [pathname]);
}

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used within ActivityProvider`);
  }
  return value;
}

export function useActivityPanel() {
  return useRequiredContext(ActivityPanelContext, "useActivityPanel");
}

export function useActivityExecutionLogs() {
  return useRequiredContext(ExecutionLogsContext, "useActivityExecutionLogs");
}
