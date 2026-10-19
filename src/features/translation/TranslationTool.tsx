import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeftRight, Eraser, ExternalLink } from "lucide-react";
import { type ClipboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import AppPageLayout from "~/components/AppPageLayout";
import { CopyButton } from "~/components/CopyButton";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { describeError, toIpcError } from "~/lib/errors";

import { isModelManagementError } from "./error-scope";
import { ModelManager } from "./ModelManager";
import { useTranslation } from "./use-translation";

const languages = [
  {
    value: "auto",
    label: msg({
      message: "自动",
      comment: "源语言不指定，由离线翻译模型理解原文",
    }),
  },
  { value: "zh-CN", label: msg`中文（简体）` },
  { value: "en", label: msg`英语` },
  { value: "ja", label: msg`日语` },
  { value: "ko", label: msg`韩语` },
  { value: "fr", label: msg`法语` },
  { value: "de", label: msg`德语` },
] as const;

type Language = (typeof languages)[number]["value"];

export default function TranslationTool() {
  const { i18n, t } = useLingui();
  const [sourceLanguage, setSourceLanguage] = useState<Language>("auto");
  const [targetLanguage, setTargetLanguage] = useState<Language>("zh-CN");
  const [input, setInput] = useState("");
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const controller = useTranslation();
  const { output, snapshot, busy, running, stopping, error } = controller;
  const notifiedError = useRef("");
  const model = snapshot?.models.find(
    (item) => item.id === snapshot.selectedId,
  );
  const modelName = model?.name ?? "";
  const request = {
    modelId: snapshot?.selectedId ?? "",
    text: input,
    sourceLanguage,
    targetLanguage,
  };
  const stale =
    output.length > 0 && controller.resultKey !== JSON.stringify(request);
  const sourceLabel = languages.find(
    (language) => language.value === sourceLanguage,
  )?.label;
  const targetLabel = languages.find(
    (language) => language.value === targetLanguage,
  )?.label;

  useEffect(() => {
    if (error == null) {
      notifiedError.current = "";
      return;
    }
    const { kind, code, message } = toIpcError(error).payload;
    // 轮询失败会重复产生相同错误，只在错误内容变化时提示一次。
    const key = `${kind}:${code}:${message}`;
    if (notifiedError.current === key) return;
    notifiedError.current = key;
    // 模型管理弹窗打开时下载/安装错误已在弹窗内展示，不再叠加提示。
    if (modelManagerOpen && isModelManagementError(error)) return;
    toast.error(describeError(error, t));
  }, [error, modelManagerOpen, t]);

  function swapLanguages() {
    setSourceLanguage(targetLanguage === "auto" ? "zh-CN" : targetLanguage);
    setTargetLanguage(sourceLanguage === "auto" ? "en" : sourceLanguage);
  }

  function handleInputChange(value: string) {
    setInput(value);
    // 输入清空时同步清空输出，并取消仍在进行的翻译，避免结果回填。
    if (!value) controller.clear();
  }

  function clearAll() {
    setInput("");
    controller.clear();
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText) return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const nextInput =
      input.slice(0, textarea.selectionStart) +
      pastedText +
      input.slice(textarea.selectionEnd);
    setInput(nextInput);
    if (!busy && !running && model?.installed && nextInput.trim()) {
      void controller.run({ ...request, text: nextInput });
    }
  }

  return (
    <AppPageLayout
      title={<Trans>翻译</Trans>}
      adaptiveDensity
      bottomInset="scroll"
      contentDensity="compact"
      actions={
        <div className="flex w-[calc(100vw-1.5rem)] max-w-full items-center justify-end gap-2 sm:w-auto">
          <ModelManager
            controller={controller}
            open={modelManagerOpen}
            onOpenChange={setModelManagerOpen}
          />
        </div>
      }
    >
      <div className="border-border bg-card grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl border p-2 sm:grid-cols-[minmax(12rem,1fr)_2.5rem_minmax(12rem,1fr)] sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center justify-end gap-2">
          <span className="text-muted-foreground hidden text-xs sm:inline">
            <Trans>源语言</Trans>
          </span>
          <Select
            disabled={running}
            value={sourceLanguage}
            onValueChange={(value) => setSourceLanguage(value as Language)}
          >
            <SelectTrigger
              density="adaptive"
              className="w-auto max-w-40 min-w-0 justify-end text-sm"
              aria-label={t`选择源语言`}
            >
              <SelectValue>
                {i18n._(sourceLabel ?? languages[0].label)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {languages.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {i18n._(language.label)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          density="adaptive"
          aria-label={t`互换语言`}
          title={t`互换语言`}
          onClick={swapLanguages}
          disabled={running || sourceLanguage === "auto"}
        >
          <ArrowLeftRight />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Select
            disabled={running}
            value={targetLanguage}
            onValueChange={(value) => setTargetLanguage(value as Language)}
          >
            <SelectTrigger
              density="adaptive"
              className="w-auto max-w-40 min-w-0 text-sm"
              aria-label={t`选择目标语言`}
            >
              <SelectValue>
                {i18n._(targetLabel ?? languages[1].label)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {languages
                  .filter((language) => language.value !== "auto")
                  .map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {i18n._(language.label)}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground hidden text-xs sm:inline">
            <Trans>目标语言</Trans>
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
        <section className="border-border bg-card flex min-h-72 min-w-0 flex-col rounded-xl border">
          <div className="text-muted-foreground flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <h2 className="text-foreground font-medium">
              <Trans>输入</Trans>
            </h2>
            <span className="tabular-nums">
              <Plural
                value={input.length}
                one="# 个字符"
                other="# 个字符"
                comment="翻译输入文本的字符数"
              />
            </span>
          </div>
          <Textarea
            id="translation-input"
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            onPaste={handlePaste}
            placeholder={t`输入要翻译的文本`}
            aria-label={t`翻译输入`}
            className="field-sizing-fixed min-h-0 flex-1 resize-none rounded-none border-x-0 border-t border-b-0 px-3 py-3 text-sm shadow-none focus-visible:ring-2"
          />
          <div className="flex items-center justify-end gap-2 px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              density="adaptive"
              disabled={!input || running}
              onClick={clearAll}
            >
              <Eraser />
              <Trans>清空</Trans>
            </Button>
            {running ? (
              <Button
                variant="outline"
                size="sm"
                density="adaptive"
                disabled={stopping}
                onClick={() => void controller.stop()}
              >
                {stopping ? <Trans>正在停止…</Trans> : <Trans>停止</Trans>}
              </Button>
            ) : (
              <Button
                size="sm"
                density="adaptive"
                disabled={busy || !input.trim() || !model?.installed}
                onClick={() => void controller.run(request)}
              >
                <Trans>翻译</Trans>
              </Button>
            )}
          </div>
        </section>

        <section className="border-border bg-card flex min-h-72 min-w-0 flex-col rounded-xl border">
          <div className="text-muted-foreground flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <h2 className="text-foreground font-medium">
              <Trans>输出</Trans>
            </h2>
            <span className="tabular-nums">
              <Plural
                value={output.length}
                one="# 个字符"
                other="# 个字符"
                comment="翻译结果文本的字符数"
              />
            </span>
          </div>
          <Textarea
            id="translation-output"
            value={output}
            readOnly
            aria-label={t`翻译输出`}
            className="field-sizing-fixed min-h-0 flex-1 resize-none rounded-none border-x-0 border-t border-b-0 px-3 py-3 text-sm shadow-none focus-visible:ring-2"
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-muted-foreground text-xs">
              {stale && <Trans>输入、语言或模型已更改，请重新翻译。</Trans>}
            </span>
            <CopyButton
              variant="ghost"
              size="sm"
              density="adaptive"
              value={output}
              disabled={!output}
              showLabel
              label={t`复制结果`}
            />
          </div>
        </section>
      </div>
      {model?.installed ? (
        <p className="text-muted-foreground shrink-0 text-center text-xs leading-relaxed">
          <Trans comment="翻译区域下方的模型来源说明；链接文字是当前所选模型名称">
            由{" "}
            <a
              href={model.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground focus-visible:ring-ring inline-flex max-w-full items-center gap-1 rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2"
              onClick={(event) => {
                if (!isTauri()) return;
                event.preventDefault();
                void openUrl(model.sourceUrl).catch((error) =>
                  toast.error(describeError(error, t)),
                );
              }}
            >
              {modelName}
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>{" "}
            驱动
          </Trans>
        </p>
      ) : (
        snapshot && (
          <p
            className="text-muted-foreground shrink-0 text-center text-xs leading-relaxed"
            role="status"
          >
            <Trans>未配置驱动模型，</Trans>{" "}
            <Button
              variant="link"
              size="sm"
              density="adaptive"
              className="h-auto p-0 text-xs"
              onClick={() => setModelManagerOpen(true)}
            >
              <Trans>去下载</Trans>
            </Button>
          </p>
        )
      )}
    </AppPageLayout>
  );
}
