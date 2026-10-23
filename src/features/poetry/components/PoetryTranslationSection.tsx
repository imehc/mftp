import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { PoetryTranslationMode } from "~/bindings";
import ToggleGroup from "~/components/FixedToggleGroup";
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
import { ToggleGroupItem } from "~/components/ui/toggle-group";

import { usePoetryTranslations } from "../hooks/use-poetry-translations";
import PoetryReadError from "./PoetryReadError";

interface Props {
  uid: string;
  fontSize: number;
  lineHeight: number;
  referenceTranslation?: string;
  initialMode?: PoetryTranslationMode;
  onModeChange?: (mode: PoetryTranslationMode) => void;
  /** 桌面端由详情页提供「译文」标题 id；窄屏由阅读区顶部的译文标签承担同一语义。 */
  labelId?: string;
}

export default function PoetryTranslationSection({
  uid,
  fontSize,
  lineHeight,
  referenceTranslation,
  initialMode = "literal",
  onModeChange,
  labelId,
}: Props) {
  const { t } = useLingui();
  const {
    mode,
    setMode,
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
    configurationMissing,
    setConfigurationMissing,
    generate,
    cancelGeneration,
    startEdit,
    saveEdit,
    remove,
    requestGeneration,
  } = usePoetryTranslations(uid, initialMode);
  // 有注释包/开放译文兜底时，生成按钮退居次要位置，不再占据空状态的重心。
  const hasFallback =
    Boolean(referenceTranslation?.trim()) || currentPackTranslations.length > 0;
  return (
    <section className="flex flex-col gap-4 font-sans text-sm">
      {/* 标题行只放标题与模式切换；生成/取消/重新生成都跟着译文内容走。 */}
      <div className="flex flex-wrap items-center gap-2">
        {labelId ? (
          <h3
            id={labelId}
            className="text-muted-foreground mr-auto text-sm font-medium"
          >
            <Trans>译文</Trans>
          </h3>
        ) : null}
        <div className="ml-auto w-44 max-w-full shrink-0">
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            disabled={generating || savingEdit || deleting}
            aria-label={t`译文模式`}
            onValueChange={(value) => {
              if (value) {
                const nextMode = value as PoetryTranslationMode;
                setMode(nextMode);
                onModeChange?.(nextMode);
                setConfigurationMissing(false);
              }
            }}
          >
            <ToggleGroupItem value="literal">
              <Trans>白话直译</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="literary">
              <Trans>文学意译</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

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
                search={{ returnUid: uid, returnMode: mode }}
              >
                <Trans>去设置</Trans>
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="text-muted-foreground flex min-h-28 items-center justify-center">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        </div>
      ) : generating ? (
        // 生成中只有这一个指示器；它本身就是要取消的按钮，hover/focus 时文字换成取消。
        // 已有正文时指示器跟在正文之后，阅读视线不被打断。
        <div
          className={
            streamingContent
              ? "flex flex-col items-start gap-2"
              : "flex min-h-28 flex-col items-center justify-center gap-3"
          }
        >
          {streamingContent ? (
            <p
              className="font-poetry whitespace-pre-line"
              style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
            >
              {streamingContent}
            </p>
          ) : null}
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
      ) : current ? (
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge
              variant={current.source === "user" ? "secondary" : "outline"}
            >
              {current.source === "user" ? t`人工修订` : t`AI 生成`}
            </Badge>
            <span
              className="text-muted-foreground max-w-full truncate text-xs"
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
                <Pencil />
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
                <RefreshCw />
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
                <Trash2 />
              </Button>
            </div>
          </div>
          <p
            className="font-poetry whitespace-pre-line"
            style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
          >
            {current.content}
          </p>
        </div>
      ) : (
        // 没有译文时，生成按钮就停在这里——原来放加载圈的位置。
        <div
          className={
            hasFallback
              ? "flex"
              : "flex min-h-28 flex-col items-center justify-center gap-2"
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
            <Trans>生成</Trans>
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
              <div className="text-muted-foreground text-xs">
                {item.packName} · {item.packAuthor} · {item.packLicense}
              </div>
              <p
                className="font-poetry whitespace-pre-line"
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
            className="font-poetry whitespace-pre-line"
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
              {t`删除后可重新生成，不影响原文和注释。`}
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
            <AlertDialogTitle>{t`覆盖人工修订？`}</AlertDialogTitle>
            <AlertDialogDescription>
              {t`将覆盖当前人工修订。`}
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
