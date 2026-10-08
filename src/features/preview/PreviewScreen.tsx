import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import type { PreviewKind } from "~/lib/preview-kind";

import PreviewSurface from "./PreviewSurface";

export interface PreviewScreenProps {
  /** 文件名，显示在标题栏，并用作图片的 alt 文本。 */
  name: string;
  onBack: () => void;
  kind: PreviewKind;
  /** 调用方仍在解析 URL 时为 null。 */
  url: string | null;
  error?: string | null;
  /** 调用方准备可加载 URL 期间显示的占位文案。 */
  loadingLabel?: ReactNode;
  /** 标题栏右侧（如关闭 / 保存到本地）。 */
  trailing?: ReactNode;
  /** 预览区下方的状态栏（如 BT 速度与连接数）。 */
  footer?: ReactNode;
}

/**
 * 通用整页预览：标题栏 + 按类型渲染的预览区 + 可选状态栏。
 * 任何模块只要解析出文件 URL 即可渲染；BT 模块会在底部
 * 追加自己的实时统计。
 */
export default function PreviewScreen({
  name,
  onBack,
  kind,
  url,
  error,
  loadingLabel,
  trailing,
  footer,
}: PreviewScreenProps) {
  const { t } = useLingui();
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader
        showHome={false}
        title={name || t`文件预览`}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t`返回来源`}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        }
        trailing={trailing}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pt-3 md:px-4 md:pt-4">
        {error ? (
          <div className="border-border text-destructive flex flex-1 items-center justify-center rounded-lg border p-4 text-center text-xs">
            {error}
          </div>
        ) : url ? (
          <PreviewSurface
            url={url}
            name={name}
            kind={kind}
            bottomInset={!footer}
          />
        ) : (
          <div className="border-border text-muted-foreground flex flex-1 items-center justify-center gap-2 rounded-lg border text-xs">
            <LoaderCircle className="size-3.5 animate-spin" />
            {loadingLabel ?? <Trans>加载中…</Trans>}
          </div>
        )}
        {footer ? (
          <div className="shrink-0 pb-[max(0.75rem,var(--safe-bottom,0px))]">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
