import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";

import type { ModelLibraryEntry } from "~/bindings";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { describeError, type IpcError, toIpcError } from "~/lib/errors";

import type { ModelLibraryController } from "../library/controller";

export function LibraryEntryEditor({
  entry,
  controller,
  close,
  restoreFocus,
}: {
  entry: ModelLibraryEntry;
  controller: ModelLibraryController;
  close: () => void;
  restoreFocus: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(entry.name);
  const [group, setGroup] = useState(entry.group);
  const [favorite, setFavorite] = useState(entry.favorite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<IpcError | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogLayoutContent
        placement="responsive-sheet"
        showCloseButton={false}
        className="ui-density-adaptive md:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogLayoutHeader showCloseButton>
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle>
              <Trans comment="编辑本地模型库的名称、分组和收藏状态。">
                编辑模型
              </Trans>
            </DialogTitle>
            <DialogDescription className="sr-only">
              <Trans>修改模型库条目信息</Trans>
            </DialogDescription>
          </div>
        </DialogLayoutHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !name.trim()) return;
            setBusy(true);
            setError(null);
            void controller
              .edit(entry.id, { name, group, favorite })
              .then(close)
              .catch((error: unknown) => setError(toIpcError(error)))
              .finally(() => setBusy(false));
          }}
        >
          <DialogLayoutBody className="-m-1 flex min-w-0 flex-col gap-3 p-1">
            <FieldGroup density="compact">
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>
                  <Trans>名称</Trans>
                </FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={240}
                  disabled={busy}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-group`}>
                  <Trans comment="模型库中用户自定义的分类名称，留空表示不分组。">
                    分组
                  </Trans>
                </FieldLabel>
                <Input
                  id={`${id}-group`}
                  value={group}
                  maxLength={80}
                  disabled={busy}
                  onChange={(event) => setGroup(event.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor={`${id}-favorite`}>
                  <Trans comment="将模型标记为收藏。">收藏</Trans>
                </FieldLabel>
                <Switch
                  id={`${id}-favorite`}
                  checked={favorite}
                  disabled={busy}
                  onCheckedChange={setFavorite}
                />
              </Field>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription className="wrap-anywhere">
                  {describeError(error)}
                </AlertDescription>
              </Alert>
            ) : null}
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button
              density="adaptive"
              type="submit"
              disabled={busy || !name.trim()}
            >
              {busy ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              <Trans>保存</Trans>
            </Button>
          </DialogLayoutFooter>
        </form>
      </DialogLayoutContent>
    </Dialog>
  );
}
