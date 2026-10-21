import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
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
import PoetryLocalManagement from "~/features/poetry/components/PoetryLocalManagement";

import {
  CollectionDownloadButton,
  CollectionGroups,
} from "./components/CollectionManagement";
import PoetrySyncStatus from "./components/PoetrySyncStatus";
import { usePoetryCollectionsManage } from "./hooks/use-poetry-collections-manage";

export default function LibraryManagePage({
  search,
}: {
  /** 来源列表的查询上下文，返回时带回。 */
  search: { q?: string; poem?: string };
}) {
  const { t } = useLingui();
  const controller = usePoetryCollectionsManage();
  const {
    pendingDelete,
    setPendingDelete,
    confirmDelete: handleDeleteConfirmed,
  } = controller;
  const pendingDeleteName = pendingDelete?.name;
  const toLocaleStringValue4 = pendingDelete?.poemCount.toLocaleString();
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader
        showHome={false}
        title={<Trans>诗词数据管理</Trans>}
        leading={
          <Button variant="ghost" density="adaptive" size="icon-sm" asChild>
            <Link
              aria-label={t`返回古诗词`}
              title={t`返回古诗词`}
              to="/library"
              search={{
                q: search.q,
                poem: search.poem,
              }}
            >
              <ArrowLeft data-icon="inline-start" />
            </Link>
          </Button>
        }
        trailing={
          <CollectionDownloadButton
            count={controller.selectedPendingIds.length}
            disabled={
              controller.busy ||
              controller.loading ||
              !!controller.error ||
              controller.selectedPendingIds.length === 0
            }
            onDownload={() => void controller.startSync()}
          />
        }
      />

      <AppPageContent bottomInset="scroll">
        <PoetrySyncStatus
          progress={controller.progress}
          collections={controller.collections}
          starting={controller.starting}
          className="sticky top-0 z-10"
          onCancel={controller.cancelSync}
        />
        <p className="text-muted-foreground text-sm">
          <Trans>下载后即可离线搜索和阅读。</Trans>
        </p>
        <CollectionGroups controller={controller} />
        <PoetryLocalManagement controller={controller} />
      </AppPageContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>{t`卸载合集`}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? t`将删除「${pendingDeleteName}」的全部本地数据（${toLocaleStringValue4} 篇）。此操作不可撤销。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteConfirmed()}>
              {t`卸载`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
