import { Trans } from "@lingui/react/macro";
import { TabsList, TabsTrigger } from "~/components/ui/tabs";
export default function ReadingModeTabs() {
  return (
    <TabsList density="adaptive">
      <TabsTrigger value="original">
        <Trans>原文</Trans>
      </TabsTrigger>
      <TabsTrigger value="translation">
        <Trans>译文</Trans>
      </TabsTrigger>
    </TabsList>
  );
}
