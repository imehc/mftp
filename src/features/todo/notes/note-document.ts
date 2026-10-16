import type { JSONContent } from "@tiptap/core";

import type {
  TodoNoteBlock,
  TodoNoteDocument,
  TodoNoteInline,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";

export const TODO_NOTE_IMAGE_LIMIT = 10;
export const TODO_NOTE_INPUT_LIMIT = 20_000_000;
export const TODO_NOTE_CLIPBOARD_TYPE = "application/x-mftp-todo-note";

export function noteError(code: string) {
  return toIpcError({
    kind: "custom",
    code,
    message: "Todo note operation rejected",
    args: {},
  });
}

function inlineToEditor(node: TodoNoteInline): JSONContent {
  if (node.type === "image")
    return { type: "image", attrs: { assetId: node.assetId } };
  if (node.type === "text") return { type: "text", text: node.text };
  return { type: "hardBreak" };
}

export function noteToEditor(document: TodoNoteDocument): JSONContent {
  return {
    type: "doc",
    content: document.blocks.length
      ? document.blocks.map((block) => ({
          type: block.type,
          content:
            block.type === "paragraph"
              ? block.content.map(inlineToEditor)
              : block.text
                ? [{ type: "text", text: block.text }]
                : [],
        }))
      : [{ type: "paragraph" }],
  };
}

function editorToInline(node: JSONContent): TodoNoteInline {
  if (node.type === "image" && typeof node.attrs?.assetId === "string")
    return { type: "image", assetId: node.attrs.assetId };
  if (node.type === "text" && typeof node.text === "string")
    return { type: "text", text: node.text };
  if (node.type === "hardBreak") return { type: "hardBreak" };
  throw noteError("todo:note_invalid");
}

export function editorToNote(content: JSONContent): TodoNoteDocument {
  const blocks = (content.content ?? []).map((node): TodoNoteBlock => {
    if (node.type === "paragraph")
      return {
        type: "paragraph",
        content: (node.content ?? []).map(editorToInline),
      };
    if (node.type === "codeBlock") {
      const text = (node.content ?? [])
        .map((child) => {
          if (child.type !== "text") throw noteError("todo:note_invalid");
          return child.text ?? "";
        })
        .join("");
      return { type: "codeBlock", text };
    }
    throw noteError("todo:note_invalid");
  });
  return {
    version: 2,
    blocks:
      blocks.length === 1 &&
      blocks[0].type === "paragraph" &&
      !blocks[0].content.length
        ? []
        : blocks,
  };
}

export function hasPendingImages(node: JSONContent): boolean {
  return (
    node.type === "imageImport" ||
    (node.content?.some(hasPendingImages) ?? false)
  );
}

export function noteImageIds(document: TodoNoteDocument): string[] {
  return document.blocks.flatMap((block) =>
    block.type === "paragraph"
      ? block.content.flatMap((node) =>
          node.type === "image" ? [node.assetId] : [],
        )
      : [],
  );
}

export function notePlainText(document: TodoNoteDocument): string {
  return document.blocks
    .map((block) =>
      block.type === "paragraph"
        ? block.content
            .map((node) =>
              node.type === "text"
                ? node.text
                : node.type === "hardBreak"
                  ? "\n"
                  : "",
            )
            .join("")
        : block.text,
    )
    .join("\n");
}

export interface NoteClipboard {
  itemId: string | null;
  draftId: string;
  document: TodoNoteDocument;
}

export function readNoteClipboard(raw: string): NoteClipboard | null {
  if (!raw || new TextEncoder().encode(raw).length > 256_000) return null;
  try {
    const value = JSON.parse(raw) as NoteClipboard;
    if (
      typeof value.draftId !== "string" ||
      (value.itemId !== null && typeof value.itemId !== "string") ||
      value.document.version !== 2 ||
      !Array.isArray(value.document.blocks)
    )
      return null;
    let nodes = value.document.blocks.length;
    for (const block of value.document.blocks) {
      if (block.type === "paragraph") {
        if (value.document.version !== 2 || !Array.isArray(block.content))
          return null;
        nodes += block.content.length;
        for (const node of block.content) {
          if (
            node.type === "text"
              ? typeof node.text !== "string"
              : node.type !== "image" && node.type !== "hardBreak"
          )
            return null;
        }
      } else if (block.type !== "codeBlock" || typeof block.text !== "string")
        return null;
    }
    const images = noteImageIds(value.document);
    if (
      nodes > 2_000 ||
      images.length > TODO_NOTE_IMAGE_LIMIT ||
      images.some((id) => typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
