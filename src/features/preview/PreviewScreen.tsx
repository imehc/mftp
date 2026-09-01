import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import type { PreviewKind } from "~/lib/preview-kind";
import PreviewSurface from "./PreviewSurface";
export interface PreviewScreenProps {
  /** 文件名，显示在标题栏，并用作图片的 alt 文本。 */
  name: string;
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
  kind,
  url,
  error,
  loadingLabel,
  trailing,
  footer,
}: PreviewScreenProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolPageHeader title={name} trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
        {error ? (
          <div className="border-border text-destructive flex flex-1 items-center justify-center rounded-lg border p-4 text-center text-xs">
            {error}
          </div>
        ) : url ? (
          <PreviewSurface key={url} url={url} name={name} kind={kind} />
        ) : (
          <div className="border-border text-muted-foreground flex flex-1 items-center justify-center gap-2 rounded-lg border text-xs">
            <LoaderCircle className="size-3.5 animate-spin" />
            {loadingLabel ?? <Trans>加载中…</Trans>}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
