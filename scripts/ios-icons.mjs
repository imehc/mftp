import { execFileSync } from "node:child_process";
import {
  accessSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const work = mkdtempSync(join(tmpdir(), "mftp-ios-icons-"));
const iconRoot = join(root, "src-tauri/gen/apple/Assets.xcassets");
const primarySet = join(iconRoot, "AppIcon.appiconset");
const projectPath = join(root, "src-tauri/gen/apple/project.yml");
const plistPath = join(root, "src-tauri/gen/apple/mftp_iOS/Info.plist");

function generate(theme) {
  const output = join(work, theme);
  execFileSync(
    process.execPath,
    [
      cli,
      "icon",
      join(root, `public/app-${theme}-icon.png`),
      "--output",
      output,
    ],
    { cwd: root, stdio: "inherit" },
  );
  const image = join(output, "ios/AppIcon-512@2x.png");
  accessSync(image);
  return image;
}

function syncProjectConfiguration() {
  let project = readFileSync(projectPath, "utf8");
  project = project.replace(
    /\n\s*# mftp app-icon:begin[\s\S]*?# mftp app-icon:end\n/g,
    "\n",
  );
  project = project.replace(
    /\n\s*# mftp app-icon-build:begin[\s\S]*?# mftp app-icon-build:end\n/g,
    "\n",
  );
  const anchor = "        ENABLE_BITCODE: false";
  if (!project.includes(anchor)) {
    throw new Error("iOS app target build settings were not found");
  }
  project = project.replace(
    anchor,
    `${anchor}\n        # mftp app-icon-build:begin\n        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon\n        # mftp app-icon-build:end\n`,
  );
  writeFileSync(projectPath, project);

  const plist = JSON.parse(
    execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
      encoding: "utf8",
    }),
  );
  for (const key of ["CFBundleIcons", "CFBundleIcons~ipad"]) {
    if (Object.hasOwn(plist, key)) {
      execFileSync("plutil", ["-remove", key, plistPath]);
    }
  }
}

try {
  const light = generate("light");
  const dark = generate("dark");
  rmSync(primarySet, { recursive: true, force: true });
  mkdirSync(primarySet, { recursive: true });
  const images = ["light", "dark"].map((theme) => ({
    filename: `AppIcon-${theme}.png`,
    idiom: "universal",
    platform: "ios",
    size: "1024x1024",
    ...(theme === "dark"
      ? { appearances: [{ appearance: "luminosity", value: "dark" }] }
      : {}),
  }));
  copyFileSync(light, join(primarySet, images[0].filename));
  copyFileSync(dark, join(primarySet, images[1].filename));
  writeFileSync(
    join(primarySet, "Contents.json"),
    `${JSON.stringify({ images, info: { version: 1, author: "xcode" } }, null, 2)}\n`,
  );
  rmSync(join(iconRoot, "AppIconDark.appiconset"), {
    recursive: true,
    force: true,
  });
  syncProjectConfiguration();
  console.log("iOS system-appearance app icons regenerated.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
