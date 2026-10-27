import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const options = new Set(process.argv.slice(2));
const offline = options.has("--offline");
const prepareOnly = options.has("--prepare-only");
const plugins = [
  "android-updater",
  "native-export",
  "native-viewer",
  "native-speech",
];
const excluded = new Set(["build", ".gradle", ".git", ".DS_Store"]);
let fixture;
let report;

function copyTree(source, destination, prefix, hashes) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs
    .readdirSync(source, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(`Source symlink is not supported: ${name}`);
    if (entry.isDirectory()) copyTree(from, to, name, hashes);
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(from);
      hashes[name] = createHash("sha256").update(bytes).digest("hex");
      fs.writeFileSync(to, bytes);
    }
  }
}

function saveReport(status) {
  report.status = status;
  fs.writeFileSync(
    path.join(fixture, "check-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

try {
  for (const option of options) {
    if (!["--offline", "--prepare-only"].includes(option))
      throw new Error(`Unknown option: ${option}`);
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const javaHome = process.env.JAVA_HOME;
  const buildTools = process.env.MFTP_ANDROID_BUILD_TOOLS || "36.0.0";
  if (!/^\d+\.\d+\.\d+$/.test(buildTools))
    throw new Error("Invalid MFTP_ANDROID_BUILD_TOOLS version");
  if (
    !sdk ||
    /[\r\n]/.test(sdk) ||
    !fs.existsSync(path.join(sdk, "platforms/android-36/android.jar"))
  ) {
    throw new Error(
      "Set ANDROID_HOME to an SDK containing platforms;android-36",
    );
  }
  if (!fs.existsSync(path.join(sdk, "build-tools", buildTools)))
    throw new Error(
      `Install SDK build-tools;${buildTools} or set MFTP_ANDROID_BUILD_TOOLS`,
    );
  if (!javaHome)
    throw new Error("Set JAVA_HOME to a JDK from version 17 through 24");
  const java = path.join(
    javaHome,
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  );
  const javaVersion = execFileSync(java, ["--version"], { encoding: "utf8" });
  const javaMajor = Number(javaVersion.match(/(?:openjdk|java) (\d+)/)?.[1]);
  if (javaMajor < 17 || javaMajor > 24 || !Number.isFinite(javaMajor))
    throw new Error("Gradle requires JDK 17–24");
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--manifest-path",
        path.join(project, "src-tauri/Cargo.toml"),
        "--locked",
        "--format-version",
        "1",
        "--filter-platform",
        "aarch64-linux-android",
        ...(offline ? ["--offline"] : []),
      ],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
  const root = metadata.resolve.nodes.find(
    (node) => node.id === metadata.resolve.root,
  );
  const tauriId = root?.deps.find((dep) => dep.name === "tauri")?.pkg;
  const tauri = metadata.packages.find((pkg) => pkg.id === tauriId);
  if (!tauri)
    throw new Error("Cannot resolve the application's locked Tauri dependency");
  const api = path.join(path.dirname(tauri.manifest_path), "mobile/android");
  if (!fs.existsSync(path.join(api, "build.gradle.kts")))
    throw new Error("Locked Tauri Android API source is missing");

  for (const source of [
    api,
    ...plugins.map((name) =>
      path.join(project, "src-tauri/plugins", name, "android"),
    ),
  ]) {
    const config = fs.readFileSync(
      path.join(source, "build.gradle.kts"),
      "utf8",
    );
    if (!/compileSdk\s*=\s*36\b/.test(config))
      throw new Error(
        "Android compile SDK changed; update the checker and CI SDK together",
      );
  }

  // 每次新建隔离工程；不向插件源码目录输出 build，也不复用历史手工夹具。
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mftp-android-plugins-"));
  console.log(`Android plugin check workspace: ${fixture}`);
  const hashes = {};
  copyTree(api, path.join(fixture, "tauri-android"), "tauri-android", hashes);
  for (const plugin of plugins)
    copyTree(
      path.join(project, "src-tauri/plugins", plugin, "android"),
      path.join(fixture, plugin),
      plugin,
      hashes,
    );
  const android = path.join(project, "src-tauri/gen/android");
  // 宿主返回处理依赖 AndroidX，在隔离 library 中编译真实源码，不读取签名配置。
  const navigationSource = path.join(
    android,
    "app/src/main/java/com/imehc/mftp/WebViewBackNavigation.kt",
  );
  const navigationBytes = fs.readFileSync(navigationSource);
  const navigationDir = path.join(fixture, "navigation-host");
  fs.mkdirSync(path.join(navigationDir, "src/main/java/com/imehc/mftp"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      navigationDir,
      "src/main/java/com/imehc/mftp/WebViewBackNavigation.kt",
    ),
    navigationBytes,
  );
  hashes["navigation-host/WebViewBackNavigation.kt"] = createHash("sha256")
    .update(navigationBytes)
    .digest("hex");
  fs.writeFileSync(
    path.join(navigationDir, "src/main/AndroidManifest.xml"),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n',
  );
  fs.writeFileSync(
    path.join(navigationDir, "build.gradle.kts"),
    `plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.imehc.navigation.check"
    compileSdk = 36
    defaultConfig { minSdk = 28 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}
dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
}
`,
  );
  copyTree(
    path.join(android, "gradle/wrapper"),
    path.join(fixture, "gradle/wrapper"),
    "gradle/wrapper",
    hashes,
  );
  for (const name of [
    "gradlew",
    "gradlew.bat",
    "build.gradle.kts",
    "gradle.properties",
  ]) {
    const source = path.join(android, name);
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(path.join(fixture, name), bytes);
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
  }
  fs.chmodSync(path.join(fixture, "gradlew"), 0o755);
  fs.appendFileSync(
    path.join(fixture, "build.gradle.kts"),
    `
subprojects {
    afterEvaluate {
        extensions.findByType<com.android.build.gradle.LibraryExtension>()?.apply {
            buildToolsVersion = "${buildTools}"
        }
    }
}
`,
  );
  fs.writeFileSync(
    path.join(fixture, "settings.gradle.kts"),
    `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
rootProject.name = "mftp-android-plugin-check"
include(":tauri-android", ":navigation-host", ${plugins.map((name) => JSON.stringify(`:${name}`)).join(", ")})
`,
  );
  // local.properties 使用 Java properties 转义，不将 SDK 路径注入 Gradle 代码。
  const escapedSdk = path
    .resolve(sdk)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll(" ", "\\ ");
  fs.writeFileSync(
    path.join(fixture, "local.properties"),
    `sdk.dir=${escapedSdk}\n`,
  );
  report = {
    status: "prepared",
    tauriVersion: tauri.version,
    cargoLockSha256: createHash("sha256")
      .update(fs.readFileSync(path.join(project, "src-tauri/Cargo.lock")))
      .digest("hex"),
    javaMajor,
    compileSdk: 36,
    buildTools,
    offline,
    plugins,
    hostSources: ["WebViewBackNavigation.kt"],
    sourceSha256: hashes,
  };
  saveReport("prepared");
  if (!prepareOnly) {
    const windows = process.platform === "win32";
    const gradle = windows ? "cmd.exe" : "./gradlew";
    execFileSync(
      gradle,
      [
        ...(windows ? ["/d", "/s", "/c", "gradlew.bat"] : []),
        "--no-daemon",
        ...(offline ? ["--offline"] : []),
        ...plugins.map((name) => `:${name}:assembleDebug`),
        ":navigation-host:assembleDebug",
        ":native-speech:testDebugUnitTest",
      ],
      {
        cwd: fixture,
        stdio: "inherit",
      },
    );
    for (const plugin of plugins) {
      if (
        !fs.existsSync(
          path.join(
            fixture,
            plugin,
            "build/outputs/aar",
            `${plugin}-debug.aar`,
          ),
        )
      )
        throw new Error(`Missing Android library output: ${plugin}`);
    }
    saveReport("passed");
  }
  console.log(
    `Android plugin ${prepareOnly ? "preparation" : "compilation"} complete; report: ${path.join(fixture, "check-report.json")}`,
  );
} catch (error) {
  if (report) saveReport("failed");
  console.error(error.message);
  process.exitCode = 1;
}
