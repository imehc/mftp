import { execFileSync } from "node:child_process";
import {
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
const work = mkdtempSync(join(tmpdir(), "mftp-android-icons-"));
const res = join(root, "src-tauri/gen/android/app/src/main/res");
const manifestPath = join(
  root,
  "src-tauri/gen/android/app/src/main/AndroidManifest.xml",
);
const densities = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

function runIconGenerator(source, output) {
  execFileSync(process.execPath, [cli, "icon", source, "--output", output], {
    cwd: root,
    stdio: "inherit",
  });
}

function generateTheme(theme, sourceName, background) {
  const themeWork = join(work, theme);
  mkdirSync(themeWork, { recursive: true });
  const source = join(root, "public", sourceName);
  const manifest = join(work, `${theme}.json`);
  writeFileSync(
    manifest,
    JSON.stringify({
      default: source,
      bg_color: background,
      android_fg: source,
    }),
  );
  runIconGenerator(manifest, themeWork);

  for (const [density] of densities) {
    const target = join(res, `mipmap-${density}`);
    mkdirSync(target, { recursive: true });
    for (const suffix of ["", "_round", "_foreground"]) {
      copyFileSync(
        join(
          themeWork,
          "android",
          `mipmap-${density}`,
          `ic_launcher${suffix}.png`,
        ),
        join(target, `ic_launcher_${theme}${suffix}.png`),
      );
    }
  }
  const anydpi = join(res, "mipmap-anydpi-v26");
  mkdirSync(anydpi, { recursive: true });
  const adaptiveIcon = join(anydpi, `ic_launcher_${theme}.xml`);
  writeFileSync(
    adaptiveIcon,
    `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <foreground>\n    <inset android:drawable="@mipmap/ic_launcher_${theme}_foreground" android:inset="16.666667%"/>\n  </foreground>\n  <background android:drawable="@color/ic_launcher_${theme}_background"/>\n</adaptive-icon>\n`,
  );
  const systemIcons = join(
    res,
    theme === "dark" ? "mipmap-night-anydpi-v26" : "mipmap-anydpi-v26",
  );
  mkdirSync(systemIcons, { recursive: true });
  copyFileSync(adaptiveIcon, join(systemIcons, "ic_launcher.xml"));
  for (const [density] of densities) {
    const target = join(
      res,
      `mipmap-${theme === "dark" ? "night-" : ""}${density}`,
    );
    mkdirSync(target, { recursive: true });
    for (const suffix of ["", "_round", "_foreground"]) {
      copyFileSync(
        join(res, `mipmap-${density}/ic_launcher_${theme}${suffix}.png`),
        join(target, `ic_launcher${suffix}.png`),
      );
    }
  }
  const values = join(res, "values");
  mkdirSync(values, { recursive: true });
  writeFileSync(
    join(values, `ic_launcher_${theme}_background.xml`),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_${theme}_background">${background}</color>\n</resources>\n`,
  );
}

function syncLauncherAliases() {
  let manifest = readFileSync(manifestPath, "utf8");
  const mainActivity = manifest.match(
    /<activity\s[^>]*android:name="([^"]+)"[^>]*>/,
  )?.[1];
  if (!mainActivity) throw new Error("Android main activity was not found");
  manifest = manifest.replace(
    /\s*<!-- mftp app-icon:begin -->[\s\S]*?<!-- mftp app-icon:end -->\s*/g,
    "\n",
  );
  manifest = manifest.replace(
    /\n\s*<intent-filter>[\s\S]*?<\/intent-filter>/g,
    (block) => (block.includes("android.intent.action.MAIN") ? "" : block),
  );
  const aliases = `
        <!-- mftp app-icon:begin -->
        <activity-alias
            android:name="\${applicationId}.LightLauncher"
            android:enabled="true"
            android:exported="true"
            android:icon="@mipmap/ic_launcher"
            android:targetActivity="${mainActivity}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity-alias>
        <activity-alias
            android:name="\${applicationId}.DarkLauncher"
            android:enabled="false"
            android:exported="true"
            android:icon="@mipmap/ic_launcher"
            android:targetActivity="${mainActivity}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity-alias>
        <!-- mftp app-icon:end -->`;
  manifest = manifest.replace(
    /\n\s*<\/application>/,
    `${aliases}\n    </application>`,
  );
  writeFileSync(manifestPath, manifest);
}

try {
  generateTheme("light", "app-light-icon.png", "#F5F8FF");
  generateTheme("dark", "app-dark-icon.png", "#171923");
  syncLauncherAliases();
  console.log("Android light/dark launcher icons regenerated.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
