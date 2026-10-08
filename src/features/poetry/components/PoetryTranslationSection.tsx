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
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { describeError } from "~/lib/errors";

import { usePoetryTranslations } from "../hooks/use-poetry-translations";
import PoetryReadError from "./PoetryReadError";

interface Props {
  uid: string;
  fontSize: number;
  lineHeight: number;
  referenceTranslation?: string;
  initialMode?: PoetryTranslationMode;
  onModeChange?: (mode: PoetryTranslationMode) => void;
}

export default function PoetryTranslationSection({
  uid,
  fontSize,
  lineHeight,
  referenceTranslation,
  initialMode = "literal",
  onModeChange,
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
    error,
    setError,
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
    startEdit,
    saveEdit,
    remove,
    requestGeneration,
  } = usePoetryTranslations(uid, initialMode);
  return (
    <section className="flex flex-col gap-4 font-sans text-sm">
      {readError ? (
        <PoetryReadError error={readError} onRetry={retryRead} />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t`操作失败`}</AlertTitle>
          <AlertDescription className="break-words">
            {describeError(error)}
          </AlertDescription>
        </Alert>
      ) : null}

      {configurationMissing ? (
        <Alert>
          <AlertTitle>{t`尚未配置 AI 服务`}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Trans>请先配置服务地址、模型和 API Key，再生成译文。</Trans>
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

      {referenceTranslation?.trim() && !current && !generating ? (
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

      {loading ? (
        <div className="text-muted-foreground flex min-h-20 items-center justify-center">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        </div>
      ) : current || generating ? (
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {generating ? (
              <Badge variant="outline">
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
                <Trans>正在生成</Trans>
              </Badge>
            ) : current ? (
              <>
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
                    disabled={deleting}
                    aria-label={t`删除译文`}
                    title={t`删除译文`}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </>
            ) : null}
          </div>
          {generating && !streamingContent ? (
            <div className="text-muted-foreground flex min-h-20 items-center justify-center">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            </div>
          ) : (
            <p
              className="font-poetry whitespace-pre-line"
              style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
            >
              {generating ? streamingContent : current?.content}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {!readError &&
          !referenceTranslation?.trim() &&
          currentPackTranslations.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              <Trans>暂无译文</Trans>
            </p>
          ) : null}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
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
              setError(null);
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            generating || deleting || savingEdit || loading || !!readError
          }
          onClick={requestGeneration}
        >
          {generating ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : current ? (
            <RefreshCw data-icon="inline-start" />
          ) : (
            <Sparkles data-icon="inline-start" />
          )}
          {current ? <Trans>重新生成</Trans> : <Trans>生成</Trans>}
        </Button>
      </div>

      {referenceTranslation?.trim() && (current || generating) ? (
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
            {error ? (
              <p role="alert" className="text-destructive mb-3 text-sm">
                {describeError(error)}
              </p>
            ) : null}
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
