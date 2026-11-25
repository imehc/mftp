import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Info, MessagesSquare } from "lucide-react";
import { toast } from "sonner";

import type { AgentSessionSummary } from "~/bindings";
import { CopyButton } from "~/components/CopyButton";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";
import { customErrorMessages } from "~/lib/errors/messages";

import { AgentIcon, agentName } from "./agents";
import { SessionConversation } from "./SessionConversation";
import { useSessionDetail } from "./use-session-detail";

export function SessionDetail({
  session,
  generation,
  search,
  onlyChat,
  expanded,
  partialNotified = false,
  onOnlyChatChange,
  onClose,
}: {
  session: AgentSessionSummary;
  generation: string;
  search: string;
  onlyChat: boolean;
  expanded: boolean;
  partialNotified?: boolean;
  onOnlyChatChange: (value: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const c = useSessionDetail(session, generation);
  const partial = c.result?.complete === false && !partialNotified;
  const encrypted = session.contentAvailability === "encrypted";
  const readableMatch =
    !!search.trim() &&
    c.result?.messages.find((message) => message.index === session.matchIndex);
  const matchedOutsideChat =
    readableMatch &&
    readableMatch.role !== "user" &&
    readableMatch.role !== "assistant";
  const messages =
    c.result?.messages.filter(
      (message) =>
        !onlyChat ||
        message.role === "user" ||
        message.role === "assistant" ||
        (!!search.trim() && message.index === session.matchIndex),
    ) ?? [];
  return (
    <section className="agent-detail flex min-h-0 min-w-0 flex-col">
      <div className="border-border flex shrink-0 flex-col gap-1.5 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="@[44rem]/session:hidden"
            aria-label={t`返回会话列表`}
            onClick={onClose}
          >
            <ArrowLeft />
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {session.title || <Trans>无标题会话</Trans>}
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t`会话信息`}>
                <Info />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="flex flex-col gap-2 text-xs">
                <p className="font-medium">{agentName(session.agent)}</p>
                {session.model && (
                  <p className="font-mono [overflow-wrap:anywhere]">
                    {session.model}
                  </p>
                )}
                {session.cwd && (
                  <p className="[overflow-wrap:anywhere]">{session.cwd}</p>
                )}
                <p className="app-description font-mono [overflow-wrap:anywhere]">
                  {session.path}
                </p>
                {encrypted && (
                  <p className="app-description">
                    <Trans>用户和助手正文已加密，仅能读取工具与记忆。</Trans>
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <AgentIcon agent={session.agent} />
          <span className="shrink-0">{agentName(session.agent)}</span>
          {session.model && (
            <Badge
              variant="secondary"
              className="max-w-52 min-w-0 shrink truncate font-mono"
              title={session.model}
            >
              {session.model}
            </Badge>
          )}
          {session.archived && (
            <Badge variant="outline">
              <Trans>已归档</Trans>
            </Badge>
          )}
          <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
            <Plural
              value={session.messageCount}
              one="# 条对话"
              other="# 条对话"
            />
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="app-description shrink-0">session ID</span>
          <p
            className="min-w-0 flex-1 truncate font-mono text-xs"
            title={session.sessionId ?? undefined}
          >
            {session.sessionId ?? <Trans>来源未记录 session ID</Trans>}
          </p>
          <CopyButton
            value={session.sessionId ?? ""}
            disabled={!session.sessionId}
            variant="ghost"
            size="icon-sm"
            label={t`复制 session ID`}
            onError={(error) => toast.error(describeError(error, t))}
          />
        </div>
      </div>
      {(c.error || partial) && (
        <div className="p-3">
          <Alert variant={c.error ? "destructive" : "default"}>
            <AlertDescription>
              {c.error
                ? describeError(c.error, t)
                : t(customErrorMessages["agent_sessions:partial"])}
              {c.error && (
                <Button variant="outline" size="sm" onClick={c.retry}>
                  <Trans>重试</Trans>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}
      {c.busy ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm"
        >
          <Spinner />
          <Trans>正在读取对话</Trans>
        </div>
      ) : (
        c.result &&
        (encrypted && onlyChat && !readableMatch ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                <Trans>对话正文已加密</Trans>
              </EmptyTitle>
              <p className="app-description">
                <Trans>此来源的用户与助手正文无法读取。</Trans>
              </p>
            </EmptyHeader>
            {c.result.total > 0 && (
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => onOnlyChatChange(false)}
                >
                  <Trans comment="关闭只看对话，展示此加密会话中可读的工具和记忆">
                    查看可读记录
                  </Trans>
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <>
            {onlyChat && matchedOutsideChat && (
              <p className="app-description px-3 pt-2">
                <Trans>已显示命中的工具、思考或系统记录。</Trans>
              </p>
            )}
            {c.result.total === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    <Trans>暂无可读记录</Trans>
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <SessionConversation
                agent={session.agent}
                messages={messages}
                matchIndex={session.matchIndex}
                search={search}
                generation={generation}
                sessionKey={session.key}
                expanded={expanded}
                hasMore={c.result.nextOffset !== null}
                loadingMore={c.loadingMore}
                onLoadMore={c.loadMore}
              />
            )}
            <div className="border-border flex shrink-0 items-center justify-between gap-2 border-t p-2">
              {c.firstOffset > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={c.loadingMore}
                  onClick={() => void c.loadEarlier()}
                >
                  <Trans>较早记录</Trans>
                </Button>
              ) : (
                <span />
              )}
              <span className="app-description tabular-nums" role="status">
                {c.loadingMore ? (
                  <Spinner />
                ) : (
                  <>
                    {c.result.messages.length === 0 ? 0 : c.firstOffset + 1}–
                    {c.firstOffset + c.result.messages.length} /{" "}
                    {c.result.total}
                  </>
                )}
              </span>
              {c.result.nextOffset !== null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={c.loadingMore}
                  onClick={() => void c.loadMore()}
                >
                  <Trans>加载更多</Trans>
                </Button>
              ) : (
                <span />
              )}
            </div>
          </>
        ))
      )}
    </section>
  );
}

export function SessionDetailEmpty() {
  return (
    <section className="hidden min-h-0 min-w-0 @[44rem]/session:flex">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquare />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>选择一个会话</Trans>
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    </section>
  );
}
