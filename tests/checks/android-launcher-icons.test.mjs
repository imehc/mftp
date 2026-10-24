import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const resources = new URL(
  "../../src-tauri/gen/android/app/src/main/res/",
  import.meta.url,
);

test("系统应用信息图标与浅色桌面图标共用同一套留白资源", () => {
  const manifest = readFileSync(
    new URL(
      "../../src-tauri/gen/android/app/src/main/AndroidManifest.xml",
      import.meta.url,
    ),
    "utf8",
  );
  const application = manifest.match(/<application\s[^>]*>/)?.[0];
  assert.ok(application?.includes('android:icon="@mipmap/ic_launcher"'));
  const aliases = [...manifest.matchAll(/<activity-alias\s[^>]*>/g)];
  assert.equal(aliases.length, 2);
  for (const [alias] of aliases) {
    assert.ok(alias.includes('android:icon="@mipmap/ic_launcher"'));
  }
  const primary = readFileSync(
    new URL("mipmap-anydpi-v26/ic_launcher.xml", resources),
    "utf8",
  );
  const light = readFileSync(
    new URL("mipmap-anydpi-v26/ic_launcher_light.xml", resources),
    "utf8",
  );
  assert.equal(primary, light);
});

for (const [theme, background] of [
  ["light", "#F5F8FF"],
  ["dark", "#171923"],
]) {
  test(`${theme} 启动图标使用原生安全留白且保留各密度 PNG`, () => {
    const xml = readFileSync(
      new URL(`mipmap-anydpi-v26/ic_launcher_${theme}.xml`, resources),
      "utf8",
    );
    const foreground = xml.match(/<foreground>([\s\S]*?)<\/foreground>/)?.[1];
    assert.ok(foreground, "前景必须通过原生 drawable 增加留白");
    assert.ok(foreground.includes(`@mipmap/ic_launcher_${theme}_foreground`));
    const inset = Number(foreground.match(/android:inset="([\d.]+)%"/)?.[1]);
    assert.ok(Math.abs(inset - 100 / 6) < 0.00001);
    assert.ok(xml.includes(`@color/ic_launcher_${theme}_background`));
    const systemFolder =
      theme === "dark" ? "mipmap-night-anydpi-v26" : "mipmap-anydpi-v26";
    assert.equal(
      readFileSync(
        new URL(`${systemFolder}/ic_launcher.xml`, resources),
        "utf8",
      ),
      xml,
    );
    const color = readFileSync(
      new URL(`values/ic_launcher_${theme}_background.xml`, resources),
      "utf8",
    );
    assert.ok(color.includes(`>${background}</color>`));
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      const systemDensity = `mipmap-${theme === "dark" ? "night-" : ""}${density}`;
      for (const suffix of ["", "_round", "_foreground"]) {
        assert.deepEqual(
          readFileSync(
            new URL(`${systemDensity}/ic_launcher${suffix}.png`, resources),
          ),
          readFileSync(
            new URL(
              `mipmap-${density}/ic_launcher_${theme}${suffix}.png`,
              resources,
            ),
          ),
        );
      }
      assert.ok(
        existsSync(
          new URL(
            `mipmap-${density}/ic_launcher_${theme}_foreground.png`,
            resources,
          ),
        ),
      );
    }
  });
}
