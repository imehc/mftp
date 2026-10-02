import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  aiKeySave,
  aiModelSave,
  aiProviderCreate,
  aiProviderUpdate,
} from "~/lib/ipc";
import { toIpcError } from "~/lib/errors";
import type { AppError } from "~/bindings";
import { useAiConfiguration } from "../store";
import type { AiEditorTarget } from "../types";
import { findExistingItem } from "../find-existing-item";

/** 草稿跨断点保留，密钥仅留在非受控输入中，不进入状态和公开快照。 */
export function useAiEditor(target: AiEditorTarget, onSaved: () => void) {
  const { t } = useLingui();
  const view = useAiConfiguration((state) => state.view)!;
  const [revision, setRevision] = useState(view.revision);
  const [name, setName] = useState(
    target.kind === "provider" ? (target.provider?.name ?? "") : "",
  );
  const [baseUrl, setBaseUrl] = useState(
    target.kind === "provider" ? (target.provider?.baseUrl ?? "") : "",
  );
  const [label, setLabel] = useState(
    target.kind === "key" ? (target.item?.label ?? "") : "",
  );
  const [model, setModel] = useState(
    target.kind === "model" ? (target.item?.modelId ?? "") : "",
  );
  const [displayName, setDisplayName] = useState(
    target.kind === "model" ? (target.item?.displayName ?? "") : "",
  );
  const [keyDirty, setKeyDirty] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  // Portal 可能晚于父组件 effect 挂载；由节点 ref 的清理回调擦除实际输入。
  const [bindSecret] = useState(() => (input: HTMLInputElement) => {
    secretRef.current = input;
    return () => {
      input.value = "";
      if (secretRef.current === input) secretRef.current = null;
    };
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const initial =
    target.kind === "provider"
      ? [
          target.provider?.name ?? "",
          target.provider?.baseUrl ?? "",
          "",
          "",
          "",
        ]
      : target.kind === "key"
        ? ["", "", target.item?.label ?? "", "", ""]
        : [
            "",
            "",
            "",
            target.item?.modelId ?? "",
            target.item?.displayName ?? "",
          ];
  const dirty =
    keyDirty ||
    [name, baseUrl, label, model, displayName].some(
      (value, index) => value !== initial[index],
    );
  const addressChanged =
    target.kind === "provider" &&
    !!target.provider &&
    baseUrl.trim() !== target.provider.baseUrl;
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const existing = findExistingItem(
    view,
    target,
    target.kind === "key" ? label : model,
  );

  async function save() {
    // 重复项仅提供定位入口，不把新草稿（尤其密钥值）写入已有项。
    if (existing) return;
    setError(null);
    const required =
      target.kind === "provider"
        ? [name, baseUrl, ...(target.provider ? [] : [label, model])]
        : target.kind === "key"
          ? [label]
          : [model];
    if (required.some((value) => !value.trim())) {
      setError(t`请填写必填字段`);
      return;
    }
    const secret = secretRef.current?.value.trim() ?? "";
    if (
      ((target.kind === "provider" && !target.provider) ||
        (target.kind === "key" && !target.item)) &&
      !secret
    ) {
      setError(t`请输入密钥值`);
      return;
    }
    if (addressChanged && !addressConfirmed) {
      setError(t`请确认新的服务地址`);
      return;
    }
    const expectedRevision = revision;
    const ok = await useAiConfiguration.getState().execute(async () => {
      try {
        if (target.kind === "provider") {
          return target.provider
            ? await aiProviderUpdate({
                expectedRevision,
                providerId: target.provider.id,
                name,
                baseUrl,
              })
            : await aiProviderCreate({
                expectedRevision,
                name,
                baseUrl,
                keyLabel: label,
                apiKey: secret,
                modelId: model,
                displayName: null,
              });
        }
        if (target.kind === "key")
          return await aiKeySave({
            expectedRevision,
            providerId: target.provider.id,
            keyId: target.item?.id ?? null,
            label,
            replacementSecret: secret || null,
          });
        return await aiModelSave({
          expectedRevision,
          providerId: target.provider.id,
          id: target.item?.id ?? null,
          modelId: model,
          displayName: displayName || null,
        });
      } catch (cause) {
        if (alive.current) setError(toIpcError(cause).payload);
        throw cause;
      }
    });
    if (ok && alive.current) {
      if (secretRef.current) secretRef.current.value = "";
      onSaved();
    }
  }
  return {
    name,
    setName,
    baseUrl,
    setBaseUrl,
    label,
    setLabel,
    model,
    setModel,
    displayName,
    setDisplayName,
    bindSecret,
    setKeyDirty,
    dirty,
    existing,
    error,
    save,
    revision,
    addressChanged,
    addressConfirmed,
    setAddressConfirmed,
    rebase: () => {
      setRevision(view.revision);
      setError(null);
    },
    stale: revision !== view.revision,
  };
}
