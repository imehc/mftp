import js from "@eslint/js";
import globals from "globals";
import reactCompiler from "eslint-plugin-react-compiler";
import reactHooks from "eslint-plugin-react-hooks";
import lingui from "eslint-plugin-lingui";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-ssr/**",
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
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
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
    files: ["*.config.{ts,js}", "scripts/**"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
