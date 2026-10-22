import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { projectRoot } from "./platforms.mjs";

/**
 * 构建信息在 Vite 配置加载时一次性算出并注入前端常量。
 * 取不到的值写成空串，由关于页降级为占位符，
 * 避免在无 git、无 rustc 的机器上构建失败。
 */

function run(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Cargo.lock 里的 `tauri` crate 版本才是应用实际链接的运行时版本。 */
function readTauriRuntimeVersion() {
  try {
    const lock = readFileSync(
      join(projectRoot, "src-tauri/Cargo.lock"),
      "utf8",
    );
    const block = lock
      .split("[[package]]")
      .find((entry) => entry.includes('name = "tauri"\n'));
    return block?.match(/version = "([^"]+)"/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function readTauriCliVersion() {
  const cli = readJson(
    join(projectRoot, "node_modules/@tauri-apps/cli/package.json"),
  );
  return cli?.version ?? "";
}

function readRustcVersion() {
  const raw = run("rustc", ["--version"]);
  return raw.match(/rustc (\S+)/)?.[1] ?? "";
}

export function readBuildInfo({ mode }) {
  const pkg = readJson(join(projectRoot, "package.json")) ?? {};
  const commit = run("git", ["rev-parse", "--short", "HEAD"]);
  const dirty =
    commit &&
    run("git", ["status", "--porcelain", "--untracked-files=no"]) !== "";
  const commitDate = run("git", [
    "log",
    "-1",
    "--format=%cd",
    "--date=format:%Y-%m-%d",
  ]);
  const commitDateCompact = run("git", [
    "log",
    "-1",
    "--format=%cd",
    "--date=format:%Y%m%d",
  ]);
  const commitCount = run("git", ["rev-list", "--count", "HEAD"]);
  const node = process.version.replace(/^v/, "");

  return {
    appVersion: pkg.version ?? "",
    tauriVersion: readTauriRuntimeVersion(),
    mode,
    buildNumber:
      commitDateCompact && commitCount
        ? `${commitDateCompact}.${commitCount}`
        : "",
    buildDate: commitDate,
    commit: commit ? `${commit}${dirty ? "+" : ""}` : "",
    node,
    rustc: readRustcVersion(),
    tauriCli: readTauriCliVersion(),
  };
}
