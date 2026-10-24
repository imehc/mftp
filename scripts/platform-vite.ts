import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import type { Plugin } from "vite";

import {
  ignoredRoutes,
  platformManifest,
  projectRoot,
  sourceIncluded,
  supports,
} from "./platforms.mjs";

const slash = (value: string) => value.replaceAll("\\", "/");

export function platformAliases(target: string | null) {
  const replacements: Record<string, string> = {};
  if (!target) return replacements;
  if (!supports(target, "mcp"))
    replacements["~/features/mcp/integration"] =
      "src/app/platform/without-mcp.tsx";
  if (target === "android") {
    replacements["~/features/updater/controller"] =
      "src/features/updater/mobile-controller.ts";
  } else if (!supports(target, "desktopSettings")) {
    replacements["~/features/updater/integration"] =
      "src/app/platform/without-updater.tsx";
    replacements["~/features/settings/DesktopSettings"] =
      "src/app/platform/without-desktop-settings.tsx";
  }
  if (!supports(target, "rsync"))
    replacements["~/features/ssh-sftp/rsync/integration"] =
      "src/app/platform/without-rsync.tsx";
  if (!supports(target, "poetryLocal"))
    replacements["~/features/poetry/components/PoetryLocalManagement"] =
      "src/app/platform/without-poetry-local.tsx";
  if (!supports(target, "bt")) {
    replacements["~/features/bt/transfer-control"] =
      "src/app/platform/without-bt-control.ts";
    replacements["~/features/bt/integration"] =
      "src/app/platform/without-bt.ts";
  }
  if (!supports(target, "mobileModel"))
    replacements["~/features/model-viewer/export/native-export"] =
      "src/features/model-viewer/export/native-export.desktop.ts";
  return Object.fromEntries(
    Object.entries(replacements).map(([key, file]) => [
      key,
      resolve(projectRoot, file),
    ]),
  );
}

export function platformRouteOptions(target: string | null) {
  if (!target) return {};
  // Router 的忽略表达式匹配目录项名称，不接收完整相对路径。
  const excluded = ignoredRoutes(target).map((name: string) =>
    name
      .split("/")
      .at(-1)!
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return {
    generatedRouteTree: `.tanstack/platform/${target}/routeTree.gen.ts`,
    routeFileIgnorePattern: excluded.length
      ? `(?:^|/)(?:${excluded.join("|")})$`
      : undefined,
  };
}

export function platformBuildPlugin(target: string | null): Plugin {
  const excluded = target
    ? ignoredRoutes(target).map((route: string) => `src/routes/${route}`)
    : [];
  return {
    name: "mftp-platform-build",
    enforce: "pre",
    config() {
      if (!target) return;
      const publicDir = join(
        projectRoot,
        ".tanstack",
        "platform",
        target,
        "public",
      );
      rmSync(publicDir, { recursive: true, force: true });
      mkdirSync(publicDir, { recursive: true });
      for (const resource of platformManifest.resources)
        cpSync(
          join(projectRoot, "public", resource),
          join(publicDir, resource),
          { recursive: true },
        );
      return { publicDir };
    },
    generateBundle(_options, bundle) {
      if (!target) return;
      const modules = [
        ...new Set(
          Object.values(bundle).flatMap((item) =>
            item.type === "chunk" ? Object.keys(item.modules) : [],
          ),
        ),
      ]
        .map((id) => slash(relative(projectRoot, id.split("?")[0])))
        .sort();
      const forbidden = modules.filter(
        (name) => !sourceIncluded(target, name) || excluded.includes(name),
      );
      if (forbidden.length)
        this.error(
          `Unsupported ${target} modules in bundle:\n${forbidden.join("\n")}`,
        );
      const report = {
        platform: target,
        capabilities: Object.keys(platformManifest.capabilities).filter((key) =>
          supports(target, key),
        ),
        excludedRoutes: ignoredRoutes(target),
        modules,
        files: Object.values(bundle).map((item) => ({
          name: item.fileName,
          bytes: Buffer.byteLength(
            item.type === "chunk" ? item.code : item.source,
          ),
        })),
      };
      const reportPath = join(
        projectRoot,
        ".tanstack",
        "reports",
        `${target}.json`,
      );
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      this.emitFile({
        type: "asset",
        fileName: "build-platform.json",
        source: JSON.stringify({
          platform: target,
          capabilities: report.capabilities,
        }),
      });
    },
  };
}
