import { Trans } from "@lingui/react/macro";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { acquireTerminal } from "~/features/ssh-sftp/runtime/terminalRuntime";
import { describeError } from "~/lib/errors";
import type { Session } from "~/types";

interface Props {
  session: Session;
}

/**
 * 终端视图：只负责把运行期持有的 xterm 槽位挂到页面上。
 *
 * 实例创建、shell 打开、数据订阅都在 `terminalRuntime` 里按会话持有，
 * 因此切页/重挂载不会重建终端，也不会漏掉离开期间的输出。
 */
export default function Terminal({ session }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shellOpening, setShellOpening] = useState(false);
  const hasBackendSession = !session.id.startsWith("tab-");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    return acquireTerminal(session.id, element, setShellOpening);
  }, [session.id]);

  if (session.status === "connecting" && !hasBackendSession) {
    const sessionTitle = session.title;
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <LoaderCircle className="size-4 animate-spin" />
        <span>
          <Trans>正在连接 {sessionTitle}…</Trans>
        </span>
      </div>
    );
  }
  if (session.status === "error") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert className="text-destructive" />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>连接失败</Trans>
          </EmptyTitle>
          <EmptyDescription className="break-words">
            {session.error ? describeError(session.error) : null}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="relative h-full w-full bg-[#0a0a0a]">
      <div ref={containerRef} className="h-full w-full p-1" />
      {session.status === "connecting" || shellOpening ? (
        <div className="bg-background/70 absolute inset-0 flex items-center justify-center backdrop-blur-[1px]">
          <div className="border-border bg-popover text-popover-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-sm">
            <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
            <Trans>正在打开终端…</Trans>
          </div>
        </div>
      ) : null}
    </div>
  );
}
