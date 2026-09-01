import { json, jsonParseLinter } from "@codemirror/lang-json";
import type { Extension } from "@codemirror/state";
import { linter } from "@codemirror/lint";
import {
  escapeJsonString,
  formatJson,
  minifyJson,
  sortJsonKeys,
  unescapeJsonString,
  validateJson,
  type FormatOptions,
  type FormatResult,
  type SortDirection,
} from "~/features/formatter/json";

export type FormatterLanguageId = "json";

export interface FormatterLanguage {
  id: FormatterLanguageId;
  /** 展示名称；语言名是专有名词，无需 i18n。 */
  label: string;
  /** CodeMirror 扩展：语法高亮与可选 lint。 */
  extensions: () => Extension[];
  format: (input: string, options: FormatOptions) => FormatResult;
  /** 当该语言没有有意义的压缩形态时省略。 */
  minify?: (input: string) => FormatResult;
  /** 仅做语法检查；不得修改内容。 */
  validate?: (input: string) => FormatResult;
  /** 递归排序对象键，并按给定缩进重新格式化。 */
  sortKeys?: (
    input: string,
    options: FormatOptions,
    direction: SortDirection,
  ) => FormatResult;
  /** 将文档转义成字符串字面量主体 / 或其逆操作。 */
  escape?: (input: string) => FormatResult;
  unescape?: (input: string) => FormatResult;
}

// 扩展点：在此追加新语言（安装对应的
// @codemirror/lang-* 包并实现 `format`）。
export const formatterLanguages: FormatterLanguage[] = [
  {
    id: "json",
    label: "JSON",
    extensions: () => [json(), linter(jsonParseLinter())],
    format: formatJson,
    minify: minifyJson,
    validate: validateJson,
    sortKeys: sortJsonKeys,
    escape: escapeJsonString,
    unescape: unescapeJsonString,
  },
];

export function getFormatterLanguage(
  id: FormatterLanguageId,
): FormatterLanguage {
  const found = formatterLanguages.find((lang) => lang.id === id);
  return found ?? formatterLanguages[0];
}
