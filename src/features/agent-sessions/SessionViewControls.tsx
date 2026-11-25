import { Trans, useLingui } from "@lingui/react/macro";
import { Ellipsis } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";

export function SessionViewControls({
  onlyChat,
  expanded,
  onOnlyChatChange,
  onExpandedChange,
}: {
  onlyChat: boolean;
  expanded: boolean;
  onOnlyChatChange: (value: boolean) => void;
  onExpandedChange: (value: boolean) => void;
}) {
  const { t } = useLingui();
  const label = t({
    message: "更多",
    comment: "Agent 会话标题栏图标，打开阅读开关下拉面板",
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <Ellipsis />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="ui-density-adaptive app-scroll-safe-end max-h-(--radix-popover-content-available-height) w-fit max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto p-2"
      >
        <div className="flex flex-col gap-1">
          <label className="hover:bg-accent flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-2 text-sm whitespace-nowrap">
            <Trans comment="更多面板阅读开关，只显示用户提问和助手回复">
              只看对话
            </Trans>
            <Switch checked={onlyChat} onCheckedChange={onOnlyChatChange} />
          </label>
          <label className="hover:bg-accent flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-2 text-sm whitespace-nowrap">
            <Trans comment="更多面板阅读开关，展开历史工具、思考和系统消息的正文">
              展开工具
            </Trans>
            <Switch checked={expanded} onCheckedChange={onExpandedChange} />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
