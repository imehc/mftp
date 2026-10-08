import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { describeError } from "~/lib/errors";

import { useAiConfiguration } from "./store";

/** 全局模型入口只消费公开配置；密钥读取与认证属于实际生成/测试用例。 */
export default function AiModelMenuDesktop() {
  const { view, loading, busy, error, refresh, switchModel } =
    useAiConfiguration();
  const active = view?.providers.find(
    (provider) => provider.id === view.activeProviderId,
  );
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    >
      <DropdownMenuSubTrigger>
        <Bot />
        <Trans>AI 模型</Trans>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        collisionPadding={8}
        sticky="always"
        className="ui-density-adaptive max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-64 max-w-[min(calc(100vw-2rem),var(--radix-dropdown-menu-content-available-width))] overflow-y-auto"
      >
        {loading ? (
          <DropdownMenuGroup>
            <DropdownMenuItem disabled>
              <Trans>正在加载</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : null}
        {error ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="whitespace-normal">
              <span role="alert">{describeError(error)}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={loading || busy}
              onSelect={(event) => {
                event.preventDefault();
                void refresh();
              }}
            >
              <Trans>重新加载</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : null}
        {view && !active ? (
          <DropdownMenuLabel>
            <Trans>未启用服务地址</Trans>
          </DropdownMenuLabel>
        ) : null}
        {view?.providers.map((provider) => (
          <DropdownMenuGroup key={provider.id}>
            <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate" title={provider.name}>
                {provider.name}
              </span>
              {provider.id !== active?.id ? (
                <span>
                  <Trans>非当前地址</Trans>
                </span>
              ) : (
                <span>
                  <Trans>当前地址</Trans>
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={
                provider.id === active?.id
                  ? (provider.currentModelId ?? "")
                  : ""
              }
              onValueChange={(modelId) => {
                void switchModel({
                  expectedRevision: view.revision,
                  expectedActiveProviderId: provider.id,
                  modelId,
                });
              }}
            >
              {provider.models.map((model) => (
                <DropdownMenuRadioItem
                  key={model.id}
                  value={model.id}
                  disabled={
                    busy ||
                    loading ||
                    !!error ||
                    provider.id !== active?.id ||
                    provider.requiresAddressRepair
                  }
                  onSelect={(event) => event.preventDefault()}
                  title={model.modelId}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">
                      {model.displayName || model.modelId}
                    </span>
                    {model.displayName ? (
                      <span className="truncate">{model.modelId}</span>
                    ) : null}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/settings" search={{ panel: "ai" }}>
              <Trans>管理 AI 配置</Trans>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
