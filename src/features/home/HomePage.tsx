import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  FileClock,
  Home,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import AppSettingsMenu from "~/features/settings/AppSettingsMenu";
import TransferPanel from "~/features/transfers/TransferPanel";
import { useHostsStore } from "~/store/hosts";
import { useSessionsStore } from "~/store/sessions";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

export default function HomePage() {
  const hosts = useHostsStore((s) => s.hosts);
  const sessions = useSessionsStore((s) => s.sessions);
  const transfers = useTransfersStore((s) => s.transfers);
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  const activeSessions = sessions.filter(
    (session) =>
      session.status === "connecting" || session.status === "connected",
  );
  const runningTransfers = transfers.filter(
    (transfer) => transfer.status === "running",
  );
  const failedTransfers = transfers.filter(
    (transfer) => transfer.status === "error",
  );
  const hasActivity =
    activeSessions.length > 0 ||
    runningTransfers.length > 0 ||
    failedTransfers.length > 0;

  return (
    <main className="h-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-2.5 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md border border-border bg-card">
              <Home className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">MFTP</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                工具与运行状态
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            <Badge variant={hasActivity ? "secondary" : "outline"}>
              <Activity data-icon="inline-start" />
              {hasActivity ? "活动中" : "空闲"}
            </Badge>
            <Badge variant="outline">{activeSessions.length} 连接</Badge>
            <Badge variant="outline">{runningTransfers.length} 传输</Badge>
            {failedTransfers.length > 0 ? (
              <Badge variant="destructive">{failedTransfers.length} 失败</Badge>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link to="/logs" preload="viewport">
                <FileClock data-icon="inline-start" />
                日志
              </Link>
            </Button>
            <AppSettingsMenu />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-3">
          <section className="flex flex-col gap-3">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),320px))] justify-start gap-2">
              <Link
                to="/tools/ssh-sftp"
                onClick={() => setLastTool("ssh-sftp")}
                className="group flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent hover:text-accent-foreground"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background group-hover:bg-background">
                    <TerminalSquare className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      SSH / SFTP
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{hosts.length} 主机</Badge>
                      <Badge variant="outline">{activeSessions.length} 连接</Badge>
                      <Badge variant="outline">{runningTransfers.length} 传输</Badge>
                    </span>
                  </span>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-accent-foreground" />
              </Link>
              <Link
                to="/tools/lan-transfer"
                preload="viewport"
                onClick={() => setLastTool("lan-transfer")}
                className="group flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent hover:text-accent-foreground"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background group-hover:bg-background">
                    <Wifi className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      局域网传输
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">HTTP</Badge>
                      <Badge variant="outline">浏览器访问</Badge>
                    </span>
                  </span>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-accent-foreground" />
              </Link>
            </div>

            <TransferPanel />
          </section>
        </div>
      </div>
    </main>
  );
}
