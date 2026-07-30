import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { exportSections } from "~/features/export/sections";
import { downloadBlob } from "~/features/media-compress/format";
import { dataExport } from "~/lib/ipc";
import type { ExportSection } from "~/bindings";

interface Props {
  open: boolean;
  /** Sections preselected when the dialog opens. */
  defaultSections: ExportSection[];
  onOpenChange: (open: boolean) => void;
}

function exportFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `mftp-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

/** Shared export dialog: pick data sections, save them as one JSON file. */
export default function ExportDialog({
  open,
  defaultSections,
  onOpenChange,
}: Props) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<Set<ExportSection>>(new Set());
  const [encrypted, setEncrypted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset state each time the dialog opens; defaultSections is stable per caller.
  useEffect(() => {
    if (open) {
      setSelected(new Set(defaultSections));
      setEncrypted(false);
      setPassword("");
      setConfirmPassword("");
    }
  }, [open, defaultSections]);

  function toggle(id: ExportSection) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const passwordInvalid =
    encrypted && (!password || password !== confirmPassword);

  async function handleExport() {
    const sections = exportSections
      .map((meta) => meta.id)
      .filter((id) => selected.has(id));
    if (sections.length === 0 || passwordInvalid) return;
    setBusy(true);
    try {
      const json = await dataExport(sections, encrypted ? password : null);
      const written = await downloadBlob(
        new Blob([json], { type: "application/json" }),
        exportFileName(),
      );
      if (written !== false) {
        toast.success(t`已导出`);
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <Trans>导出数据</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {exportSections.map((meta) => (
            <Label
              key={meta.id}
              className="flex items-start gap-2 rounded-md border border-border p-2.5 font-normal"
            >
              <Checkbox
                checked={selected.has(meta.id)}
                onCheckedChange={() => toggle(meta.id)}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{meta.title}</span>
                <span className="text-xs text-muted-foreground">
                  {meta.description}
                </span>
              </span>
            </Label>
          ))}
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={encrypted}
              onCheckedChange={(checked) => setEncrypted(checked === true)}
            />
            <span className="text-sm">
              <Trans>加密导出</Trans>
            </span>
          </Label>
          {encrypted ? (
            <div className="flex flex-col gap-2">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t`密码`}
                aria-label={t`密码`}
                autoComplete="new-password"
              />
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t`确认密码`}
                aria-label={t`确认密码`}
                autoComplete="new-password"
                aria-invalid={
                  confirmPassword.length > 0 && password !== confirmPassword
                }
              />
              {confirmPassword.length > 0 && password !== confirmPassword ? (
                <p className="text-xs text-destructive">
                  <Trans>两次输入的密码不一致</Trans>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              <Trans>导出为明文 JSON 文件，请妥善保管。</Trans>
            </p>
          )}
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
            disabled={busy || selected.size === 0 || passwordInvalid}
            onClick={() => void handleExport()}
          >
            <Trans>导出</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
