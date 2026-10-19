import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const productionId = "com.imehc.mftp";

function readConfig(value, cwd) {
  // 开发入口只接受 JSON，解析失败时停止，不能降级为正式环境。
  const config = JSON.parse(
    value.trimStart().startsWith("{")
      ? value
      : readFileSync(resolve(cwd, value), "utf8"),
  );
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Tauri config must be a JSON object.");
  }
  return config;
}

function merge(base, overlay) {
  for (const [key, value] of Object.entries(overlay)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("Unsupported Tauri config key.");
    }
    if (value === null) delete base[key];
    else if (typeof value === "object" && !Array.isArray(value)) {
      const previous = base[key];
      base[key] = merge(
        previous && typeof previous === "object" && !Array.isArray(previous)
          ? previous
          : {},
        value,
      );
    } else base[key] = value;
  }
  return base;
}

export function prepareTauriArgs(args, { cwd = root, env = process.env } = {}) {
  const boundary = args.indexOf("--");
  const cli = boundary < 0 ? args : args.slice(0, boundary);
  const runner = boundary < 0 ? [] : args.slice(boundary);
  const commandIndex = cli.findIndex((arg) => !/^(-v+|--verbose)$/.test(arg));
  const platform = cli[commandIndex];
  const mobile = platform === "android" || platform === "ios";
  const command = cli[commandIndex + (mobile ? 1 : 0)];
  // IDE 的内部构建命令由 Tauri options server 传递已解析的配置。
  if (
    cli.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg)) ||
    !(command === "dev" || (command === "build" && cli.includes("--debug")))
  )
    return args;
  if (env.TAURI_CONFIG) {
    throw new Error(
      "Use --config instead of TAURI_CONFIG for development builds.",
    );
  }
  const android = platform === "android";
  if (android && cli.includes("--release")) {
    throw new Error(
      "Android dev --release cannot isolate the package. Use android dev (debug).",
    );
  }
  const config = readConfig("src-tauri/tauri.dev.conf.json", root);
  if (android) {
    // Android 用安装包后缀隔离沙盒；identifier 同时用于 JNI，必须保留。
    config.identifier = productionId;
    config.bundle.android = { debugApplicationIdSuffix: ".dev" };
  }
  const forwarded = [];
  for (let index = 0; index < cli.length; index++) {
    const arg = cli[index];
    let value;
    if (arg === "--config" || arg === "-c") {
      value = cli[++index];
      if (!value) throw new Error("Missing --config value.");
    } else if (arg.startsWith("--config=")) value = arg.slice(9);
    else if (arg.startsWith("-c") && arg.length > 2) value = arg.slice(2);
    else {
      forwarded.push(arg);
      continue;
    }
    merge(config, readConfig(value, cwd));
  }
  if (android) {
    if (
      config.identifier !== productionId ||
      config.bundle?.android?.debugApplicationIdSuffix !== ".dev"
    )
      throw new Error(
        "Android development requires the existing JNI identifier and .dev package suffix.",
      );
  } else if (!config.identifier || config.identifier === productionId) {
    throw new Error("Development builds must use a non-production identifier.");
  }
  // 自定义开发/QA 配置仍不能获取正式更新包。
  merge(config, {
    bundle: { createUpdaterArtifacts: false },
    plugins: { updater: { endpoints: [] } },
  });
  return [...forwarded, "--config", JSON.stringify(config), ...runner];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = prepareTauriArgs(process.argv.slice(2));
    if (args.some((arg) => arg === "dev" || arg === "build")) {
      const { prepareTranslationEngine } =
        await import("./prepare-translation-engine.mjs");
      await prepareTranslationEngine();
    }
    const { run } = await import("@tauri-apps/cli");
    await run(args, "pnpm tauri");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
