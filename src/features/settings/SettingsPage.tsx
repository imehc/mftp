import { useLingui } from "@lingui/react/macro";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import type { PoetryTranslationMode } from "~/bindings";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import AiConfigurationSettings from "~/features/ai-configuration/AiConfigurationSettings";
import AiWorkspaceMenu from "~/features/ai-configuration/AiWorkspaceMenu";
import BackupPage from "~/features/export/BackupPage";

import SettingsOverview from "./SettingsOverview";

export default function SettingsPage({
  returnContext,
}: {
  returnContext?: {
    panel?: "ai" | "data";
    returnUid?: string;
    returnQ?: string;
    returnMode?: PoetryTranslationMode;
  };
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const ai = returnContext?.panel === "ai" || !!returnContext?.returnUid;
  if (returnContext?.panel === "data") return <BackupPage />;
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader
        showHome={false}
        title={ai ? t`AI 服务` : t`设置`}
        leading={
          ai ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`返回设置`}
              onClick={() => void navigate({ to: "/settings", search: {} })}
            >
              <ArrowLeft />
            </Button>
          ) : undefined
        }
        trailing={
          <div className="flex items-center gap-1">
            {ai ? <AiWorkspaceMenu /> : null}
            {returnContext?.returnUid ? (
              <Button variant="outline" density="adaptive" asChild>
                <Link
                  to="/library/$id"
                  params={{ id: returnContext.returnUid }}
                  search={{
                    q: returnContext.returnQ,
                    mode: returnContext.returnMode,
                  }}
                >{t`返回诗词`}</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="app-scroll-safe-end mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto px-3 pt-3">
        {ai ? (
          <AiConfigurationSettings />
        ) : (
          <SettingsOverview
            onAi={() =>
              void navigate({ to: "/settings", search: { panel: "ai" } })
            }
          />
        )}
      </div>
    </main>
  );
}
