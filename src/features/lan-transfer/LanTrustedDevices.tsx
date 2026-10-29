import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import {
  Field as UiField,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { firstFormError } from "~/lib/form-errors";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import type {
  LanTransferSettings,
  LanTrustedDevice,
  LanTrustedDeviceInput,
} from "~/types";

import LanConfirmDialog from "./LanConfirmDialog";
import {
  createLanTrustedDeviceSchema,
  type LanTrustedDeviceFormValues,
  lanTrustedDeviceFormValuesToInput,
} from "./lanTransferForms.schema";

const emptyTrustedDeviceFormValues: LanTrustedDeviceFormValues = {
  label: "",
  ip: "",
};

export default function LanTrustedDevices({
  visible,
  open,
  settings,
  trustedDevices,
  addTrustedDevice,
  deleteTrustedDevice,
}: {
  visible: boolean;
  open: boolean;
  settings: LanTransferSettings;
  trustedDevices: LanTrustedDevice[];
  addTrustedDevice: (input: LanTrustedDeviceInput) => Promise<void>;
  deleteTrustedDevice: (id: string) => void;
}) {
  const { t } = useLingui();
  const removeTrigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [pendingTrusted, setPendingTrusted] = useState<LanTrustedDevice | null>(
    null,
  );
  const pendingLabel = pendingTrusted?.label ?? "";
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
    if (open) trustedForm.reset(emptyTrustedDeviceFormValues);
  }, [open, settings, trustedForm]);

  if (!visible) return null;
  return (
    <>
      <div className="border-border rounded-lg border p-2.5">
        <div className="mb-2 text-sm font-medium">
          <Trans>白名单</Trans>
        </div>
        <FieldGroup
          density="compact"
          className="grid md:grid-cols-[minmax(0,1fr)_9.375rem_auto] md:items-start"
        >
          <trustedForm.Field name="label">
            {(field) => (
              <UiField>
                <FieldLabel htmlFor="lan-trusted-label">
                  <Trans>名称</Trans>
                </FieldLabel>
                <Input
                  id="lan-trusted-label"
                  ref={nameInput}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
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
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-label={t`IP 地址`}
                    placeholder="192.168.1.10"
                    aria-invalid={!!error}
                    aria-describedby={
                      error ? "lan-trusted-ip-error" : undefined
                    }
                  />
                  {error ? (
                    <FieldError id="lan-trusted-ip-error">{error}</FieldError>
                  ) : null}
                </UiField>
              );
            }}
          </trustedForm.Field>
          <trustedForm.Subscribe selector={(state) => state.isSubmitting}>
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
        <div className="app-scroll-safe-end mt-2 flex max-h-36 flex-col gap-1 overflow-auto">
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
                  onClick={(event) => {
                    removeTrigger.current = event.currentTarget;
                    setPendingTrusted(device);
                  }}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
      <LanConfirmDialog
        open={pendingTrusted !== null}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // 删除后原按钮可能已移除，此时回到白名单编辑入口。
          if (removeTrigger.current?.isConnected) removeTrigger.current.focus();
          else nameInput.current?.focus();
        }}
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
    </>
  );
}
