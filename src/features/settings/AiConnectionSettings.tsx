import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  CircleCheck,
  KeyRound,
  LoaderCircle,
  Save,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { Switch } from "~/components/ui/switch";
import {
  aiConnectionClearKey,
  aiConnectionGet,
  aiConnectionSave,
  aiConnectionTest,
} from "~/lib/ipc";

export default function AiConnectionSettings() {
  const { t } = useLingui();
  const keyInputRef = useRef<HTMLInputElement>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [savedBaseUrl, setSavedBaseUrl] = useState("");
  const [savedModel, setSavedModel] = useState("");
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [savedStreamingEnabled, setSavedStreamingEnabled] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const dirty =
    baseUrl.trim() !== savedBaseUrl ||
    model.trim() !== savedModel ||
    streamingEnabled !== savedStreamingEnabled;

  useEffect(() => {
    let cancelled = false;
    void aiConnectionGet()
      .then((connection) => {
        if (cancelled) return;
        setBaseUrl(connection.baseUrl);
        setModel(connection.model);
        setSavedBaseUrl(connection.baseUrl);
        setSavedModel(connection.model);
        setStreamingEnabled(connection.streamingEnabled);
        setSavedStreamingEnabled(connection.streamingEnabled);
        setHasKey(connection.hasKey);
      })
      .catch((error) => !cancelled && toast.error(String(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveConnection() {
    setSaving(true);
    try {
      const apiKey = keyInputRef.current?.value.trim() || null;
      const connection = await aiConnectionSave({
        baseUrl,
        model,
        streamingEnabled,
        apiKey,
      });
      setBaseUrl(connection.baseUrl);
      setModel(connection.model);
      setSavedBaseUrl(connection.baseUrl);
      setSavedModel(connection.model);
      setStreamingEnabled(connection.streamingEnabled);
      setSavedStreamingEnabled(connection.streamingEnabled);
      setHasKey(connection.hasKey);
      if (keyInputRef.current) keyInputRef.current.value = "";
      toast.success(t`AI 服务配置已保存`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      await aiConnectionTest();
      toast.success(t`AI 服务连接成功`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setTesting(false);
    }
  }

  async function clearKey() {
    try {
      const connection = await aiConnectionClearKey();
      setHasKey(connection.hasKey);
      toast.success(t`API Key 已清除`);
    } catch (error) {
      toast.error(String(error));
    }
  }

  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{t`AI 服务`}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t`当前仅支持 OpenAI Responses 接口格式`}
          </p>
          <p className="text-muted-foreground mt-1 max-w-prose text-xs leading-relaxed">
            {t`生成请求会发送到你配置的第三方服务，可能产生服务费用。`}
          </p>
        </div>
        <Badge variant={hasKey ? "secondary" : "outline"}>
          {hasKey ? <CircleCheck /> : <KeyRound />}
          {hasKey ? t`已保存密钥` : t`未保存密钥`}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ai-base-url">{t`服务地址`}</Label>
          <Input
            id="ai-base-url"
            type="url"
            value={baseUrl}
            disabled={loading || saving}
            placeholder={t`请输入服务地址`}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ai-model">{t`模型`}</Label>
          <Input
            id="ai-model"
            value={model}
            disabled={loading || saving}
            placeholder={t`请输入模型名称`}
            onChange={(event) => setModel(event.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ai-api-key">
            {hasKey ? t`替换 API Key` : t`API Key`}
          </Label>
          <PasswordInput
            ref={keyInputRef}
            id="ai-api-key"
            disabled={loading || saving}
            placeholder={hasKey ? t`留空则保留现有密钥` : t`输入 API Key`}
            aria-label={hasKey ? t`替换 API Key` : t`API Key`}
          />
        </div>
        <div className="flex items-center justify-between gap-4 sm:col-span-2">
          <Label htmlFor="ai-streaming">{t`流式输出`}</Label>
          <Switch
            id="ai-streaming"
            checked={streamingEnabled}
            disabled={loading || saving}
            aria-label={t`流式输出`}
            onCheckedChange={setStreamingEnabled}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {hasKey ? (
          <Button
            type="button"
            variant="outline"
            disabled={saving || testing}
            onClick={() => setClearOpen(true)}
          >
            <Unplug data-icon="inline-start" />
            {t`清除密钥`}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={loading || saving || testing || dirty || !hasKey}
          title={dirty ? t`请先保存当前配置` : t`测试连接`}
          onClick={() => void testConnection()}
        >
          {testing ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <CircleCheck data-icon="inline-start" />
          )}
          {t`测试连接`}
        </Button>
        <Button
          type="button"
          disabled={loading || saving || testing}
          onClick={() => void saveConnection()}
        >
          {saving ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          {t`保存`}
        </Button>
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`清除 API Key？`}</AlertDialogTitle>
            <AlertDialogDescription>
              {t`系统凭据库中的 AI 密钥将被删除，服务地址和模型会保留。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clearKey()}>
              {t`确认清除`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
