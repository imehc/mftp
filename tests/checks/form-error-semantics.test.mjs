import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const srcDir = join(project, "src");
const ignored = new Set([join(srcDir, "components/ui/field.tsx")]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const description = /<FieldDescription\b[^>]*>[\s\S]*?<\/FieldDescription>/g;
const openingTag = /<FieldDescription\b[^>]*>/;
const errorExpression = /\{[^{}]*error[^{}]*\}/i;

function scan(content) {
  const violations = [];
  for (const match of content.matchAll(description)) {
    const tag = openingTag.exec(match[0])?.[0] ?? "";
    const body = match[0].slice(tag.length);
    const line = content.slice(0, match.index).split("\n").length;
    const reason = tag.includes("text-destructive")
      ? "在 FieldDescription 上使用 text-destructive"
      : tag.includes('role="alert"')
        ? '在 FieldDescription 上使用 role="alert"'
        : errorExpression.test(body)
          ? "在 FieldDescription 中渲染错误变量"
          : null;
    if (reason) violations.push({ line, reason });
  }
  return violations;
}

test("静态检查能识别错误的 FieldDescription 用法", () => {
  const sample = [
    '<FieldDescription className="text-destructive">{error}</FieldDescription>',
    "<FieldDescription>{submitError}</FieldDescription>",
    '<FieldDescription role="alert">{field.state.meta.errors}</FieldDescription>',
    "<FieldDescription>用户名用于登录</FieldDescription>",
    '<FieldDescription role="status">已存在相同配置</FieldDescription>',
  ].join("\n");
  assert.deepEqual(
    scan(sample).map((violation) => violation.line),
    [1, 2, 3],
  );
});

test("表单错误使用 FieldError，而不是 FieldDescription", () => {
  const violations = [];
  for (const path of walk(srcDir)) {
    if (ignored.has(path)) continue;
    const content = readFileSync(path, "utf8");
    for (const violation of scan(content)) {
      violations.push(
        `${relative(project, path)}:${violation.line} ${violation.reason}`,
      );
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});
