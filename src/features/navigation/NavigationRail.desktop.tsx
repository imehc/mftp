import { useLingui } from "@lingui/react/macro";

import ActivityEntry from "~/features/activity/ActivityEntry";

import type { NavigationItem, NavigationSection } from "./NavigationItems";
import NavigationLinks from "./NavigationLinks";

export default function NavigationRailDesktop({
  items,
  active,
}: {
  items: NavigationItem[];
  active: NavigationSection;
}) {
  const { t } = useLingui();
  const primary = items.filter((item) => item.id !== "settings");
  const settings = items.filter((item) => item.id === "settings");
  return (
    <aside className="border-border flex w-23 shrink-0 flex-col items-center gap-5 border-r px-2 pt-4.5 pb-[max(0.75rem,var(--safe-bottom,0px))]">
      <div
        aria-label="MFTP"
        className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg text-lg font-semibold"
      >
        M
      </div>
      <nav
        aria-label={t`应用主导航`}
        className="flex min-h-0 w-full flex-1 flex-col gap-2.5"
      >
        <div className="flex min-h-0 w-full flex-1 flex-col gap-2.5 overflow-y-auto">
          <NavigationLinks items={primary} active={active} desktop />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2.5">
          <ActivityEntry variant="rail" />
          <NavigationLinks items={settings} active={active} desktop />
        </div>
      </nav>
    </aside>
  );
}
