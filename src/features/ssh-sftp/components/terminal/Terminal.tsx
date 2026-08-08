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

// Encode/decode helpers for the base64 transport used by the shell channel.
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

  useEffect(() => {
    // Wire up a real shell once the backend session id exists. The session
    // remains "connecting" until this succeeds, so sidebars/tabs do not turn
    // green before the terminal is actually open.
    if (
      session.status !== "connected" &&
      !(session.status === "connecting" && !session.id.startsWith("tab-"))
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
      theme: { background: "#0a0a0a", foreground: "#e5e5e5" },
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

    // Backend -> terminal: decode base64 payloads and write.
    const unlistenData = listen<string>(sshDataEvent(sessionId), (e) => {
      if (!disposed) term.write(base64ToBytes(e.payload));
    });
    const unlistenClosed = listen<string>(sshClosedEvent(sessionId), () => {
      if (!disposed) {
        term.write(`\r\n\x1b[31m[${t`连接已关闭`}]\x1b[0m\r\n`);
        patch(
          sessionId,
          shellOpenConfirmed
            ? { status: "closed" }
            : {
                status: "error",
                error: t`远端连接在终端打开前已关闭`,
              },
        );
      }
    });

    // Open the remote shell sized to the current terminal.
    void ipc
      .sshOpenShell(sessionId, term.cols, term.rows)
      .then(() => {
        shellOpenConfirmed = true;
        if (!disposed) {
          setShellOpening(false);
          patch(sessionId, { status: "connected" });
        }
      })
      .catch((e) => {
        if (!disposed) setShellOpening(false);
        patch(sessionId, { status: "error", error: String(e) });
        toast.error(t`打开终端失败：${e}`);
      });

    // Terminal -> backend: forward keystrokes as base64.
    const onData = term.onData((data) => {
      void ipc.sshWrite(sessionId, bytesToBase64(enc.encode(data)));
    });

    // Keep the pty sized to the container.
    const doResize = () => {
      try {
        fit.fit();
        void ipc.sshResize(sessionId, term.cols, term.rows);
      } catch {
        /* container not measurable yet */
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
    // Re-run only when the backend session identity changes. Changing status
    // from connecting -> connected must not reopen the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  if (session.status === "connecting" && !hasBackendSession) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span><Trans>正在连接 {session.title}…</Trans></span>
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
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            <Trans>正在打开终端…</Trans>
          </div>
        </div>
      ) : null}
    </div>
  );
}
