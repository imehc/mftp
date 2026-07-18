import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { FolderOpen, LoaderCircle, TerminalSquare, X } from "lucide-react";
import { useSessionsStore } from "~/store/sessions";
import { cn } from "~/lib/utils";

const statusColor: Record<string, string> = {
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  closed: "bg-muted-foreground",
  error: "bg-destructive",
};

export default function TabBar() {
  const { t } = useLingui();
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const setView = useSessionsStore((s) => s.setView);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());

  async function closeTab(id: string) {
    setClosingIds((current) => new Set(current).add(id));
    try {
      await closeSession(id);
    } finally {
      setClosingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  if (sessions.length === 0) return null;

  return (
    <div className="flex h-9 items-stretch gap-1 border-b border-border bg-sidebar px-1.5">
      <div className="flex flex-1 items-stretch gap-1 overflow-x-auto py-1">
        {sessions.map((s) => {
          const isClosing = closingIds.has(s.id);
          return (
            <div
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs",
                s.id === activeId
                  ? "border-border bg-background"
                  : "border-transparent text-muted-foreground hover:bg-sidebar-accent",
              )}
            >
              {isClosing ? (
                <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    statusColor[s.status] ?? "bg-muted-foreground",
                  )}
                />
              )}
              <span className="max-w-32 truncate">{s.title}</span>

              {s.status === "connected" && (
                <button
                  title={s.view === "terminal" ? t`打开文件管理` : t`打开终端`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setView(s.id, s.view === "terminal" ? "sftp" : "terminal");
                  }}
                  className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
                  disabled={isClosing}
                >
                  {s.view === "terminal" ? (
                    <FolderOpen className="size-3.5" />
                  ) : (
                    <TerminalSquare className="size-3.5" />
                  )}
                </button>
              )}

              <button
                title={isClosing ? t`关闭中` : t`关闭`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(s.id);
                }}
                className="rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100 disabled:opacity-50"
                disabled={isClosing}
              >
                {isClosing ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
