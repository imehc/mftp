import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { LoaderCircle, PlugZap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import ToggleGroup from "~/components/FixedToggleGroup";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Field as UiField,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { PasswordInput } from "~/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  createHostFormSchema,
  createHostTestSchema,
  hostFormValuesToInput,
  hostToFormValues,
} from "~/features/ssh-sftp/components/hosts/HostForm.schema";
import { describeError } from "~/lib/errors";
import { firstFormError } from "~/lib/form-errors";
import * as ipc from "~/lib/ipc";
import { useHostsStore } from "~/store/hosts";
import type { Host } from "~/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 要编辑的已有主机；为 null 表示新建。 */
  host: Host | null;
}

export default function HostForm({ open, onOpenChange, host }: Props) {
  const { t } = useLingui();
  const keys = useHostsStore((s) => s.keys);
  const createHost = useHostsStore((s) => s.createHost);
  const updateHost = useHostsStore((s) => s.updateHost);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  // 口令不进入表单状态与保存载荷，只在测试连接时读取。
  const passphraseRef = useRef<HTMLInputElement>(null);
  const testRequest = useRef(0);
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
        setSubmitError(describeError(e, t));
      }
    },
  });
  useEffect(() => {
    if (!open) return;
    // 用微任务延后，使表单重置发生在 effect 函数体之外。
    queueMicrotask(() => {
      // 保留空默认值：否则 useForm 每次重渲染都会把未触碰的表单重置回空值。
      form.reset(hostToFormValues(host), { keepDefaultValues: true });
      if (passphraseRef.current) passphraseRef.current.value = "";
      setSubmitError(null);
    });
  }, [form, host, open]);
  useEffect(() => {
    // 字段变化后旧结果不再对应当前配置，直接清除并作废进行中的请求。
    const subscription = form.store.subscribe(() => {
      testRequest.current += 1;
      setIsTesting(false);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      testRequest.current += 1;
      setIsTesting(false);
      if (passphraseRef.current) passphraseRef.current.value = "";
    }
    onOpenChange(next);
  }

  async function testConnection() {
    const values = form.state.values;
    const validation = createHostTestSchema(t).safeParse(values);
    if (!validation.success) {
      toast.error(validation.error.issues[0]?.message ?? t`请填写必填字段`);
      return;
    }
    const selectedKey = keys.find((key) => key.id === values.keyId);
    const passphrase = passphraseRef.current?.value ?? "";
    if (
      values.authType === "key" &&
      selectedKey?.hasPassphrase &&
      !passphrase
    ) {
      toast.error(t`请输入密钥口令后再测试`);
      return;
    }
    const request = ++testRequest.current;
    setIsTesting(true);
    try {
      const result = await ipc.sshTestConnection(
        hostFormValuesToInput(values),
        values.authType === "key" && passphrase ? passphrase : undefined,
      );
      if (testRequest.current !== request) return;
      const username = result.username;
      const target = username
        ? `${username}@${result.host}:${result.port}`
        : `${result.host}:${result.port}`;
      const home = result.home;
      const latency = result.latencyMs;
      toast.success(t`连接成功`, {
        description: t`${target} · 主目录 ${home} · 耗时 ${latency} 毫秒`,
      });
    } catch (error) {
      if (testRequest.current !== request) return;
      toast.error(t`连接失败`, { description: describeError(error, t) });
    } finally {
      if (testRequest.current === request) setIsTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogLayoutContent
        placement="responsive-page"
        className="md:max-w-md"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogLayoutHeader showCloseButton>
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
                      autoCapitalize="off"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!error}
                      aria-describedby={error ? "host-label-error" : undefined}
                    />
                    {error ? (
                      <FieldError id="host-label-error">{error}</FieldError>
                    ) : null}
                  </UiField>
                );
              }}
            </form.Field>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_6.25rem]">
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
                        autoCapitalize="off"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!error}
                        aria-describedby={error ? "host-addr-error" : undefined}
                      />
                      {error ? (
                        <FieldError id="host-addr-error">{error}</FieldError>
                      ) : null}
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
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={!!error}
                        aria-describedby={error ? "host-port-error" : undefined}
                      />
                      {error ? (
                        <FieldError id="host-port-error">{error}</FieldError>
                      ) : null}
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
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldDescription>
                    <Trans comment="主机表单用户名为空时的实际回退顺序">
                      留空则用 SSH 配置或系统用户
                    </Trans>
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
                      if (v === "password" || v === "key")
                        field.handleChange(v);
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
                        <PasswordInput
                          id="host-pw"
                          value={field.state.value ?? ""}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </UiField>
                    )}
                  </form.Field>
                ) : (
                  <form.Field name="keyId">
                    {(field) => {
                      const missingKeys = keys.length === 0;
                      const error = firstFormError(field.state.meta.errors);
                      const selectedKey = keys.find(
                        (key) => key.id === field.state.value,
                      );
                      return (
                        <>
                          <UiField data-invalid={!!error}>
                            <FieldLabel htmlFor="host-key">
                              <Trans>密钥</Trans>
                            </FieldLabel>
                            <Select
                              value={field.state.value ?? ""}
                              onValueChange={(v) => {
                                field.handleChange(v || null);
                                // 换用其它密钥后旧口令不再适用。
                                if (passphraseRef.current)
                                  passphraseRef.current.value = "";
                              }}
                              disabled={missingKeys}
                            >
                              <SelectTrigger
                                id="host-key"
                                className="w-full"
                                aria-invalid={!!error}
                                aria-describedby={
                                  error ? "host-key-error" : undefined
                                }
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="ui-density-adaptive">
                                <SelectGroup>
                                  {keys.map((k) => (
                                    <SelectItem key={k.id} value={k.id}>
                                      {k.label}
                                      {k.hasPassphrase ? (
                                        <Badge
                                          variant="secondary"
                                          className="ml-1.5"
                                        >
                                          <Trans>需口令</Trans>
                                        </Badge>
                                      ) : null}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            {missingKeys ? (
                              <FieldDescription>
                                <Trans>暂无密钥，请先导入</Trans>
                              </FieldDescription>
                            ) : error ? (
                              <FieldError id="host-key-error">
                                {error}
                              </FieldError>
                            ) : null}
                          </UiField>
                          {selectedKey?.hasPassphrase ? (
                            <UiField>
                              <FieldLabel htmlFor="host-key-passphrase">
                                <Trans comment="主机表单中仅用于测试连接的密钥口令">
                                  密钥口令（仅用于测试）
                                </Trans>
                              </FieldLabel>
                              <PasswordInput
                                id="host-key-passphrase"
                                ref={passphraseRef}
                                autoComplete="off"
                                aria-describedby="host-key-passphrase-desc"
                              />
                              <FieldDescription id="host-key-passphrase-desc">
                                <Trans>不会保存，仅在测试连接时使用</Trans>
                              </FieldDescription>
                            </UiField>
                          ) : null}
                        </>
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
                  />
                  <FieldDescription>
                    <Trans comment="默认目录为空或不存在时的回退行为">
                      留空或目录不存在时使用主目录
                    </Trans>
                  </FieldDescription>
                </UiField>
              )}
            </form.Field>

            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </FieldGroup>
        </DialogLayoutBody>

        <DialogLayoutFooter>
          <Button
            type="button"
            variant="outline"
            className="md:mr-auto"
            onClick={() => void testConnection()}
            disabled={isTesting}
          >
            {isTesting ? (
              <LoaderCircle
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <PlugZap data-icon="inline-start" aria-hidden="true" />
            )}
            {isTesting ? t`测试中…` : t`测试连接`}
          </Button>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            <Trans>取消</Trans>
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                onClick={() => void form.handleSubmit()}
                disabled={isSubmitting}
              >
                {isSubmitting ? t`保存中…` : t`保存`}
              </Button>
            )}
          </form.Subscribe>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
