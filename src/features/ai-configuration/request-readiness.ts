import type { AiConfigurationView } from "~/bindings";

/** 仅检查公开选择是否完整；凭据是否可用仍由实际请求的原生认证裁决。 */
export function hasAiRequestSelection(view: AiConfigurationView): boolean {
  const provider = view.providers.find(
    (item) => item.id === view.activeProviderId,
  );
  if (!provider || provider.requiresAddressRepair || !provider.baseUrl.trim())
    return false;
  const key = provider.keys.find((item) => item.id === provider.currentKeyId);
  const model = provider.models.find(
    (item) => item.id === provider.currentModelId,
  );
  return key?.state === "savedUnverified" && Boolean(model?.modelId.trim());
}
