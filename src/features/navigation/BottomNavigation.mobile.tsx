import { useLingui } from "@lingui/react/macro";
import NavigationLinks from "./NavigationLinks";
import type { NavigationItem } from "./NavigationItems";

export default function BottomNavigationMobile({
  items,
  active,
}: {
  items: NavigationItem[];
  active: NavigationItem["id"];
}) {
  const { t } = useLingui();
  return (
    <nav
      aria-label={t`应用主导航`}
      className="border-border bg-background flex shrink-0 gap-1 border-t px-2 pt-1.5 pb-[calc(0.375rem+var(--safe-bottom,0px))]"
    >
      <NavigationLinks items={items} active={active} />
    </nav>
  );
}
