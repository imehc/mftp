import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { createTodoNoteExtensions } from "~/features/todo/notes/note-extensions";

function EditorProbe() {
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const editor = useEditor({
    extensions: createTodoNoteExtensions(),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "文本、图片与代码块" }],
        },
      ],
    },
    onUpdate({ editor: current }) {
      setContent(JSON.stringify(current.getJSON()));
    },
  });
  return (
    <section>
      <div>
        <button type="button" onClick={() => editor.commands.setCodeBlock()}>
          插入代码块
        </button>
        <button type="button" onClick={() => editor.commands.exitCode()}>
          退出代码块
        </button>
        <button
          type="button"
          onClick={() =>
            editor.commands.insertContent({
              type: "image",
              attrs: { assetId: "isolated-test-image" },
            })
          }
        >
          插入图片占位
        </button>
        <button type="button" onClick={() => editor.commands.undo()}>
          撤销
        </button>
        <button type="button" onClick={() => editor.commands.redo()}>
          重做
        </button>
        <button type="button" onClick={() => setRevision(revision + 1)}>
          重渲染
        </button>
        <button type="button" onClick={() => editor.destroy()}>
          销毁编辑器
        </button>
      </div>
      <EditorContent editor={editor} />
      <output data-revision={revision}>{content}</output>
    </section>
  );
}

export function mountEditor() {
  const element = document.getElementById("root");
  if (!element) throw new Error("Missing isolated editor mount");
  createRoot(element).render(
    <StrictMode>
      <EditorProbe />
    </StrictMode>,
  );
}
