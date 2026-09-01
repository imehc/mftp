import { useRef, useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { openSearchPanel } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  ArrowDownAZ,
  ArrowUpZA,
  Braces,
  CheckCheck,
  Copy,
  Eraser,
  Minimize2,
  Quote,
  RemoveFormatting,
  Search,
  Sparkles,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  formatterLanguages,
  getFormatterLanguage,
  type FormatterLanguageId,
} from "~/features/formatter/languages";
import type { FormatResult } from "~/features/formatter/json";
import type { SortDirection } from "~/features/formatter/json";
type IndentId = "2" | "4" | "tab";
const indentValues: Record<IndentId, string> = {
  "2": "  ",
  "4": "    ",
  tab: "\t",
};
export default function FormatterTool() {
  const { t } = useLingui();
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [languageId, setLanguageId] = useState<FormatterLanguageId>("json");
  const [indent, setIndent] = useState<IndentId>("2");
  const [value, setValue] = useState("");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const language = getFormatterLanguage(languageId);

  // 输入时实时校验：文档无效时禁用格式化 / 压缩 / 排序键
  //（校验与转义不受此限制）。
  const isDocValid = (() => {
    if (!value.trim() || !language.validate) return true;
    return language.validate(value).ok;
  })();
  function describeError(
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
    toast.error(describeError(result));
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
      toast.error(describeError(result));
    }
  }
  function handleSortKeys() {
    const doc = currentDoc();
    if (!doc.trim() || !language.sortKeys) return;
    const result = language.sortKeys(
      doc,
      {
        indent: indentValues[indent],
      },
      sortDirection,
    );
    if (result.ok) {
      // 在升序 / 降序之间切换：即使输入未变，再次点击仍会
      // 生效（并翻转方向）。
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    }
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
      view.focus();
    }
  }
  async function handleCopy() {
    const doc = currentDoc();
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc);
      toast.success(t`已复制`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  const languageLabel3 = language.label;
  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>格式化</Trans>}
        trailing={
          <Badge variant="outline">
            <Trans>本地处理</Trans>
          </Badge>
        }
      />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2 overflow-auto p-2.5 sm:p-3">
        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border">
                <Braces className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">
                  <Trans>格式化</Trans>
                </h1>
                <p className="text-muted-foreground truncate text-xs">
                  <Trans>格式化、压缩与校验结构化数据</Trans>
                </p>
              </div>
            </div>
            <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSearch}
                disabled={!value}
                title={t`在内容中搜索（Ctrl+F）`}
              >
                <Search data-icon="inline-start" />
                <Trans>搜索</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopy()}
                disabled={!value}
              >
                <Copy data-icon="inline-start" />
                <Trans>复制</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => replaceDoc("")}
                disabled={!value}
              >
                <Eraser data-icon="inline-start" />
                <Trans>清空</Trans>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field>
              <FieldLabel>
                <Trans>语言</Trans>
              </FieldLabel>
              <Select
                value={languageId}
                onValueChange={(next) => {
                  if (formatterLanguages.some((lang) => lang.id === next)) {
                    setLanguageId(next as FormatterLanguageId);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label={t`选择语言`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formatterLanguages.map((lang) => (
                    <SelectItem key={lang.id} value={lang.id}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>
                <Trans>缩进</Trans>
              </FieldLabel>
              <Select
                value={indent}
                onValueChange={(next) => {
                  if (next === "2" || next === "4" || next === "tab") {
                    setIndent(next);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label={t`选择缩进`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">
                    <Plural
                      value={{
                        spaces: 2,
                      }}
                      one="# 空格"
                      other="# 空格"
                    />
                  </SelectItem>
                  <SelectItem value="4">
                    <Plural
                      value={{
                        spaces: 4,
                      }}
                      one="# 空格"
                      other="# 空格"
                    />
                  </SelectItem>
                  <SelectItem value="tab">Tab</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="flex max-w-full flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                onClick={handleFormat}
                disabled={!value.trim() || !isDocValid}
              >
                <Sparkles data-icon="inline-start" />
                <Trans>格式化</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMinify}
                disabled={!value.trim() || !isDocValid || !language.minify}
              >
                <Minimize2 data-icon="inline-start" />
                <Trans>压缩</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleValidate}
                disabled={!value.trim() || !language.validate}
              >
                <CheckCheck data-icon="inline-start" />
                <Trans>校验</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSortKeys}
                disabled={!value.trim() || !isDocValid || !language.sortKeys}
                title={
                  sortDirection === "asc"
                    ? t`递归按字母升序排序对象键`
                    : t`递归按字母降序排序对象键`
                }
              >
                {sortDirection === "asc" ? (
                  <ArrowDownAZ data-icon="inline-start" />
                ) : (
                  <ArrowUpZA data-icon="inline-start" />
                )}
                {sortDirection === "asc" ? (
                  <Trans>键升序</Trans>
                ) : (
                  <Trans>键降序</Trans>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEscape}
                disabled={!value || !language.escape}
                title={t`将内容转义为字符串字面量`}
              >
                <Quote data-icon="inline-start" />
                <Trans>添加转义</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnescape}
                disabled={!value || !language.unescape}
                title={t`还原被转义的字符串内容`}
              >
                <RemoveFormatting data-icon="inline-start" />
                <Trans>移除转义</Trans>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-border bg-card flex min-h-72 flex-1 flex-col gap-1.5 rounded-lg border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              <Trans>内容</Trans>
            </span>
            <div className="flex items-center gap-1">
              <Badge variant="outline">
                <Plural
                  value={{
                    lineCount: value ? value.split("\n").length : 0,
                  }}
                  one="# 行"
                  other="# 行"
                />
              </Badge>
              <Badge variant="outline">
                <Plural
                  value={{
                    characterCount: value.length,
                  }}
                  one="# 个字符"
                  other="# 个字符"
                />
              </Badge>
            </div>
          </div>
          <div className="border-border min-h-0 flex-1 overflow-hidden rounded-md border">
            <CodeMirror
              ref={editorRef}
              value={value}
              onChange={setValue}
              extensions={extensions}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
              height="100%"
              style={{
                height: "100%",
              }}
              placeholder={t`粘贴或输入 ${languageLabel3} 内容`}
              aria-label={t`格式化内容编辑器`}
              basicSetup={basicSetup}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
