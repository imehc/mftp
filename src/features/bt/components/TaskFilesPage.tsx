import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Send } from "lucide-react";
import { useState } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { isMobilePlatform } from "~/lib/platform";
import type { BtTaskInfo } from "~/types";

import FileBrowserPanel from "./FileBrowserPanel";
import PeersPanel from "./PeersPanel";

export default function TaskFilesPage({
  task,
  initialTab,
  onClose,
  onExport,
  busy,
}: {
  task: BtTaskInfo;
  initialTab: string;
  onClose: () => void;
  onExport: () => void;
  busy: boolean;
}) {
  const { t } = useLingui();
  const [tab, setTab] = useState(initialTab);
  return (
    <div className="ui-density-adaptive flex h-full min-h-0 flex-col">
      <ToolPageHeader
        title={task.label}
        showHome={false}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`返回列表`}
            onClick={onClose}
          >
            <ArrowLeft />
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <div className="border-b px-3 py-2">
          <TabsList density="adaptive">
            <TabsTrigger value="files">
              <Trans>文件</Trans>
            </TabsTrigger>
            <TabsTrigger value="peers">
              <Trans>连接</Trans>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="files"
          forceMount
          hidden={tab !== "files"}
          className="min-h-0 flex-1 p-3"
        >
          <FileBrowserPanel task={task} />
        </TabsContent>
        <TabsContent value="peers" className="min-h-0 flex-1 p-3">
          <PeersPanel infoHash={task.infoHash} />
        </TabsContent>
      </Tabs>
      {task.status === "Completed" && !task.exported ? (
        <footer className="shrink-0 border-t px-3 pt-2 pb-[max(0.75rem,var(--safe-bottom,0px))]">
          <Button fullWidth disabled={busy} onClick={onExport}>
            <Send data-icon="inline-start" />
            {isMobilePlatform() ? (
              <Trans>复制到系统下载目录</Trans>
            ) : (
              <Trans>复制到用户目录</Trans>
            )}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
