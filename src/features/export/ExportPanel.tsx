import { Trans, useLingui } from "@lingui/react/macro";
import { Lock } from "lucide-react";

import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { PasswordInput } from "~/components/ui/password-input";
import SettingsControl from "~/features/settings/SettingsControl";
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
        {c.available.map((s) => (
          <SettingsControl
            key={s.id}
            id={`backup-section-${s.id}`}
            icon={s.icon}
            title={s.title}
            description={s.description}
          >
            <Checkbox
              id={`backup-section-${s.id}`}
              checked={c.selected.has(s.id)}
              disabled={c.busy}
              onCheckedChange={() => c.toggle(s.id)}
            />
          </SettingsControl>
        ))}
      </SettingsGroup>
      <SettingsGroup title={<Trans>保护备份</Trans>}>
        <SettingsControl
          id="backup-encrypted"
          icon={Lock}
          title={<Trans>加密导出</Trans>}
        >
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
        </SettingsControl>
        <FieldGroup>
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
              <p className="app-description">
                <Trans>请妥善保管密码，导入时需要使用。</Trans>
              </p>
            </>
          ) : (
            <p className="app-description">
              <Trans>导出为明文 JSON 文件，请妥善保管。</Trans>
            </p>
          )}
        </FieldGroup>
      </SettingsGroup>
    </div>
  );
}
