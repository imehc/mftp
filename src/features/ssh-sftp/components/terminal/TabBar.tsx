import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, FolderOpen, Gauge, LoaderCircle, TerminalSquare, X } from "lucide-react";
import { useSessionsStore } from "~/store/sessions";
import type { Session } from "~/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

const statusColor: Record<string, string> = {
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  closed: "bg-muted-foreground",
  error: "bg-destructive",
};

interface ViewOption {
  view: Session["view"];
  icon: typeof TerminalSquare;
  label: string;
}

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

  const viewOptions: ViewOption[] = [
    { view: "terminal", icon: TerminalSquare, label: t`终端` },
    { view: "sftp", icon: FolderOpen, label: t`文件管理` },
    { view: "monitor", icon: Gauge, label: t`系统监控` },
  ];

  return (
    <div className="flex h-9 items-stretch gap-1 border-b border-border bg-sidebar px-1.5">
      <div className="flex flex-1 items-stretch gap-1 overflow-x-auto py-1">
        {sessions.map((s) => {
          const isClosing = closingIds.has(s.id);
          const { icon: ViewIcon, label: viewLabel } =
            viewOptions.find((option) => option.view === s.view) ?? viewOptions[0];
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title={viewLabel}
                      aria-label={t`切换视图：${viewLabel}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-0.5 rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
                      disabled={isClosing}
                    >
                      <ViewIcon className="size-3.5" />
                      <ChevronDown className="size-2.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-36">
                    {viewOptions.map(({ view, icon: Icon, label }) => (
                      <DropdownMenuItem
                        key={view}
                        onSelect={() => setView(s.id, view)}
                        className={cn(view === s.view && "bg-accent text-accent-foreground")}
                      >
                        <Icon className="size-3.5" />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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