import { Trans } from "@lingui/react/macro";
import { Clapperboard, ImageIcon, ImageUpscale } from "lucide-react";
import { Button } from "~/components/ui/button";
import { COMPRESS_MODES } from "~/features/media-compress/modes";
import type { CompressModeId } from "~/features/media-compress/types";
import { cn } from "~/lib/utils";

interface CompressModeTabsProps {
  value: CompressModeId;
  onChange: (mode: CompressModeId) => void;
  disabled?: boolean;
}

function modeLabel(id: CompressModeId) {
  switch (id) {
    case "image":
      return <Trans>图片压缩</Trans>;
    case "video":
      return <Trans>视频压缩</Trans>;
    case "resize":
      return <Trans>图片改尺寸</Trans>;
  }
}

function modeIcon(id: CompressModeId) {
  switch (id) {
    case "image":
      return <ImageIcon className="size-3.5" />;
    case "video":
      return <Clapperboard className="size-3.5" />;
    case "resize":
      return <ImageUpscale className="size-3.5" />;
  }
}

export function CompressModeTabs({
  value,
  onChange,
  disabled,
}: CompressModeTabsProps) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-md border border-border bg-muted/40 p-0.5"
    >
      {COMPRESS_MODES.map((mode) => {
        const active = mode.id === value;
        return (
          <Button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={active}
            size="xs"
            variant={active ? "secondary" : "ghost"}
            disabled={disabled}
            className={cn(
              "gap-1 px-2.5",
              active && "shadow-sm",
            )}
            onClick={() => onChange(mode.id)}
          >
            {modeIcon(mode.id)}
            {modeLabel(mode.id)}
          </Button>
        );
      })}
    </div>
  );
}
