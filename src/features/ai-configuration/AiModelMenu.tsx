import { useDesktopLayout } from "~/lib/use-desktop-layout";
import AiModelMenuMobile from "./AiModelMenu.mobile";
import AiModelMenuDesktop from "./AiModelMenu.desktop";

export default function AiModelMenu() {
  const compact = !useDesktopLayout();
  return compact ? <AiModelMenuMobile /> : <AiModelMenuDesktop />;
}
