import { Trans } from "@lingui/react/macro";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type { AuthorBio } from "~/types";

export function AnnotationSection({
  title,
  body,
}: {
  title: React.ReactNode;
  body: string;
}) {
  if (!body.trim()) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
      <p className="text-sm leading-relaxed whitespace-pre-line">{body}</p>
    </section>
  );
}

export function CollapsibleStrains({ strains }: { strains: string[] }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  if (strains.length === 0) return null;
  return (
    <section>
      <Button
        variant="ghost"
        size="sm"
        density="adaptive"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <ChevronDown
          data-icon="inline-start"
          className={cn("transition-transform", open && "rotate-180")}
          aria-hidden
        />
        <Trans>平仄</Trans>
      </Button>
      {open ? (
        <div
          id={contentId}
          className="text-muted-foreground mt-1 font-mono text-xs leading-relaxed"
        >
          {strains.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AuthorBioSheet({
  bio,
  onClose,
}: {
  bio: AuthorBio | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={bio !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="max-md:inset-x-0 max-md:top-auto max-md:right-auto max-md:bottom-0 max-md:h-auto max-md:max-h-[75dvh] max-md:w-full max-md:max-w-none max-md:border-t max-md:border-l-0 md:w-90 md:max-w-[85vw]"
      >
        <SheetHeader>
          <SheetTitle>{bio?.name}</SheetTitle>
          <SheetDescription>{bio?.dynasty}</SheetDescription>
        </SheetHeader>
        <p className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 text-sm leading-loose whitespace-pre-line">
          {bio?.desc || <Trans>暂无作者小传。</Trans>}
        </p>
      </SheetContent>
    </Sheet>
  );
}
