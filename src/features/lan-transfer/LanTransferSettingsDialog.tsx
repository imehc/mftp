import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { FolderOpen, ShieldAlert, Trash2 } from "lucide-react";
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
  FieldDescription,
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
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { firstFormError } from "~/lib/form-errors";
import {
  createLanSettingsSchema,
  createLanTrustedDeviceSchema,
  lanTrustedDeviceFormValuesToInput,
  type LanTrustedDeviceFormValues,
} from "~/features/lan-transfer/lanTransferForms.schema";
import type {
  LanNetworkAddress,
  LanTransferSettings,
  LanTrustedDevice,
  LanTrustedDeviceInput,
} from "~/types";
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
      <DialogLayoutContent className="max-w-lg">
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>局域网传输设置</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <FieldGroup>
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
                      value={field.state.value}
                      inputMode="numeric"
                      disabled={running}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(Number(event.target.value) || 3000)
                      }
                      aria-invalid={!!error}
                    />
                    {error ? (
                      <FieldDescription>{error}</FieldDescription>
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
                      <SelectTrigger>
                        <SelectValue placeholder={t`自动选择`} />
                      </SelectTrigger>
                      <SelectContent>
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
                    size="sm"
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
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                      <trustedForm.Field name="label">
                        {(field) => (
                          <Input
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            placeholder={t`名称`}
                          />
                        )}
                      </trustedForm.Field>
                      <trustedForm.Field name="ip">
                        {(field) => {
                          const error = firstFormError(field.state.meta.errors);
                          return (
                            <div>
                              <Input
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                placeholder="192.168.1.10"
                                aria-invalid={!!error}
                              />
                              {error ? (
                                <FieldDescription className="text-destructive">
                                  {error}
                                </FieldDescription>
                              ) : null}
                            </div>
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
                            onClick={() => void trustedForm.handleSubmit()}
                            disabled={isSubmitting}
                          >
                            <Trans>添加</Trans>
                          </Button>
                        )}
                      </trustedForm.Subscribe>
                    </div>
                    <div className="mt-2 flex max-h-36 flex-col gap-1 overflow-auto">
                      {trustedDevices.length === 0 ? (
                        <div className="border-border text-muted-foreground rounded-md border border-dashed px-2 py-4 text-center text-xs">
                          <Trans>暂无白名单</Trans>
                        </div>
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
                              className="max-sm:min-h-11 max-sm:min-w-11"
                              onClick={() =>
                                void deleteTrustedDevice(device.id)
                              }
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
                  <ToggleGroup
                    type="single"
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
                    variant="outline"
                    size="sm"
                    disabled={running}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="readOnly">
                      <Trans>只读</Trans>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="readWrite">
                      <Trans>读写</Trans>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="uploadOnly">
                      <Trans>仅上传</Trans>
                    </ToggleGroupItem>
                  </ToggleGroup>
                </UiField>
              )}
            </form.Field>

            <form.Field name="maxConcurrentTransfers">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <UiField data-invalid={!!error}>
                    <FieldLabel>
                      <Trans>同时传输数</Trans>
                    </FieldLabel>
                    <Input
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
                    />
                    {error ? (
                      <FieldDescription>{error}</FieldDescription>
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
    </Dialog>
  );
}
