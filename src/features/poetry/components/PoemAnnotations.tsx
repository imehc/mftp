import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import { useId } from "react";

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

export function CollapsibleStrains({
  strains,
  open,
  onOpenChange,
}: {
  strains: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const contentId = useId();
  if (strains.length === 0) return null;
  return (
    <section>
      <Button
        variant="ghost"
        size="sm"
        density="adaptive"
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <ChevronRight
          data-icon="inline-start"
          className={cn("transition-transform", open && "rotate-90")}
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

/** 注释页直接展示资料；面板切换由阅读容器统一负责。 */
export function PoemAnnotationContent({
  remark,
  appreciation,
  notes,
}: {
  remark: string;
  appreciation: string;
  notes: string[];
}) {
  const { t } = useLingui();
  if (!remark.trim() && !appreciation.trim() && notes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans comment="当前诗词没有注释、赏析或源注释时的阅读空态">
          暂无注释
        </Trans>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4 wrap-break-word">
      <AnnotationSection title={t`注释`} body={remark} />
      <AnnotationSection title={t`赏析`} body={appreciation} />
      {notes.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-muted-foreground text-sm font-medium">{t`源注释`}</h3>
          <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
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
