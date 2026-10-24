import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  macosIconName,
  validateMacosIconAssets,
} from "../../scripts/macos-icons.mjs";

const [platform, input, expectedId = "com.imehc.mftp.dev"] =
  process.argv.slice(2);
assert.ok(
  ["android", "ios", "macos"].includes(platform) && input,
  "Usage: node tests/checks/check-app-icon-artifact.mjs android|ios|macos <apk|app> [expected-bundle-id]",
);
const artifact = resolve(input);

function run(command, args, binary = false) {
  return execFileSync(command, args, {
    encoding: binary ? undefined : "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function attribute(element, name) {
  return element.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
}

function checkAndroid() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  assert.ok(sdk, "Set ANDROID_HOME or ANDROID_SDK_ROOT");
  const analyzer = join(sdk, "cmdline-tools/latest/bin/apkanalyzer");
  const version = readdirSync(join(sdk, "build-tools"))
    .filter((name) => existsSync(join(sdk, "build-tools", name, "aapt2")))
    .sort((first, second) =>
      second.localeCompare(first, undefined, { numeric: true }),
    )[0];
  assert.ok(version, "Android SDK build-tools with aapt2 are required");
  const aapt = join(sdk, "build-tools", version, "aapt2");
  const primaryIcon = run(aapt, [
    "dump",
    "xmltree",
    artifact,
    "--file",
    "res/mipmap-anydpi-v26/ic_launcher.xml",
  ]);
  const lightIcon = run(aapt, [
    "dump",
    "xmltree",
    artifact,
    "--file",
    "res/mipmap-anydpi-v26/ic_launcher_light.xml",
  ]);
  assert.equal(
    primaryIcon,
    lightIcon,
    "Application settings icon must share the light launcher's padding and resources",
  );
  const resources = run(aapt, ["dump", "resources", artifact]);
  const resourceNames = new Map(
    [...resources.matchAll(/\bresource (0x[\da-f]+) (\S+)/gi)].map((match) => [
      match[1].toLowerCase(),
      `@${match[2]}`,
    ]),
  );
  const manifest = run(analyzer, ["manifest", "print", artifact]);
  assert.equal(
    attribute(manifest.match(/<manifest\s[^>]*>/)?.[0] ?? "", "package"),
    expectedId,
  );
  const activities = [...manifest.matchAll(/<activity\s[^>]*>/g)].map((match) =>
    attribute(match[0], "android:name"),
  );
  const aliases = [
    ...manifest.matchAll(/<activity-alias\s[^>]*>[\s\S]*?<\/activity-alias>/g),
  ]
    .map((match) => match[0])
    .filter((element) => element.includes("android.intent.category.LAUNCHER"));
  assert.equal(aliases.length, 2, "Expected exactly two launcher aliases");
  for (const [name, enabled] of [
    ["LightLauncher", "true"],
    ["DarkLauncher", "false"],
  ]) {
    const alias = aliases.find(
      (element) =>
        attribute(element, "android:name") === `${expectedId}.${name}`,
    );
    assert.ok(alias, `Missing ${name}`);
    assert.equal(attribute(alias, "android:enabled"), enabled);
    assert.equal(attribute(alias, "android:exported"), "true");
    assert.ok(
      activities.includes(attribute(alias, "android:targetActivity")),
      `${name} targets an undeclared activity`,
    );
    const icon = attribute(alias, "android:icon");
    const resourceId = icon?.match(/^@ref\/(0x[\da-f]+)$/i)?.[1];
    assert.equal(
      resourceId ? resourceNames.get(resourceId.toLowerCase()) : icon,
      "@mipmap/ic_launcher",
    );
    assert.ok(alias.includes("android.intent.action.MAIN"));
  }
  for (const theme of ["light", "dark"]) {
    const folder =
      theme === "dark" ? "mipmap-night-anydpi-v26" : "mipmap-anydpi-v26";
    const systemIcon = run(aapt, [
      "dump",
      "xmltree",
      artifact,
      "--file",
      `res/${folder}/ic_launcher.xml`,
    ]);
    const themedIcon = run(aapt, [
      "dump",
      "xmltree",
      artifact,
      "--file",
      `res/mipmap-anydpi-v26/ic_launcher_${theme}.xml`,
    ]);
    assert.equal(
      systemIcon,
      themedIcon,
      `${theme} system icon must preserve the themed inset`,
    );
    for (const suffix of ["", "_foreground", "_round"]) {
      assert.ok(
        resources.includes(`mipmap/ic_launcher_${theme}${suffix}`),
        `Missing ${theme}${suffix} resource`,
      );
    }
  }
  const entries = run("unzip", ["-Z1", artifact]).split("\n");
  assert.ok(
    entries.some((entry) => /^lib\/arm64-v8a\/[^/]+\.so$/.test(entry)),
    "Missing ARM64 native library",
  );
  const dex = run("unzip", ["-p", artifact, "classes*.dex"], true);
  assert.ok(
    !dex.includes(Buffer.from("Lcom/imehc/appicon/AppIconPlugin;")),
    "Application-theme icon switch plugin must not be packaged",
  );
  return {
    package: expectedId,
    aliases: 2,
    iconVariants: 2,
    nativePlugin: false,
  };
}

function checkIos() {
  const plist = JSON.parse(
    run("plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      join(artifact, "Info.plist"),
    ]),
  );
  assert.equal(plist.CFBundleIdentifier, expectedId);
  const files = readdirSync(artifact);
  const families = ["CFBundleIcons"];
  if (plist.UIDeviceFamily?.includes(2)) families.push("CFBundleIcons~ipad");
  for (const family of families) {
    const icons = plist[family];
    assert.equal(icons?.CFBundlePrimaryIcon?.CFBundleIconName, "AppIcon");
    assert.equal(icons?.CFBundleAlternateIcons, undefined);
    for (const icon of [icons.CFBundlePrimaryIcon]) {
      assert.ok(
        icon.CFBundleIconFiles?.length > 0,
        `Missing compiled icon filenames in ${family}`,
      );
      for (const filename of icon.CFBundleIconFiles) {
        assert.ok(
          files.some(
            (file) =>
              file === `${filename}.png` || file.startsWith(`${filename}@`),
          ),
          `Missing compiled PNG: ${filename}`,
        );
      }
    }
  }
  assert.ok(files.includes("Assets.car"), "Missing compiled asset catalog");
  const catalog = JSON.parse(
    run("xcrun", ["assetutil", "--info", join(artifact, "Assets.car")]),
  );
  const icons = catalog.filter((entry) => entry.Name?.startsWith("AppIcon"));
  assert.ok(
    icons.some((entry) => entry.Appearance === "UIAppearanceDark"),
    "Missing compiled dark app icon appearance",
  );
  assert.ok(
    icons.some((entry) => !entry.Appearance),
    "Missing compiled default app icon appearance",
  );
  const symbols = run("nm", ["-gU", join(artifact, plist.CFBundleExecutable)]);
  assert.ok(
    !symbols.includes("_init_plugin_app_icon"),
    "Application-theme icon switch plugin must not be linked",
  );
  return {
    package: expectedId,
    families,
    iconVariants: 2,
    nativePlugin: false,
  };
}

function checkMacos() {
  const contents = join(artifact, "Contents");
  const plist = JSON.parse(
    run("plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      join(contents, "Info.plist"),
    ]),
  );
  assert.equal(plist.CFBundleIdentifier, expectedId);
  assert.equal(plist.CFBundleIconName, macosIconName);
  assert.equal(plist.CFBundleIconFile, "icon.icns");
  const resources = join(contents, "Resources");
  assert.deepEqual(
    readFileSync(join(resources, "icon.icns")),
    readFileSync(new URL("../../src-tauri/icons/icon.icns", import.meta.url)),
    "Older macOS releases must retain the existing static icon",
  );
  validateMacosIconAssets(
    JSON.parse(
      run("xcrun", ["assetutil", "--info", join(resources, "Assets.car")]),
    ),
  );
  assert.ok(existsSync(join(contents, "MacOS", plist.CFBundleExecutable)));
  return { package: expectedId, iconVariants: 2, staticFallback: true };
}

const checks = { android: checkAndroid, ios: checkIos, macos: checkMacos };

console.log(
  JSON.stringify(
    {
      platform,
      artifact,
      ...checks[platform](),
    },
    null,
    2,
  ),
);
