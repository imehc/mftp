import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowDownUp,
  Binary,
  Copy,
  Eraser,
  Home,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  type Base64Variant,
  decodeBase64,
  encodeBase64,
} from "~/features/crypto/base64";

type CryptoAlgorithm = "base64";
type CryptoMode = "encode" | "decode";

export default function CryptoTool() {
  const { t } = useLingui();
  const [algorithm, setAlgorithm] = useState<CryptoAlgorithm>("base64");
  const [mode, setMode] = useState<CryptoMode>("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const [input, setInput] = useState("");

  const variant: Base64Variant = urlSafe ? "url-safe" : "standard";

  const outcome = useMemo(() => {
    if (!input) {
      return { ok: true as const, value: "" };
    }
    if (algorithm !== "base64") {
      return { ok: false as const, error: "unsupported" as const };
    }
    return mode === "encode"
      ? encodeBase64(input, variant)
      : decodeBase64(input, variant);
  }, [algorithm, input, mode, variant]);

  const output = outcome.ok ? outcome.value : "";
  const errorMessage = !outcome.ok
    ? outcome.error === "invalid-base64"
      ? t`内容无效，无法解码`
      : outcome.error === "encode-failed"
        ? t`编码失败`
        : t`暂不支持该算法`
    : null;

  async function copyText(value: string, successMessage: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      toast.error(String(error));
    }
  }

  function clearAll() {
    setInput("");
  }

  function swapInputOutput() {
    if (!outcome.ok || !output) return;
    setInput(output);
    setMode((current) => (current === "encode" ? "decode" : "encode"));
  }

  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
            <Trans>加解密</Trans>
          </div>
        </div>
        <Badge variant="outline">
          <Trans>本地处理</Trans>
        </Badge>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2 overflow-auto p-2.5 sm:p-3">
        <section className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <LockKeyhole className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">
                  <Trans>加解密</Trans>
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  <Trans>选择算法对文本进行编码或解码</Trans>
                </p>
              </div>
            </div>
            <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={swapInputOutput}
                disabled={!outcome.ok || !output}
                title={t`将结果写回输入并切换模式`}
              >
                <ArrowDownUp data-icon="inline-start" />
                <Trans>互换</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                disabled={!input}
              >
                <Eraser data-icon="inline-start" />
                <Trans>清空</Trans>
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-2.5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-end">
            <Field>
              <FieldLabel>
                <Trans>算法</Trans>
              </FieldLabel>
              <Select
                value={algorithm}
                onValueChange={(value) => {
                  if (value === "base64") setAlgorithm(value);
                }}
              >
                <SelectTrigger className="w-full" aria-label={t`选择算法`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="base64">
                    <span className="flex items-center gap-1.5">
                      <Binary className="size-3.5" />
                      Base64
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>
                <Trans>模式</Trans>
              </FieldLabel>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(value) => {
                  if (value === "encode" || value === "decode") {
                    setMode(value);
                  }
                }}
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="encode" className="flex-1">
                  <Trans>编码</Trans>
                </ToggleGroupItem>
                <ToggleGroupItem value="decode" className="flex-1">
                  <Trans>解码</Trans>
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {algorithm === "base64" ? (
              <Field orientation="horizontal" className="lg:pb-1">
                <Checkbox
                  id="crypto-url-safe"
                  checked={urlSafe}
                  onCheckedChange={(checked) => setUrlSafe(checked === true)}
                />
                <div className="min-w-0">
                  <FieldLabel htmlFor="crypto-url-safe">
                    <Trans>URL Safe</Trans>
                  </FieldLabel>
                  <FieldDescription>
                    <Trans>使用 -_ 替换 +/，并省略填充</Trans>
                  </FieldDescription>
                </div>
              </Field>
            ) : null}
          </div>
        </section>

        <section className="grid min-h-0 flex-1 gap-2 md:grid-cols-2">
          <div className="flex min-h-56 flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="crypto-input"
                className="text-xs font-medium text-muted-foreground"
              >
                <Trans>输入</Trans>
              </label>
              <div className="flex items-center gap-1">
                <Badge variant="outline">
                  <Trans>{input.length} 字符</Trans>
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void copyText(input, t`已复制输入`)}
                  disabled={!input}
                  aria-label={t`复制输入`}
                  title={t`复制输入`}
                >
                  <Copy />
                </Button>
              </div>
            </div>
            <Textarea
              id="crypto-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                mode === "encode"
                  ? t`输入要编码的文本`
                  : t`输入要解码的内容`
              }
              className="min-h-0 flex-1 resize-none font-mono text-sm"
              aria-invalid={!!errorMessage}
            />
          </div>

          <div className="flex min-h-56 flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="crypto-output"
                className="text-xs font-medium text-muted-foreground"
              >
                <Trans>输出</Trans>
              </label>
              <div className="flex items-center gap-1">
                {errorMessage ? (
                  <Badge variant="destructive">{errorMessage}</Badge>
                ) : (
                  <Badge variant="outline">
                    <Trans>{output.length} 字符</Trans>
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void copyText(output, t`已复制输出`)}
                  disabled={!output}
                  aria-label={t`复制输出`}
                  title={t`复制输出`}
                >
                  <Copy />
                </Button>
              </div>
            </div>
            <Textarea
              id="crypto-output"
              value={output}
              readOnly
              placeholder={t`结果会实时显示在这里`}
              className="min-h-0 flex-1 resize-none font-mono text-sm"
              aria-invalid={!!errorMessage}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
