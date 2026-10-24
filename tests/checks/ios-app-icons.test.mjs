import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const apple = new URL("../../src-tauri/gen/apple/", import.meta.url);

test("iOS 主图标包含默认和系统深色变体而非备用图标", () => {
  const asset = new URL("Assets.xcassets/AppIcon.appiconset/", apple);
  const { images } = JSON.parse(
    readFileSync(new URL("Contents.json", asset), "utf8"),
  );
  assert.equal(images.length, 2);
  assert.equal(images.filter((image) => !image.appearances).length, 1);
  assert.equal(
    images.filter((image) =>
      image.appearances?.some(
        (appearance) =>
          appearance.appearance === "luminosity" && appearance.value === "dark",
      ),
    ).length,
    1,
  );
  for (const image of images) {
    assert.equal(image.idiom, "universal");
    assert.equal(image.platform, "ios");
    assert.equal(image.size, "1024x1024");
    assert.ok(existsSync(new URL(image.filename, asset)));
  }
  assert.equal(
    existsSync(new URL("Assets.xcassets/AppIconDark.appiconset", apple)),
    false,
  );
  for (const path of ["project.yml", "mftp_iOS/Info.plist"]) {
    const text = readFileSync(new URL(path, apple), "utf8");
    assert.ok(!text.includes("CFBundleAlternateIcons"));
    assert.ok(!text.includes("ALTERNATE_APPICON_NAMES"));
  }
});
