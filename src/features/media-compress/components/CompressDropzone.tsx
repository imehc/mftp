import type { ReactNode, RefObject } from "react";
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { pickFileNative, type NativeFilePickOptions } from "~/lib/files";
import { cn } from "cn";
import { describeError } from "~/lib/errors";
interface CompressDropzoneProps {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  footer?: ReactNode;
  preview?: ReactNode;
  onClear?: () => void;
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
  preview,
  onClear,
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
        toast.error(describeError(error));
        return;
      }
    }
    inputRef.current?.click();
  }
  return (
    <section
      className={cn(
        "border-border bg-card rounded-lg border p-3 transition-colors",
        !preview && "md:col-span-2 md:border-dashed",
        dragOver ? "border-primary bg-accent/40" : "border-border bg-card",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (disabled) return;
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
      {preview ? (
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm font-semibold">
            <Trans>源文件</Trans>
          </h2>
          <div className="bg-muted flex h-60 items-center justify-center overflow-hidden rounded-md">
            {preview}
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">{footer}</div>
            <div className="flex items-center gap-2">
              <Button
                density="adaptive"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void onPick()}
              >
                <Trans>更换</Trans>
              </Button>
              <Button
                density="adaptive"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onClear}
              >
                <Trans>清空</Trans>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 py-6 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-lg">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-muted-foreground mt-1 text-xs">{description}</p>
          </div>
          <Button
            density="adaptive"
            className="max-md:w-full"
            onClick={() => void onPick()}
            disabled={disabled}
          >
            <Upload />
            {pickLabel ?? <Trans>选择文件</Trans>}
          </Button>
        </div>
      )}
    </section>
  );
}
