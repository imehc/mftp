import { type Context, createContext, type ReactNode, useContext } from "react";

import {
  type ExecutionLogs,
  useExecutionLogs,
} from "~/features/connection-diagnostics/use-execution-logs";

const ExecutionLogsContext = createContext<ExecutionLogs | null>(null);

/**
 * 应用级活动外壳：执行日志只维护一个跨页面会话。
 * 具体任务状态仍归各自模块，活动中心只聚合展示和调用既有动作。
 */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const logs = useExecutionLogs();
  return (
    <ExecutionLogsContext.Provider value={logs}>
      {children}
    </ExecutionLogsContext.Provider>
  );
}

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used within ActivityProvider`);
  }
  return value;
}

export function useActivityExecutionLogs() {
  return useRequiredContext(ExecutionLogsContext, "useActivityExecutionLogs");
}
