import { Trans } from "@lingui/react/macro";

import { TabsList, TabsTrigger } from "~/components/ui/tabs";

export default function ReadingModeTabs({
  desktop = false,
}: {
  desktop?: boolean;
}) {
  return (
    <TabsList
      density="adaptive"
      variant="line"
      className={desktop ? undefined : "min-w-0 flex-1"}
    >
      {!desktop ? (
        <TabsTrigger value="original" className="min-w-0">
          <span className="truncate">
            <Trans>原文</Trans>
          </span>
        </TabsTrigger>
      ) : null}
      <TabsTrigger value="annotations" className="min-w-0">
        <span className="truncate">
          <Trans comment="诗词阅读标签，展示注释、赏析和源注释">注释</Trans>
        </span>
      </TabsTrigger>
      <TabsTrigger value="translation" className="min-w-0">
        <span className="truncate">
          <Trans>译文</Trans>
        </span>
      </TabsTrigger>
    </TabsList>
  );
}
