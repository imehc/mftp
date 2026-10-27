import { Link, useRouter } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";
import { mobilePoetryEntry } from "~/features/poetry/back-navigation";
import { isMobilePlatform } from "~/lib/platform";

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
  const router = useRouter();
  return items.map((item) => {
    const Icon = item.icon;
    return (
      <Button
        key={item.id}
        asChild
        // 导航项的图标和文字共同占据整行表面。
        density="default"
        variant={item.id === active ? "secondary" : "ghost"}
        className={
          desktop
            ? "h-14.5 w-full flex-col gap-1 px-1 text-xs"
            : "h-13.5 min-w-0 flex-1 flex-col gap-1 px-1 text-xs"
        }
      >
        <Link
          {...item.link}
          replace={isMobilePlatform()}
          onClick={(event) => {
            if (
              !isMobilePlatform() ||
              item.id !== "library" ||
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            const entry = mobilePoetryEntry();
            if (!entry) return;
            event.preventDefault();
            const parentHref = router.buildLocation(entry.parent).href;
            void router
              .navigate({ ...entry.parent, replace: true })
              .then(() => {
                // 用户在父级加载期间改去了其他页，不能再被旧恢复请求拉回。
                if (router.state.location.href === parentHref)
                  return router.navigate(entry.destination);
              })
              .catch(console.error);
          }}
          aria-current={item.id === active ? "page" : undefined}
        >
          <Icon />
          <span className="max-w-full truncate">{item.title}</span>
        </Link>
      </Button>
    );
  });
}
