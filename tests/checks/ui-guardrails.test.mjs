import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const srcDir = join(project, "src");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * 找出一个 JSX 起始标签的完整文本。
 *
 * 不能直接用 `/<Button[^>]*>/`：属性里的箭头函数和模板字符串都可能带 `>`。
 * 这里按花括号、引号和模板字符串跳过 JSX 表达式内部。
 */
function openingTags(content, name) {
  const tags = [];
  const pattern = new RegExp(`<${name}\\b`, "g");
  for (const match of content.matchAll(pattern)) {
    let index = match.index + match[0].length;
    let braces = 0;
    let quote = null;
    let escaped = false;
    for (; index < content.length; index += 1) {
      const char = content[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        braces += 1;
      } else if (char === "}") {
        braces -= 1;
      } else if (char === ">" && braces === 0) {
        break;
      }
    }
    tags.push(content.slice(match.index, index + 1));
  }
  return tags;
}

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

const inlineMinSize = /\bstyle=\{\{[\s\S]*?\bmin(?:Width|Height)\s*:/;

function scanButtonInlineMinSize(content) {
  const violations = [];
  for (const match of content.matchAll(/<Button\b/g)) {
    const tag = openingTags(content.slice(match.index), "Button")[0] ?? "";
    if (!inlineMinSize.test(tag)) continue;
    violations.push({
      line: lineAt(content, match.index),
      reason: "Button 使用内联 minWidth/minHeight 承担触控下限",
    });
  }
  return violations;
}

function scanVisibleSurfacePattern(content) {
  const violations = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (/\bmin-h-11\b/.test(line) && /\bmd:min-h-8\b/.test(line)) {
      violations.push({
        line: index + 1,
        reason: "用 min-h-11 md:min-h-8 放大移动端可见表面",
      });
    }
  }
  return violations;
}

test("静态检查能识别 Button 内联触控尺寸", () => {
  const sample = [
    "<Button style={{ minWidth: 44 }}>编辑</Button>",
    '<Button style={{ minHeight: "44px", color: "red" }} />',
    '<Button className="min-h-11" style={{ color: "red" }} />',
    "<Button onClick={() => run({ deep: true })}>保存</Button>",
  ].join("\n");
  assert.deepEqual(
    scanButtonInlineMinSize(sample).map((violation) => violation.line),
    [1, 2],
  );
});

test("静态检查能识别放大可见表面的断点组合", () => {
  const sample = [
    '<button className="min-h-11 md:min-h-8">保存</button>',
    '<button className="md:min-h-8 min-h-11">保存</button>',
    '<button className="min-h-11 md:min-h-9">保存</button>',
  ].join("\n");
  assert.deepEqual(
    scanVisibleSurfacePattern(sample).map((violation) => violation.line),
    [1, 2],
  );
});

test("Button 不使用内联 minWidth/minHeight 承担触控下限", () => {
  const violations = [];
  for (const path of walk(srcDir)) {
    const content = readFileSync(path, "utf8");
    for (const violation of scanButtonInlineMinSize(content)) {
      violations.push(
        `${relative(project, path)}:${violation.line} ${violation.reason}`,
      );
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("不使用 min-h-11 md:min-h-8 放大可见表面", () => {
  const violations = [];
  for (const path of walk(srcDir)) {
    const content = readFileSync(path, "utf8");
    for (const violation of scanVisibleSurfacePattern(content)) {
      violations.push(
        `${relative(project, path)}:${violation.line} ${violation.reason}`,
      );
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("弹窗与页面外壳默认启用自适应密度", () => {
  const files = [
    {
      path: "src/components/ui/dialog.tsx",
      mapping: /adaptiveDensity\s*&&\s*"ui-density-adaptive"/,
    },
    {
      path: "src/components/ui/alert-dialog.tsx",
      mapping: /adaptiveDensity\s*&&\s*"ui-density-adaptive"/,
    },
    {
      path: "src/components/ui/dialog-layout.tsx",
      mapping: /adaptiveDensity=\{adaptiveDensity\}/,
    },
    {
      path: "src/components/AppPageLayout.tsx",
      mapping: /adaptiveDensity\s*&&\s*"ui-density-adaptive"/,
    },
  ];
  for (const file of files) {
    const content = readFileSync(join(project, file.path), "utf8");
    assert.match(
      content,
      /adaptiveDensity\s*=\s*true/,
      `${file.path} 缺少 adaptiveDensity 默认值`,
    );
    assert.match(
      content,
      file.mapping,
      `${file.path} 未把 adaptiveDensity 映射到密度作用域`,
    );
  }
});

test("页面外壳承接内部滚动安全区", () => {
  const content = readFileSync(
    join(project, "src/components/AppPageContent.tsx"),
    "utf8",
  );
  assert.match(
    content,
    /"app-scroll-safe-end":\s*bottomInset\s*!==\s*"page"\s*&&\s*scroll\s*===\s*"page"/,
    "AppPageContent 未在内部滚动场景添加 app-scroll-safe-end",
  );
  const layout = readFileSync(
    join(project, "src/components/AppPageLayout.tsx"),
    "utf8",
  );
  assert.match(layout, /<AppPageContent\b/, "AppPageLayout 未复用共享外壳");
});
