import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import { linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";

// 前端测试统一走 vitest：只装 Lingui 宏与 `~` 别名，
// 不加载应用构建用的路由 / React Compiler / Tailwind 插件链。
export default defineConfig({
  plugins: [babel({ presets: [linguiTransformerBabelPreset()] })],
  resolve: {
    alias: { "~": resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
