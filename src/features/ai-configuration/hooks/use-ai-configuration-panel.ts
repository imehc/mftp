import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import {
  aiProviderActivate,
  aiProviderSelect,
  aiProviderTest,
  aiStreamingUpdate,
} from "~/lib/ipc";
import { useAiConfiguration } from "../store";
import type { AiDeleteTarget, AiEditorTarget } from "../types";

export function useAiConfigurationPanel() {
  const { t } = useLingui();
  const { view, loading, busy, error, refresh, execute, clearError } =
    useAiConfiguration();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("models");
  const [editor, setEditor] = useState<AiEditorTarget | null>(null);
  const [deleting, setDeleting] = useState<AiDeleteTarget | null>(null);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const provider =
    view?.providers.find((item) => item.id === selectedId) ??
    view?.providers.find((item) => item.id === view.activeProviderId) ??
    view?.providers[0];
  const active = view?.providers.find(
    (item) => item.id === view.activeProviderId,
  );
  function edit(target: AiEditorTarget) {
    clearError();
    setEditor(target);
  }
  function remove(target: AiDeleteTarget) {
    clearError();
    setDeleting(target);
  }
  async function test() {
    if (!view || !provider) return;
    if (
      await execute(() =>
        aiProviderTest({
          expectedRevision: view.revision,
          providerId: provider.id,
        }),
      )
    )
      toast.success(t`AI 服务连接成功`);
  }
  function saved() {
    const latest = useAiConfiguration.getState().view;
    if (editor?.kind === "provider" && !editor.provider) {
      const added = latest?.providers.find(
        (item) => !view?.providers.some((old) => old.id === item.id),
      );
      if (added) setSelectedId(added.id);
    }
    setEditor(null);
  }
  function activate() {
    if (view && provider)
      void execute(() =>
        aiProviderActivate({
          expectedRevision: view.revision,
          providerId: provider.id,
        }),
      );
  }
  function select(currentKeyId: string, currentModelId: string) {
    if (view && provider)
      void execute(() =>
        aiProviderSelect({
          expectedRevision: view.revision,
          providerId: provider.id,
          currentKeyId,
          currentModelId,
        }),
      );
  }
  function streaming(streamingEnabled: boolean) {
    if (view)
      void execute(() =>
        aiStreamingUpdate({
          expectedRevision: view.revision,
          streamingEnabled,
        }),
      );
  }
  return {
    view,
    loading,
    busy,
    error,
    refresh,
    provider,
    active,
    selectedId,
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
  };
}
