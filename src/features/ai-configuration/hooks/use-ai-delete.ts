import { useEffect, useRef, useState } from "react";

import { aiKeyDelete, aiModelDelete, aiProviderDelete } from "~/lib/ipc";

import { useAiConfiguration } from "../store";
import type { AiDeleteTarget } from "../types";

export function useAiDelete(target: AiDeleteTarget, onClose: () => void) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { view, busy, error, execute } = useAiConfiguration();
  const [revision, setRevision] = useState(view!.revision);
  const [replacement, setReplacement] = useState("");
  const provider = view!.providers.find(
    (item) => item.id === target.provider.id,
  );
  const stale = revision !== view!.revision;
  const current =
    target.kind === "key"
      ? provider?.currentKeyId === target.item.id
      : target.kind === "model" && provider?.currentModelId === target.item.id;
  const choices =
    target.kind === "key"
      ? (provider?.keys ?? [])
          .filter((item) => item.id !== target.item.id)
          .map((item) => ({ id: item.id, label: item.label }))
      : target.kind === "model"
        ? (provider?.models ?? [])
            .filter((item) => item.id !== target.item.id)
            .map((item) => ({ id: item.id, label: item.modelId }))
        : [];

  async function remove() {
    const ok = await execute(() =>
      target.kind === "provider"
        ? aiProviderDelete({
            expectedRevision: revision,
            providerId: target.provider.id,
          })
        : target.kind === "key"
          ? aiKeyDelete({
              expectedRevision: revision,
              providerId: target.provider.id,
              keyId: target.item.id,
              replacementKeyId: current ? replacement : null,
            })
          : aiModelDelete({
              expectedRevision: revision,
              providerId: target.provider.id,
              id: target.item.id,
              replacementModelId: current ? replacement : null,
            }),
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
      setRevision(view!.revision);
      setReplacement("");
    },
  };
}
