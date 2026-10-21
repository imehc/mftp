import { Trans, useLingui } from "@lingui/react/macro";
import {
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  Settings2,
  Square,
  Volume2,
} from "lucide-react";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { describeError } from "~/lib/errors";

import type { usePoetrySpeech } from "../hooks/use-poetry-speech";
import type { PoetrySpeechDocument } from "../speech-document";
import { usePoetryStore } from "../store/poetry-store";

export default function PoetrySpeech({
  speech,
  text,
  onSettingsOpenChange,
}: {
  speech: ReturnType<typeof usePoetrySpeech>;
  text: PoetrySpeechDocument;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const voicePreference = usePoetryStore((state) => state.speechVoiceId);
  const ratePreference = usePoetryStore((state) => state.speechRate);
  const setVoice = usePoetryStore((state) => state.setSpeechVoiceId);
  const setRate = usePoetryStore((state) => state.setSpeechRate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const voiceLabel = useId();
  const rateLabel = useId();
  const voices =
    speech.catalog?.voices.filter((voice) =>
      /^(zh|cmn|yue)(-|$)/i.test(voice.language),
    ) ?? [];
  const selected =
    voices.find((voice) => voice.id === voicePreference) ??
    voices.find((voice) => voice.language === "zh-CN") ??
    voices[0];
  const rate = Number.isFinite(ratePreference)
    ? Math.min(1.5, Math.max(0.5, ratePreference))
    : 0.9;
  const segments = text.segments.map((segment) => segment.text);
  const phase = speech.snapshot?.phase;
  const playing = phase === "speaking";
  const paused = phase === "paused";
  const active =
    playing || paused || phase === "preparing" || phase === "stopping";
  const waiting = speech.busy || phase === "preparing" || phase === "stopping";
  const paragraph = (speech.snapshot?.segmentIndex ?? 0) + 1;
  const paragraphCount = speech.snapshot?.segmentCount ?? 0;
  const settingsLabel = t({
    message: "朗读设置",
    comment: "古诗词系统朗读的音色和语速设置入口",
  });
  const playbackLabel = playing
    ? t({ message: "暂停朗读", comment: "暂停当前诗词朗读" })
    : paused
      ? t({ message: "继续朗读", comment: "从暂停位置继续播放诗词" })
      : t({
          message: "朗读原文",
          comment: "使用系统语音朗读当前诗词原文",
        });
  const stopLabel = t({
    message: "停止朗读",
    comment: "结束当前诗词朗读或音色试听",
  });

  function start(isPreview: boolean) {
    setPreview(isPreview);
    void speech.run((session) =>
      session.start({
        segments: isPreview ? segments.slice(0, text.previewCount) : segments,
        voiceId: selected?.id ?? null,
        rate,
      }),
    );
  }

  if (speech.catalog?.available === false) return null;
  return (
    <div className="flex max-w-full min-w-0 flex-col items-end gap-2 font-sans">
      <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
        {active && !preview && paragraphCount > 0 ? (
          <span
            className="text-muted-foreground text-xs tabular-nums"
            aria-hidden
          >
            {paragraph} / {paragraphCount}
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              aria-label={playbackLabel}
              disabled={
                !speech.ready || !selected || !segments.length || waiting
              }
              onClick={() => {
                if (playing)
                  void speech.run((session) => session.control("pause"));
                else if (paused)
                  void speech.run((session) => session.control("resume"));
                else start(false);
              }}
            >
              {waiting ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : playing ? (
                <Pause aria-hidden />
              ) : paused ? (
                <Play aria-hidden />
              ) : (
                <Volume2 aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{playbackLabel}</TooltipContent>
        </Tooltip>
        {active ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={stopLabel}
                disabled={speech.busy}
                onClick={() =>
                  void speech.run((session) => session.control("stop"))
                }
              >
                <Square aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{stopLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        <Dialog
          open={settingsOpen}
          onOpenChange={(open) => {
            setSettingsOpen(open);
            onSettingsOpenChange(open);
            if (!open && preview && active)
              void speech.run((session) => session.control("stop"));
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  density="adaptive"
                  aria-label={settingsLabel}
                >
                  <Settings2 aria-hidden />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{settingsLabel}</TooltipContent>
          </Tooltip>
          <DialogLayoutContent
            placement="responsive-sheet"
            className="md:max-w-sm"
          >
            <DialogLayoutHeader>
              <DialogTitle>{settingsLabel}</DialogTitle>
              <DialogDescription>
                <Trans>
                  音色和语速将在下次朗读时使用。试听会替换当前朗读。
                </Trans>
              </DialogDescription>
            </DialogLayoutHeader>
            <DialogLayoutBody>
              <FieldGroup>
                <Field>
                  <FieldLabel id={voiceLabel}>
                    <Trans comment="系统语音合成使用的发声音色">音色</Trans>
                  </FieldLabel>
                  <Select
                    value={selected?.id ?? ""}
                    onValueChange={setVoice}
                    disabled={!voices.length}
                  >
                    <SelectTrigger
                      aria-labelledby={voiceLabel}
                      className="w-full"
                    >
                      <SelectValue placeholder={t`没有可用的中文音色`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {voices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name} · {voice.language}
                            {voice.quality > 1
                              ? ` · ${t({ message: "高质量", comment: "系统标记为增强或优质的语音音色" })}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel id={rateLabel} className="flex justify-between">
                    <Trans comment="诗词朗读速度，相对于系统正常语速">
                      语速
                    </Trans>
                    <span>{rate.toFixed(1)}×</span>
                  </FieldLabel>
                  <Slider
                    value={[rate]}
                    min={0.5}
                    max={1.5}
                    step={0.1}
                    onValueChange={([value]) => setRate(value)}
                    aria-labelledby={rateLabel}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      preview && active
                        ? speech.busy
                        : !speech.ready ||
                          !selected ||
                          !segments.length ||
                          waiting
                    }
                    onClick={() => {
                      if (preview && active)
                        void speech.run((session) => session.control("stop"));
                      else start(true);
                    }}
                  >
                    {preview && active ? (
                      <Square data-icon="inline-start" aria-hidden />
                    ) : (
                      <Headphones data-icon="inline-start" aria-hidden />
                    )}
                    {preview && active ? (
                      <Trans comment="停止当前设置弹窗中的音色样本播放">
                        停止试听
                      </Trans>
                    ) : (
                      <Trans comment="用当前音色朗读题目、作者信息与诗词第一段作为样本">
                        试听音色
                      </Trans>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={speech.busy}
                    onClick={() => void speech.refresh()}
                  >
                    <Trans comment="重新查询设备已安装的语音音色">
                      刷新音色
                    </Trans>
                  </Button>
                </div>
                {speech.catalog && !voices.length ? (
                  <p className="text-muted-foreground text-sm">
                    <Trans>
                      请在系统设置的辅助功能中下载中文语音，再刷新音色列表。
                    </Trans>
                  </p>
                ) : null}
                {speech.error ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {describeError(speech.error, t)}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </DialogLayoutBody>
          </DialogLayoutContent>
        </Dialog>
      </div>
      {active ? (
        <p className="sr-only" role="status">
          {phase === "preparing" ? (
            <Trans>正在准备朗读</Trans>
          ) : phase === "stopping" ? (
            <Trans>正在停止朗读</Trans>
          ) : paused ? (
            <Trans comment="诗词朗读或试听已暂停">朗读已暂停</Trans>
          ) : preview ? (
            <Trans comment="当前播放是音色样本">正在试听</Trans>
          ) : (
            <Trans comment="当前朗读段落与整首诗的总段数">
              第 {paragraph} / {paragraphCount} 段
            </Trans>
          )}
        </p>
      ) : null}
      {speech.error && !settingsOpen ? (
        <Alert variant="destructive" className="text-start">
          <AlertDescription>{describeError(speech.error, t)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
