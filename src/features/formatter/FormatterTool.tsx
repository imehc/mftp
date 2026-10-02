import { Plural, Trans, useLingui } from "@lingui/react/macro";
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { useRef } from "react";
import { search } from "@codemirror/search";
import { Prec } from "@codemirror/state";
import { toast } from "sonner";
import AppPageLayout from "~/components/AppPageLayout";
import { CopyButton } from "~/components/CopyButton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { describeError } from "~/lib/errors";
import { formatterLanguages } from "./languages";
import { FormatterActions } from "./FormatterActions";
import { useFormatter } from "./use-formatter";

// 编辑器文字随根级显示比例变化；内容保留自身滚动与光标定位，不做 transform 缩放。
const editorLayout = EditorView.theme({
  "&": {
    fontSize: "0.875rem",
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--accent)" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-search": { padding: "0.5rem 3rem 0.5rem 0.5rem", fontSize: "0.75rem" },
  ".cm-search .cm-button, .cm-search .cm-textfield": {
    minHeight: "2rem",
    maxWidth: "100%",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--background)",
    color: "var(--foreground)",
    padding: "0.25rem 0.5rem",
    font: "inherit",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  ".cm-search label input": {
    width: "1rem",
    height: "1rem",
    accentColor: "var(--primary)",
  },
  ".cm-search button[name=close]": {
    top: "0.25rem",
    right: "0.25rem",
    minWidth: "2rem",
    minHeight: "2rem",
    fontSize: "1.25rem",
  },
  "@media (pointer: coarse)": {
    ".cm-search .cm-button, .cm-search .cm-textfield, .cm-search label, .cm-search button[name=close]":
      { minHeight: "max(2.75rem, 44px)" },
    ".cm-search button[name=close]": { minWidth: "max(2.75rem, 44px)" },
  },
});
// 显式保留搜索扩展，避免受控内容变化触发重新配置时移除动态添加的搜索面板。
const editorSearch = search();

export default function FormatterTool() {
  const { t } = useLingui();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const c = useFormatter(editorRef);
  const languageLabel = c.language.label;
  return (
    <AppPageLayout
      title={<Trans>格式化</Trans>}
      adaptiveDensity
      bottomInset="scroll"
      actions={<FormatterActions controller={c} />}
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="formatter-language" className="text-xs">
            <Trans>语言</Trans>
          </label>
          <Select
            value={c.languageId}
            onValueChange={(next) => {
              if (next === "json") c.setLanguageId(next);
            }}
          >
            <SelectTrigger
              id="formatter-language"
              density="adaptive"
              aria-label={t`选择语言`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {formatterLanguages.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="formatter-indent" className="text-xs">
            <Trans>缩进</Trans>
          </label>
          <Select
            value={c.indent}
            onValueChange={(next) => {
              if (next === "2" || next === "4" || next === "tab")
                c.setIndent(next);
            }}
          >
            <SelectTrigger
              id="formatter-indent"
              density="adaptive"
              aria-label={t`选择缩进`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="2">
                  <Plural value={{ spaces: 2 }} one="# 空格" other="# 空格" />
                </SelectItem>
                <SelectItem value="4">
                  <Plural value={{ spaces: 4 }} one="# 空格" other="# 空格" />
                </SelectItem>
                <SelectItem value="tab">Tab</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <section className="border-border bg-card flex min-h-96 min-w-0 flex-1 flex-col rounded-lg border">
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
          <h2 className="font-medium">
            <Trans>内容</Trans>
          </h2>
          <span className="tabular-nums">
            <Plural
              value={{ lineCount: c.value ? c.value.split("\n").length : 0 }}
              one="# 行"
              other="# 行"
            />{" "}
            ·{" "}
            <Plural
              value={{ characterCount: c.value.length }}
              one="# 个字符"
              other="# 个字符"
            />
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeMirror
            ref={editorRef}
            value={c.value}
            onChange={c.setValue}
            extensions={[
              ...c.extensions,
              Prec.highest(editorLayout),
              editorSearch,
              EditorView.contentAttributes.of({
                "aria-label": t`格式化内容编辑器`,
              }),
            ]}
            theme={c.resolvedTheme === "dark" ? "dark" : "light"}
            height="100%"
            style={{ height: "100%" }}
            placeholder={t`粘贴或输入 ${languageLabel} 内容`}
            aria-label={t`格式化内容编辑器`}
            basicSetup={c.basicSetup}
          />
        </div>
        <div className="border-border flex items-center justify-between gap-3 border-t px-3 py-2">
          <p
            role="status"
            className={`min-w-0 text-xs ${c.isDocValid ? "text-muted-foreground" : "text-destructive"}`}
          >
            {c.status ?? <Trans>输入内容后自动校验</Trans>}
          </p>
          <CopyButton
            variant="ghost"
            density="adaptive"
            size="sm"
            className="shrink-0"
            value={c.value}
            disabled={!c.value}
            showLabel
            onError={(error) => toast.error(describeError(error))}
          />
        </div>
      </section>
    </AppPageLayout>
  );
}
