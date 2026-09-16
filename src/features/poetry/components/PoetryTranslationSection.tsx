import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  poetryTranslationDelete,
  poetryTranslationGenerate,
  poetryTranslationsList,
  poetryTranslationUpdate,
} from "~/lib/ipc";
import type { PoetryTranslation, PoetryTranslationMode } from "~/bindings";

interface Props {
  uid: string;
  fontSize: number;
  lineHeight: number;
  referenceTranslation?: string;
}

export default function PoetryTranslationSection({
  uid,
  fontSize,
  lineHeight,
  referenceTranslation,
}: Props) {
  const { t } = useLingui();
  const [mode, setMode] = useState<PoetryTranslationMode>("literal");
  const [translations, setTranslations] = useState<PoetryTranslation[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PoetryTranslation | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const current = translations.find((item) => item.mode === mode) ?? null;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });
    void poetryTranslationsList(uid)
      .then((items) => !cancelled && setTranslations(items))
      .catch((nextError) => !cancelled && setError(String(nextError)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uid]);

  function replaceTranslation(next: PoetryTranslation) {
    setTranslations((items) => [
      ...items.filter((item) => item.mode !== next.mode),
      next,
    ]);
  }

  async function generate() {
    setGenerating(true);
    setStreamingContent("");
    setError(null);
    try {
      const translation = await poetryTranslationGenerate(uid, mode, (delta) =>
        setStreamingContent((content) => content + delta),
      );
      replaceTranslation(translation);
      toast.success(t`已生成`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setStreamingContent("");
      setGenerating(false);
    }
  }

  function startEdit() {
    if (!current) return;
    setEditing(current);
    setEditContent(current.content);
  }

  async function saveEdit() {
    if (!editing || !editContent.trim()) return;
    setSavingEdit(true);
    setError(null);
    try {
      const translation = await poetryTranslationUpdate(
        uid,
        editing.mode,
        editContent,
      );
      replaceTranslation(translation);
      setEditing(null);
      toast.success(t`已保存`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove() {
    if (!current) return;
    setDeleting(true);
    setError(null);
    try {
      await poetryTranslationDelete(uid, current.mode);
      setTranslations((items) =>
        items.filter((item) => item.mode !== current.mode),
      );
      toast.success(t`已删除`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setDeleting(false);
    }
  }

  function requestGeneration() {
    if (current?.source === "user") setRegenerateOpen(true);
    else void generate();
  }

  return (
    <section className="border-border space-y-3 border-t pt-4 font-sans text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-muted-foreground font-medium">
          <Trans>译文</Trans>
        </h3>
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          disabled={generating || savingEdit || deleting}
          aria-label={t`译文模式`}
          onValueChange={(value) => {
            if (value) {
              setMode(value as PoetryTranslationMode);
              setError(null);
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

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t`操作失败`}</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="text-muted-foreground flex min-h-20 items-center justify-center">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        </div>
      ) : current || generating ? (
        <div className="space-y-2">
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
              style={{ fontSize, lineHeight }}
            >
              {generating ? streamingContent : current?.content}
            </p>
          )}
          {!generating && current ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={requestGeneration}
            >
              <RefreshCw data-icon="inline-start" />
              <Trans>重新生成</Trans>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-20 flex-col items-start justify-center gap-2">
          <p className="text-muted-foreground text-xs">
            <Trans>暂无译文</Trans>
          </p>
          <Button
            type="button"
            size="sm"
            disabled={generating}
            onClick={requestGeneration}
          >
            {generating ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Sparkles data-icon="inline-start" />
            )}
            <Trans>生成</Trans>
          </Button>
        </div>
      )}

      {referenceTranslation?.trim() ? (
        <div className="border-border space-y-2 border-t pt-3">
          <Badge variant="outline">
            <Trans>注释包译文</Trans>
          </Badge>
          <p
            className="font-poetry whitespace-pre-line"
            style={{ fontSize, lineHeight }}
          >
            {referenceTranslation}
          </p>
        </div>
      ) : null}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t`编辑译文`}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editContent}
            disabled={savingEdit}
            className="min-h-52 resize-y"
            aria-label={t`译文内容`}
            onChange={(event) => setEditContent(event.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
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
        </DialogContent>
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
