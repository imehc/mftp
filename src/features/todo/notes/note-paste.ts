import type { JSONContent } from "@tiptap/core";

import type { NoteImageSource } from "./note-imports";

function plainContent(text: string): JSONContent[] {
  return text
    .split("\n")
    .flatMap((line, index) => [
      ...(index ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
}

export function notePasteContent(
  data: DataTransfer | null,
  files: File[],
  nativeImage?: () => Promise<File | null>,
): { content: JSONContent[]; sources: NoteImageSource[] } {
  const sources: NoteImageSource[] = [...files];
  const html = data?.getData("text/html") ?? "";
  const text = data?.getData("text/plain") ?? "";
  const blocks: JSONContent[] = [];
  let current: JSONContent[] = [];
  let imageIndex = 0;

  function image() {
    if (imageIndex >= sources.length) {
      sources.push(
        imageIndex === 0 && nativeImage ? nativeImage : async () => null,
      );
    }
    current.push({ type: "clipboardImage", attrs: { index: imageIndex++ } });
  }

  function flush() {
    if (current.length) blocks.push({ type: "paragraph", content: current });
    current = [];
  }

  if (html && html.length <= 256_000) {
    // template 内容始终留在惰性片段中，只提取文字和本地图片占位，不挂载外部 HTML。
    const template = document.createElement("template");
    template.innerHTML = html;

    function visit(node: ChildNode) {
      if (node.nodeType === globalThis.Node.TEXT_NODE) {
        if (node.textContent)
          current.push({ type: "text", text: node.textContent });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (
        [
          "SCRIPT",
          "STYLE",
          "NOSCRIPT",
          "IFRAME",
          "OBJECT",
          "TEMPLATE",
        ].includes(node.tagName)
      )
        return;
      if (node.tagName === "IMG") {
        image();
        return;
      }
      if (node.tagName === "BR") {
        current.push({ type: "hardBreak" });
        return;
      }
      const block = /^(P|DIV|LI|PRE|H[1-6]|BLOCKQUOTE|TR)$/.test(node.tagName);
      if (block) flush();
      node.childNodes.forEach(visit);
      if (block) flush();
    }

    template.content.childNodes.forEach(visit);
  } else current.push(...plainContent(text));
  while (imageIndex < files.length) image();
  flush();
  return { content: blocks, sources };
}
