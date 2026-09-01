import { cn } from "~/lib/utils";
import type { PoemSummary } from "~/types";

interface PoemCardProps {
  poem: PoemSummary;
  query?: string;
  active: boolean;
  onSelect: (uid: string) => void;
}

/** 在原始文本上做子串高亮；归一化仅用于匹配。 */
function Highlight({ text, query }: { text: string; query?: string }) {
  const trimmed = query?.trim();
  if (!trimmed) return <>{text}</>;
  const index = text.indexOf(trimmed);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary/20 text-foreground rounded-sm">
        {trimmed}
      </mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

function PoemCard({ poem, query, active, onSelect }: PoemCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(poem.uid)}
      aria-label={poem.title}
      className={cn(
        "flex h-full w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-[translate,box-shadow] duration-100 hover:-translate-y-px hover:shadow-md",
        active ? "border-primary/60 bg-accent" : "border-border bg-card",
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">
          <Highlight text={poem.title} query={query} />
        </span>
        {poem.dynasty ? (
          <span className="text-muted-foreground shrink-0 text-xs">
            {poem.author ? `${poem.author}·` : ""}
            {poem.dynasty}
          </span>
        ) : (
          poem.author && (
            <span className="text-muted-foreground shrink-0 text-xs">
              {poem.author}
            </span>
          )
        )}
      </div>
      <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
        <Highlight text={poem.excerpt} query={query} />
      </p>
      <span className="text-muted-foreground/70 mt-auto truncate pt-1 text-[11px]">
        {poem.collectionName}
      </span>
    </button>
  );
}

export default PoemCard;
