import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import type { Session } from "~/types";
import { useSessionsStore } from "~/store/sessions";
import * as ipc from "~/lib/ipc";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const patch = useSessionsStore((s) => s.patch);

  useEffect(() => {
    // Only wire up a real shell once the backend session is connected.
    if (session.status !== "connected") return;
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

    // Open the remote shell sized to the current terminal.
    void ipc.sshOpenShell(sessionId, term.cols, term.rows).catch((e) => {
      patch(sessionId, { status: "error", error: String(e) });
      toast.error(`打开终端失败: ${e}`);
    });

    // Backend -> terminal: decode base64 payloads and write.
    const unlistenData = listen<string>(`ssh://data/${sessionId}`, (e) => {
      if (!disposed) term.write(base64ToBytes(e.payload));
    });
    const unlistenClosed = listen<string>(`ssh://closed/${sessionId}`, () => {
      if (!disposed) {
        term.write("\r\n\x1b[31m[连接已关闭]\x1b[0m\r\n");
        patch(sessionId, { status: "closed" });
      }
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
      ro.disconnect();
      onData.dispose();
      void unlistenData.then((f) => f());
      void unlistenClosed.then((f) => f());
      term.dispose();
    };
    // Re-run only when the connected session identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.status]);

  if (session.status === "connecting") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在连接 {session.title}…
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
          <EmptyTitle>连接失败</EmptyTitle>
          <EmptyDescription className="break-words">
            {session.error}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <div ref={containerRef} className="h-full w-full bg-[#0a0a0a] p-1" />;
}
