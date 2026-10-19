import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildPlatform,
  ignoredRoutes,
  normalizePlatform,
  platformManifest,
  projectRoot,
  sourceIncluded,
  supports,
} from "../../scripts/platforms.mjs";

test("原生目标优先且拒绝冲突平台", () => {
  assert.equal(normalizePlatform("aarch64-linux-android"), "android");
  assert.equal(normalizePlatform("aarch64-apple-ios-sim"), "ios");
  assert.equal(
    buildPlatform({ TAURI_ENV_PLATFORM: "ios" }, undefined, "darwin"),
    "ios",
  );
  assert.throws(
    () => buildPlatform({ TAURI_ENV_PLATFORM: "ios" }, "android"),
    /mismatch/,
  );
  assert.throws(() => buildPlatform({}, "unknown"), /Unsupported/);
  assert.equal(buildPlatform({}, undefined, "win32"), "windows");
});

test("五个目标的路由和源模块矩阵与原生配置一致", () => {
  for (const target of platformManifest.targets) {
    const config = JSON.parse(
      readFileSync(
        join(projectRoot, `src-tauri/tauri.${target}.conf.json`),
        "utf8",
      ),
    );
    assert.equal(config.build.frontendDist, `../dist/${target}`);
    assert.equal(
      ignoredRoutes(target).includes("tools/bt.tsx"),
      target === "ios",
    );
    assert.equal(
      sourceIncluded(target, "src/features/bt/tasks-store.ts"),
      target !== "ios",
    );
    assert.equal(supports(target, "lan"), !["android", "ios"].includes(target));
    // 布局是窗口尺寸能力，移动/桌面后缀不是全局排除规则。
    assert.equal(
      sourceIncluded(
        target,
        "src/features/transfers/TransferPanel.desktop.tsx",
      ),
      true,
    );
  }
});
