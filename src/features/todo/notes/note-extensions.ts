import type { AnyExtension } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Image from "@tiptap/extension-image";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";

export const LocalNoteImage = Image.extend({
  priority: 101,
  addKeyboardShortcuts() {
    const remove = (direction: "before" | "after") =>
      this.editor.commands.command(({ state, tr, dispatch }) => {
        if (!state.selection.empty || this.editor.view.composing) return false;
        const { $from } = state.selection;
        const node =
          direction === "before" ? $from.nodeBefore : $from.nodeAfter;
        if (!node || !["image", "imageImport"].includes(node.type.name))
          return false;
        if (dispatch)
          tr.delete(
            direction === "before" ? $from.pos - node.nodeSize : $from.pos,
            direction === "before" ? $from.pos : $from.pos + node.nodeSize,
          );
        return true;
      });
    return { Backspace: () => remove("before"), Delete: () => remove("after") };
  },
  addAttributes() {
    return {
      assetId: { default: null },
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ node }) {
    return [
      "span",
      { "data-todo-image": node.attrs.assetId, contenteditable: "false" },
    ];
  },

  addCommands() {
    return {};
  },

  addInputRules() {
    return [];
  },
}).configure({ inline: true });

const PlainCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {};
  },
}).configure({
  languageClassPrefix: null,
  enableTabIndentation: false,
  exitOnTripleEnter: true,
  exitOnArrowDown: true,
});

export function createTodoNoteExtensions(image: AnyExtension = LocalNoteImage) {
  return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    PlainCodeBlock,
    image,
    UndoRedo,
  ];
}
