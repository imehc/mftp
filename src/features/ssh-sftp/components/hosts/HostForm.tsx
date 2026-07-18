import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Host } from "~/types";
import { useHostsStore } from "~/store/hosts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Field as UiField,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "~/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { firstFormError } from "~/lib/form-errors";
import {
  createHostFormSchema,
  hostFormValuesToInput,
  hostToFormValues,
} from "~/features/ssh-sftp/components/hosts/HostForm.schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing host to edit, or null to create. */
  host: Host | null;
}

export default function HostForm({ open, onOpenChange, host }: Props) {
  const { t } = useLingui();
  const keys = useHostsStore((s) => s.keys);
  const createHost = useHostsStore((s) => s.createHost);
  const updateHost = useHostsStore((s) => s.updateHost);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: hostToFormValues(null),
    validators: {
      onSubmit: createHostFormSchema(t),
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        const payload = hostFormValuesToInput(value);
        if (host) await updateHost(host.id, payload);
        else await createHost(payload);
        onOpenChange(false);
      } catch (e) {
        setSubmitError(String(e));
      }
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(hostToFormValues(host));
    setSubmitError(null);
  }, [form, host, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent className="sm:max-w-md">
        <DialogLayoutHeader>
          <DialogTitle>{host ? t`编辑主机` : t`新建主机`}</DialogTitle>
        </DialogLayoutHeader>

        <DialogLayoutBody className="pr-1">
          <FieldGroup>
            <form.Field name="label">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <UiField data-invalid={!!error}>
                    <FieldLabel htmlFor="host-label">
                      <Trans>名称</Trans>
                    </FieldLabel>
                    <Input
                      id="host-label"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="My Server"
                      autoCapitalize="off"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!error}
                    />
                    {error ? <FieldDescription>{error}</FieldDescription> : null}
                  </UiField>
                );
              }}
            </form.Field>

            <div className="grid grid-cols-[1fr_100px] gap-3">
              <form.Field name="host">
                {(field) => {
                  const error = firstFormError(field.state.meta.errors);
                  return (
                    <UiField data-invalid={!!error}>
                      <FieldLabel htmlFor="host-addr">
                        <Trans>地址</Trans>
                      </FieldLabel>
                      <Input
                        id="host-addr"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="example.com"
                        autoCapitalize="off"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!error}
                      />
                      {error ? <FieldDescription>{error}</FieldDescription> : null}
                    </UiField>
                  );
                }}
              </form.Field>
              <form.Field name="port">
                {(field) => {
                  const error = firstFormError(field.state.meta.errors);
                  return (
                    <UiField data-invalid={!!error}>
                      <FieldLabel htmlFor="host-port">
                        <Trans>端口</Trans>
                      </FieldLabel>
                      <Input
                        id="host-port"
                        type="number"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(Number(e.target.value) || 22)}
                        aria-invalid={!!error}
                      />
                      {error ? <FieldDescription>{error}</FieldDescription> : null}
                    </UiField>
                  );
                }}
              </form.Field>
            </div>

            <form.Field name="username">
              {(field) => (
                <UiField>
                  <FieldLabel htmlFor="host-user">
                    <Trans>用户名</Trans>
                  </FieldLabel>
                  <Input
                    id="host-user"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t`留空则使用 SSH 配置或本机用户`}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldDescription>
                    <Trans>留空时优先使用 ~/.ssh/config 的 User，其次使用当前系统用户。</Trans>
                  </FieldDescription>
                </UiField>
              )}
            </form.Field>

            <form.Field name="authType">
              {(field) => (
                <UiField>
                  <FieldLabel>
                    <Trans>认证方式</Trans>
                  </FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v === "password" || v === "key") field.handleChange(v);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <ToggleGroupItem value="password" className="flex-1">
                      <Trans>密码</Trans>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="key" className="flex-1">
                      <Trans>密钥</Trans>
                    </ToggleGroupItem>
                  </ToggleGroup>
                </UiField>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.authType}>
              {(authType) =>
                authType === "password" ? (
                  <form.Field name="password">
                    {(field) => (
                      <UiField>
                        <FieldLabel htmlFor="host-pw">
                          <Trans>密码</Trans>
                        </FieldLabel>
                        <Input
                          id="host-pw"
                          type="password"
                          value={field.state.value ?? ""}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="••••••••"
                        />
                      </UiField>
                    )}
                  </form.Field>
                ) : (
                  <form.Field name="keyId">
                    {(field) => {
                      const missingKeys = keys.length === 0;
                      const error = firstFormError(field.state.meta.errors);
                      return (
                        <UiField data-invalid={!!error}>
                          <FieldLabel>
                            <Trans>密钥</Trans>
                          </FieldLabel>
                          <Select
                            value={field.state.value ?? ""}
                            onValueChange={(v) => field.handleChange(v || null)}
                            disabled={missingKeys}
                          >
                            <SelectTrigger className="w-full" aria-invalid={!!error}>
                              <SelectValue placeholder={t`选择密钥…`} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {keys.map((k) => (
                                  <SelectItem key={k.id} value={k.id}>
                                    {k.label}
                                    {k.hasPassphrase ? t` (需口令)` : ""}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {missingKeys ? (
                            <FieldDescription>
                              <Trans>暂无密钥，请先在密钥管理中导入。</Trans>
                            </FieldDescription>
                          ) : error ? (
                            <FieldDescription>{error}</FieldDescription>
                          ) : null}
                        </UiField>
                      );
                    }}
                  </form.Field>
                )
              }
            </form.Subscribe>

            <form.Field name="defaultPath">
              {(field) => (
                <UiField>
                  <FieldLabel htmlFor="host-defpath">
                    <Trans>默认目录</Trans>
                  </FieldLabel>
                  <Input
                    id="host-defpath"
                    value={field.state.value ?? ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t`/var/www（留空则用主目录）`}
                  />
                  <FieldDescription>
                    <Trans>打开 SFTP 时进入此目录；若不存在则回退到主目录，再退到根目录。</Trans>
                  </FieldDescription>
                </UiField>
              )}
            </form.Field>

            {submitError ? (
              <FieldDescription className="text-destructive">
                {submitError}
              </FieldDescription>
            ) : null}
          </FieldGroup>
        </DialogLayoutBody>

        <DialogLayoutFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>取消</Trans>
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button onClick={() => void form.handleSubmit()} disabled={isSubmitting}>
                {isSubmitting ? t`保存中…` : t`保存`}
              </Button>
            )}
          </form.Subscribe>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
