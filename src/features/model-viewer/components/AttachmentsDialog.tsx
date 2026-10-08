import { Trans, useLingui } from "@lingui/react/macro";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ModelAttachment, ModelLibraryEntry } from "~/bindings";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";

import { AttachmentController } from "../attachments/controller";

export function AttachmentsDialog({
  entry,
  close,
  restoreFocus,
  changed,
}: {
  entry: ModelLibraryEntry;
  close: () => void;
  restoreFocus: () => void;
  changed: () => void;
}) {
  const { t } = useLingui();
  const inputId = useId();
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  const [controller] = useState(
    () => new AttachmentController(entry.id, changed),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [file, setFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState<ModelAttachment | null>(null);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          placement="responsive-page"
          className="ui-density-adaptive flex flex-col md:max-w-2xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <Trans comment="模型库条目的说明文件管理。">模型附件</Trans>
            </DialogTitle>
            <DialogDescription className="break-all">
              {entry.name}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
            <p className="text-muted-foreground text-sm">
              <Trans>
                支持 UTF-8 文本、Markdown（1 MiB）和 PDF（8 MiB）。每个模型最多
                16 项、合计 32 MiB。
              </Trans>
            </p>
            <FieldGroup density="compact">
              <Field>
                <FieldLabel htmlFor={inputId}>
                  <Trans>选择附件</Trans>
                </FieldLabel>
                <Input
                  id={inputId}
                  type="file"
                  accept=".txt,.md,.pdf"
                  disabled={state.busy}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </Field>
              <Button
                density="adaptive"
                disabled={!file || state.busy || !state.entries}
                onClick={() => {
                  if (file) void controller.add(file);
                }}
              >
                <Trans>添加附件</Trans>
              </Button>
            </FieldGroup>
            {state.error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {describeError(state.error, t)}
                </AlertDescription>
              </Alert>
            ) : null}
            <p role="status" className="text-muted-foreground text-sm">
              {state.busy ? (
                <Trans>正在处理附件…</Trans>
              ) : state.saved ? (
                <Trans>附件副本已保存。</Trans>
              ) : null}
            </p>
            {state.entries === null && !state.busy ? (
              <Button
                variant="outline"
                onClick={() => void controller.refresh()}
              >
                <Trans>重新加载</Trans>
              </Button>
            ) : null}
            {state.entries?.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    <Trans>暂无附件</Trans>
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : null}
            <ul className="flex flex-col gap-3">
              {state.entries?.map((attachment) => (
                <li key={attachment.id} className="flex flex-col gap-2">
                  <span className="min-w-0 break-all">
                    {attachment.name}{" "}
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(attachment.size)}
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      density="adaptive"
                      variant="outline"
                      disabled={state.busy}
                      onClick={() => void controller.read(attachment)}
                    >
                      <Trans comment="阅读或查看模型附件的信息。">查看</Trans>
                    </Button>
                    <Button
                      density="adaptive"
                      variant="outline"
                      disabled={state.busy}
                      onClick={() => void controller.save(attachment)}
                    >
                      <Trans>保存副本</Trans>
                    </Button>
                    <Button
                      density="adaptive"
                      variant="ghost"
                      disabled={state.busy}
                      onClick={(event) => {
                        removeTrigger.current = event.currentTarget;
                        setDeleting(attachment);
                      }}
                    >
                      <Trans comment="从模型库移除附件副本。">移除</Trans>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {state.selected ? (
              <section
                className="flex flex-col gap-2"
                aria-label={state.selected.name}
              >
                <h3 className="font-medium break-all">{state.selected.name}</h3>
                {state.text === null ? (
                  <p className="text-muted-foreground text-sm">
                    <Trans>
                      PDF 不在应用内预览。请保存副本后使用 PDF 阅读器打开。
                    </Trans>
                  </p>
                ) : (
                  <>
                    <p className="text-muted-foreground text-sm">
                      <Trans>按纯文本展示，不加载文档中的链接或图片。</Trans>
                    </p>
                    <pre
                      tabIndex={0}
                      className="max-h-80 overflow-auto rounded-md border p-3 text-sm break-all whitespace-pre-wrap"
                    >
                      {state.text}
                    </pre>
                  </>
                )}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent
          className="ui-density-adaptive"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (removeTrigger.current?.isConnected)
              removeTrigger.current.focus();
            else document.getElementById(inputId)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>移除此附件？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>仅删除模型库中的附件副本，原始文件不受影响。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all">{deleting?.name}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void controller.remove(deleting);
              }}
            >
              <Trans>移除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
