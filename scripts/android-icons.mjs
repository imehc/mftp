import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const source = readFileSync(join(root, "public/app-icon.png")).toString(
  "base64",
);
// Android 的 108dp 前景只有中央约 72dp 可见；将完整原图放入可见区，
// 避免启动器裁切原图的留白。背景填满外圈供启动器遮罩和视差使用。
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="108" height="108" viewBox="0 0 108 108">
  <rect width="108" height="108" fill="#030913"/>
  <image x="18" y="18" width="72" height="72" xlink:href="data:image/png;base64,${source}"/>
</svg>`;
const svg = join(work, "foreground.svg");
writeFileSync(svg, foreground);
const res = join(root, "src-tauri/gen/android/app/src/main/res");
for (const [density, size] of [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
]) {
  execFileSync(
    process.execPath,
    [cli, "icon", svg, "--png", String(size), "--output", work],
    { cwd: root, stdio: "inherit" },
  );
  const target = join(res, `mipmap-${density}`);
  mkdirSync(target, { recursive: true });
  copyFileSync(
    join(work, `${size}x${size}.png`),
    join(target, "ic_launcher_foreground.png"),
  );
}
console.log(`Android adaptive foregrounds regenerated. Working files: ${work}`);
