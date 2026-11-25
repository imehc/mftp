import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { MessagesSquare } from "lucide-react";

import type {
  AgentSessionsSnapshot,
  AgentSessionStorageSource,
  SessionAgent,
} from "~/bindings";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { formatBytes } from "~/lib/format";

import { AgentIcon, availableSessionAgents } from "./agents";

export function SessionSources({
  snapshot,
  selected,
  onSelect,
  storage,
}: {
  snapshot: AgentSessionsSnapshot;
  selected: SessionAgent | "all";
  onSelect: (agent: SessionAgent | "all") => void;
  storage?: AgentSessionStorageSource[];
}) {
  const { t } = useLingui();
  const agents = availableSessionAgents(snapshot.sources);
  const totalBytes =
    snapshot.complete &&
    storage?.every((source) => source.complete) &&
    agents.every((agent) => storage.some((source) => source.agent === agent.id))
      ? storage.reduce((total, source) => total + source.bytes, 0)
      : undefined;
  const count = snapshot.total;
  const storageSize = totalBytes === undefined ? "—" : formatBytes(totalBytes);
  return (
    <aside className="border-border bg-muted/40 hidden min-h-0 flex-col gap-3 overflow-y-auto border-r p-2 @[56rem]/session:flex">
      <nav aria-label="Agent" className="flex flex-col gap-1">
        <Button
          variant={selected === "all" ? "outline" : "ghost"}
          className="w-full justify-start"
          onClick={() => onSelect("all")}
          aria-pressed={selected === "all"}
        >
          <MessagesSquare data-icon="inline-start" />
          <Trans comment="显示所有 agent 的会话">全部会话</Trans>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto flex shrink-0">
                <Badge
                  variant="secondary"
                  className="shrink-0 tabular-nums"
                  role="img"
                  aria-label={t({
                    message: `会话数量：${count}；会话存储占用：${storageSize}`,
                    comment:
                      "来源数量徽标的读屏标签，count是会话数量，storageSize是格式化存储大小或未计量占位",
                  })}
                >
                  {snapshot.total}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent>{storageSize}</TooltipContent>
          </Tooltip>
        </Button>
        {agents.map((agent) => {
          const source = snapshot.sources.find(
            (source) => source.agent === agent.id,
          );
          const bytes = storage?.find(
            (source) => source.agent === agent.id,
          )?.bytes;
          const storageSize = bytes === undefined ? "—" : formatBytes(bytes);
          const count = source?.count ?? 0;
          return (
            <Button
              key={agent.id}
              variant={selected === agent.id ? "outline" : "ghost"}
              className={cn(
                "agent-choice h-auto min-h-8 w-full justify-start py-1",
                `agent-${agent.id}`,
              )}
              data-selected={selected === agent.id}
              onClick={() => onSelect(agent.id)}
              aria-pressed={selected === agent.id}
            >
              <AgentIcon agent={agent.id} />
              <span
                data-slot="agent-source-name"
                className="min-w-0 text-left [overflow-wrap:anywhere] whitespace-normal"
              >
                {agent.label}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto flex shrink-0">
                    <Badge
                      variant="secondary"
                      className="shrink-0 tabular-nums"
                      role="img"
                      aria-label={t({
                        message: `会话数量：${count}；会话存储占用：${storageSize}`,
                        comment:
                          "来源数量徽标的读屏标签，count是会话数量，storageSize是格式化存储大小或未计量占位",
                      })}
                    >
                      {count}
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{storageSize}</TooltipContent>
              </Tooltip>
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}
