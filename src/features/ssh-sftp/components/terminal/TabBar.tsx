import { useState, type Ref } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useSessionsStore } from "~/store/sessions";
import type { Session } from "~/types";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { describeError } from "~/lib/errors";

export default function TabBar({
  onHosts,
  actionRef,
}: {
  onHosts: () => void;
  actionRef: Ref<HTMLDivElement>;
}) {
  const { t } = useLingui();
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const setView = useSessionsStore((s) => s.setView);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const [closing, setClosing] = useState(false);
  const active = sessions.find((session) => session.id === activeId);
  if (!active) return null;
  const statuses = {
    connecting: t`连接中`,
    connected: t`已连接`,
    closed: t`已断开`,
    error: t`失败`,
  };
  return (
    <div className="shrink-0 border-b">
      <div className="flex min-h-11 items-center gap-2 border-b px-3">
        <Select value={active.id} onValueChange={setActive}>
          <SelectTrigger
            density="adaptive"
            className="max-w-64 min-w-0 flex-1"
            aria-label={t`选择连接`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="ui-density-adaptive">
            {sessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.title} · {statuses[session.status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`打开主机列表`}
          onClick={onHosts}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={t`关闭连接`}
          disabled={closing}
          onClick={async () => {
            setClosing(true);
            try {
              await closeSession(active.id);
            } catch (error) {
              toast.error(describeError(error));
            } finally {
              setClosing(false);
            }
          }}
        >
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-1">
        <Tabs
          value={active.view}
          onValueChange={(view) => setView(active.id, view as Session["view"])}
          className="min-w-0"
        >
          <TabsList density="adaptive" aria-label={t`连接视图`}>
            <TabsTrigger value="terminal">
              <Trans>终端</Trans>
            </TabsTrigger>
            <TabsTrigger value="sftp" disabled={active.status !== "connected"}>
              <Trans>文件</Trans>
            </TabsTrigger>
            <TabsTrigger
              value="monitor"
              disabled={active.status !== "connected"}
            >
              <Trans>监控</Trans>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div ref={actionRef} className="flex items-center gap-2" />
      </div>
    </div>
  );
}
