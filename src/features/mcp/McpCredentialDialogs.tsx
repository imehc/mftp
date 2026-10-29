import { Trans, useLingui } from "@lingui/react/macro";

import type { McpCredential, McpIssuedCredential } from "~/bindings";
import { CopyButton } from "~/components/CopyButton";
import {
  AlertDialog,
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
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

import { connectionConfig } from "./connection-config";

export type CredentialAction = {
  kind: "rotate" | "revoke" | "update";
  credential: McpCredential;
};

export function McpStopDialog({
  busy,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>停止 MCP 服务？</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              所有客户端将断开，未完成的操作会被中断。已保存的数据不会删除。
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <Button disabled={busy} onClick={onConfirm}>
            <Trans>停止服务</Trans>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function McpCredentialConfirmation({
  action,
  busy,
  onConfirm,
  onClose,
}: {
  action: CredentialAction;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action.kind === "rotate"
              ? t`重新生成凭据？`
              : action.kind === "update"
                ? t`修改授权权限？`
                : t`撤销授权？`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action.credential.name}
          </AlertDialogDescription>
          <p className="text-muted-foreground text-sm">
            <Trans>
              此客户端的旧请求将失效，未完成的操作会被中断。已保存的数据不会删除。
            </Trans>
          </p>
          {action.kind === "update" ? (
            <p className="app-description">
              <Trans>
                保存后，所选权限统一适用于全部模块，包括后续新增模块。
              </Trans>
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <Button
            variant={action.kind === "revoke" ? "destructive" : "default"}
            disabled={busy}
            onClick={onConfirm}
          >
            {action.kind === "revoke" ? t`撤销授权` : t`确认修改`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function McpIssuedDialog({
  issued,
  endpoint,
  onError,
  onClose,
}: {
  issued: McpIssuedCredential;
  endpoint: string;
  onError: (error: unknown) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogLayoutContent placement="responsive-page" className="md:max-w-lg">
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>保存连接凭据</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>凭据只显示这一次。关闭后无法找回，只能重新生成。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-3">
          <Label htmlFor="mcp-issued-token">
            <Trans comment="MCP Bearer token，只在生成时展示">连接凭据</Trans>
          </Label>
          <Input
            id="mcp-issued-token"
            type="password"
            value={issued.token}
            readOnly
            autoComplete="off"
          />
          <p className="app-description">
            <Trans>
              仅交给可信的本机 MCP 客户端。共享凭据等于共享数据访问权限。
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton
              variant="outline"
              value={issued.token}
              label={t`复制凭据`}
              onError={onError}
              showLabel
            />
            <CopyButton
              variant="outline"
              value={connectionConfig(endpoint, issued.token)}
              label={t`复制含凭据的配置`}
              onError={onError}
              showLabel
            />
          </div>
        </DialogLayoutBody>
        <DialogLayoutFooter surface="plain">
          <Button onClick={onClose}>{t`我已保存`}</Button>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
