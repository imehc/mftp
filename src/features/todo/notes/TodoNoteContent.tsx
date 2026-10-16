import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";

import type { TodoNoteDocument } from "~/bindings";
import { CopyButton } from "~/components/CopyButton";
import { describeError } from "~/lib/errors";

import TodoNoteImage from "./TodoNoteImage";

export default function TodoNoteContent({
  document,
  itemId,
}: {
  document: TodoNoteDocument;
  itemId: string;
}) {
  const { t } = useLingui();
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm leading-6 select-text">
      {document.blocks.map((block, index) =>
        block.type === "paragraph" ? (
          <p
            key={index}
            className="min-h-6 wrap-break-word whitespace-pre-wrap"
          >
            {block.content.map((node, offset) =>
              node.type === "image" ? (
                <TodoNoteImage
                  key={offset}
                  assetId={node.assetId}
                  scope={{ itemId, draftId: null }}
                />
              ) : node.type === "hardBreak" ? (
                <br key={offset} />
              ) : (
                node.text
              ),
            )}
          </p>
        ) : block.type === "codeBlock" ? (
          <div
            key={index}
            className="bg-muted flex min-w-0 flex-col rounded-md"
          >
            <div className="flex items-center justify-between gap-2 px-2 pt-1 text-xs">
              <span className="text-muted-foreground">
                <Trans>代码块</Trans>
              </span>
              <CopyButton
                value={block.text}
                variant="ghost"
                size="icon-sm"
                label={t`复制代码`}
                onError={(error) =>
                  toast.error(t`复制失败`, {
                    description: describeError(error, t),
                  })
                }
              />
            </div>
            <pre className="m-0 max-w-full p-3 pt-1 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap">
              <code>{block.text}</code>
            </pre>
          </div>
        ) : null,
      )}
    </div>
  );
}
