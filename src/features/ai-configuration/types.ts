import type {
  AiConfigurationView,
  AiKeyView,
  AiModelView,
  AiProviderView,
} from "~/bindings";

export type AiEditorTarget =
  | { kind: "provider"; provider?: AiProviderView }
  | { kind: "key"; provider: AiProviderView; item?: AiKeyView }
  | { kind: "model"; provider: AiProviderView; item?: AiModelView };

export type AiDeleteTarget =
  | { kind: "provider"; provider: AiProviderView }
  | { kind: "key"; provider: AiProviderView; item: AiKeyView }
  | { kind: "model"; provider: AiProviderView; item: AiModelView };

export interface ProviderNavigationProps {
  view: AiConfigurationView;
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  disabled: boolean;
}

export interface RowActionsProps {
  current: boolean;
  disabled: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// 与后端 configuration/validation.rs 的业务上限一致，最终准入仍由后端裁决。
export const AI_LIMITS = { providers: 5, keys: 5, models: 10 } as const;
