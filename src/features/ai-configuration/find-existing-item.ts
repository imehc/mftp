import type { AiConfigurationView } from "~/bindings";

import type { AiEditorTarget } from "./types";

/** 仅定位当前地址的其他条目；跨地址候选只复用文字，不改变当前选择。 */
export function findExistingItem(
  view: AiConfigurationView,
  target: AiEditorTarget,
  value: string,
): AiEditorTarget | null {
  if (target.kind === "provider") return null;
  const provider = view.providers.find(
    (item) => item.id === target.provider.id,
  );
  if (!provider) return null;
  const normalized = value.trim();
  if (target.kind === "key") {
    const item = provider.keys.find(
      (item) => item.id !== target.item?.id && item.label === normalized,
    );
    return item ? { kind: "key", provider, item } : null;
  }
  const item = provider.models.find(
    (item) => item.id !== target.item?.id && item.modelId === normalized,
  );
  return item ? { kind: "model", provider, item } : null;
}
