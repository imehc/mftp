import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { FolderOpen, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import ToggleGroup from "~/components/FixedToggleGroup";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import {
  Field as UiField,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
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
  createLanSettingsSchema,
  createLanTrustedDeviceSchema,
  type LanTrustedDeviceFormValues,
  lanTrustedDeviceFormValuesToInput,
} from "~/features/lan-transfer/lanTransferForms.schema";
import { firstFormError } from "~/lib/form-errors";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import type {
  LanNetworkAddress,
  LanTransferSettings,
  LanTrustedDevice,
  LanTrustedDeviceInput,
} from "~/types";

import LanConfirmDialog from "./LanConfirmDialog";

interface LanTransferSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: LanTransferSettings;
  addresses: LanNetworkAddress[];
  trustedDevices: LanTrustedDevice[];
  running: boolean;
  busy: boolean;
  chooseDownloadDir: () => Promise<string | null>;
  addTrustedDevice: (input: LanTrustedDeviceInput) => Promise<void>;
  deleteTrustedDevice: (id: string) => void;
  saveSettings: (values: LanTransferSettings) => Promise<void>;
}

const emptyTrustedDeviceFormValues: LanTrustedDeviceFormValues = {
  label: "",
  ip: "",
};

export default function LanTransferSettingsDialog({
  open,
  onOpenChange,
  settings,
  addresses,
  trustedDevices,
  running,
  busy,
  chooseDownloadDir,
  addTrustedDevice,
  deleteTrustedDevice,
  saveSettings,
}: LanTransferSettingsDialogProps) {
  const { t } = useLingui();
  const [pendingTrusted, setPendingTrusted] = useState<LanTrustedDevice | null>(
    null,
  );
  const pendingLabel = pendingTrusted?.label ?? "";
  const form = useForm({
    defaultValues: settings,
    validators: {
      onSubmit: createLanSettingsSchema(t),
    },
    onSubmit: async ({ value }) => {
      await saveSettings(value);
    },
  });
  const trustedForm = useForm({
    defaultValues: emptyTrustedDeviceFormValues,
    validators: {
      onSubmit: createLanTrustedDeviceSchema(t),
    },
    onSubmit: async ({ value }) => {
      await addTrustedDevice(lanTrustedDeviceFormValuesToInput(value));
      trustedForm.reset(emptyTrustedDeviceFormValues);
    },
  });
  useEffect(() => {
    if (!open) return;
    form.reset(settings);
    trustedForm.reset(emptyTrustedDeviceFormValues);
  }, [form, open, settings, trustedForm]);

  async function pickDownloadDir() {
    const selected = await chooseDownloadDir();
    if (selected) form.setFieldValue("downloadDir", selected);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent className="max-w-lg" showCloseButton={false}>
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>局域网传输设置</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <FieldGroup density="compact">
            <form.Field name="deviceName">
              {(field) => (
                <UiField>
                  <FieldLabel htmlFor="lan-device-name">
                    <Trans>设备名</Trans>
                  </FieldLabel>
                  <Input
                    id="lan-device-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </UiField>
              )}
            </form.Field>

            <form.Field name="port">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <UiField data-invalid={!!error}>
                    <FieldLabel htmlFor="lan-port">
                      <Trans>端口</Trans>
                    </FieldLabel>
                    <Input
                      id="lan-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={field.state.value}
                      inputMode="numeric"
                      disabled={running}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(Number(event.target.value))
                      }
                      aria-invalid={!!error}
                      aria-describedby={error ? "lan-port-error" : undefined}
                    />
                    {error ? (
                      <FieldError id="lan-port-error">{error}</FieldError>
                    ) : null}
                  </UiField>
                );
              }}
            </form.Field>

            <form.Field name="bindHost">
              {(field) => {
                const bindHostUnavailable = Boolean(
                  field.state.value &&
                  !addresses.some(
                    (address) => address.ip === field.state.value,
                  ),
                );
                return (
                  <UiField>
                    <FieldLabel>
                      <Trans>绑定 IP</Trans>
                    </FieldLabel>
                    <Select
                      value={field.state.value || "auto"}
                      onValueChange={(value) =>
                        field.handleChange(value === "auto" ? "" : value)
                      }
                      disabled={running}
                    >
                      <SelectTrigger
                        wrapValue
                        aria-label={t`绑定 IP`}
                        className="w-full"
                      >
                        <SelectValue placeholder={t`自动选择`} />
                      </SelectTrigger>
                      <SelectContent className="ui-density-adaptive">
                        <SelectGroup>
                          <SelectItem value="auto">
                            <Trans>自动选择</Trans>
                          </SelectItem>
                          {bindHostUnavailable ? (
                            <SelectItem value={field.state.value}>
                              {field.state.value} · {t`当前不可用`}
                            </SelectItem>
                          ) : null}
                          {addresses.map((address) => (
                            <SelectItem
                              key={`${address.interfaceName}-${address.ip}`}
                              value={address.ip}
                            >
                              {address.ip} · {address.interfaceName}
                              {address.recommended ? (
                                <Badge variant="secondary" className="ml-1.5">
                                  <Trans>推荐</Trans>
                                </Badge>
                              ) : null}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </UiField>
                );
              }}
            </form.Field>

            <form.Field name="downloadDir">
              {(field) => (
                <UiField>
                  <FieldLabel>
                    <Trans>接收目录</Trans>
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      aria-label={t`接收目录`}
                      readOnly
                      value={field.state.value}
                      placeholder={t`未选择`}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={pickDownloadDir}
                      disabled={running}
                    >
                      <FolderOpen data-icon="inline-start" />
                      <Trans>选择</Trans>
                    </Button>
                  </div>
                </UiField>
              )}
            </form.Field>

            <form.Field name="securityMode">
              {(field) => (
                <UiField>
                  <FieldLabel>
                    <Trans>安全模式</Trans>
                  </FieldLabel>
                  <ToggleGroup
                    aria-label={t`安全模式`}
                    type="single"
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (!value || running) return;
                      if (
                        value === "code" ||
                        value === "trusted" ||
                        value === "open"
                      ) {
                        field.handleChange(value);
                      }
                    }}
                    variant="outline"
                    disabled={running}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="code">
                      <Trans>确认码</Trans>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="trusted">
                      <Trans>白名单</Trans>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="open">
                      <Trans
                        context="LAN security mode"
                        comment="Security mode that allows LAN access without authentication"
                      >
                        开放
                      </Trans>
                    </ToggleGroupItem>
                  </ToggleGroup>
                </UiField>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.securityMode}>
              {(securityMode) =>
                securityMode === "trusted" ? (
                  <div className="border-border rounded-lg border p-2.5">
                    <div className="mb-2 text-sm font-medium">
                      <Trans>白名单</Trans>
                    </div>
                    <FieldGroup className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9.375rem_auto] md:items-start">
                      <trustedForm.Field name="label">
                        {(field) => (
                          <UiField>
                            <FieldLabel htmlFor="lan-trusted-label">
                              <Trans>名称</Trans>
                            </FieldLabel>
                            <Input
                              id="lan-trusted-label"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              aria-label={t`名称`}
                              placeholder={t`名称`}
                            />
                          </UiField>
                        )}
                      </trustedForm.Field>
                      <trustedForm.Field name="ip">
                        {(field) => {
                          const error = firstFormError(field.state.meta.errors);
                          return (
                            <UiField data-invalid={!!error}>
                              <FieldLabel htmlFor="lan-trusted-ip">
                                <Trans>IP 地址</Trans>
                              </FieldLabel>
                              <Input
                                id="lan-trusted-ip"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                aria-label={t`IP 地址`}
                                placeholder="192.168.1.10"
                                aria-invalid={!!error}
                                aria-describedby={
                                  error ? "lan-trusted-ip-error" : undefined
                                }
                              />
                              {error ? (
                                <FieldError id="lan-trusted-ip-error">
                                  {error}
                                </FieldError>
                              ) : null}
                            </UiField>
                          );
                        }}
                      </trustedForm.Field>
                      <trustedForm.Subscribe
                        selector={(state) => state.isSubmitting}
                      >
                        {(isSubmitting) => (
                          <Button
                            type="button"
                            variant="outline"
                            className="md:self-end"
                            onClick={() => void trustedForm.handleSubmit()}
                            disabled={isSubmitting}
                          >
                            <Trans>添加</Trans>
                          </Button>
                        )}
                      </trustedForm.Subscribe>
                    </FieldGroup>
                    <div className="mt-2 flex max-h-36 flex-col gap-1 overflow-auto">
                      {trustedDevices.length === 0 ? (
                        <Empty className="min-h-16 gap-0 border border-dashed p-3">
                          <EmptyHeader>
                            <EmptyTitle className="text-muted-foreground text-xs font-normal">
                              <Trans>暂无白名单</Trans>
                            </EmptyTitle>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        trustedDevices.map((device) => (
                          <div
                            key={device.id}
                            className="border-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {device.label}
                              </div>
                              <div className="text-muted-foreground truncate text-xs">
                                {device.ip}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title={t`删除白名单`}
                              aria-label={t`删除白名单`}
                              className={TOUCH_TARGET_CLASS}
                              onClick={() => setPendingTrusted(device)}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null
              }
            </form.Subscribe>

            <form.Subscribe selector={(state) => state.values.securityMode}>
              {(securityMode) =>
                securityMode === "open" ? (
                  <Alert variant="destructive">
                    <ShieldAlert />
                    <AlertTitle>
                      <Trans>开放模式会跳过确认码</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        同一局域网内设备可直接访问。仅在可信网络中使用，并配合默认权限限制访问范围。
                      </Trans>
                    </AlertDescription>
                  </Alert>
                ) : null
              }
            </form.Subscribe>

            <form.Field name="defaultPermission">
              {(field) => (
                <UiField>
                  <FieldLabel>
                    <Trans>默认权限</Trans>
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (!value || running) return;
                      if (
                        value === "readOnly" ||
                        value === "readWrite" ||
                        value === "uploadOnly"
                      ) {
                        field.handleChange(value);
                      }
                    }}
                    disabled={running}
                  >
                    <SelectTrigger aria-label={t`默认权限`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="ui-density-adaptive">
                      <SelectGroup>
                        <SelectItem value="readOnly">
                          <Trans>只读</Trans>
                        </SelectItem>
                        <SelectItem value="readWrite">
                          <Trans>读写</Trans>
                        </SelectItem>
                        <SelectItem value="uploadOnly">
                          <Trans>仅上传</Trans>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </UiField>
              )}
            </form.Field>

            <form.Field name="maxConcurrentTransfers">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <UiField data-invalid={!!error}>
                    <FieldLabel htmlFor="lan-max-concurrent">
                      <Trans>同时传输数</Trans>
                    </FieldLabel>
                    <Input
                      id="lan-max-concurrent"
                      type="number"
                      min={1}
                      max={16}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(Number(event.target.value))
                      }
                      disabled={running}
                      className="max-w-32"
                      aria-invalid={!!error}
                      aria-describedby={
                        error ? "lan-max-concurrent-error" : undefined
                      }
                    />
                    {error ? (
                      <FieldError id="lan-max-concurrent-error">
                        {error}
                      </FieldError>
                    ) : null}
                  </UiField>
                );
              }}
            </form.Field>

            <form.Field name="autoStart">
              {(field) => (
                <UiField orientation="horizontal">
                  <Checkbox
                    id="lan-auto-start"
                    checked={field.state.value}
                    onCheckedChange={(checked) =>
                      field.handleChange(checked === true)
                    }
                  />
                  <FieldLabel htmlFor="lan-auto-start">
                    <Trans>应用启动后自动开启服务</Trans>
                  </FieldLabel>
                </UiField>
              )}
            </form.Field>
          </FieldGroup>
          {running ? (
            <p className="text-muted-foreground mt-3 text-xs">
              <Trans>
                服务运行中，端口、接收目录、安全模式和权限需停止后修改；自动启动可直接保存。
              </Trans>
            </p>
          ) : null}
        </DialogLayoutBody>
        <DialogLayoutFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <Trans>取消</Trans>
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                onClick={() => void form.handleSubmit()}
                disabled={busy || isSubmitting}
              >
                <Trans>保存</Trans>
              </Button>
            )}
          </form.Subscribe>
        </DialogLayoutFooter>
      </DialogLayoutContent>
      <LanConfirmDialog
        open={pendingTrusted !== null}
        onOpenChange={(nextOpen) => !nextOpen && setPendingTrusted(null)}
        title={t`删除白名单`}
        description={
          <>
            {t`移除“${pendingLabel}”？`}
            <span className="mt-2 block">
              <Trans>移除后，该设备将不再自动获得访问权限。</Trans>
            </span>
          </>
        }
        confirmLabel={t`删除`}
        onConfirm={() => {
          if (pendingTrusted) void deleteTrustedDevice(pendingTrusted.id);
        }}
      />
    </Dialog>
  );
}
