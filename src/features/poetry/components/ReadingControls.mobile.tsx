import type { ComponentProps } from "react";

import ReadingModeTabs from "./ReadingModeTabs";
import ReadingSettingsPopover from "./ReadingSettingsPopover";

export default function ReadingControlsMobile({
  settings,
  settingsInHeader,
}: {
  settings: ComponentProps<typeof ReadingSettingsPopover>;
  settingsInHeader: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-3 py-1">
      <ReadingModeTabs />
      {!settingsInHeader ? <ReadingSettingsPopover {...settings} /> : null}
    </div>
  );
}
