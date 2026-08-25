import { memo } from "react";
import { cn } from "~/lib/utils";
import type { PoemSummary } from "~/types";

interface PoemCardProps {
  poem: PoemSummary;
  query?: string;
  active: boolean;
  onSelect: (uid: string) => void;
}

/** Substring highlight on the ORIGINAL text; normalization is match-only. */
function Highlight({ text, query }: { text: string; query?: string }) {
  const trimmed = query?.trim();
  if (!trimmed) return <>{text}</>;
  const index = text.indexOf(trimmed);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-primary/20 text-foreground">
        {trimmed}
      </mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

function PoemCardImpl({ poem, query, active, onSelect }: PoemCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(poem.uid)}
      aria-label={poem.title}
      className={cn(
        "flex h-full w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-[translate,box-shadow] duration-100 hover:-translate-y-px hover:shadow-md",
        active
          ? "border-primary/60 bg-accent"
          : "border-border bg-card",
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">
          <Highlight text={poem.title} query={query} />
        </span>
        {poem.dynasty ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {poem.author ? `${poem.author}·` : ""}
            {poem.dynasty}
          </span>
        ) : (
          poem.author && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {poem.author}
            </span>
          )
        )}
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        <Highlight text={poem.excerpt} query={query} />
      </p>
      <span className="mt-auto truncate pt-1 text-[11px] text-muted-foreground/70">
        {poem.collectionName}
      </span>
    </button>
  );
}

const PoemCard = memo(PoemCardImpl);
export default PoemCard;
