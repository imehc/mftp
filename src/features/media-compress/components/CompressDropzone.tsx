import type { ReactNode, RefObject } from "react";
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  pickFileNative,
  type NativeFilePickOptions,
} from "~/features/media-compress/format";
import { cn } from "~/lib/utils";
interface CompressDropzoneProps {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  footer?: ReactNode;
  pickLabel?: ReactNode;
  /**
   * 桌面端 Tauri 原生对话框的后缀过滤，因为 WebView 不强制
   * accept 属性。浏览器 / 移动端保留隐藏 input 作为兜底。
   */
  nativeFilter?: NativeFilePickOptions;
}
export function CompressDropzone({
  inputRef,
  accept,
  disabled,
  onFile,
  icon,
  title,
  description,
  footer,
  pickLabel,
  nativeFilter,
}: CompressDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  async function onPick() {
    if (nativeFilter) {
      try {
        const picked = await pickFileNative(nativeFilter);
        if (picked === false) return;
        if (picked) {
          onFile(picked);
          return;
        }
      } catch (error) {
        toast.error(String(error));
        return;
      }
    }
    inputRef.current?.click();
  }
  return (
    <section
      className={cn(
        "rounded-lg border border-dashed p-3 transition-colors",
        dragOver ? "border-primary bg-accent/40" : "border-border bg-card",
        disabled && "pointer-events-none opacity-60",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onFile(next);
        }}
      />
      <div className="flex flex-col items-center justify-center gap-2 py-4 text-center sm:py-6">
        <div className="border-border bg-background flex size-10 items-center justify-center rounded-md border">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void onPick()}
          disabled={disabled}
        >
          <Upload data-icon="inline-start" />
          {pickLabel ?? <Trans>选择文件</Trans>}
        </Button>
        {footer}
      </div>
    </section>
  );
}
