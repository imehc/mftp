import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import {
  lingui,
  linguiTransformerBabelPreset,
} from "@lingui/vite-plugin";
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
      presets: [linguiTransformerBabelPreset()],
    }),
    lingui(),
    tailwindcss(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
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
          // recharts + its heavy transitive deps (redux/immer/d3 via
          // victory-vendor). Only the lazy monitor panel imports it, so this
          // chunk stays out of the initial load.
          if (
            id.includes("/recharts/") ||
            id.includes("/victory-vendor/") ||
            id.includes("/d3-") ||
            id.includes("/@reduxjs/") ||
            id.includes("/react-redux/") ||
            id.includes("/immer/") ||
            id.includes("/reselect/") ||
            id.includes("/decimal.js-light/") ||
            id.includes("/es-toolkit/") ||
            id.includes("/eventemitter3/")
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
