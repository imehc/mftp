import { useEffect } from "react";
import { useHostsStore } from "~/store/hosts";
import { useSessionsStore } from "~/store/sessions";
import Sidebar from "~/components/layout/Sidebar";
import TabBar from "~/components/terminal/TabBar";
import Terminal from "~/components/terminal/Terminal";
import SftpPanel from "~/components/sftp/SftpPanel";
import { TerminalSquare } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export default function App() {
  const loadAll = useHostsStore((s) => s.loadAll);
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TabBar />
        <div className="relative flex-1 overflow-hidden">
          {sessions.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TerminalSquare />
                </EmptyMedia>
                <EmptyTitle>还没有打开的连接</EmptyTitle>
                <EmptyDescription>
                  在左侧选择主机并点击连接，或新建主机
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {/* Keep every session mounted so terminals preserve their state. */}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="absolute inset-0"
              style={{ display: session.id === activeId ? "block" : "none" }}
            >
              {/* Terminal stays mounted to keep the shell alive across view switches. */}
              <div
                className="h-full"
                style={{ display: session.view === "terminal" ? "block" : "none" }}
              >
                <Terminal session={session} />
              </div>
              {session.view === "sftp" && <SftpPanel session={session} />}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
