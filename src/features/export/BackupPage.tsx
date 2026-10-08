import { Trans, useLingui } from "@lingui/react/macro";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { describeError } from "~/lib/errors";

import ExportPanel from "./ExportPanel";
import ImportPanel from "./ImportPanel";
import { useBackup } from "./use-backup";

export default function BackupPage() {
  const { t } = useLingui(),
    navigate = useNavigate();
  const c = useBackup();
  useBlocker({
    shouldBlockFn: () => {
      if (c.busy) toast.info(t`正在处理备份，请稍候`);
      return c.busy;
    },
    enableBeforeUnload: c.busy,
  });
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background flex h-full min-h-0 flex-col overflow-hidden"
    >
      <ToolPageHeader
        showHome={false}
        title={<Trans>数据导入与导出</Trans>}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            disabled={c.busy}
            aria-label={t`返回设置`}
            onClick={() => void navigate({ to: "/settings", search: {} })}
          >
            <ArrowLeft />
          </Button>
        }
      />
      <Tabs
        value={c.tab}
        onValueChange={c.changeTab}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 border-b px-3 py-2 md:px-4">
          <TabsList density="adaptive">
            <TabsTrigger value="export" disabled={c.busy}>
              <Trans>导出</Trans>
            </TabsTrigger>
            <TabsTrigger value="import" disabled={c.busy}>
              <Trans>导入</Trans>
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3 md:px-4">
          <div className="mx-auto flex max-w-4xl flex-col gap-3">
            {c.error ? (
              <Alert variant="destructive">
                <AlertDescription>{describeError(c.error)}</AlertDescription>
              </Alert>
            ) : null}
            <TabsContent value="export">
              <ExportPanel controller={c} />
            </TabsContent>
            <TabsContent value="import">
              <ImportPanel controller={c} />
            </TabsContent>
          </div>
        </div>
      </Tabs>
      <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t px-3 pt-3 pb-[max(0.75rem,var(--safe-bottom,0px))] md:px-4">
        {c.tab === "export" ? (
          <Button
            disabled={c.busy || !c.selected.size || c.passwordInvalid}
            onClick={() => void c.exportBackup()}
          >
            <Download data-icon="inline-start" />
            {c.busy ? <Trans>正在导出…</Trans> : <Trans>导出所选数据</Trans>}
          </Button>
        ) : c.report ? (
          <Button
            onClick={() => void navigate({ to: "/settings", search: {} })}
          >
            <Trans>完成</Trans>
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={c.busy}
              onClick={() => c.changeTab("export")}
            >
              <Trans>取消</Trans>
            </Button>
            <Button
              disabled={
                c.busy ||
                c.picking ||
                !c.file ||
                (c.file.preview.encrypted && !c.importPassword)
              }
              onClick={c.submitImport}
            >
              {c.busy ? <Trans>正在导入…</Trans> : <Trans>确认导入</Trans>}
            </Button>
          </>
        )}
      </DialogFooter>
      <AlertDialog
        open={c.confirmOverwrite}
        onOpenChange={(open) => {
          if (!c.busy) c.setConfirmOverwrite(open);
        }}
      >
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>覆盖已有数据？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                将删除备份所涉及模块中的现有记录，再写入备份内容。此操作无法撤销，请确认已保留需要的数据。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {c.error ? (
            <Alert variant="destructive">
              <AlertDescription>{describeError(c.error)}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={c.busy}>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={c.busy}
              onClick={(e) => {
                e.preventDefault();
                void c.importBackup();
              }}
            >
              <Trans>确认覆盖</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
