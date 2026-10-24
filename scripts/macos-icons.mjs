import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const macosIconName = "AppIcon";

export function validateMacosIconAssets(entries) {
  for (const appearance of [
    "NSAppearanceNameAqua",
    "NSAppearanceNameDarkAqua",
  ]) {
    if (
      !entries.some(
        (entry) =>
          entry.AssetType === "IconImageStack" &&
          entry.Name === macosIconName &&
          entry.Appearance === appearance,
      )
    ) {
      throw new Error(`Missing native ${appearance} app icon stack.`);
    }
  }
  const images = ["light", "dark"].map((theme) =>
    entries.find(
      (entry) =>
        entry.AssetType === "Image" &&
        entry.Name === `${macosIconName}_Assets/app-${theme}-icon` &&
        entry.PixelWidth >= 1024 &&
        entry.PixelHeight >= 1024 &&
        entry.SizeOnDisk > 0 &&
        entry.SHA1Digest,
    ),
  );
  if (images.some((image) => !image)) {
    throw new Error(
      "Both original app icon images must be present in Assets.car.",
    );
  }
  if (images[0].SHA1Digest === images[1].SHA1Digest) {
    throw new Error("Light and dark app icon resources must be distinct.");
  }
}

export function prepareMacosIcons() {
  if (process.platform !== "darwin") {
    throw new Error(
      "Native macOS app icons require macOS and Xcode 26 or newer.",
    );
  }
  const version = execFileSync(
    "xcrun",
    ["actool", "--version", "--output-format", "human-readable-text"],
    { encoding: "utf8" },
  );
  const major = Number(version.match(/short-bundle-version:\s*(\d+)/)?.[1]);
  if (!(major >= 26)) {
    throw new Error("Native macOS app icons require Xcode 26 or newer.");
  }
  const work = mkdtempSync(join(tmpdir(), "mftp-macos-icons-"));
  try {
    const source = join(work, `${macosIconName}.icon`);
    const assets = join(source, "Assets");
    const compiled = join(work, "compiled");
    mkdirSync(assets, { recursive: true });
    mkdirSync(compiled);
    copyFileSync(
      join(root, "src-tauri/icons/macos/icon.json"),
      join(source, "icon.json"),
    );
    for (const theme of ["light", "dark"]) {
      const filename = `app-${theme}-icon.png`;
      copyFileSync(join(root, "public", filename), join(assets, filename));
    }
    execFileSync(
      "xcrun",
      [
        "actool",
        source,
        "--compile",
        compiled,
        "--platform",
        "macosx",
        "--minimum-deployment-target",
        "26.0",
        "--app-icon",
        macosIconName,
        "--output-partial-info-plist",
        join(work, "icon-info.plist"),
      ],
      { stdio: "inherit" },
    );
    const car = join(compiled, "Assets.car");
    const entries = JSON.parse(
      execFileSync("xcrun", ["assetutil", "--info", car], { encoding: "utf8" }),
    );
    validateMacosIconAssets(entries);
    const output = join(root, "src-tauri/icons/.generated/macos");
    mkdirSync(output, { recursive: true });
    copyFileSync(car, join(output, "Assets.car"));
    console.log("Native macOS light/dark icons compiled and verified.");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    prepareMacosIcons();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
