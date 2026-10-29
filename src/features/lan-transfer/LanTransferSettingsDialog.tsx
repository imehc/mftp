import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { FolderOpen, ShieldAlert } from "lucide-react";
import { useEffect } from "react";

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
import { createLanSettingsSchema } from "~/features/lan-transfer/lanTransferForms.schema";
import { firstFormError } from "~/lib/form-errors";
import type {
  LanNetworkAddress,
  LanTransferSettings,
  LanTrustedDevice,
  LanTrustedDeviceInput,
} from "~/types";

import LanTrustedDevices from "./LanTrustedDevices";

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
  const form = useForm({
    defaultValues: settings,
    validators: {
      onSubmit: createLanSettingsSchema(t),
    },
    onSubmit: async ({ value }) => {
      await saveSettings(value);
    },
  });
  useEffect(() => {
    if (!open) return;
    form.reset(settings);
  }, [form, open, settings]);

  async function pickDownloadDir() {
    const selected = await chooseDownloadDir();
    if (selected) form.setFieldValue("downloadDir", selected);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent
        placement="responsive-page"
        className="max-w-lg"
        showCloseButton={false}
      >
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
              {(securityMode) => (
                <LanTrustedDevices
                  visible={securityMode === "trusted"}
                  open={open}
                  settings={settings}
                  trustedDevices={trustedDevices}
                  addTrustedDevice={addTrustedDevice}
                  deleteTrustedDevice={deleteTrustedDevice}
                />
              )}
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
            <p className="app-description mt-3">
              <Trans comment="服务运行时受限字段需要停止服务才能改">
                需停止服务后修改。
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
    </Dialog>
  );
}
