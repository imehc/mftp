import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import type {
  McpCredential,
  McpCredentialInput,
  ModuleGrant,
} from "~/bindings";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

import {
  ALL_MODULES,
  changePermission,
  globalGrant,
} from "./credential-permissions";

export default function McpCredentialEditor({
  credential,
  busy,
  open,
  onSave,
  onCancel,
}: {
  open: boolean;
  credential: McpCredential | null;
  busy: boolean;
  onSave: (input: McpCredentialInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [name, setName] = useState(credential?.name ?? "");
  const [grant, setGrant] = useState<ModuleGrant>(
    () =>
      globalGrant(credential) ?? { read: true, write: false, delete: false },
  );
  const valid = name.trim().length > 0 && grant.read;
  const permissions: {
    key: keyof ModuleGrant;
    label: string;
    disabled: boolean;
  }[] = [
    {
      key: "read",
      label: t({
        message: "读取",
        comment: "MCP 全部模块的读取权限，复选框与授权表头共用",
      }),
      disabled: false,
    },
    {
      key: "write",
      label: t({
        message: "写入",
        comment:
          "MCP 全部模块的新建和编辑权限，不包含删除，复选框与授权表头共用",
      }),
      disabled: !grant.read,
    },
    {
      key: "delete",
      label: t({
        message: "删除",
        comment: "MCP 全部模块的删除权限，必须单独勾选，复选框与授权表头共用",
      }),
      disabled: !grant.write,
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogLayoutContent
        placement="responsive-page"
        className="md:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogLayoutHeader>
          <DialogTitle>{credential ? t`编辑授权` : t`添加授权`}</DialogTitle>
        </DialogLayoutHeader>
        <form
          id="mcp-credential-form"
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy)
              void onSave({
                name: name.trim(),
                grants: { [ALL_MODULES]: grant },
              });
          }}
        >
          <DialogLayoutBody>
            <fieldset disabled={busy} className="min-w-0">
              <FieldGroup density="compact">
                <Field>
                  <FieldLabel htmlFor="mcp-credential-name">
                    <Trans comment="MCP 授权记录名称，用来区分外部客户端，不是密钥本身">
                      授权名称
                    </Trans>
                  </FieldLabel>
                  <Input
                    id="mcp-credential-name"
                    autoComplete="off"
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </Field>
                <FieldSet>
                  <FieldLegend variant="label">
                    <Trans comment="MCP 授权表与编辑弹窗的权限组标题">
                      权限
                    </Trans>
                  </FieldLegend>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {permissions.map((permission) => (
                      <Field
                        key={permission.key}
                        orientation="horizontal"
                        className="w-auto"
                        data-disabled={busy || permission.disabled}
                      >
                        <Checkbox
                          id={`mcp-permission-${permission.key}`}
                          checked={grant[permission.key]}
                          disabled={busy || permission.disabled}
                          onCheckedChange={(checked) =>
                            setGrant((current) =>
                              changePermission(
                                current,
                                permission.key,
                                checked === true,
                              ),
                            )
                          }
                        />
                        <FieldLabel
                          htmlFor={`mcp-permission-${permission.key}`}
                        >
                          {permission.label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                  <FieldDescription>
                    <Trans>写入需允许读取，删除需允许写入。</Trans>
                  </FieldDescription>
                </FieldSet>
                {credential && !globalGrant(credential) ? (
                  <FieldDescription>
                    <Trans>
                      此记录使用旧版授权。保存后将改为全部模块授权，当前默认只读。
                    </Trans>
                  </FieldDescription>
                ) : null}
                {credential ? (
                  <FieldDescription>
                    <Trans>
                      保存后，此客户端的旧请求会失效，未完成的操作会被中断。
                    </Trans>
                  </FieldDescription>
                ) : null}
              </FieldGroup>
            </fieldset>
          </DialogLayoutBody>
          <DialogLayoutFooter surface="plain">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              <Trans>取消</Trans>
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {credential ? t`保存权限` : t`生成凭据`}
            </Button>
          </DialogLayoutFooter>
        </form>
      </DialogLayoutContent>
    </Dialog>
  );
}
