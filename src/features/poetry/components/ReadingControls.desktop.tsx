import type { ComponentProps } from "react";

import ReadingSettingsPopover from "./ReadingSettingsPopover";

export default function ReadingControlsDesktop({
  settings,
  settingsInHeader = false,
}: {
  settingsInHeader?: boolean;
  settings: ComponentProps<typeof ReadingSettingsPopover>;
}) {
  if (settingsInHeader) return null;
  return (
    <div className="flex items-center justify-end">
      <ReadingSettingsPopover {...settings} showLabel />
    </div>
  );
}
