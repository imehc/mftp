import type { Dispatch, SetStateAction } from "react";
import { FolderOpen, ShieldAlert, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
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
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
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
import type {
  LanNetworkAddress,
  LanTransferSettings,
  LanTrustedDevice,
} from "~/types";

interface LanTransferSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftSettings: LanTransferSettings;
  setDraftSettings: Dispatch<SetStateAction<LanTransferSettings>>;
  addresses: LanNetworkAddress[];
  draftBindHostUnavailable: boolean;
  trustedDevices: LanTrustedDevice[];
  trustedLabel: string;
  setTrustedLabel: (value: string) => void;
  trustedIp: string;
  setTrustedIp: (value: string) => void;
  running: boolean;
  busy: boolean;
  chooseDownloadDir: () => void;
  addTrustedDevice: () => void;
  deleteTrustedDevice: (id: string) => void;
  saveSettings: () => void;
}

export default function LanTransferSettingsDialog({
  open,
  onOpenChange,
  draftSettings,
  setDraftSettings,
  addresses,
  draftBindHostUnavailable,
  trustedDevices,
  trustedLabel,
  setTrustedLabel,
  trustedIp,
  setTrustedIp,
  running,
  busy,
  chooseDownloadDir,
  addTrustedDevice,
  deleteTrustedDevice,
  saveSettings,
}: LanTransferSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent className="max-w-lg">
        <DialogLayoutHeader>
          <DialogTitle>局域网传输设置</DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <FieldGroup>
          <Field>
            <FieldLabel htmlFor="lan-device-name">设备名</FieldLabel>
            <Input
              id="lan-device-name"
              value={draftSettings.deviceName}
              onChange={(event) =>
                setDraftSettings((current) => ({
                  ...current,
                  deviceName: event.target.value,
                }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="lan-port">端口</FieldLabel>
            <Input
              id="lan-port"
              value={draftSettings.port}
              inputMode="numeric"
              disabled={running}
              onChange={(event) =>
                setDraftSettings((current) => ({
                  ...current,
                  port: Number(event.target.value) || 3000,
                }))
              }
            />
          </Field>
          <Field>
            <FieldLabel>绑定 IP</FieldLabel>
            <Select
              value={draftSettings.bindHost || "auto"}
              onValueChange={(value) =>
                setDraftSettings((current) => ({
                  ...current,
                  bindHost: value === "auto" ? "" : value,
                }))
              }
              disabled={running}
            >
              <SelectTrigger>
                <SelectValue placeholder="自动选择" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">自动选择</SelectItem>
                  {draftBindHostUnavailable ? (
                    <SelectItem value={draftSettings.bindHost}>
                      {draftSettings.bindHost} · 当前不可用
                    </SelectItem>
                  ) : null}
                  {addresses.map((address) => (
                    <SelectItem
                      key={`${address.interfaceName}-${address.ip}`}
                      value={address.ip}
                    >
                      {address.ip} · {address.interfaceName}
                      {address.recommended ? " · 推荐" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>接收目录</FieldLabel>
            <div className="flex gap-2">
              <Input
                readOnly
                value={draftSettings.downloadDir}
                placeholder="未选择"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={chooseDownloadDir}
                disabled={running}
              >
                <FolderOpen data-icon="inline-start" />
                选择
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel>安全模式</FieldLabel>
            <ToggleGroup
              type="single"
              value={draftSettings.securityMode}
              onValueChange={(value) => {
                if (!value || running) return;
                setDraftSettings((current) => ({
                  ...current,
                  securityMode: value,
                }));
              }}
              variant="outline"
              size="sm"
              disabled={running}
              className="justify-start"
            >
              <ToggleGroupItem value="code">确认码</ToggleGroupItem>
              <ToggleGroupItem value="trusted">白名单</ToggleGroupItem>
              <ToggleGroupItem value="open">开放</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {draftSettings.securityMode === "trusted" ? (
            <div className="rounded-lg border border-border p-2.5">
              <div className="mb-2 text-sm font-medium">白名单</div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                <Input
                  value={trustedLabel}
                  onChange={(event) => setTrustedLabel(event.target.value)}
                  placeholder="名称"
                />
                <Input
                  value={trustedIp}
                  onChange={(event) => setTrustedIp(event.target.value)}
                  placeholder="192.168.1.10"
                />
                <Button type="button" variant="outline" onClick={addTrustedDevice}>
                  添加
                </Button>
              </div>
              <div className="mt-2 flex max-h-36 flex-col gap-1 overflow-auto">
                {trustedDevices.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">
                    暂无白名单
                  </div>
                ) : (
                  trustedDevices.map((device) => (
                    <div
                      key={device.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{device.label}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {device.ip}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void deleteTrustedDevice(device.id)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
          {draftSettings.securityMode === "open" ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>开放模式会跳过确认码</AlertTitle>
              <AlertDescription>
                同一局域网内设备可直接访问。仅在可信网络中使用，并配合默认权限限制访问范围。
              </AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel>默认权限</FieldLabel>
            <ToggleGroup
              type="single"
              value={draftSettings.defaultPermission}
              onValueChange={(value) => {
                if (!value || running) return;
                setDraftSettings((current) => ({
                  ...current,
                  defaultPermission: value,
                }));
              }}
              variant="outline"
              size="sm"
              disabled={running}
              className="justify-start"
            >
              <ToggleGroupItem value="readOnly">只读</ToggleGroupItem>
              <ToggleGroupItem value="readWrite">读写</ToggleGroupItem>
              <ToggleGroupItem value="uploadOnly">仅上传</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel>同时传输数</FieldLabel>
            <Input
              type="number"
              min={1}
              max={16}
              value={draftSettings.maxConcurrentTransfers}
              onChange={(event) =>
                setDraftSettings((current) => ({
                  ...current,
                  maxConcurrentTransfers: Number(event.target.value),
                }))
              }
              disabled={running}
              className="max-w-32"
            />
          </Field>
          <Field orientation="horizontal">
            <input
              id="lan-auto-start"
              type="checkbox"
              checked={draftSettings.autoStart}
              onChange={(event) =>
                setDraftSettings((current) => ({
                  ...current,
                  autoStart: event.target.checked,
                }))
              }
              className="size-4 accent-primary"
            />
            <FieldLabel htmlFor="lan-auto-start">应用启动后自动开启服务</FieldLabel>
          </Field>
          </FieldGroup>
          {running ? (
            <p className="mt-3 text-xs text-muted-foreground">
              服务运行中，端口、接收目录、安全模式和权限需停止后修改；自动启动可直接保存。
            </p>
          ) : null}
        </DialogLayoutBody>
        <DialogLayoutFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={saveSettings} disabled={busy}>
            保存
          </Button>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
