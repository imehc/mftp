import "./agent-colors.css";

import { cn } from "cn";

import type { SessionAgent, SessionSource } from "~/bindings";

import claudeIcon from "./assets/claudecode-color.svg";
import codebuddyIcon from "./assets/codebuddy-color.svg";
import codexIcon from "./assets/codex-color.svg";
import copilotIcon from "./assets/copilot.svg";
import opencodeIcon from "./assets/opencode.svg";
import qoderIcon from "./assets/qoder-color.svg";
import qoderDarkIcon from "./assets/qoder-dark.svg";
import workbuddyIcon from "./assets/workbuddy-color.svg";

export const sessionAgents = [
  { id: "claude", label: "Claude Code", icon: claudeIcon },
  { id: "codex", label: "Codex", icon: codexIcon },
  { id: "workbuddy", label: "WorkBuddy", icon: workbuddyIcon },
  { id: "opencode", label: "OpenCode", icon: opencodeIcon },
  { id: "copilot", label: "VS Code Copilot", icon: copilotIcon },
  { id: "qoder", label: "Qoder", icon: qoderIcon, darkIcon: qoderDarkIcon },
  { id: "codebuddy", label: "CodeBuddy", icon: codebuddyIcon },
] as const;

export function availableSessionAgents(sources: SessionSource[]) {
  return sessionAgents.filter((agent) =>
    sources.some((source) => source.agent === agent.id && source.count > 0),
  );
}

export function AgentIcon({
  agent,
  className,
}: {
  agent: SessionAgent;
  className?: string;
}) {
  const source = sessionAgents.find((entry) => entry.id === agent)!;
  const darkIcon = "darkIcon" in source ? source.darkIcon : undefined;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "agent-icon inline-flex size-5 shrink-0 items-center justify-center",
        `agent-${agent}`,
        className,
      )}
    >
      <img
        src={source.icon}
        alt=""
        className={cn("agent-icon-image", darkIcon && "dark:hidden")}
      />
      {darkIcon && (
        <img
          src={darkIcon}
          alt=""
          className="agent-icon-image hidden dark:block"
        />
      )}
    </span>
  );
}

export function agentName(agent: SessionAgent) {
  return sessionAgents.find((entry) => entry.id === agent)?.label ?? agent;
}
