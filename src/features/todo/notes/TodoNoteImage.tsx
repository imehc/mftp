import { Trans, useLingui } from "@lingui/react/macro";
import { Check, Copy, ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";

import type { NoteImageScope } from "./note-image-cache";
import { canCopyNoteImage, copyNoteImage } from "./note-image-clipboard";
import { useNoteImage } from "./use-note-image";

export default function TodoNoteImage({
  assetId,
  scope,
  disabled = false,
}: {
  assetId: string;
  scope: NoteImageScope;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { value, error, retry } = useNoteImage(assetId, scope);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifetime = useRef({
    active: true,
    action: false,
  });
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [lifetime]);

  async function act(operation: () => Promise<unknown>) {
    if (lifetime.current.action) return;
    lifetime.current.action = true;
    setBusy(true);
    try {
      await operation();
    } catch (cause) {
      if (lifetime.current.active)
        toast.error(t`图片操作失败`, { description: describeError(cause, t) });
    } finally {
      lifetime.current.action = false;
      if (lifetime.current.active) setBusy(false);
    }
  }

  function copyImage() {
    if (!value) return;
    if (!canCopyNoteImage()) {
      toast.error(t`当前环境不支持复制图片`);
      return;
    }
    void act(async () => {
      await copyNoteImage(value);
      if (!lifetime.current.active) return;
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    });
  }

  const actions = (
    <ImageActions
      unavailable={!value}
      disabled={busy || disabled}
      copied={copied}
      onCopy={copyImage}
    />
  );

  return (
    <span
      className="relative inline-block max-w-full min-w-24 align-middle"
      data-todo-image-node
    >
      {value ? (
        <button
          type="button"
          className="focus-visible:ring-ring bg-muted/30 inline-flex min-h-12 max-w-full min-w-24 justify-center rounded-md align-middle outline-none focus-visible:ring-2"
          onClick={() => setPreview(true)}
          aria-label={t`预览备注图片`}
        >
          <img
            src={value.url}
            alt={t`备注图片`}
            width={value.image.width}
            height={value.image.height}
            className="h-auto max-h-40 w-auto max-w-full rounded-md object-contain"
          />
        </button>
      ) : error ? (
        <span
          className="bg-muted inline-flex min-h-24 flex-col items-center justify-center gap-2 rounded-md p-3 text-sm"
          role="alert"
        >
          <ImageOff aria-hidden className="size-5" />
          <span>{describeError(error, t)}</span>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <Trans>重试</Trans>
          </Button>
        </span>
      ) : (
        <span
          className="bg-muted inline-flex min-h-24 items-center justify-center rounded-md"
          role="status"
          aria-label={t`正在读取图片`}
        >
          <Spinner />
        </span>
      )}
      {actions}
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogLayoutContent
          className="md:max-w-3xl"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>备注图片</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            {value ? (
              <div className="relative">
                <img
                  src={value.url}
                  alt={t`备注图片`}
                  width={value.image.width}
                  height={value.image.height}
                  className="mx-auto max-w-full object-contain"
                />
                {actions}
              </div>
            ) : null}
          </DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
    </span>
  );
}

function ImageActions({
  unavailable,
  disabled,
  copied,
  onCopy,
}: {
  unavailable: boolean;
  disabled: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useLingui();
  const copyLabel = copied ? t`已复制` : t`复制图片`;
  return (
    <span
      className="absolute top-1.5 right-1.5 flex items-center gap-1 p-0.5"
      contentEditable={false}
      data-todo-image-actions
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={unavailable || disabled}
        onClick={onCopy}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}
