import { useLingui } from "@lingui/react/macro";
import NavigationLinks from "./NavigationLinks";
import type { NavigationItem } from "./NavigationItems";

export default function NavigationRailDesktop({
  items,
  active,
}: {
  items: NavigationItem[];
  active: NavigationItem["id"];
}) {
  const { t } = useLingui();
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
        className="flex min-h-0 w-full flex-1 flex-col gap-2.5 overflow-y-auto"
      >
        <NavigationLinks items={items} active={active} desktop />
      </nav>
    </aside>
  );
}
