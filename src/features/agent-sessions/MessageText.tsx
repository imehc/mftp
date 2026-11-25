import type { ReactNode } from "react";

export function MessageText({
  text,
  search,
}: {
  text: string;
  search: string;
}) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const key = index;
    if (!line.trim()) {
      index++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index]))
        code.push(lines[index++]);
      index++;
      blocks.push(
        <pre
          key={key}
          className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
        >
          <Highlight text={code.join("\n")} search={search} />
        </pre>,
      );
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <h3 key={key} className="text-sm font-semibold">
          <Inline text={heading[1]} search={search} />
        </h3>,
      );
      index++;
      continue;
    }
    if (/^\s*([-*+] |\d+[.)] )/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (
        index < lines.length &&
        /^\s*([-*+] |\d+[.)] )/.test(lines[index])
      ) {
        const content = lines[index].replace(/^\s*([-*+] |\d+[.)] )/, "");
        items.push(
          <li key={index}>
            <Inline text={content} search={search} />
          </li>,
        );
        index++;
      }
      blocks.push(
        ordered ? (
          <ol key={key} className="list-decimal pl-5">
            {items}
          </ol>
        ) : (
          <ul key={key} className="list-disc pl-5">
            {items}
          </ul>
        ),
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(
        <blockquote
          key={key}
          className="text-muted-foreground border-border border-l pl-3"
        >
          <Inline text={line.replace(/^>\s?/, "")} search={search} />
        </blockquote>,
      );
      index++;
      continue;
    }
    if (
      /^\s*\|/.test(line) &&
      index + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|/.test(lines[index + 1])
    ) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const heading = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|/.test(lines[index]))
        rows.push(cells(lines[index++]));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {heading.map((cell, i) => (
                  <th
                    key={i}
                    className="border-border border-b px-2 py-1 text-left font-medium"
                  >
                    <Inline text={cell} search={search} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-border border-b px-2 py-1">
                      <Inline text={cell} search={search} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*(```|#{1,6}\s|[-*+] |\d+[.)] |>\s?|\|)/.test(lines[index])
    )
      paragraph.push(lines[index++]);
    blocks.push(
      <p key={key}>
        <Inline text={paragraph.join(" ")} search={search} />
      </p>,
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {blocks}
    </div>
  );
}

function Inline({ text, search }: { text: string; search: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-semibold">
        <Highlight text={part.slice(2, -2)} search={search} />
      </strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={index}
        className="bg-muted rounded px-1 py-0.5 font-mono text-xs"
      >
        <Highlight text={part.slice(1, -1)} search={search} />
      </code>
    ) : (
      <Highlight key={index} text={part} search={search} />
    ),
  );
}

function Highlight({ text, search }: { text: string; search: string }) {
  const needle = search.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "giu")).map((part, index) =>
    index % 2 ? (
      <mark
        key={index}
        className="bg-warning/25 text-foreground rounded-sm font-medium"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
