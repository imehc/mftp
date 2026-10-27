import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogFooter, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Textarea } from "~/components/ui/textarea";

import { usePoetryTranslations } from "../hooks/use-poetry-translations";
import PoetryReadError from "./PoetryReadError";

interface Props {
  uid: string;
  fontSize: number;
  lineHeight: number;
  referenceTranslation?: string;
  returnQuery?: string;
  /** 桌面提供分区标题；窄屏由原文/译文页签标记当前内容。 */
  labelId?: string;
  onReady?: (uid: string) => void;
  returnPage?: "library" | "detail";
}

export default function PoetryTranslationSection({
  uid,
  fontSize,
  lineHeight,
  referenceTranslation,
  returnQuery,
  labelId,
  onReady,
  returnPage = "detail",
}: Props) {
  const { t } = useLingui();
  const {
    current,
    currentPackTranslations,
    loading,
    readError,
    retryRead,
    generating,
    streamingContent,
    deleting,
    editing,
    setEditing,
    editContent,
    setEditContent,
    savingEdit,
    deleteOpen,
    setDeleteOpen,
    regenerateOpen,
    setRegenerateOpen,
    replacesManualTranslation,
    configurationMissing,
    generate,
    cancelGeneration,
    startEdit,
    saveEdit,
    remove,
    requestGeneration,
  } = usePoetryTranslations(uid);
  useEffect(() => {
    if (!loading && !readError) onReady?.(uid);
  }, [uid, loading, readError, onReady]);
  // 有注释包/开放译文兜底时，生成按钮退居次要位置，不再占据空状态的重心。
  const hasFallback =
    Boolean(referenceTranslation?.trim()) || currentPackTranslations.length > 0;
  const showCurrent = !loading && !generating && current !== null;
  return (
    <section className="flex flex-col gap-2 font-sans text-sm">
      {labelId || showCurrent ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {labelId ? (
            <h3
              id={labelId}
              className="text-muted-foreground shrink-0 text-sm font-medium"
            >
              <Trans comment="古诗词正文的现代汉语译文区域">译文</Trans>
            </h3>
          ) : null}
          {showCurrent && current ? (
            <>
              <Badge
                variant={current.source === "user" ? "secondary" : "outline"}
              >
                {current.source === "user" ? t`人工修订` : t`AI 生成`}
              </Badge>
              <span
                className="text-muted-foreground min-w-0 flex-1 basis-16 truncate text-xs"
                title={current.model}
              >
                {current.model}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={deleting}
                  aria-label={t`编辑译文`}
                  title={t`编辑译文`}
                  onClick={startEdit}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={deleting || savingEdit}
                  aria-label={t`重新生成`}
                  title={t`重新生成`}
                  onClick={requestGeneration}
                >
                  <RefreshCw aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={deleting}
                  aria-label={t`删除译文`}
                  title={t`删除译文`}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {readError ? (
        <PoetryReadError error={readError} onRetry={retryRead} />
      ) : null}

      {configurationMissing ? (
        <Alert>
          <AlertTitle>{t`尚未配置 AI 服务`}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Trans comment="未配置 AI 服务时无法生成译文">
              请先配置 AI 服务。
            </Trans>
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/settings"
                search={{
                  returnUid: uid,
                  returnQ: returnQuery,
                  returnView: "translation",
                  returnPage,
                }}
              >
                <Trans>去设置</Trans>
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div
          role="status"
          aria-label={t`加载中…`}
          className="text-muted-foreground flex items-center"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        </div>
      ) : generating ? (
        // 首字出现后只保留加载图标，并把它内联在正文末尾跟随光标位置：
        // 独立的文字或固定位置的指示器会打断阅读视线。
        streamingContent ? (
          <p
            className="font-poetry wrap-break-word whitespace-pre-line"
            style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
          >
            {streamingContent}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground ml-1 inline-flex align-middle"
              aria-label={t`正在生成，点击取消`}
              title={t`正在生成，点击取消`}
              onClick={cancelGeneration}
            >
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            </Button>
          </p>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="group text-muted-foreground hover:text-foreground"
              aria-label={t`正在生成，点击取消`}
              title={t`正在生成，点击取消`}
              onClick={cancelGeneration}
            >
              <LoaderCircle
                data-icon="inline-start"
                className="size-3.5 animate-spin"
                aria-hidden
              />
              {/* 两个文案叠在同一格：宽度取较长的一个，hover 时只换字不跳宽。 */}
              <span className="grid">
                <span className="col-start-1 row-start-1 group-hover:invisible group-focus-visible:invisible">
                  <Trans>正在生成</Trans>
                </span>
                <span className="invisible col-start-1 row-start-1 group-hover:visible group-focus-visible:visible">
                  <Trans>取消生成</Trans>
                </span>
              </span>
            </Button>
          </div>
        )
      ) : current ? (
        <p
          className="font-poetry wrap-break-word whitespace-pre-line"
          style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
        >
          {current.content}
        </p>
      ) : (
        // 没有译文时，生成按钮就停在这里——原来放加载圈的位置。
        <div
          className={
            hasFallback ? "order-last flex" : "flex flex-col items-start gap-2"
          }
        >
          {!readError && !hasFallback ? (
            <p className="text-muted-foreground text-xs">
              <Trans>暂无译文</Trans>
            </p>
          ) : null}
          <Button
            type="button"
            variant={hasFallback ? "outline" : "default"}
            size="sm"
            disabled={deleting || savingEdit || !!readError}
            onClick={requestGeneration}
          >
            <Sparkles data-icon="inline-start" />
            <Trans comment="生成当前诗词的现代汉语译文">生成</Trans>
          </Button>
        </div>
      )}

      {currentPackTranslations.length > 0 ? (
        <div className="border-border flex flex-col gap-3 border-t pt-3">
          <Badge variant="outline">
            <Trans>开放译文</Trans>
          </Badge>
          {currentPackTranslations.map((item) => (
            <div
              key={`${item.packId}-${item.language}-${item.mode}`}
              className="flex flex-col gap-1"
            >
              <div className="text-muted-foreground text-xs wrap-break-word">
                {[
                  item.packName,
                  item.packAuthor,
                  item.packSource,
                  item.packLicense,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <p
                className="font-poetry wrap-break-word whitespace-pre-line"
                style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
              >
                {item.content}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {referenceTranslation?.trim() ? (
        <div className="flex flex-col gap-2">
          <Badge variant="outline">
            <Trans>注释包译文</Trans>
          </Badge>
          <p
            className="font-poetry wrap-break-word whitespace-pre-line"
            style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
          >
            {referenceTranslation}
          </p>
        </div>
      ) : null}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && !savingEdit && setEditing(null)}
      >
        <DialogLayoutContent
          className="ui-density-adaptive md:max-w-lg"
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>{t`编辑译文`}</DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            <Textarea
              value={editContent}
              disabled={savingEdit}
              className="min-h-52 resize-y"
              aria-label={t`译文内容`}
              onChange={(event) => setEditContent(event.target.value)}
            />
          </DialogLayoutBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingEdit}
              onClick={() => setEditing(null)}
            >
              <Trans>取消</Trans>
            </Button>
            <Button
              type="button"
              disabled={savingEdit || !editContent.trim()}
              onClick={() => void saveEdit()}
            >
              {savingEdit ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              <Trans>保存</Trans>
            </Button>
          </DialogFooter>
        </DialogLayoutContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`确认删除？`}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                仅删除当前这条译文；如有其他历史译文，将继续显示。不影响原文和注释。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void remove()}
            >
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans comment="用户已编辑过译文，重新生成前的确认标题">
                重新生成译文？
              </Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {replacesManualTranslation ? (
                <Trans>
                  重新生成将覆盖已有现代文译文中的人工修订。其他历史译文会保留。
                </Trans>
              ) : (
                <Trans>
                  重新生成后将显示新的现代文译文，当前人工修订会保留为历史译文。
                </Trans>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void generate()}>
              <Trans>重新生成</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
