import { Trans, useLingui } from "@lingui/react/macro";
import { ListFilter, Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "~/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { AgentIcon, availableSessionAgents } from "./agents";
import type { SessionDateRange } from "./date-range";
import { SessionDateFilter } from "./SessionDateFilter";
import type { useAgentSessions } from "./use-agent-sessions";

type Controller = ReturnType<typeof useAgentSessions>;

export function SessionFilters({ controller: c }: { controller: Controller }) {
  const { t } = useLingui();
  const agents = availableSessionAgents(c.sources.data?.sources ?? []);
  const label = t({
    message: "筛选会话",
    comment: "标题栏图标，打开 agent、日期与归档状态筛选面板",
  });
  return (
    <>
      <InputGroup className="w-36 md:w-64 xl:w-80">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={c.search}
          onChange={(event) => c.setSearch(event.target.value)}
          maxLength={256}
          aria-label={t({
            message: "搜索对话、项目或 session ID",
            comment: "本机会话全文检索输入框",
          })}
          placeholder={t`搜索对话、项目或 session ID`}
        />
      </InputGroup>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={c.filtered ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            title={label}
          >
            <ListFilter />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="ui-density-adaptive app-scroll-safe-end max-h-(--radix-popover-content-available-height) w-fit max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
        >
          {/* 横排筛选按内容定宽，关闭 FieldGroup 的尺寸隔离以保留固有宽度。 */}
          <FieldGroup density="compact" className="@container-normal w-max">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="session-agent-filter">
                <Trans>Agent 分类</Trans>
              </FieldLabel>
              <Select
                value={c.agent}
                onValueChange={(value) => {
                  if (
                    value === "all" ||
                    agents.some((agent) => agent.id === value)
                  )
                    c.setAgent(value as Controller["agent"]);
                }}
              >
                <SelectTrigger
                  id="session-agent-filter"
                  className="w-40"
                  aria-label={t`按 agent 分类`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="ui-density-adaptive">
                  <SelectGroup>
                    <SelectItem value="all">
                      <Trans comment="会话来源分类，显示本机已发现的全部 agent 记录">
                        全部 agent
                      </Trans>
                    </SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        <AgentIcon agent={agent.id} />
                        {agent.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="session-archive-filter">
                <Trans>归档状态</Trans>
              </FieldLabel>
              <Select
                value={c.archive}
                onValueChange={(value) =>
                  c.setArchive(value as "all" | "active" | "archived")
                }
              >
                <SelectTrigger
                  id="session-archive-filter"
                  className="w-40"
                  aria-label={t`按归档状态筛选`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="ui-density-adaptive">
                  <SelectGroup>
                    <SelectItem value="all">
                      <Trans>全部记录</Trans>
                    </SelectItem>
                    <SelectItem value="active">
                      <Trans>未归档</Trans>
                    </SelectItem>
                    <SelectItem value="archived">
                      <Trans>已归档</Trans>
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="session-date-filter">
                <Trans>日期</Trans>
              </FieldLabel>
              <Select
                value={c.range}
                onValueChange={(value) => c.setRange(value as SessionDateRange)}
              >
                <SelectTrigger
                  id="session-date-filter"
                  className="w-40"
                  aria-label={t`按最后活动日期筛选`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="ui-density-adaptive">
                  <SelectGroup>
                    <SelectItem value="all">
                      <Trans>全部日期</Trans>
                    </SelectItem>
                    <SelectItem value="today">
                      <Trans>今天</Trans>
                    </SelectItem>
                    <SelectItem value="week">
                      <Trans>最近 7 天</Trans>
                    </SelectItem>
                    <SelectItem value="month">
                      <Trans comment="会话日期筛选，选择任意历史月份">
                        按月份
                      </Trans>
                    </SelectItem>
                    <SelectItem value="custom">
                      <Trans>自定义日期</Trans>
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <SessionDateFilter controller={c} />
            {c.filtered && (
              <Button variant="ghost" onClick={c.clearFilters}>
                <Trans comment="清除面板中的来源、日期、归档条件与搜索词">
                  清除筛选
                </Trans>
              </Button>
            )}
          </FieldGroup>
        </PopoverContent>
      </Popover>
    </>
  );
}
