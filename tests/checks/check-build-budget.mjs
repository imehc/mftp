import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { buildPlatform } from "../../scripts/platforms.mjs";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const root = path.resolve(
  process.argv[2] ?? path.join(project, "dist", buildPlatform()),
);
const budget = JSON.parse(
  fs.readFileSync(path.join(project, "tests/checks/build-budget.json"), "utf8"),
);
try {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // 仅统计 HTML 声明的入口、预加载 JS 和样式，不冒称全部网络流量或启动耗时。
  const initial = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (!initial.some((name) => name.endsWith(".js")))
    throw new Error("Missing build entry");
  const read = (name) => {
    const file = path.resolve(root, name.replace(/^\//, ""));
    if (!file.startsWith(root + path.sep))
      throw new Error("Invalid build resource path");
    return fs.readFileSync(file);
  };
  const initialGzip = initial.reduce(
    (sum, name) => sum + gzipSync(read(name)).length,
    0,
  );
  for (const name of initial) {
    if (
      budget.lazyChunks.some((chunk) =>
        path.basename(name).startsWith(chunk + "-"),
      )
    )
      throw new Error(`Heavy lazy chunk in HTML preload: ${name}`);
  }
  let javascript = 0;
  let fonts = 0;
  for (const file of fs.readdirSync(path.join(root, "assets"), {
    recursive: true,
  })) {
    const full = path.join(root, "assets", file);
    if (!fs.statSync(full).isFile()) continue;
    const size = fs.statSync(full).size;
    if (file.endsWith(".js")) javascript += size;
    if (/\.woff2?$/.test(file)) fonts += size;
  }
  const metrics = { initialGzip, javascript, fonts };
  for (const [name, bytes] of Object.entries(metrics)) {
    if (bytes > budget.limits[name])
      throw new Error(
        `${name} exceeds build budget: ${bytes} > ${budget.limits[name]}`,
      );
  }
  console.log(
    JSON.stringify(
      { metrics, limits: budget.limits, initialFiles: initial.length },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
