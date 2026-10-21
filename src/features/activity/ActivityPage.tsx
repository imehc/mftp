import { Trans, useLingui } from "@lingui/react/macro";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";

import type { ActivityTab } from "./ActivityCenter";
import { ActivityCenter } from "./ActivityCenter";

export default function ActivityPage() {
  const { t } = useLingui();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const [tab, setTab] = useState<ActivityTab>("tasks");
  return (
    <main
      data-bottom-inset="page"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      <ToolPageHeader
        showHome={false}
        showActivity={false}
        title={<Trans>活动</Trans>}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t`返回`}
            onClick={() => {
              if (canGoBack) router.history.back();
              else void router.navigate({ to: "/" });
            }}
          >
            <ArrowLeft />
          </Button>
        }
      />
      <AppPageContent width="full" scroll="content" density="compact">
        <ActivityCenter mode="page" tab={tab} onTabChange={setTab} />
      </AppPageContent>
    </main>
  );
}
