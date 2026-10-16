import { Trans, useLingui } from "@lingui/react/macro";
import { Node } from "@tiptap/core";
import {
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { createContext, useContext } from "react";
import { useStore } from "zustand";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";

import { LocalNoteImage } from "./note-extensions";
import type { NoteImageScope } from "./note-image-cache";
import type { NoteImports } from "./note-imports";
import TodoNoteImage from "./TodoNoteImage";

export const NoteEditorContext = createContext<{
  scope: NoteImageScope;
  imports: NoteImports;
  disabled: boolean;
} | null>(null);

function ImageView({ node, selected }: NodeViewProps) {
  const context = useContext(NoteEditorContext);
  if (!context) return null;
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="data-[selected=true]:ring-ring mx-0.5 inline-block max-w-full rounded-md align-middle data-[selected=true]:ring-2"
      data-selected={selected}
    >
      <TodoNoteImage
        assetId={node.attrs.assetId as string}
        scope={context.scope}
        disabled={context.disabled}
      />
    </NodeViewWrapper>
  );
}

function PendingView({ node }: NodeViewProps) {
  const context = useContext(NoteEditorContext);
  return context ? (
    <PendingContent
      id={node.attrs.id as string}
      imports={context.imports}
      disabled={context.disabled}
    />
  ) : null;
}

function PendingContent({
  id,
  imports,
  disabled,
}: {
  id: string;
  imports: NoteImports;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const job = useStore(imports.store, (state) =>
    state.jobs.find((entry) => entry.id === id),
  );
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="bg-muted mx-0.5 inline-flex min-h-24 max-w-full min-w-40 flex-col items-center justify-center gap-2 rounded-md p-3 text-center align-middle text-sm"
    >
      <span
        className="flex items-center justify-center gap-2"
        role={job?.error ? "alert" : undefined}
      >
        {!job ? (
          <span>
            <Trans>图片导入已取消，请移除后重新插入。</Trans>
          </span>
        ) : job.error ? (
          <span>{describeError(job.error, t)}</span>
        ) : (
          <Spinner aria-label={t`正在处理图片`} />
        )}
      </span>
      {job?.error ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => imports.retry(id)}
        >
          <Trans>重试</Trans>
        </Button>
      ) : null}
    </NodeViewWrapper>
  );
}

export const EditorNoteImage = LocalNoteImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

export const PendingNoteImage = Node.create({
  name: "imageImport",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ["span", { "data-todo-image-pending": "true" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PendingView);
  },
});
