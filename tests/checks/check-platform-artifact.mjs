import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

import {
  buildPlatform,
  ignoredRoutes,
  platformManifest,
  projectRoot,
  sourceIncluded,
  supports,
} from "../../scripts/platforms.mjs";

const target = buildPlatform(process.env, process.argv[2]);
const root = join(projectRoot, "dist", target);
const reportPath = join(projectRoot, ".tanstack/reports", `${target}.json`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const stamp = JSON.parse(
  readFileSync(join(root, "build-platform.json"), "utf8"),
);
assert.equal(stamp.platform, target);
assert.deepEqual(
  stamp.capabilities,
  Object.keys(platformManifest.capabilities).filter((key) =>
    supports(target, key),
  ),
);
const forbiddenRoutes = ignoredRoutes(target).map(
  (route) => `src/routes/${route}`,
);
for (const module of report.modules)
  assert.ok(
    sourceIncluded(target, module) && !forbiddenRoutes.includes(module),
    `Unexpected module: ${module}`,
  );

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = join(directory, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}

const artifactFiles = files(root);

for (const file of files(join(projectRoot, "public"))) {
  const name = relative(join(projectRoot, "public"), file).replaceAll(
    "\\",
    "/",
  );
  const included = platformManifest.resources.some((resource) =>
    resource.endsWith("/") ? name.startsWith(resource) : name === resource,
  );
  if (included)
    assert.deepEqual(
      readFileSync(join(root, name)),
      readFileSync(file),
      `Resource mismatch: ${name}`,
    );
  else
    assert.ok(
      !artifactFiles.includes(join(root, name)),
      `Unowned public resource: ${name}`,
    );
}
report.files = artifactFiles.map((file) => {
  const bytes = readFileSync(file);
  return {
    name: relative(root, file).replaceAll("\\", "/"),
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
report.totalBytes = report.files.reduce((sum, file) => sum + file.bytes, 0);
report.totalGzipBytes = report.files.reduce(
  (sum, file) => sum + file.gzipBytes,
  0,
);
report.verified = true;
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `${target}: ${report.modules.length} modules, ${report.files.length} files, ${report.totalBytes} bytes; modules and resources verified`,
);
