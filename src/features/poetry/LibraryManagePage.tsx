import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowLeft,
  FolderInput,
  ScrollText,
  Trash2,
} from "lucide-react";

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
import { Checkbox } from "~/components/ui/checkbox";
import { describeError } from "~/lib/errors";
import { isDesktopPlatform } from "~/lib/platform";

import {
  CollectionDownloadFooter,
  CollectionGroups,
  CollectionSection,
} from "./components/CollectionManagement";
import TranslationPackManager from "./components/TranslationPackManager";
import { usePoetryCollectionsManage } from "./hooks/use-poetry-collections-manage";
import { usePoetryLocalData } from "./hooks/use-poetry-local-data";

export default function LibraryManagePage({
  search,
}: {
  /** 来源列表的查询上下文，返回时带回。 */
  search: { q?: string; poem?: string };
}) {
  const { t } = useLingui();
  const localDataAvailable = isDesktopPlatform();
  const controller = usePoetryCollectionsManage();
  const {
    progress,
    selectedPendingIds,
    starting,
    busy: syncBusy,
    pendingDelete,
    setPendingDelete,
    confirmDelete: handleDeleteConfirmed,
  } = controller;
  const {
    bodyIndex,
    annotationsCount,
    translationPacks,
    setTranslationPacks,
    extrasError,
    extrasLoading,
    refreshExtras,
    busy: extrasBusy,
    importLocal,
    toggleBodyIndex,
    installAnnotations,
    deleteAnnotations,
  } = usePoetryLocalData(
    progress,
    selectedPendingIds,
    syncBusy,
    localDataAvailable,
  );
  const toLocaleStringValue2 = bodyIndex?.indexedPoems.toLocaleString();
  const toLocaleStringValue3 = annotationsCount?.toLocaleString();
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
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            <Trans>下载后即可离线搜索和阅读。</Trans>
          </p>
          <CollectionGroups controller={controller} />
          {localDataAvailable ? (
            <CollectionSection title={<Trans>译文与本地语料</Trans>}>
              <Button
                className="self-start"
                density="adaptive"
                variant="outline"
                disabled={
                  syncBusy ||
                  extrasBusy ||
                  starting ||
                  controller.loading ||
                  !!controller.error ||
                  selectedPendingIds.length === 0
                }
                onClick={() => void importLocal()}
              >
                <FolderInput data-icon="inline-start" />
                <Trans>从本地 tar.gz 导入…</Trans>
              </Button>
              {/* 偏好：两行精简设置。 */}
              {extrasError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <p className="text-destructive text-xs break-words">
                    {describeError(extrasError)}
                  </p>
                  <Button
                    variant="outline"
                    density="adaptive"
                    onClick={() => void refreshExtras()}
                  >
                    <Trans>重试</Trans>
                  </Button>
                </div>
              ) : extrasLoading ? (
                <p role="status" className="text-muted-foreground text-xs">
                  <Trans>加载中…</Trans>
                </p>
              ) : (
                <div className="divide-y">
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <ScrollText
                          className="text-muted-foreground size-3.5"
                          aria-hidden
                        />
                        <Trans>正文全文索引</Trans>
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {bodyIndex?.enabled
                          ? t`已索引 ${toLocaleStringValue2} 篇，搜索亚毫秒返回`
                          : t`关闭时正文搜索走 LIKE 兜底，较慢`}
                      </p>
                    </div>
                    <label className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
                      <Checkbox
                        checked={bodyIndex?.enabled ?? false}
                        disabled={syncBusy || extrasBusy}
                        onCheckedChange={(checked) =>
                          void toggleBodyIndex(checked === true)
                        }
                        aria-label={t`正文全文索引`}
                      />
                      {t`开启`}
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <Trans>注释包（译文 / 赏析）</Trans>
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {annotationsCount
                          ? t`已安装 ${toLocaleStringValue3} 条，约 14MB`
                          : t`未安装；仅点击时下载，可随时删除`}
                      </p>
                    </div>
                    {annotationsCount ? (
                      <Button
                        variant="outline"
                        density="adaptive"
                        disabled={syncBusy || extrasBusy}
                        onClick={() => void deleteAnnotations()}
                      >
                        <Trash2 data-icon="inline-start" />
                        <Trans>删除</Trans>
                      </Button>
                    ) : (
                      <Button
                        density="adaptive"
                        disabled={syncBusy || extrasBusy}
                        onClick={() => void installAnnotations()}
                      >
                        <ArrowDownToLine data-icon="inline-start" />
                        <Trans>安装</Trans>
                      </Button>
                    )}
                  </div>

                  <TranslationPackManager
                    packs={translationPacks}
                    disabled={syncBusy || extrasBusy}
                    onChange={setTranslationPacks}
                  />
                </div>
              )}
            </CollectionSection>
          ) : null}
        </div>
      </div>
      <CollectionDownloadFooter controller={controller} />

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
