import { Trans, useLingui } from "@lingui/react/macro";
import { FileInput } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "~/components/ui/select";
import { PasswordInput } from "~/components/ui/password-input";
import { SettingsGroup } from "~/features/settings/SettingsEntry";
import { exportSections } from "./sections";
import type { BackupController } from "./use-backup";

export default function ImportPanel({
  controller: c,
}: {
  controller: BackupController;
}) {
  const { t } = useLingui();
  const modes = {
    merge: t`合并：相同记录更新，其余插入`,
    append: t`新增：全部作为新记录插入`,
    overwrite: t`覆盖：替换备份涉及的模块数据`,
  };
  const title = (id: string) =>
    exportSections.find((s) => s.id === id)?.title ?? id;
  return (
    <div className="flex flex-col gap-3">
      <SettingsGroup title={<Trans>备份内容</Trans>}>
        <Button
          variant="outline"
          fullWidth
          disabled={c.busy || c.picking}
          onClick={() => void c.pick()}
        >
          <FileInput data-icon="inline-start" />
          <span className="truncate">
            {c.picking ? <Trans>正在读取…</Trans> : <Trans>选择备份文件</Trans>}
          </span>
        </Button>
        {c.file ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm font-medium break-all">{c.file.name}</p>
            {c.file.preview.encrypted ? (
              <p className="text-muted-foreground text-xs">
                <Trans>加密备份将在导入时解密，当前无法预览数据范围。</Trans>
              </p>
            ) : (
              c.file.preview.sections.map((id) => (
                <div className="border-b py-2 text-sm last:border-0" key={id}>
                  {title(id)}
                </div>
              ))
            )}
          </div>
        ) : (
          <p className="text-muted-foreground mt-3 text-xs">
            <Trans>选择后查看数据范围，再确认导入。</Trans>
          </p>
        )}
      </SettingsGroup>
      {c.file && !c.report ? (
        <SettingsGroup title={<Trans>导入选项</Trans>}>
          <FieldGroup>
            {c.file.preview.encrypted ? (
              <Field>
                <FieldLabel htmlFor="import-password">
                  <Trans>备份密码</Trans>
                </FieldLabel>
                <PasswordInput
                  id="import-password"
                  value={c.importPassword}
                  disabled={c.busy}
                  onChange={(e) => c.setImportPassword(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="import-mode">
                <Trans>导入模式</Trans>
              </FieldLabel>
              <Select
                value={c.mode}
                disabled={c.busy || c.picking}
                onValueChange={(v) => {
                  if (v === "merge" || v === "append" || v === "overwrite")
                    c.setMode(v);
                }}
              >
                <SelectTrigger id="import-mode" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(modes).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <p className="text-muted-foreground text-xs">
              <Trans>
                导入前请核对数据范围，覆盖模式会删除对应模块中的现有记录。
              </Trans>
            </p>
          </FieldGroup>
        </SettingsGroup>
      ) : null}
      {c.report ? (
        <SettingsGroup title={<Trans>导入完成</Trans>}>
          {c.report.sections.map(({ section, inserted, updated }) => (
            <div
              key={section}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0"
            >
              <span>{title(section)}</span>
              <span className="text-muted-foreground">
                {t({
                  comment: "导入结果行的新增和更新数量",
                  message: `新增 ${inserted}，更新 ${updated}`,
                })}
              </span>
            </div>
          ))}
        </SettingsGroup>
      ) : null}
    </div>
  );
}
