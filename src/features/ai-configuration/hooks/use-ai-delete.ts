import { useEffect, useRef, useState } from "react";

import type { AiConfigurationView } from "~/bindings";
import { aiKeyDelete, aiModelDelete, aiProviderDelete } from "~/lib/ipc";

import { useAiConfiguration } from "../store";
import type { AiDeleteTarget } from "../types";

export function deleteAiTarget(
  target: AiDeleteTarget,
  revision: number,
  replacement: string | null,
) {
  const common = { expectedRevision: revision, providerId: target.provider.id };
  switch (target.kind) {
    case "provider":
      return aiProviderDelete(common);
    case "key":
      return aiKeyDelete({
        ...common,
        keyId: target.item.id,
        replacementKeyId: replacement,
      });
    case "model":
      return aiModelDelete({
        ...common,
        id: target.item.id,
        replacementModelId: replacement,
      });
  }
}

export function useAiDelete(
  target: AiDeleteTarget,
  view: AiConfigurationView,
  onClose: () => void,
) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const busy = useAiConfiguration((state) => state.busy);
  const error = useAiConfiguration((state) => state.error);
  const execute = useAiConfiguration((state) => state.execute);
  const [revision, setRevision] = useState(view.revision);
  const [replacement, setReplacement] = useState("");
  const provider = view.providers.find(
    (item) => item.id === target.provider.id,
  );
  const stale = revision !== view.revision;
  const current =
    target.kind === "key"
      ? provider?.currentKeyId === target.item.id
      : target.kind === "model" && provider?.currentModelId === target.item.id;

  function replacementChoices() {
    switch (target.kind) {
      case "provider":
        return [];
      case "key":
        return (provider?.keys ?? [])
          .filter((item) => item.id !== target.item.id)
          .map((item) => ({ id: item.id, label: item.label }));
      case "model":
        return (provider?.models ?? [])
          .filter((item) => item.id !== target.item.id)
          .map((item) => ({ id: item.id, label: item.modelId }));
    }
  }

  const choices = replacementChoices();

  async function remove() {
    if (
      stale ||
      !provider ||
      (current && !choices.some((item) => item.id === replacement))
    )
      return;
    const ok = await execute(() =>
      deleteAiTarget(target, revision, current ? replacement : null),
    );
    if (ok && alive.current) onClose();
  }

  return {
    busy,
    error,
    provider,
    stale,
    current,
    choices,
    replacement,
    setReplacement,
    remove,
    rebase: () => {
      setRevision(view.revision);
      setReplacement("");
    },
  };
}
