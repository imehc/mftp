import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import lingui from "eslint-plugin-lingui";
import reactCompiler from "eslint-plugin-react-compiler";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

// 独立声明前后留空行，连续的普通变量和函数内部语句仍可紧凑排列。
const separatedStatements = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  {
    selector:
      ":matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type=/^(FunctionDeclaration|ClassDeclaration|TSInterfaceDeclaration|TSTypeAliasDeclaration|TSEnumDeclaration)$/]",
  },
  {
    selector:
      "VariableDeclaration[declarations.0.init.body.type='BlockStatement']",
  },
  {
    selector:
      "ExportNamedDeclaration[declaration.declarations.0.init.body.type='BlockStatement']",
  },
];

// 只匹配调用链起点，避免把测试体内的 expect 等普通语句全部隔开。
const testCalls = [
  "callee",
  "callee.object",
  "callee.object.object",
  "callee.callee.object",
  "callee.callee.object.object",
  "callee.callee.callee.object",
].map((path) => ({
  selector: `ExpressionStatement[expression.${path}.name=/^(describe|suite|it|test|beforeAll|beforeEach|afterAll|afterEach)$/]`,
}));

const paddingRules = [
  { blankLine: "always", prev: "*", next: separatedStatements },
  { blankLine: "always", prev: separatedStatements, next: "*" },
  { blankLine: "always", prev: "import", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
  // 重载签名属于同一个函数，不强制拆开。
  {
    blankLine: "any",
    prev: "function-overload",
    next: ["function-overload", "function"],
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-ssr/**",
      // 固定版本的第三方 WASM 解码器分发文件，保持上游原始字节。
      "public/model-decoders/**",
      // 文档、设计片段和辅助验收产物不纳入 ESLint 检查。
      "docs/**",
      // Rust 管理的资源（如 lan_transfer 浏览器端）不属于前端代码
      "src-tauri/**",
      // 自动生成：真实来源是 Rust（specta）/ 路由配置 / .po 文件
      "src/bindings.ts",
      "src/routeTree.gen.ts",
      "src/locales/**/messages.ts",
      // shadcn/ui 组件 —— 由上游维护，无需手动修改
      "src/components/ui/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    plugins: { "react-compiler": reactCompiler },
    // React Compiler：暴露会破坏记忆化的 React 规则违规行为
    rules: { "react-compiler/react-compiler": "warn" },
  },
  lingui.configs["flat/recommended"],
  {
    files: ["src/**/*.{ts,tsx}", "*.config.{ts,js}", "scripts/**/*.mjs"],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": [
        "error",
        {
          groups: [
            // 样式等副作用导入单独成组，保留彼此的原始顺序。
            ["^\\u0000"],
            ["^node:"],
            ["^@?\\w"],
            ["^~/"],
            ["^\\."],
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "@stylistic": stylistic },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Prettier 只保留已有空行；ESLint 负责补齐，并限制最多一行。
      "@stylistic/padding-line-between-statements": ["error", ...paddingRules],
      "@stylistic/no-multiple-empty-lines": [
        "error",
        { max: 1, maxBOF: 0, maxEOF: 0 },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // TanStack Virtual 的 useVirtualizer 与 React Compiler 不兼容
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@stylistic/padding-line-between-statements": [
        "error",
        ...paddingRules,
        { blankLine: "always", prev: "*", next: testCalls },
        { blankLine: "always", prev: testCalls, next: "*" },
      ],
    },
  },
  {
    files: ["*.config.{ts,js}", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
