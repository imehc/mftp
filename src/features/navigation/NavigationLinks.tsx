import { Link } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";

import type { NavigationItem, NavigationSection } from "./NavigationItems";

export default function NavigationLinks({
  items,
  active,
  desktop = false,
}: {
  items: NavigationItem[];
  active: NavigationSection;
  desktop?: boolean;
}) {
  return items.map((item) => {
    const Icon = item.icon;
    return (
      <Button
        key={item.id}
        asChild
        variant={item.id === active ? "secondary" : "ghost"}
        className={
          desktop
            ? "h-14.5 w-full flex-col gap-1 px-1 text-xs"
            : "h-13.5 min-w-0 flex-1 flex-col gap-1 px-1 text-xs"
        }
      >
        <Link
          {...item.link}
          aria-current={item.id === active ? "page" : undefined}
        >
          <Icon />
          <span className="max-w-full truncate">{item.title}</span>
        </Link>
      </Button>
    );
  });
}
