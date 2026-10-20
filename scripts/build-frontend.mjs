import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { buildPlatform, projectRoot } from "./platforms.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--platform"))
  throw new Error(
    "Usage: pnpm build [--platform macos|windows|linux|android|ios]",
  );
const target = buildPlatform(process.env, args[1]);
const env = { ...process.env, MFTP_BUILD_PLATFORM: target };
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command) {
  const result = spawnSync(pnpm, command, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Build step failed: pnpm ${command.join(" ")}`);
}

// 全量类型/文案共用源码目录，完整构建持锁，避免另一个构建改写正在读取的输入。
mkdirSync(join(projectRoot, ".tanstack"), { recursive: true });
const lock = join(projectRoot, ".tanstack", "frontend-prepare.lock");
const deadline = Date.now() + 600_000;
while (true) {
  try {
    mkdirSync(lock);
    break;
  } catch (error) {
    if (error.code !== "EEXIST" || Date.now() >= deadline) throw error;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
try {
  run(["run", "i18n:compile"]);
  run(["run", "routes:generate"]);
  run(["exec", "tsc", "-p", "tsconfig.node.json", "--noEmit"]);
  run(["exec", "tsc", "--noEmit"]);
  run(["exec", "vite", "build"]);
  run(["run", "platform:artifact", target]);
} finally {
  rmSync(lock, { recursive: true });
}
