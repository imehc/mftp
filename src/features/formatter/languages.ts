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
  /** Display label; language names are proper nouns, no i18n needed. */
  label: string;
  /** CodeMirror extensions: syntax highlighting plus optional lint. */
  extensions: () => Extension[];
  format: (input: string, options: FormatOptions) => FormatResult;
  /** Omit when the language has no meaningful minified form. */
  minify?: (input: string) => FormatResult;
  /** Syntax check only; must not modify the content. */
  validate?: (input: string) => FormatResult;
  /** Recursively sort object keys, reformatting with the given indent. */
  sortKeys?: (
    input: string,
    options: FormatOptions,
    direction: SortDirection,
  ) => FormatResult;
  /** Escape the document into a string-literal body / reverse it. */
  escape?: (input: string) => FormatResult;
  unescape?: (input: string) => FormatResult;
}

// Extension point: append new languages here (install the matching
// @codemirror/lang-* package and implement `format`).
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

export function getFormatterLanguage(id: FormatterLanguageId): FormatterLanguage {
  const found = formatterLanguages.find((lang) => lang.id === id);
  return found ?? formatterLanguages[0];
}
