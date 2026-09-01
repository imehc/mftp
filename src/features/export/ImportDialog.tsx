import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileUp, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { PasswordInput } from "~/components/ui/password-input";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { exportSections } from "~/features/export/sections";
import { dataImport, dataInspect } from "~/lib/ipc";
import { useHostsStore } from "~/store/hosts";
import type { ImportMode, ImportPreview } from "~/bindings";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
interface PickedFile {
  name: string;
  raw: string;
  preview: ImportPreview;
}

/** 导入对话框：选择一个导出文件，自动识别加密，并选择导入模式。 */
export default function ImportDialog({ open, onOpenChange }: Props) {
  const { t } = useLingui();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const reloadHosts = useHostsStore((s) => s.loadAll);
  // 每次打开对话框时重置状态；用微任务延后，让重置
  // 发生在 effect 函数体之外。
  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setFile(null);
        setPassword("");
        setMode("merge");
      });
    }
  }, [open]);
  const modeDescriptions: Record<ImportMode, string> = {
    overwrite: t`清空现有数据后写入文件内容`,
    merge: t`相同记录更新，其余插入`,
    append: t`全部作为新记录插入`,
  };
  async function pickFile() {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const path = await openDialog({
        multiple: false,
        filters: [
          {
            name: "JSON",
            extensions: ["json"],
          },
        ],
      });
      if (typeof path !== "string" || !path) return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const raw = await readTextFile(path);
      const preview = await dataInspect(raw);
      const name = path.split(/[\\/]/).pop() ?? path;
      setFile({
        name,
        raw,
        preview,
      });
      setPassword("");
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function handleImport() {
    if (!file) return;
    if (file.preview.encrypted && !password) return;
    setBusy(true);
    try {
      const report = await dataImport(
        file.raw,
        file.preview.encrypted ? password : null,
        mode,
      );
      const inserted = report.sections.reduce((n, s) => n + s.inserted, 0);
      const updated = report.sections.reduce((n, s) => n + s.updated, 0);
      toast.success(t`导入完成：新增 ${inserted}，更新 ${updated}`);
      void reloadHosts();
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  const sectionTitle = (id: string) =>
    exportSections.find((meta) => meta.id === id)?.title ?? id;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <Trans>导入数据</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => void pickFile()}
          >
            <FileUp data-icon="inline-start" />
            {file ? file.name : <Trans>选择文件</Trans>}
          </Button>

          {file ? (
            file.preview.encrypted ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <LockKeyhole className="size-3.5" />
                  <Trans>加密文件，请输入密码</Trans>
                </p>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t`密码`}
                  aria-label={t`密码`}
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {file.preview.sections.map((id) => (
                  <Badge key={id} variant="outline">
                    {sectionTitle(id)}
                  </Badge>
                ))}
              </div>
            )
          ) : null}

          {file ? (
            <div className="flex flex-col gap-1.5">
              <ToggleGroup
                type="single"
                variant="outline"
                value={mode}
                onValueChange={(value) => {
                  if (value) setMode(value as ImportMode);
                }}
                className="w-full"
              >
                <ToggleGroupItem value="overwrite" className="flex-1">
                  <Trans>覆盖</Trans>
                </ToggleGroupItem>
                <ToggleGroupItem value="merge" className="flex-1">
                  <Trans>合并</Trans>
                </ToggleGroupItem>
                <ToggleGroupItem value="append" className="flex-1">
                  <Trans>新增</Trans>
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-muted-foreground text-xs">
                {modeDescriptions[mode]}
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <Trans>取消</Trans>
          </Button>
          <Button
            type="button"
            disabled={busy || !file || (file.preview.encrypted && !password)}
            onClick={() => void handleImport()}
          >
            <Trans>导入</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
