import { useEffect, useState } from "react";
import type { Host, HostInput } from "~/types";
import { useHostsStore } from "~/store/hosts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "~/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing host to edit, or null to create. */
  host: Host | null;
}

const empty: HostInput = {
  label: "",
  host: "",
  port: 22,
  username: "",
  authType: "password",
  password: "",
  keyId: null,
  defaultPath: "",
};

export default function HostForm({ open, onOpenChange, host }: Props) {
  const keys = useHostsStore((s) => s.keys);
  const createHost = useHostsStore((s) => s.createHost);
  const updateHost = useHostsStore((s) => s.updateHost);

  const [form, setForm] = useState<HostInput>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (host) {
      setForm({
        label: host.label,
        host: host.host,
        port: host.port,
        username: host.username,
        authType: host.authType,
        password: host.password ?? "",
        keyId: host.keyId ?? null,
        defaultPath: host.defaultPath ?? "",
      });
    } else {
      setForm(empty);
    }
    setError(null);
  }, [open, host]);

  const set = <K extends keyof HostInput>(key: K, value: HostInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.label.trim() || !form.host.trim()) {
      setError("名称、地址为必填项");
      return;
    }
    if (form.authType === "key" && !form.keyId) {
      setError("请选择一个密钥，或先在密钥管理中导入");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: HostInput = {
        ...form,
        label: form.label.trim(),
        host: form.host.trim(),
        username: form.username.trim(),
        password: form.authType === "password" ? form.password : null,
        keyId: form.authType === "key" ? form.keyId : null,
        defaultPath: form.defaultPath?.trim() ? form.defaultPath.trim() : null,
      };
      if (host) await updateHost(host.id, payload);
      else await createHost(payload);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const missingKeys = form.authType === "key" && keys.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{host ? "编辑主机" : "新建主机"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-1">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="host-label">名称</FieldLabel>
              <Input
                id="host-label"
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="My Server"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <div className="grid grid-cols-[1fr_100px] gap-3">
              <Field>
                <FieldLabel htmlFor="host-addr">地址</FieldLabel>
                <Input
                  id="host-addr"
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="example.com"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="host-port">端口</FieldLabel>
                <Input
                  id="host-port"
                  type="number"
                  value={form.port}
                  onChange={(e) => set("port", Number(e.target.value) || 22)}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="host-user">用户名</FieldLabel>
              <Input
                id="host-user"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                placeholder="留空则使用 SSH 配置或本机用户"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              <FieldDescription>
                留空时优先使用 ~/.ssh/config 的 User，其次使用当前系统用户。
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>认证方式</FieldLabel>
              <ToggleGroup
                type="single"
                value={form.authType}
                onValueChange={(v) =>
                  v && set("authType", v as HostInput["authType"])
                }
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="password" className="flex-1">
                  密码
                </ToggleGroupItem>
                <ToggleGroupItem value="key" className="flex-1">
                  密钥
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {form.authType === "password" ? (
              <Field>
                <FieldLabel htmlFor="host-pw">密码</FieldLabel>
                <Input
                  id="host-pw"
                  type="password"
                  value={form.password ?? ""}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel>密钥</FieldLabel>
                <Select
                  value={form.keyId ?? ""}
                  onValueChange={(v) => set("keyId", v || null)}
                  disabled={missingKeys}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择密钥…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {keys.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.label}
                          {k.hasPassphrase ? " (需口令)" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {missingKeys ? (
                  <FieldDescription>
                    暂无密钥，请先在密钥管理中导入。
                  </FieldDescription>
                ) : null}
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="host-defpath">默认目录</FieldLabel>
              <Input
                id="host-defpath"
                value={form.defaultPath ?? ""}
                onChange={(e) => set("defaultPath", e.target.value)}
                placeholder="/var/www（留空则用主目录）"
              />
              <FieldDescription>
                打开 SFTP 时进入此目录；若不存在则回退到主目录，再退到根目录。
              </FieldDescription>
            </Field>

            {error ? (
              <FieldDescription className="text-destructive">
                {error}
              </FieldDescription>
            ) : null}
          </FieldGroup>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
