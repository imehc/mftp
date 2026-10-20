import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const native = join(root, "src-tauri/native/translation");
const spec = JSON.parse(await readFile(join(native, "engine.json"), "utf8"));
// Windows 检出会把补丁转成 CRLF，而解压出的源码仍是 LF；
// 先统一换行，保证 git apply 在各平台使用相同的上下文。
const patch = (
  await readFile(join(native, "legacy-stq.patch"), "utf8")
).replace(/\r\n/g, "\n");
const signature = `${spec.revision}:${createHash("sha256").update(patch).digest("hex")}`;
const cache = join(root, "src-tauri/target/translation-source");

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command, args, cwd, input) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    // 源码目录不是 Git 工作树，避免补丁被父仓库的忽略规则跳过。
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(cwd) },
    // input 只对管道 stdin 生效；无输入时沿用继承的终端输出。
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
}

export async function prepareTranslationEngine() {
  await mkdir(cache, { recursive: true });
  const destination = join(cache, "llama.cpp");
  const marker = join(destination, ".mftp-version");
  try {
    if ((await readFile(marker, "utf8")) === signature) return destination;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lock = join(cache, ".prepare-lock");
  await mkdir(lock);
  const temporary = join(cache, `.prepare-${process.pid}`);
  try {
    const archive = process.env.MFTP_TRANSLATION_SOURCE_ARCHIVE
      ? resolve(process.env.MFTP_TRANSLATION_SOURCE_ARCHIVE)
      : join(cache, `${spec.revision}.tar.gz`);
    try {
      await stat(archive);
    } catch (error) {
      if (
        error.code !== "ENOENT" ||
        process.env.MFTP_TRANSLATION_SOURCE_ARCHIVE
      )
        throw error;
      console.log(
        "Downloading pinned translation engine source (no model weights)…",
      );
      const response = await fetch(spec.url, {
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok || !response.body)
        throw new Error(
          `Engine source download failed: HTTP ${response.status}`,
          { cause: error },
        );
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(`${archive}.part`),
      );
      if ((await checksum(`${archive}.part`)) !== spec.sha256)
        throw new Error("Engine source SHA-256 mismatch", { cause: error });
      await rename(`${archive}.part`, archive);
    }
    if ((await checksum(archive)) !== spec.sha256)
      throw new Error("Engine source SHA-256 mismatch");
    await mkdir(temporary);
    run(
      "tar",
      ["-xzf", archive, "--strip-components=1", "-C", temporary],
      cache,
    );
    run("git", ["apply", "--check", "-"], temporary, patch);
    run("git", ["apply", "-"], temporary, patch);
    await writeFile(join(temporary, ".mftp-version"), signature);
    // 仅替换本脚本管理的开发源码缓存，不接触运行时模型和用户数据。
    await rm(destination, { force: true, recursive: true });
    await rename(temporary, destination);
    console.log(`Translation engine prepared: ${spec.revision}`);
    return destination;
  } finally {
    await rm(temporary, { force: true, recursive: true });
    await rm(lock, { recursive: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await prepareTranslationEngine();
}
