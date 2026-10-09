import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { prepareTauriArgs } from "../../scripts/tauri.mjs";

function prepare(args, options = {}) {
  return prepareTauriArgs(args, { env: {}, ...options });
}

function config(args) {
  const resolved = prepare(args);
  return JSON.parse(resolved[resolved.indexOf("--config") + 1]);
}

test("桌面和 iOS 开发命令自动隔离，正式构建保持原参数", () => {
  for (const args of [
    ["dev"],
    ["-vv", "dev"],
    ["dev", "--release"],
    ["ios", "dev"],
    ["build", "--debug"],
    ["ios", "build", "--debug"],
  ]) {
    const value = config(args);
    assert.equal(value.identifier, "com.imehc.mftp.dev");
    assert.equal(value.productName, "MFTP Dev");
    assert.deepEqual(value.plugins.updater.endpoints, []);
  }
  for (const args of [
    ["build"],
    ["android", "build"],
    ["ios", "build"],
    ["ios", "xcode-script"],
    ["android", "android-studio-script"],
    ["dev", "--help"],
  ]) {
    assert.deepEqual(prepare(args), args);
  }
});

test("Android 保留 JNI 命名空间，通过安装后缀隔离", () => {
  for (const args of [
    ["android", "dev"],
    ["--verbose", "android", "dev"],
    ["android", "build", "--debug"],
  ]) {
    const value = config(args);
    assert.equal(value.identifier, "com.imehc.mftp");
    assert.equal(value.bundle.android.debugApplicationIdSuffix, ".dev");
  }
  const base = JSON.parse(
    readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url)),
  );
  assert.equal(base.bundle.android.debugApplicationIdSuffix, ".dev");
  assert.throws(() => prepare(["android", "dev", "--release"]));
});

test("保留自定义配置顺序及 runner 参数，QA 保持自己的身份", () => {
  const args = [
    "dev",
    "-c",
    '{"build":{"devUrl":"http://localhost:1450"}}',
    '--config={"identifier":"com.imehc.mftp.qa"}',
    "--",
    "--config",
    "runner.json",
  ];
  const result = prepare(args);
  assert.deepEqual(result.slice(-3), ["--", "--config", "runner.json"]);
  const value = JSON.parse(result[result.indexOf("--config") + 1]);
  assert.equal(value.identifier, "com.imehc.mftp.qa");
  assert.equal(value.build.devUrl, "http://localhost:1450");
  assert.deepEqual(value.plugins.updater.endpoints, []);
});

test("配置冲突或损坏时失败，不回退正式环境", () => {
  for (const value of [
    '{"identifier":"com.imehc.mftp"}',
    '{"identifier":null}',
    "{broken",
    "missing.json",
  ]) {
    assert.throws(() => prepare(["dev", "--config", value]));
  }
  assert.throws(() => prepare(["dev", "--config"]));
  assert.throws(() => prepare(["dev"], { env: { TAURI_CONFIG: "{}" } }));
  assert.throws(() =>
    prepare([
      "android",
      "dev",
      "-c",
      '{"bundle":{"android":{"debugApplicationIdSuffix":null}}}',
    ]),
  );
  assert.throws(() =>
    prepare(["android", "dev", "-c", '{"identifier":"com.imehc.mftp.dev"}']),
  );
});
