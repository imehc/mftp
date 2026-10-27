import { createLink, useRouter } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { isMobilePlatform } from "~/lib/platform";

import { previousAppLocation } from "./back-history";
import { runMobileBackTransition } from "./mobile-back-transition";

/** 返回链接复用真实父级历史，避免点击返回后手势又回到刚离开的子页。 */
function BackAnchor({ onClick, ...props }: ComponentProps<"a">) {
  const router = useRouter();
  return (
    <a
      {...props}
      onClick={(event) => {
        if (
          props["aria-disabled"] === true ||
          props["aria-disabled"] === "true"
        ) {
          event.preventDefault();
          return;
        }
        if (
          !isMobilePlatform() ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (props.target && props.target !== "_self")
        ) {
          onClick?.(event);
          return;
        }
        const target = new URL(event.currentTarget.href);
        if (target.origin !== window.location.origin) {
          onClick?.(event);
          return;
        }
        const href = `${target.pathname}${target.search}${target.hash}`;
        event.preventDefault();
        runMobileBackTransition(
          router,
          href,
          () => {
            if (previousAppLocation(router.history)?.href === href)
              router.history.back();
            else return router.navigate({ href, replace: true });
          },
          event.detail > 0,
        );
      }}
    />
  );
}

export const BackLink = createLink(BackAnchor);
