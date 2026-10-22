import { cn } from "cn";

import type { ExecutionLogBlock } from "./execution-log-stream";

export default function ExecutionLogDetails({
  blocks,
}: {
  blocks: ExecutionLogBlock[];
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-4 font-mono text-xs leading-relaxed"
      data-log-stream
    >
      {blocks.map((block, index) => (
        <section
          key={index}
          role={
            block.kind === "appError" || block.kind === "transportError"
              ? "alert"
              : undefined
          }
          data-log-block={block.kind}
          className="min-w-0 border-b pb-4 last:border-b-0"
        >
          <h2
            className={cn(
              "mb-2 text-xs font-semibold break-all",
              block.kind === "transportError" || block.kind === "appError"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {block.title}
          </h2>
          {block.text ? (
            <pre className="min-w-0 font-mono break-all whitespace-pre-wrap">
              {block.text}
            </pre>
          ) : null}
        </section>
      ))}
    </div>
  );
}
