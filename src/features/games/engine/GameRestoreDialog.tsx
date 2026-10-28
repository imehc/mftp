import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

/** 恢复选择与丢弃确认共用一个弹层，避免占据游戏画布或叠加模态层。 */
export function GameRestoreDialog({
  description,
  busy,
  error,
  onRestore,
  onDiscard,
}: {
  description: ReactNode;
  busy: boolean;
  error?: string;
  onRestore(): void;
  onDiscard(): void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);

  const leave = () => {
    if (!busy) void navigate({ to: "/", search: { category: "games" } });
  };

  return (
    <AlertDialog open>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (busy) return;
          if (confirmDiscard) setConfirmDiscard(false);
          else leave();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          continueButton.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="w-full pr-10">
            {confirmDiscard ? (
              <Trans>丢弃对局存档？</Trans>
            ) : (
              <Trans comment="小游戏进入页面时，询问是否恢复本地保存的进度">
                继续上次游戏？
              </Trans>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmDiscard ? (
              <Trans>此操作会删除该游戏的存档，无法继续上次的对局。</Trans>
            ) : (
              description
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmDiscard(!confirmDiscard)}
          >
            {confirmDiscard ? <Trans>取消</Trans> : <Trans>丢弃存档</Trans>}
          </Button>
          <Button
            ref={continueButton}
            size="sm"
            variant={confirmDiscard ? "destructive" : "default"}
            disabled={busy}
            onClick={confirmDiscard ? onDiscard : onRestore}
          >
            {confirmDiscard ? <Trans>确认</Trans> : <Trans>继续游戏</Trans>}
          </Button>
        </AlertDialogFooter>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          aria-label={t`关闭`}
          disabled={busy}
          onClick={leave}
        >
          <X />
        </Button>
      </AlertDialogContent>
    </AlertDialog>
  );
}
