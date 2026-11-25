import { Trans } from "@lingui/react/macro";
import { cn } from "cn";
import { MessagesSquare } from "lucide-react";

import type { AgentSessionsSnapshot, SessionAgent } from "~/bindings";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

import { AgentIcon, availableSessionAgents } from "./agents";

export function SessionSources({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: AgentSessionsSnapshot;
  selected: SessionAgent | "all";
  onSelect: (agent: SessionAgent | "all") => void;
}) {
  return (
    <aside className="border-border bg-muted/40 hidden min-h-0 flex-col gap-3 overflow-y-auto border-r p-2 @[56rem]/session:flex">
      <h2 className="text-sm font-medium">
        <Trans comment="左侧导航标题，按 AI 编码工具区分历史来源">
          Agent 分类
        </Trans>
      </h2>
      <nav aria-label="Agent" className="flex flex-col gap-1">
        <Button
          variant={selected === "all" ? "outline" : "ghost"}
          className="w-full justify-start"
          onClick={() => onSelect("all")}
          aria-pressed={selected === "all"}
        >
          <MessagesSquare data-icon="inline-start" />
          <Trans comment="显示所有 agent 的会话">全部会话</Trans>
          <Badge variant="secondary" className="ml-auto tabular-nums">
            {snapshot.total}
          </Badge>
        </Button>
        {availableSessionAgents(snapshot.sources).map((agent) => {
          const source = snapshot.sources.find(
            (source) => source.agent === agent.id,
          );
          return (
            <Button
              key={agent.id}
              variant={selected === agent.id ? "outline" : "ghost"}
              className={cn(
                "agent-choice w-full justify-start",
                `agent-${agent.id}`,
              )}
              data-selected={selected === agent.id}
              onClick={() => onSelect(agent.id)}
              aria-pressed={selected === agent.id}
            >
              <AgentIcon agent={agent.id} />
              <span className="min-w-0 truncate">{agent.label}</span>
              <Badge variant="secondary" className="ml-auto tabular-nums">
                {source?.count ?? 0}
              </Badge>
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}
