import { useDesktopLayout } from "~/lib/use-desktop-layout";

import AiModelMenuDesktop from "./AiModelMenu.desktop";
import AiModelMenuMobile from "./AiModelMenu.mobile";

export default function AiModelMenu() {
  const compact = !useDesktopLayout();
  return compact ? <AiModelMenuMobile /> : <AiModelMenuDesktop />;
}
