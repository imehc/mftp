import { cn } from "cn";
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
      aria-current={active ? "true" : undefined}
      className={cn(
        "hover:bg-accent focus-visible:outline-ring flex w-full min-w-0 flex-col gap-1.5 rounded-lg px-3 py-3 text-left transition-colors",
        active && "bg-accent",
      )}
    >
      <span className="line-clamp-2 text-sm font-semibold break-words">
        <Highlight text={poem.title} query={query} />
      </span>
      <span
        className="text-muted-foreground block max-w-full truncate text-xs"
        title={poem.collectionName}
      >
        {[poem.author, poem.dynasty].filter(Boolean).join(" · ")}
      </span>
      <p className="text-muted-foreground line-clamp-1 text-xs leading-relaxed">
        <Highlight text={poem.excerpt} query={query} />
      </p>
    </button>
  );
}

export default PoemCard;
