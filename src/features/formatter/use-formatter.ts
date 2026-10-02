import { useState, type RefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { openSearchPanel } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { getFormatterLanguage, type FormatterLanguageId } from "./languages";
import type { FormatResult, SortDirection } from "./json";
type IndentId = "2" | "4" | "tab";
const indentValues: Record<IndentId, string> = {
  "2": "  ",
  "4": "    ",
  tab: "\t",
};
export function useFormatter(editorRef: RefObject<ReactCodeMirrorRef | null>) {
  const { t } = useLingui();
  const { resolvedTheme } = useTheme();
  const [languageId, setLanguageId] = useState<FormatterLanguageId>("json");
  const [indent, setIndent] = useState<IndentId>("2");
  const [value, setValue] = useState("");
  const language = getFormatterLanguage(languageId);

  const validation =
    value.trim() && language.validate ? language.validate(value) : null;
  const isDocValid = validation?.ok !== false;
  function describeFormatError(
    result: Extract<
      FormatResult,
      {
        ok: false;
      }
    >,
  ): string {
    const resultLine = result.line;
    const resultColumn = result.column;
    const languageLabel = language.label;
    // 引擎报错（如 "Unrecognized token"）对用户难以理解；
    // 用本地化的提示文案替换。
    return result.line !== undefined && result.column !== undefined
      ? t`第 ${resultLine} 行第 ${resultColumn} 列附近有语法错误`
      : t`内容不是有效的 ${languageLabel}`;
  }
  const extensions = [
    ...language.extensions(),
    // CodeMirror 面板（搜索等）的 UI 文案：键是 CodeMirror 原来的
    // 英文文本，值走 Lingui，使面板跟随应用语言。
    EditorState.phrases.of({
      Find: t`查找`,
      Replace: t`替换为`,
      next: t`下一个`,
      previous: t`上一个`,
      all: t`全部`,
      "match case": t`区分大小写`,
      "by word": t`全字匹配`,
      regexp: t`正则`,
      replace: t`替换`,
      "replace all": t`全部替换`,
      close: t({
        context: "action",
        comment: "Button that closes the CodeMirror search panel",
        message: "关闭",
      }),
      "current match": t`当前匹配`,
      "on line": t`所在行`,
      "replaced $ matches": t({
        message: "已替换 $ 处匹配",
        comment: "$ 由 CodeMirror 替换为匹配数量，须保留。",
      }),
      "replaced match on line $": t({
        message: "已替换第 $ 行的匹配",
        comment: "$ 由 CodeMirror 替换为行号，须保留。",
      }),
      "Go to line": t`跳转到行`,
      go: t`跳转`,
    }),
  ];
  const basicSetup = {
    foldGutter: true,
    highlightActiveLine: true,
    searchKeymap: true,
  };

  /** 直接从编辑器读取真实内容，而不是用 React state，
   * 这样即便受控值的同步尚未完成，格式化也能正常工作。 */
  function currentDoc(): string {
    return editorRef.current?.view?.state.doc.toString() ?? value;
  }
  function replaceDoc(next: string) {
    const view = editorRef.current?.view;
    if (view) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: next,
        },
      });
    }
    setValue(next);
  }
  function applyResult(result: FormatResult) {
    if (result.ok) {
      replaceDoc(result.value);
      return;
    }
    toast.error(describeFormatError(result));
  }
  function handleFormat() {
    const doc = currentDoc();
    if (!doc.trim()) return;
    applyResult(
      language.format(doc, {
        indent: indentValues[indent],
      }),
    );
  }
  function handleMinify() {
    const doc = currentDoc();
    if (!doc.trim() || !language.minify) return;
    applyResult(language.minify(doc));
  }
  function handleValidate() {
    const doc = currentDoc();
    if (!doc.trim() || !language.validate) return;
    const result = language.validate(doc);
    if (result.ok) {
      const languageLabel2 = language.label;
      toast.success(t`${languageLabel2} 格式有效`);
    } else {
      toast.error(describeFormatError(result));
    }
  }
  function handleSortKeys(sortDirection: SortDirection) {
    const doc = currentDoc();
    if (!doc.trim() || !language.sortKeys) return;
    const result = language.sortKeys(
      doc,
      {
        indent: indentValues[indent],
      },
      sortDirection,
    );
    applyResult(result);
  }
  function handleEscape() {
    const doc = currentDoc();
    if (!doc || !language.escape) return;
    applyResult(language.escape(doc));
  }
  function handleUnescape() {
    const doc = currentDoc();
    if (!doc || !language.unescape) return;
    const result = language.unescape(doc);
    if (!result.ok) {
      toast.error(t`内容不是有效的转义字符串`);
      return;
    }
    applyResult(result);
  }
  function handleSearch() {
    const view = editorRef.current?.view;
    if (view) {
      openSearchPanel(view);
    }
  }
  const statusLanguage = language.label;
  const status = !validation
    ? null
    : validation.ok
      ? t`${statusLanguage} 格式有效`
      : describeFormatError(validation);
  return {
    languageId,
    setLanguageId,
    indent,
    setIndent,
    value,
    setValue,
    language,
    extensions,
    basicSetup,
    resolvedTheme,
    isDocValid,
    status,
    replaceDoc,
    handleFormat,
    handleMinify,
    handleValidate,
    handleSortKeys,
    handleEscape,
    handleUnescape,
    handleSearch,
  };
}
export type FormatterController = ReturnType<typeof useFormatter>;
