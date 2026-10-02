import type { ComponentProps } from "react";
import ReadingSettingsPopover from "./ReadingSettingsPopover";
import ReadingModeTabs from "./ReadingModeTabs";
export default function ReadingControlsMobile({
  settings,
  settingsInHeader,
}: {
  settings: ComponentProps<typeof ReadingSettingsPopover>;
  settingsInHeader: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1">
      <ReadingModeTabs />
      {!settingsInHeader ? <ReadingSettingsPopover {...settings} /> : null}
    </div>
  );
}
