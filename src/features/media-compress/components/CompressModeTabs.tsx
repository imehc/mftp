import { Trans, useLingui } from "@lingui/react/macro";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { CompressModeId } from "../types";

export function CompressModeTabs({
  value,
  onChange,
  disabled,
}: {
  value: CompressModeId;
  onChange: (mode: CompressModeId) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (next === "image" || next === "video" || next === "resize")
          onChange(next);
      }}
    >
      <TabsList density="adaptive" aria-label={t`媒体处理模式`}>
        <TabsTrigger
          id="media-tab-image"
          aria-controls="media-panel-image"
          value="image"
          disabled={disabled}
        >
          <Trans>图片压缩</Trans>
        </TabsTrigger>
        <TabsTrigger
          id="media-tab-video"
          aria-controls="media-panel-video"
          value="video"
          disabled={disabled}
        >
          <Trans>视频压缩</Trans>
        </TabsTrigger>
        <TabsTrigger
          id="media-tab-resize"
          aria-controls="media-panel-resize"
          value="resize"
          disabled={disabled}
        >
          <Trans>调整尺寸</Trans>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
