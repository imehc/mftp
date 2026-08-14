import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { Home } from "lucide-react";
import { Button } from "~/components/ui/button";

interface ToolPageHeaderProps {
  title: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}

export function ToolPageHeader({ title, trailing, children }: ToolPageHeaderProps) {
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button variant="ghost" size="xs" asChild>
          <Link to="/">
            <Home data-icon="inline-start" />
            <Trans>首页</Trans>
          </Link>
        </Button>
        <div className="hidden h-4 w-px bg-border sm:block" />
        <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
          {title}
        </div>
        {children}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  );
}
