import { mergeConfig } from "vite";

import appConfig from "../../vite.config.ts";

export default async (environment) =>
  mergeConfig(await appConfig(environment), {
    // 预扫描全部夹具依赖，避免首个检查中途因发现新依赖而自动刷新页面。
    optimizeDeps: { entries: ["tests/browser/fixtures/*.html"] },
    server: { warmup: { clientFiles: ["tests/browser/fixtures/*.html"] } },
  });
