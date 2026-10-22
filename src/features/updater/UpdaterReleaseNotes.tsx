import { Trans, useLingui } from "@lingui/react/macro";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";

import { parseReleaseNotes, RELEASES_URL } from "./release-notes";

export default function UpdaterReleaseNotes({
  body,
  truncated,
}: {
  body: string;
  truncated: boolean;
}) {
  const { t } = useLingui();
  const notes = parseReleaseNotes(body);
  const groups: { kind: (typeof notes)[number]["kind"]; lines: string[] }[] =
    [];
  for (const note of notes) {
    const last = groups.at(-1);
    if (note.kind === "item" && last?.kind === "item")
      last.lines.push(note.text);
    else groups.push({ kind: note.kind, lines: [note.text] });
  }
  return (
    <section
      aria-label={t`本次更新`}
      className="flex flex-col gap-3 wrap-anywhere"
    >
      {notes.length ? (
        <div className="flex flex-col gap-2.5 text-sm">
          {groups.map((note, index) =>
            note.kind === "heading" ? (
              <h3 key={index} className="font-medium">
                {note.lines[0]}
              </h3>
            ) : note.kind === "item" ? (
              <ul key={index} className="flex list-disc flex-col gap-2.5 pl-5">
                {note.lines.map((line, lineIndex) => (
                  <li key={lineIndex}>{line}</li>
                ))}
              </ul>
            ) : (
              <p key={index}>{note.lines[0]}</p>
            ),
          )}
        </div>
      ) : null}
      {truncated ? (
        <p className="text-muted-foreground text-xs">
          <Trans comment="发布说明被长度限制截断">说明已截断</Trans>
        </p>
      ) : null}
      <Button
        variant="link"
        size="sm"
        className="h-auto self-start p-0 text-left whitespace-normal"
        onClick={() =>
          void openUrl(RELEASES_URL).catch((error: unknown) =>
            toast.error(describeError(error)),
          )
        }
      >
        <Trans>查看完整发布说明</Trans>
        <ExternalLink data-icon="inline-end" />
      </Button>
    </section>
  );
}
