import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Field, FieldLabel } from "~/components/ui/field";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "~/components/ui/empty";
import { Separator } from "~/components/ui/separator";
import { describeError } from "~/lib/errors";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { useAiConfigurationPanel } from "./hooks/use-ai-configuration-panel";
import ProviderNavigationDesktop from "./ProviderNavigation.desktop";
import ProviderNavigationMobile from "./ProviderNavigation.mobile";
import ProviderDetails from "./ProviderDetails";
import AiEditorDialog from "./AiEditorDialog";
import AiDeleteDialog from "./AiDeleteDialog";

export default function AiConfigurationSettings() {
  const { t } = useLingui();
  const {
    view,
    loading,
    busy,
    error,
    refresh,
    provider,
    active,
    setSelectedId,
    tab,
    setTab,
    editor,
    setEditor,
    deleting,
    setDeleting,
    edit,
    remove,
    test,
    activate,
    select,
    streaming,
    saved,
  } = useAiConfigurationPanel();
  const wide = useDesktopLayout();
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-busy={busy || loading}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {view && provider && !wide ? (
            <ProviderNavigationMobile
              view={view}
              selectedId={provider.id}
              onSelect={setSelectedId}
              onAdd={() => edit({ kind: "provider" })}
              disabled={busy}
            />
          ) : (
            <Button
              variant="ghost"
              density="adaptive"
              disabled={!active}
              onClick={() => active && setSelectedId(active.id)}
              className="max-w-full justify-start"
            >
              <Sparkles />
              <span className="min-w-0 text-left">
                <span className="block truncate">
                  {active ? active.name : t`未启用服务地址`}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {
                    active?.models.find(
                      (model) => model.id === active.currentModelId,
                    )?.modelId
                  }
                </span>
              </span>
            </Button>
          )}
        </div>
        <Field orientation="horizontal" className="w-auto shrink-0 gap-2">
          <FieldLabel htmlFor="ai-global-streaming">
            <Trans>流式输出</Trans>
          </FieldLabel>
          <Switch
            id="ai-global-streaming"
            checked={view?.streamingEnabled ?? true}
            disabled={!view || busy}
            onCheckedChange={streaming}
          />
        </Field>
      </div>
      <Separator />
      {error && !editor && !deleting ? (
        <Alert variant="destructive">
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      ) : null}
      {!view ? (
        loading ? (
          <p
            role="status"
            className="text-muted-foreground py-8 text-center text-sm"
          >
            <Trans>正在加载</Trans>
          </p>
        ) : (
          <Button variant="outline" fullWidth onClick={() => void refresh()}>
            <Trans>重新加载</Trans>
          </Button>
        )
      ) : view.providers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              <Trans>添加 AI 服务地址</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>为每个地址保存密钥和模型，切换时恢复各自的选择。</Trans>
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              fullWidth
              disabled={busy}
              onClick={() => edit({ kind: "provider" })}
            >
              <Plus data-icon="inline-start" />
              <Trans>添加地址</Trans>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
          {wide ? (
            <ProviderNavigationDesktop
              view={view}
              selectedId={provider!.id}
              onSelect={setSelectedId}
              onAdd={() => edit({ kind: "provider" })}
              disabled={busy}
            />
          ) : null}
          {provider ? (
            <ProviderDetails
              provider={provider}
              active={provider.id === view.activeProviderId}
              busy={busy}
              wide={wide}
              tab={tab}
              onTab={setTab}
              onEdit={edit}
              onDelete={remove}
              onActivate={activate}
              onTest={() => void test()}
              onSelect={select}
            />
          ) : null}
        </div>
      )}
      {editor && view ? (
        <AiEditorDialog
          key={`${editor.kind}:${editor.provider?.id ?? "new"}:${editor.kind === "provider" ? "provider" : (editor.item?.id ?? "new")}`}
          target={editor}
          onLocate={edit}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      ) : null}
      {deleting && view ? (
        <AiDeleteDialog target={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </section>
  );
}
