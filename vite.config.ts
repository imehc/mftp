import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    babel({
      presets: [reactCompilerPreset(), linguiTransformerBabelPreset()],
    }),
    lingui(),
    tailwindcss(),
  ],

  // 为 Tauri 开发定制的 Vite 配置，仅在 `tauri dev` 或 `tauri build` 时生效
  //
  // 1. 避免 Vite 隐藏 Rust 编译错误
  clearScreen: false,
  // 2. Tauri 需要固定端口，若端口被占用则直接失败
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. 让 Vite 忽略监听 `src-tauri` 目录
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          // 把 Vite 的动态导入预加载辅助函数放进一个很小的共享 chunk。
          // 否则第一个用到它的“重消费者”会把整个特性
          // vendor chunk（Pixi）拉进首屏 HTML 的 modulepreload 列表。
          if (id.includes("vite/preload-helper")) return "runtime-preload";
          if (!id.includes("node_modules")) return;
          if (id.includes("/pixi.js/") || id.includes("/@pixi/")) {
            return "vendor-pixi";
          }
          if (id.includes("/@dimforge/")) return "vendor-physics";
          if (id.includes("/mediabunny/")) return "vendor-media";
          if (id.includes("/@xterm/")) return "vendor-xterm";
          if (id.includes("/@tauri-apps/")) return "vendor-tauri";
          if (id.includes("/@lingui/")) return "vendor-i18n";
          if (id.includes("/@tanstack/")) return "vendor-tanstack";
          if (id.includes("/@dnd-kit/")) return "vendor-dnd";
          // recharts 及其沉重的传递依赖（通过 victory-vendor 引入的
          // redux/immer/d3）。只有懒加载的监控面板会用到它，因此这个
          // chunk 不会进入首屏加载。
          if (
            id.includes("/recharts/") ||
            id.includes("/victory-vendor/") ||
            id.includes("/d3-") ||
            id.includes("/@reduxjs/") ||
            id.includes("/react-redux/") ||
            id.includes("/immer/") ||
            id.includes("/reselect/") ||
            id.includes("/decimal.js-light/") ||
            id.includes("/es-toolkit/")
          ) {
            return "vendor-charts";
          }
          if (id.includes("/zod/") || id.includes("/@standard-schema/")) {
            return "vendor-schema";
          }
          if (
            id.includes("/gsap/") ||
            id.includes("/qrcode.react/") ||
            id.includes("/qrcode/") ||
            id.includes("/react-resizable-panels/")
          ) {
            return "vendor-interaction";
          }
          if (id.includes("/react/") || id.includes("/react-dom/")) {
            return "vendor-react";
          }
          if (
            id.includes("/lucide-react/") ||
            id.includes("/radix-ui/") ||
            id.includes("/sonner/") ||
            id.includes("/next-themes/")
          ) {
            return "vendor-ui";
          }
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "~": resolve(import.meta.dirname, "src"),
    },
  },
}));
