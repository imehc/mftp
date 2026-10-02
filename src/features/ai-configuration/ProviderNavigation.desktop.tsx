import { Trans, useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { cn } from "cn";
import { AI_LIMITS, type ProviderNavigationProps } from "./types";

export default function ProviderNavigationDesktop({
  view,
  selectedId,
  onSelect,
  onAdd,
  disabled,
}: ProviderNavigationProps) {
  const { t } = useLingui();
  return (
    <nav aria-label={t`AI 服务地址`} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          <Trans>服务地址</Trans>
        </h3>
        <Button
          density="adaptive"
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={disabled || view.providers.length >= AI_LIMITS.providers}
        >
          <Plus data-icon="inline-start" />
          <Trans>添加</Trans>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {view.providers.length} / {AI_LIMITS.providers}
      </p>
      <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
        {view.providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            aria-pressed={selectedId === provider.id}
            disabled={disabled}
            onClick={() => onSelect(provider.id)}
            className={cn(
              "border-border hover:bg-muted focus-visible:ring-ring flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left focus-visible:ring-2",
              selectedId === provider.id && "bg-muted",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">
                {provider.name}
              </span>
              {view.activeProviderId === provider.id ? (
                <Badge variant="secondary">
                  <Trans>当前</Trans>
                </Badge>
              ) : null}
            </span>
            <span className="text-muted-foreground w-full truncate text-xs">
              {provider.baseUrl}
            </span>
            <span className="text-muted-foreground w-full truncate text-xs">
              {
                provider.keys.find((key) => key.id === provider.currentKeyId)
                  ?.label
              }{" "}
              ·{" "}
              {
                provider.models.find(
                  (model) => model.id === provider.currentModelId,
                )?.modelId
              }
            </span>
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        <Trans>切换当前地址时，恢复各自的密钥与模型选择。</Trans>
      </p>
    </nav>
  );
}
