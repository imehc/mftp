import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDownToLine, FolderInput, ScrollText, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { describeError } from "~/lib/errors";
import { isDesktopPlatform } from "~/lib/platform";

import type { usePoetryCollectionsManage } from "../hooks/use-poetry-collections-manage";
import { usePoetryLocalData } from "../hooks/use-poetry-local-data";
import { CollectionSection } from "./CollectionManagement";
import TranslationPackManager from "./TranslationPackManager";

type Props = { controller: ReturnType<typeof usePoetryCollectionsManage> };

export default function PoetryLocalManagement({ controller }: Props) {
  const { t } = useLingui();
  const localDataAvailable = isDesktopPlatform();
  const { selectedPendingIds, busy: syncBusy, starting } = controller;
  const {
    bodyIndex,
    annotationsCount,
    translationPacks,
    onPacksChange,
    extrasError,
    extrasLoading,
    refreshExtras,
    busy: extrasBusy,
    importLocal,
    toggleBodyIndex,
    installAnnotations,
    deleteAnnotations,
  } = usePoetryLocalData(selectedPendingIds, syncBusy, localDataAvailable);
  const toLocaleStringValue2 = bodyIndex?.indexedPoems.toLocaleString();
  const toLocaleStringValue3 = annotationsCount?.toLocaleString();
  return localDataAvailable ? (
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
          <p className="text-destructive text-xs wrap-break-word">
            {describeError(extrasError, t)}
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
                  ? t`已索引 ${toLocaleStringValue2} 篇`
                  : t`关闭时正文搜索较慢`}
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
            onChange={onPacksChange}
          />
        </div>
      )}
    </CollectionSection>
  ) : null;
}
