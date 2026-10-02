import { Trans, useLingui } from "@lingui/react/macro";
import { Pencil, Plus, Trash2, PlugZap } from "lucide-react";
import type { AiProviderView } from "~/bindings";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Alert, AlertDescription } from "~/components/ui/alert";
import RowActionsDesktop from "./RowActions.desktop";
import RowActionsMobile from "./RowActions.mobile";
import { AI_LIMITS, type AiDeleteTarget, type AiEditorTarget } from "./types";

interface Props {
  provider: AiProviderView;
  active: boolean;
  busy: boolean;
  wide: boolean;
  tab: string;
  onTab: (tab: string) => void;
  onEdit: (target: AiEditorTarget) => void;
  onDelete: (target: AiDeleteTarget) => void;
  onActivate: () => void;
  onTest: () => void;
  onSelect: (keyId: string, modelId: string) => void;
}

export default function ProviderDetails({
  provider,
  active,
  busy,
  wide,
  tab,
  onTab,
  onEdit,
  onDelete,
  onActivate,
  onTest,
  onSelect,
}: Props) {
  const { t } = useLingui();
  const RowActions = wide ? RowActionsDesktop : RowActionsMobile;
  const currentKey = provider.keys.find(
    (item) => item.id === provider.currentKeyId,
  );
  const currentModel = provider.models.find(
    (item) => item.id === provider.currentModelId,
  );
  return (
    <div className="border-border flex min-w-0 flex-col gap-3 md:rounded-lg md:border md:p-4">
      <div className="flex min-h-[max(44px,2.75rem)] items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{provider.name}</h3>
          <p
            className="text-muted-foreground mt-1 truncate text-xs"
            title={provider.baseUrl}
          >
            {provider.baseUrl}
          </p>
        </div>
        {active ? (
          <Badge variant="secondary">
            <Trans>当前地址</Trans>
          </Badge>
        ) : (
          <Button
            density="adaptive"
            size="sm"
            variant="outline"
            disabled={busy || provider.requiresAddressRepair}
            onClick={onActivate}
          >
            <Trans>设为当前</Trans>
          </Button>
        )}
      </div>
      {provider.requiresAddressRepair ? (
        <Alert>
          <AlertDescription>
            <Trans>此服务地址需要修复，请先编辑地址。</Trans>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          density="adaptive"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onEdit({ kind: "provider", provider })}
        >
          <Pencil data-icon="inline-start" />
          <Trans>编辑地址</Trans>
        </Button>
        <Button
          density="adaptive"
          variant="outline"
          size="sm"
          disabled={
            busy ||
            provider.requiresAddressRepair ||
            currentKey?.state !== "savedUnverified" ||
            !currentModel
          }
          onClick={onTest}
        >
          <PlugZap data-icon="inline-start" />
          <Trans>测试连接</Trans>
        </Button>
        <Button
          density="adaptive"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          disabled={busy}
          aria-label={t`删除服务地址`}
          onClick={() => onDelete({ kind: "provider", provider })}
        >
          <Trash2 />
        </Button>
      </div>
      <Separator />
      <dl className="grid min-w-0 grid-cols-2 gap-3 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">
            <Trans>当前密钥</Trans>
          </dt>
          <dd className="mt-1 truncate" title={currentKey?.label}>
            {currentKey?.label ?? t`未选择`}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">
            <Trans>当前模型</Trans>
          </dt>
          <dd className="mt-1 truncate" title={currentModel?.modelId}>
            {currentModel?.modelId ?? t`未选择`}
          </dd>
        </div>
      </dl>
      <Separator />
      <Tabs value={tab} onValueChange={onTab} className="min-w-0 gap-3">
        <TabsList density="adaptive" className="w-full md:w-fit">
          <TabsTrigger value="models">
            <Trans>模型</Trans>
            <span>{provider.models.length}</span>
          </TabsTrigger>
          <TabsTrigger value="keys">
            <Trans>密钥</Trans>
            <span>{provider.keys.length}</span>
          </TabsTrigger>
        </TabsList>
        {(["models", "keys"] as const).map((kind) => {
          const models = kind === "models";
          const count = models ? provider.models.length : provider.keys.length;
          return (
            <TabsContent
              key={kind}
              value={kind}
              className="mt-0 flex min-w-0 flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">
                  {models ? <Trans>模型</Trans> : <Trans>密钥</Trans>}
                </h4>
                <Button
                  density="adaptive"
                  variant="outline"
                  size="sm"
                  disabled={busy || count >= AI_LIMITS[kind]}
                  onClick={() =>
                    onEdit(
                      models
                        ? { kind: "model", provider }
                        : { kind: "key", provider },
                    )
                  }
                >
                  <Plus data-icon="inline-start" />
                  {models ? <Trans>添加模型</Trans> : <Trans>添加密钥</Trans>}
                </Button>
              </div>
              <div className="border-border h-[17rem] overflow-y-auto overscroll-contain rounded-lg border">
                <div className="bg-muted text-muted-foreground sticky top-0 z-10 flex justify-between gap-2 px-3 py-2 text-xs">
                  <span>
                    {models ? (
                      <Trans>模型名称 / ID</Trans>
                    ) : (
                      <Trans>标签</Trans>
                    )}
                  </span>
                  <span>
                    <Trans>操作</Trans>
                  </span>
                </div>
                {models
                  ? provider.models.map((item) => (
                      <div
                        key={item.id}
                        className="border-border flex min-w-0 items-center gap-2 border-b p-3 last:border-0"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="truncate text-sm"
                              title={item.modelId}
                            >
                              {item.modelId}
                            </span>
                            {provider.currentModelId === item.id ? (
                              <Badge variant="secondary">
                                <Trans>当前</Trans>
                              </Badge>
                            ) : null}
                          </div>
                          {item.displayName ? (
                            <p className="text-muted-foreground truncate text-xs">
                              {item.displayName}
                            </p>
                          ) : null}
                        </div>
                        <RowActions
                          current={provider.currentModelId === item.id}
                          disabled={busy}
                          canDelete={count > 1}
                          onSelect={() =>
                            onSelect(provider.currentKeyId ?? "", item.id)
                          }
                          onEdit={() =>
                            onEdit({ kind: "model", provider, item })
                          }
                          onDelete={() =>
                            onDelete({ kind: "model", provider, item })
                          }
                        />
                      </div>
                    ))
                  : provider.keys.map((item) => (
                      <div
                        key={item.id}
                        className="border-border flex min-w-0 items-center gap-2 border-b p-3 last:border-0"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="truncate text-sm"
                              title={item.label}
                            >
                              {item.label}
                            </span>
                            {provider.currentKeyId === item.id ? (
                              <Badge variant="secondary">
                                <Trans>当前</Trans>
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {item.state === "savedUnverified" ? (
                              <Trans>已保存 · 未验证</Trans>
                            ) : (
                              <Trans>未保存密钥</Trans>
                            )}
                          </p>
                        </div>
                        <RowActions
                          current={provider.currentKeyId === item.id}
                          disabled={busy}
                          canDelete={count > 1}
                          onSelect={() =>
                            onSelect(item.id, provider.currentModelId ?? "")
                          }
                          onEdit={() => onEdit({ kind: "key", provider, item })}
                          onDelete={() =>
                            onDelete({ kind: "key", provider, item })
                          }
                        />
                      </div>
                    ))}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
