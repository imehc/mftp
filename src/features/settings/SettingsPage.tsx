import { useLingui } from "@lingui/react/macro";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import AiConfigurationSettings from "~/features/ai-configuration/AiConfigurationSettings";
import AiWorkspaceMenu from "~/features/ai-configuration/AiWorkspaceMenu";
import BackupPage from "~/features/export/BackupPage";
import { McpSettingsPanel } from "~/features/mcp/integration";
import { poetryReadingLink } from "~/features/poetry/reading-navigation";
import type { PoetryReadingView } from "~/features/poetry/reading-view";

import FeatureEntrySettings from "./FeatureEntrySettings";
import SettingsOverview from "./SettingsOverview";

export default function SettingsPage({
  returnContext,
}: {
  returnContext?: {
    panel?: "ai" | "data" | "features" | "mcp";
    returnUid?: string;
    returnQ?: string;
    returnView?: PoetryReadingView;
    returnPage?: "library" | "detail";
  };
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const ai = returnContext?.panel === "ai" || !!returnContext?.returnUid;
  const features = returnContext?.panel === "features";
  const mcp = returnContext?.panel === "mcp";
  if (returnContext?.panel === "data") return <BackupPage />;
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader
        showHome={false}
        title={
          mcp ? t`MCP 服务` : ai ? t`AI 服务` : features ? t`功能入口` : t`设置`
        }
        leading={
          ai || features || mcp ? (
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
                  {...poetryReadingLink({
                    page: returnContext.returnPage ?? "detail",
                    uid: returnContext.returnUid,
                    q: returnContext.returnQ,
                    view: returnContext.returnView,
                  })}
                >{t`返回诗词`}</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      {mcp ? (
        <McpSettingsPanel />
      ) : ai ? (
        <AiConfigurationSettings />
      ) : features ? (
        <AppPageContent bottomInset="scroll">
          <FeatureEntrySettings />
        </AppPageContent>
      ) : (
        <AppPageContent bottomInset="scroll">
          <SettingsOverview
            onAi={() =>
              void navigate({ to: "/settings", search: { panel: "ai" } })
            }
          />
        </AppPageContent>
      )}
    </main>
  );
}
