import { createFileRoute } from "@tanstack/react-router";

import AgentSessionsTool from "~/features/agent-sessions/AgentSessionsTool";
import { useRememberTool } from "~/features/navigation/use-remember-tool";
import { macosOnlyGuard } from "~/lib/platform";

function AgentSessionsRoute() {
  useRememberTool("agent-sessions");
  return <AgentSessionsTool />;
}

export const Route = createFileRoute("/tools/agent-sessions")({
  beforeLoad: macosOnlyGuard,
  component: AgentSessionsRoute,
});
