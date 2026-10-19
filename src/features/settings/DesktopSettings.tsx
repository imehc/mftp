import { isDesktopPlatform } from "~/lib/platform";

import AutostartSettingDesktop from "./AutostartSetting.desktop";
import StartupPageSettings from "./StartupPageSettings";

export function DesktopStartupSettings() {
  return isDesktopPlatform() ? <StartupPageSettings /> : null;
}

export function DesktopAutostartSettings() {
  return isDesktopPlatform() ? <AutostartSettingDesktop /> : null;
}
