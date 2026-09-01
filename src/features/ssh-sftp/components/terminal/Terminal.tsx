import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { Session } from "~/types";
import { useSessionsStore } from "~/store/sessions";
import * as ipc from "~/lib/ipc";
import { sshClosedEvent, sshDataEvent } from "~/lib/events";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
interface Props {
  session: Session;
}

// 编解码辅助函数，用于 shell 通道的 base64 传输。
const enc = new TextEncoder();
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export default function Terminal({ session }: Props) {
  const { t } = useLingui();
  const containerRef = useRef<HTMLDivElement>(null);
  const patch = useSessionsStore((s) => s.patch);
  const [shellOpening, setShellOpening] = useState(false);
  const hasBackendSession = !session.id.startsWith("tab-");
  // 每个会话 id 的 shell 只能打开一次；status / t 通过最新值 ref 读取，
  // 这样状态翻转或语言切换都不会重新打开它。
  const sessionStatusRef = useRef(session.status);
  const tRef = useRef(t);
  useEffect(() => {
    sessionStatusRef.current = session.status;
    tRef.current = t;
  });
  useEffect(() => {
    // 后端会话 id 存在后，再接上真实的 shell。在此之前会话保持
    // “connecting”，使侧边栏 / 标签不会在终端真正打开前就变绿。
    if (
      sessionStatusRef.current !== "connected" &&
      !(
        sessionStatusRef.current === "connecting" &&
        !session.id.startsWith("tab-")
      )
    ) {
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const term = new XTerm({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
      },
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const sessionId = session.id;
    let disposed = false;
    let shellOpenConfirmed = false;
    setShellOpening(true);

    // 后端 → 终端：解码 base64 负载并写入。
    const unlistenData = listen<string>(sshDataEvent(sessionId), (e) => {
      if (!disposed) term.write(base64ToBytes(e.payload));
    });
    const unlistenClosed = listen<string>(sshClosedEvent(sessionId), () => {
      if (!disposed) {
        term.write(`\r\n\x1b[31m[${tRef.current`连接已关闭`}]\x1b[0m\r\n`);
        patch(
          sessionId,
          shellOpenConfirmed
            ? {
                status: "closed",
              }
            : {
                status: "error",
                error: tRef.current`远端连接在终端打开前已关闭`,
              },
        );
      }
    });

    // 按当前终端尺寸打开远程 shell。
    void ipc
      .sshOpenShell(sessionId, term.cols, term.rows)
      .then(() => {
        shellOpenConfirmed = true;
        if (!disposed) {
          setShellOpening(false);
          patch(sessionId, {
            status: "connected",
          });
        }
      })
      .catch((e) => {
        if (!disposed) setShellOpening(false);
        patch(sessionId, {
          status: "error",
          error: String(e),
        });
        toast.error(tRef.current`打开终端失败：${e}`);
      });

    // 终端 → 后端：将按键以 base64 转发。
    const onData = term.onData((data) => {
      void ipc.sshWrite(sessionId, bytesToBase64(enc.encode(data)));
    });

    // 让 pty 尺寸跟随容器。
    const doResize = () => {
      try {
        fit.fit();
        void ipc.sshResize(sessionId, term.cols, term.rows);
      } catch {
        /* 容器尚不可测量 */
      }
    };
    const ro = new ResizeObserver(doResize);
    ro.observe(el);
    term.focus();
    return () => {
      disposed = true;
      setShellOpening(false);
      ro.disconnect();
      onData.dispose();
      void unlistenData.then((f) => f());
      void unlistenClosed.then((f) => f());
      term.dispose();
    };
    // 仅在后端会话身份变化时重跑。状态从 connecting → connected 切换
    // 时不得重新打开 shell。
  }, [patch, session.id]);
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
            {session.error}
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
