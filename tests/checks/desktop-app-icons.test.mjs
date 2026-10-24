import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateMacosIconAssets } from "../../scripts/macos-icons.mjs";

function read(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

function catalog() {
  return [
    ...["NSAppearanceNameAqua", "NSAppearanceNameDarkAqua"].map(
      (Appearance) => ({
        AssetType: "IconImageStack",
        Name: "AppIcon",
        Appearance,
      }),
    ),
    ...["light", "dark"].map((theme) => ({
      AssetType: "Image",
      Name: `AppIcon_Assets/app-${theme}-icon`,
      PixelWidth: 1024,
      PixelHeight: 1024,
      SizeOnDisk: 100,
      SHA1Digest: theme,
    })),
  ];
}

test("编译资源必须包含原生明暗栈与两个独立位图", () => {
  assert.doesNotThrow(() => validateMacosIconAssets(catalog()));
  for (const index of [0, 1, 2, 3]) {
    assert.throws(() =>
      validateMacosIconAssets(
        catalog().filter((_, position) => index !== position),
      ),
    );
  }
  const duplicate = catalog();
  duplicate[3].SHA1Digest = duplicate[2].SHA1Digest;
  assert.throws(() => validateMacosIconAssets(duplicate), /distinct/);
  const lowResolution = catalog();
  lowResolution[3].PixelWidth = 32;
  assert.throws(() => validateMacosIconAssets(lowResolution), /original/);
});

test("源图层在默认和深色外观中互斥，不重绘用户图像", () => {
  const source = read("../../src-tauri/icons/macos/icon.json");
  const layers = source.groups.flatMap((group) => group.layers);
  assert.equal(layers.length, 2);
  for (const [index, theme] of ["light", "dark"].entries()) {
    assert.equal(layers[index]["image-name"], `app-${theme}-icon.png`);
    assert.equal(layers[index].glass, false);
    assert.deepEqual(layers[index].position, {
      scale: 0.84,
      "translation-in-points": [0, 0],
    });
    assert.deepEqual(layers[index]["opacity-specializations"], [
      { value: index === 0 ? 1 : 0 },
      { appearance: "dark", value: index === 0 ? 0 : 1 },
    ]);
  }
});

test("Apple 编译钩子和资源仅进入 macOS，保留静态兼容图标", () => {
  const base = read("../../src-tauri/tauri.conf.json");
  assert.equal(base.bundle.macOS.minimumSystemVersion, "10.15");
  assert.ok(!JSON.stringify(base).includes("Assets.car"));
  for (const platform of ["macos", "windows", "linux", "android", "ios"]) {
    const config = read(`../../src-tauri/tauri.${platform}.conf.json`);
    if (platform === "macos") {
      assert.equal(
        config.build.beforeBundleCommand,
        "node scripts/macos-icons.mjs",
      );
      assert.ok(config.bundle.icon.includes("icons/icon.icns"));
      assert.ok(
        config.bundle.icon.includes("icons/.generated/macos/Assets.car"),
      );
    } else {
      assert.ok(!JSON.stringify(config).includes("macos-icons"));
      assert.ok(!JSON.stringify(config).includes("Assets.car"));
    }
  }
});
