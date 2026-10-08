import "/src/App.css";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AiConfigurationView,
  AiProtocol,
  AiProviderView,
} from "../../../src/bindings";
import AiEditorDialog from "../../../src/features/ai-configuration/AiEditorDialog";
import { useAiConfiguration } from "../../../src/features/ai-configuration/store";
import type { AiEditorTarget } from "../../../src/features/ai-configuration/types";
import { messages } from "../../../src/locales/en/messages";

i18n.load("en", messages);
i18n.activate("en");
let view: AiConfigurationView = {
  revision: 0,
  activeProviderId: null,
  streamingEnabled: true,
  providers: [],
  labelCandidates: [],
  modelCandidates: [],
};
const qa = { calls: [] as { command: string; protocol: AiProtocol }[] };
Object.assign(window, {
  qa,
  __TAURI_INTERNALS__: {
    invoke: async (
      command: string,
      args: { input: { name: string; baseUrl: string; protocol: AiProtocol } },
    ) => {
      if (command === "ai_configuration_get") return view;
      if (command !== "ai_provider_create" && command !== "ai_provider_update")
        throw new Error(`Unexpected command ${command}`);
      const input = args.input;
      qa.calls.push({ command, protocol: input.protocol });
      const provider: AiProviderView = {
        id: "provider",
        name: input.name,
        baseUrl: input.baseUrl,
        protocol: input.protocol,
        requiresAddressRepair: false,
        currentKeyId: "key",
        currentModelId: "model",
        revision: view.revision + 1,
        keys: [{ id: "key", label: "test", state: "savedUnverified" }],
        models: [{ id: "model", modelId: "test-model", displayName: null }],
      };
      view = {
        ...view,
        revision: view.revision + 1,
        activeProviderId: provider.id,
        providers: [provider],
      };
      return view;
    },
  },
});
useAiConfiguration.setState({ view });

function Fixture() {
  const [target, setTarget] = useState<AiEditorTarget | null>({
    kind: "provider",
  });
  return (
    <I18nProvider i18n={i18n}>
      <button id="new" onClick={() => setTarget({ kind: "provider" })}>
        New
      </button>
      <button
        id="edit"
        onClick={() =>
          setTarget({ kind: "provider", provider: view.providers[0] })
        }
      >
        Edit
      </button>
      {target ? (
        <AiEditorDialog
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => setTarget(null)}
          onLocate={setTarget}
        />
      ) : null}
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
