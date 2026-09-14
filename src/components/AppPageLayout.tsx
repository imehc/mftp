import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "~/components/ui/button";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}

export default function AppPageLayout({
  title,
  description,
  actions,
  children,
  maxWidth = "max-w-5xl",
}: Props) {
  const { t } = useLingui();
  return (
    <main className="bg-background text-foreground flex h-full flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label={t`返回首页`} title={t`返回首页`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {description ? (
              <p className="text-muted-foreground truncate text-xs">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div
        className={`mx-auto min-h-0 w-full flex-1 overflow-auto p-2.5 sm:p-3 ${maxWidth}`}
      >
        {children}
      </div>
    </main>
  );
}
