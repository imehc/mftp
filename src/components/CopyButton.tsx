import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useLingui } from "@lingui/react/macro";
import { Check, Copy } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "cn";

type CopyButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "onClick"
> & {
  value: string;
  label?: string;
  copiedLabel?: string;
  showLabel?: boolean;
  onError?: (error: unknown) => void;
};

export function CopyButton({
  value,
  label,
  copiedLabel,
  showLabel = false,
  onError,
  title,
  className,
  ...props
}: CopyButtonProps) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      onError?.(error);
    }
  }

  const defaultLabel = t`复制`;
  const defaultCopiedLabel = t`已复制`;
  const currentTitle = copied
    ? (copiedLabel ?? defaultCopiedLabel)
    : (label ?? title ?? defaultLabel);

  return (
    <Button
      {...props}
      className={cn(className, copied && "text-success")}
      title={currentTitle}
      aria-label={currentTitle}
      onClick={() => void handleCopy()}
    >
      {copied ? (
        <Check data-icon="inline-start" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
      {showLabel ? currentTitle : null}
    </Button>
  );
}
