import { FolderOpen, TerminalSquare, X } from "lucide-react";
import { useSessionsStore } from "~/store/sessions";
import { cn } from "~/lib/utils";

const statusColor: Record<string, string> = {
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  closed: "bg-muted-foreground",
  error: "bg-destructive",
};

export default function TabBar() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const setView = useSessionsStore((s) => s.setView);
  const closeSession = useSessionsStore((s) => s.closeSession);

  if (sessions.length === 0) return null;

  return (
    <div className="flex h-9 items-stretch gap-1 border-b border-border bg-sidebar px-1.5">
      <div className="flex flex-1 items-stretch gap-1 overflow-x-auto py-1">
        {sessions.map((s) => (
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
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                statusColor[s.status] ?? "bg-muted-foreground",
              )}
            />
            <span className="max-w-32 truncate">{s.title}</span>

            {s.status === "connected" && (
              <button
                title={s.view === "terminal" ? "打开文件管理" : "打开终端"}
                onClick={(e) => {
                  e.stopPropagation();
                  setView(s.id, s.view === "terminal" ? "sftp" : "terminal");
                }}
                className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
              >
                {s.view === "terminal" ? (
                  <FolderOpen className="size-3.5" />
                ) : (
                  <TerminalSquare className="size-3.5" />
                )}
              </button>
            )}

            <button
              title="关闭"
              onClick={(e) => {
                e.stopPropagation();
                void closeSession(s.id);
              }}
              className="rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
