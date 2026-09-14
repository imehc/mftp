import { useEffect, useState, type ReactNode } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Archive, FolderTree, HardDriveDownload } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import AppPageLayout from "~/components/AppPageLayout";
import ExportDialog from "~/features/export/ExportDialog";
import ImportDialog from "~/features/export/ImportDialog";
import { exportSections } from "~/features/export/sections";
import { isDesktopPlatform } from "~/lib/platform";
import { type DirectoryTransferMode, useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

const transferModes = [
  { value: "archive", icon: Archive },
  { value: "direct", icon: FolderTree },
] as const;

export default function SettingsPage() {
  const { t } = useLingui();
  const mode = useSettingsStore((state) => state.directoryTransferMode);
  const setMode = useSettingsStore((state) => state.setDirectoryTransferMode);
  const running = useTransfersStore((state) =>
    state.transfers.some((item) => item.status === "running"),
  );
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!isDesktopPlatform()) return;
    void isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  async function setAutostartMode(value: boolean) {
    setAutostartBusy(true);
    try {
      if (value) await enable();
      else await disable();
      setAutostart(value);
      toast.success(value ? t`已开启开机自启` : t`已关闭开机自启`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setAutostartBusy(false);
    }
  }

  return (
    <AppPageLayout title={t`设置`} description={t`管理应用数据和运行方式`}>
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <section className="border-border bg-card divide-border divide-y rounded-lg border px-2.5">
          <SettingRow
            title={t`数据导入导出`}
            description={t`导出密码本、主机、待办和局域网配置。`}
          >
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => setExportOpen(true)}>
                <HardDriveDownload data-icon="inline-start" />
                {t`导出数据`}
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FolderTree data-icon="inline-start" />
                {t`导入数据`}
              </Button>
            </div>
          </SettingRow>

          {isDesktopPlatform() ? (
            <SettingRow title={t`开机自启`}>
              <Switch
                checked={autostart}
                disabled={autostartBusy}
                onCheckedChange={(value) => void setAutostartMode(value)}
                aria-label={t`开机自启`}
              />
            </SettingRow>
          ) : null}

          <SettingRow title={t`文件夹传输`}>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <ToggleGroup
                type="single"
                variant="outline"
                value={mode}
                onValueChange={(value) => {
                  if (!running) setMode(value as DirectoryTransferMode);
                }}
                className="gap-2"
              >
                {transferModes.map((item) => {
                  const Icon = item.icon;
                  return (
                    <ToggleGroupItem
                      key={item.value}
                      value={item.value}
                      disabled={running}
                      className="flex items-center gap-2"
                    >
                      <Icon className="size-4" />
                      {item.value === "archive" ? t`压缩包` : t`直连`}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
              {running ? (
                <p className="text-muted-foreground text-right text-xs">
                  {t`传输进行中，暂不可修改。`}
                </p>
              ) : null}
            </div>
          </SettingRow>
        </section>
      </div>
      <ExportDialog
        open={exportOpen}
        defaultSections={exportSections.map((item) => item.id)}
        onOpenChange={setExportOpen}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </AppPageLayout>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-col justify-between gap-2 py-2 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
