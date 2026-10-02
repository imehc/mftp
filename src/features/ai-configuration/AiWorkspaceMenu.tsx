import { Trans, useLingui } from "@lingui/react/macro";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { useAiConfiguration } from "./store";
import AiModelMenu from "./AiModelMenu";

/** 工作区次要操作与全局模型菜单共用公开快照，不读取密钥。 */
export default function AiWorkspaceMenu() {
  const { t } = useLingui();
  const { refresh, busy, loading } = useAiConfiguration();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          density="adaptive"
          size="icon-sm"
          aria-label={t`更多 AI 设置`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="ui-density-adaptive max-w-[calc(100vw-2rem)]"
      >
        <AiModelMenu />
        <DropdownMenuItem
          disabled={busy || loading}
          onSelect={() => void refresh()}
        >
          <RefreshCw />
          <Trans>刷新 AI 配置</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="max-w-64 text-xs font-normal whitespace-normal">
          <Trans>生成请求会发送到你配置的第三方服务，可能产生服务费用。</Trans>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
