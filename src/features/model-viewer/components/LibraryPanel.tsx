import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState, useSyncExternalStore } from "react";

import type { ModelLibraryEntry } from "~/bindings";
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
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";

import type { ModelLibraryController } from "../library/controller";
import { AttachmentsDialog } from "./AttachmentsDialog";
import { LibraryEntryEditor } from "./LibraryEntryEditor";
import { LibraryList } from "./LibraryList";

export function LibraryPanel({
  controller,
  open,
  onOpenChange,
}: {
  controller: ModelLibraryController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const returnFocus = useRef<HTMLElement | null>(null);

  function restoreFocus() {
    const target = returnFocus.current;
    if (target?.isConnected) target.focus();
    else document.getElementById(`${id}-search`)?.focus();
  }

  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [editing, setEditing] = useState<ModelLibraryEntry | null>(null);
  const [attachments, setAttachments] = useState<ModelLibraryEntry | null>(
    null,
  );
  const [deleting, setDeleting] = useState<ModelLibraryEntry | null>(null);
  const catalog = state.catalog;
  const busy = state.busy > 0;
  const entries =
    catalog?.entries.filter(
      (entry) =>
        (!favorites || entry.favorite) &&
        `${entry.name} ${entry.group}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogLayoutContent
          placement="responsive-page"
          showCloseButton={false}
          className="ui-density-adaptive grid-rows-[auto_minmax(0,1fr)] md:max-w-2xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("model-library-trigger")?.focus();
          }}
        >
          <DialogLayoutHeader showCloseButton>
            <div className="flex min-w-0 flex-col gap-2">
              <DialogTitle>
                <Trans comment="本机保存的三维模型集合。">模型库</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>导入的模型自动保存在此设备。</Trans>
              </DialogDescription>
            </div>
          </DialogLayoutHeader>
          <DialogLayoutBody className="-m-1 flex min-w-0 flex-col gap-4 p-1 wrap-anywhere">
            {state.error ? (
              <Alert variant="destructive">
                <AlertDescription className="flex min-w-0 flex-col gap-2">
                  <span>{describeError(state.error)}</span>
                  <Button
                    density="adaptive"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void controller.refresh().catch(controller.report)
                    }
                  >
                    <Trans>重新加载</Trans>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup density="compact">
              <Field>
                <FieldLabel htmlFor={`${id}-search`} className="sr-only">
                  <Trans>搜索名称或分组</Trans>
                </FieldLabel>
                <Input
                  id={`${id}-search`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t`搜索名称或分组`}
                />
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor={`${id}-favorites`}>
                  <Trans>仅收藏</Trans>
                </FieldLabel>
                <Switch
                  id={`${id}-favorites`}
                  checked={favorites}
                  onCheckedChange={setFavorites}
                />
              </Field>
            </FieldGroup>
            {catalog && !catalog.entries.length && !busy && !state.error ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    <Trans>模型库为空</Trans>
                  </EmptyTitle>
                  <EmptyDescription>
                    <Trans>导入模型后可在这里重新打开。</Trans>
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : catalog ? (
              <LibraryList
                entries={entries}
                controller={controller}
                busy={busy}
                edit={(entry, trigger) => {
                  returnFocus.current = trigger;
                  setEditing(entry);
                }}
                attachments={(entry, trigger) => {
                  returnFocus.current = trigger;
                  setAttachments(entry);
                }}
                remove={(entry, trigger) => {
                  returnFocus.current = trigger;
                  setDeleting(entry);
                }}
                open={(id) => {
                  onOpenChange(false);
                  void controller.open(id);
                }}
              />
            ) : null}
            {busy ? (
              <p
                role="status"
                className="text-muted-foreground flex items-center gap-2 text-sm"
              >
                <Spinner />
                <Trans>正在处理模型库</Trans>
              </p>
            ) : null}
            {catalog ? (
              <details className="text-muted-foreground text-sm">
                <summary
                  data-slot="touch-label"
                  className="min-h-8 cursor-pointer content-center py-1"
                >
                  <Trans comment="模型库磁盘逻辑字节数和可清理缩略图缓存设置。">
                    存储与缓存
                  </Trans>
                </summary>
                <FieldGroup density="compact" className="mt-3">
                  <p>
                    <Trans>模型资源</Trans> {formatBytes(catalog.libraryBytes)}{" "}
                    · <Trans>缩略图缓存</Trans>{" "}
                    {formatBytes(catalog.cacheBytes)}
                  </p>
                  <Field>
                    <FieldLabel htmlFor={`${id}-limit`}>
                      <Trans>缓存上限</Trans>
                    </FieldLabel>
                    <Select
                      value={String(catalog.cacheLimit)}
                      disabled={busy}
                      onValueChange={(value) =>
                        void controller
                          .cache(Number(value), false)
                          .catch(controller.report)
                      }
                    >
                      <SelectTrigger id={`${id}-limit`} density="adaptive">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="ui-density-adaptive">
                        <SelectGroup>
                          {[0, 16, 64, 256].map((mb) => (
                            <SelectItem
                              key={mb}
                              value={String(mb * 1024 * 1024)}
                            >
                              {mb ? (
                                formatBytes(mb * 1024 * 1024)
                              ) : (
                                <Trans>不缓存</Trans>
                              )}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button
                    density="adaptive"
                    variant="outline"
                    disabled={busy || !catalog.cacheBytes}
                    onClick={() =>
                      void controller
                        .cache(catalog.cacheLimit, true)
                        .catch(controller.report)
                    }
                  >
                    <Trans>清理缓存</Trans>
                  </Button>
                  <p className="text-xs">
                    <Trans>
                      仅清理缩略图，模型保留。数据库空间会供后续写入复用。
                    </Trans>
                  </p>
                </FieldGroup>
              </details>
            ) : null}
          </DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
      {attachments ? (
        <AttachmentsDialog
          key={attachments.id}
          entry={attachments}
          close={() => setAttachments(null)}
          restoreFocus={restoreFocus}
          changed={() => {
            void controller.refresh().catch(controller.report);
          }}
        />
      ) : null}
      {editing ? (
        <LibraryEntryEditor
          key={editing.id}
          entry={editing}
          controller={controller}
          close={() => setEditing(null)}
          restoreFocus={restoreFocus}
        />
      ) : null}
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
            restoreFocus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>从模型库删除？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                删除本机保存的模型及附件副本，原始文件和当前画布不受影响。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting)
                  void controller.delete(deleting.id).catch(controller.report);
              }}
            >
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function LibraryStatus({
  controller,
}: {
  controller: ModelLibraryController;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  if (state.error)
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span>{describeError(state.error)}</span>
          {state.failed ? (
            <Button
              density="adaptive"
              variant="outline"
              onClick={() => controller.retry()}
            >
              <Trans comment="用户主动重新保存未保存的模型或视图。">
                重试保存
              </Trans>
            </Button>
          ) : null}
          <Button
            density="adaptive"
            variant="ghost"
            onClick={() => controller.clearError()}
          >
            <Trans>关闭</Trans>
          </Button>
        </AlertDescription>
      </Alert>
    );
  return state.busy ? (
    <p
      role="status"
      className="text-muted-foreground flex items-center gap-2 text-xs"
    >
      <Spinner />
      <Trans>正在处理模型库</Trans>
    </p>
  ) : null;
}
