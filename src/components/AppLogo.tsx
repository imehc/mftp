import { cn } from "cn";

import { appIconPaths } from "~/lib/app-icon";

export default function AppLogo({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "MFTP"}
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-flex size-9 shrink-0 overflow-hidden rounded-lg",
        className,
      )}
    >
      <img
        src={appIconPaths.light}
        alt=""
        draggable={false}
        className="size-full object-contain dark:hidden"
      />
      <img
        src={appIconPaths.dark}
        alt=""
        draggable={false}
        className="hidden size-full object-contain dark:block"
      />
    </span>
  );
}
