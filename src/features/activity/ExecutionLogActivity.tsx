import ExecutionLogList from "~/features/connection-diagnostics/ExecutionLogList";

import { useActivityExecutionLogs } from "./ActivityProvider";

/** 活动中心的实时执行日志页签；视图开关不影响应用级日志会话。 */
export default function ExecutionLogActivity() {
  const logs = useActivityExecutionLogs();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ExecutionLogList logs={logs} />
    </div>
  );
}
