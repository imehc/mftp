import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildPlatform,
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
    assert.equal(supports(target, "lan"), !["android", "ios"].includes(target));
    // 布局是窗口尺寸能力，移动/桌面后缀不是全局排除规则。
    assert.equal(
      sourceIncluded(
        target,
        "src/features/navigation/NavigationRail.desktop.tsx",
      ),
      true,
    );
  }
});

test("rsync 能力只随 macOS/Linux 产物提供", () => {
  for (const target of platformManifest.targets) {
    const expected = target === "macos" || target === "linux";
    assert.equal(supports(target, "rsync"), expected);
    assert.equal(
      sourceIncluded(target, "src/features/ssh-sftp/rsync/integration.tsx"),
      expected,
    );
    assert.equal(
      sourceIncluded(target, "src/app/platform/without-rsync.tsx"),
      true,
    );
  }
  // SFTP 面板是共享入口，任何目标都保留；仅替换 rsync 装配模块。
  assert.equal(
    sourceIncluded(
      "android",
      "src/features/ssh-sftp/components/sftp/SftpPanel.tsx",
    ),
    true,
  );
});

test("BT 模块在所有平台均已移除", () => {
  assert.equal("bt" in platformManifest.capabilities, false);
  for (const path of [
    "src/features/bt",
    "src/routes/tools/bt.tsx",
    "src/app/platform/without-bt.ts",
    "src/app/platform/without-bt-control.ts",
    "src-tauri/src/modules/bt",
    "src-tauri/src/adapters/bt.rs",
  ])
    assert.equal(existsSync(join(projectRoot, path)), false, path);
  assert.doesNotMatch(
    readFileSync(
      join(projectRoot, "src-tauri/src/app/registry/command_baseline.txt"),
      "utf8",
    ),
    /\bbt_\w+/,
  );
  assert.doesNotMatch(
    readFileSync(join(projectRoot, "src-tauri/Cargo.toml"), "utf8"),
    /\blibrqbit(?:-core)?\b/,
  );
});
