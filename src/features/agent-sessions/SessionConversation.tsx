import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { Brain, ChevronRight, Info, UserRound, Wrench } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";

import type {
  AgentSessionMessage,
  SessionAgent,
  SessionRole,
} from "~/bindings";

import { AgentIcon, agentName } from "./agents";
import { MessageText } from "./MessageText";
import { SessionImage } from "./SessionImage";

const roles = {
  user: msg({ message: "你", comment: "历史会话中的本机用户身份标签" }),
  assistant: msg({ message: "助手", comment: "历史会话中的 AI 回复身份标签" }),
  tool: msg`工具`,
  thinking: msg`思考`,
  system: msg`系统`,
} satisfies Record<SessionRole, ReturnType<typeof msg>>;

export function SessionConversation({
  messages,
  matchIndex,
  search,
  agent,
  generation,
  sessionKey,
  expanded,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  messages: AgentSessionMessage[];
  matchIndex: number | null;
  search: string;
  agent: SessionAgent;
  generation: string;
  sessionKey: string;
  expanded: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const jumped = useRef(false);
  const first = useRef(messages[0]?.index);
  const anchor = useRef<{ index: number; offset: number } | null>(null);
  // 正文按页加载并限制为 400 段，保留自然文档流，折叠不依赖缓存行高。
  useLayoutEffect(() => {
    if (
      first.current !== messages[0]?.index &&
      anchor.current &&
      scroll.current
    ) {
      const element = scroll.current.querySelector<HTMLElement>(
        '[data-message-index="' + anchor.current.index + '"]',
      );
      if (element)
        scroll.current.scrollTop = element.offsetTop + anchor.current.offset;
    }
    first.current = messages[0]?.index;
    if (!jumped.current && matchIndex !== null && scroll.current) {
      const target = scroll.current.querySelector<HTMLElement>(
        '[data-message-index="' + matchIndex + '"]',
      );
      if (target) {
        scroll.current.scrollTop = target.offsetTop;
        jumped.current = true;
      }
    }
  }, [messages, matchIndex]);
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void onLoadMore();
      },
      { root: scroll.current, rootMargin: "200px" },
    );
    if (end.current) observer.observe(end.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);
  const time = new Intl.DateTimeFormat(i18n.locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div
      ref={scroll}
      className="app-scroll-safe-end min-h-0 flex-1 overflow-auto px-3"
      aria-label={t`对话记录`}
      onScroll={() => {
        const top = scroll.current?.scrollTop ?? 0;
        const nodes =
          scroll.current?.querySelectorAll<HTMLElement>(
            "[data-message-index]",
          ) ?? [];
        const element = [...nodes].find(
          (node) => node.offsetTop + node.offsetHeight > top,
        );
        if (element)
          anchor.current = {
            index: Number(element.dataset.messageIndex),
            offset: top - element.offsetTop,
          };
      }}
    >
      <div className="relative">
        {messages.map((message) => {
          const folded =
            message.role === "tool" ||
            message.role === "thinking" ||
            message.role === "system";
          const Icon =
            message.role === "user"
              ? UserRound
              : message.role === "tool"
                ? Wrench
                : message.role === "thinking"
                  ? Brain
                  : Info;
          return (
            <article
              key={message.index}
              data-message-index={message.index}
              className="flex w-full items-start gap-3 py-2"
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                  "agent-" + agent,
                  message.role === "assistant"
                    ? "bg-[color-mix(in_srgb,var(--agent-color)_10%,var(--card))]"
                    : message.role === "user"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {message.role === "assistant" ? (
                  <AgentIcon agent={agent} className="size-full" />
                ) : (
                  <Icon className="size-6" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {folded ? (
                  <details
                    open={expanded || message.index === matchIndex}
                    className="group bg-muted/40 rounded-lg px-3 py-2"
                  >
                    <summary className="focus-visible:ring-ring flex cursor-pointer items-center gap-2 rounded-sm outline-none focus-visible:ring-2">
                      <ChevronRight className="size-3 shrink-0 group-open:rotate-90 motion-safe:transition-transform" />
                      <span className="shrink-0 text-xs font-medium">
                        {t(roles[message.role])}
                      </span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                        {message.text.slice(0, 90)}
                      </span>
                    </summary>
                    <div className="mt-2">
                      <MessageText text={message.text} search={search} />
                    </div>
                  </details>
                ) : (
                  <div
                    className={cn(
                      "flex flex-col gap-1.5 rounded-xl px-3 py-2",
                      message.role === "user" && "bg-muted/50",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "shrink-0 font-semibold",
                          "agent-" + agent,
                          message.role === "assistant" &&
                            "text-[var(--agent-ink)]",
                        )}
                      >
                        {message.role === "assistant"
                          ? agentName(agent)
                          : t(roles[message.role])}
                      </span>
                      {message.model && (
                        <span
                          className="text-muted-foreground min-w-0 truncate font-mono"
                          title={message.model}
                        >
                          {message.model}
                        </span>
                      )}
                      {message.timestamp !== null && (
                        <time className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                          {time.format(message.timestamp)}
                        </time>
                      )}
                    </div>
                    <MessageText text={message.text} search={search} />
                  </div>
                )}
                {!!message.images?.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.images.map((image) => (
                      <SessionImage
                        key={image.index}
                        image={image}
                        generation={generation}
                        sessionKey={sessionKey}
                        messageIndex={message.index}
                      />
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <div ref={end} className="h-px" />
    </div>
  );
}
