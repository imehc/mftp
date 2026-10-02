import { Trans, useLingui } from "@lingui/react/macro";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "~/components/ui/field";
import { PasswordInput } from "~/components/ui/password-input";
import { SettingsGroup } from "~/features/settings/SettingsEntry";
import type { BackupController } from "./use-backup";

export default function ExportPanel({
  controller: c,
}: {
  controller: BackupController;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3">
      <SettingsGroup title={<Trans>选择导出数据</Trans>}>
        <FieldGroup density="compact">
          {c.available.map((s) => (
            <Field key={s.id} orientation="horizontal">
              <Checkbox
                id={`backup-section-${s.id}`}
                checked={c.selected.has(s.id)}
                disabled={c.busy}
                onCheckedChange={() => c.toggle(s.id)}
              />
              <FieldLabel
                htmlFor={`backup-section-${s.id}`}
                className="min-h-11 cursor-pointer py-2"
              >
                <span className="min-w-0">
                  <span className="block">{s.title}</span>
                  <span className="text-muted-foreground block text-xs font-normal">
                    {s.description}
                  </span>
                </span>
              </FieldLabel>
            </Field>
          ))}
        </FieldGroup>
      </SettingsGroup>
      <SettingsGroup title={<Trans>保护备份</Trans>}>
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id="backup-encrypted"
              checked={c.encrypted}
              disabled={c.busy}
              onCheckedChange={(checked) => {
                c.setEncrypted(checked === true);
                if (checked !== true) {
                  c.setPassword("");
                  c.setConfirmPassword("");
                }
              }}
            />
            <FieldLabel
              htmlFor="backup-encrypted"
              className="min-h-11 cursor-pointer"
            >
              <Trans>加密导出</Trans>
            </FieldLabel>
          </Field>
          {c.encrypted ? (
            <>
              <Field>
                <FieldLabel htmlFor="backup-password">
                  <Trans>备份密码</Trans>
                </FieldLabel>
                <PasswordInput
                  id="backup-password"
                  value={c.password}
                  disabled={c.busy}
                  onChange={(e) => c.setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field
                data-invalid={
                  !!c.confirmPassword && c.password !== c.confirmPassword
                }
              >
                <FieldLabel htmlFor="backup-confirm">
                  <Trans>确认密码</Trans>
                </FieldLabel>
                <PasswordInput
                  id="backup-confirm"
                  value={c.confirmPassword}
                  disabled={c.busy}
                  onChange={(e) => c.setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={
                    !!c.confirmPassword && c.password !== c.confirmPassword
                  }
                  aria-describedby={
                    c.confirmPassword && c.password !== c.confirmPassword
                      ? "backup-password-error"
                      : undefined
                  }
                />
                {c.confirmPassword && c.password !== c.confirmPassword ? (
                  <FieldError id="backup-password-error">{t`两次输入的密码不一致`}</FieldError>
                ) : null}
              </Field>
              <p className="text-muted-foreground text-xs">
                <Trans>请妥善保管密码，导入时需要使用。</Trans>
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">
              <Trans>导出为明文 JSON 文件，请妥善保管。</Trans>
            </p>
          )}
        </FieldGroup>
      </SettingsGroup>
    </div>
  );
}
