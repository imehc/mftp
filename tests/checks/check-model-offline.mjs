import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(import.meta.url);
const installed = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(require.resolve("three")), "../package.json"),
    "utf8",
  ),
).version;
const root = path.resolve(
  process.argv[2] ?? path.join(project, "public/model-decoders"),
);
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(project, "package.json"), "utf8"),
  );
  if (
    manifest.three !== installed ||
    packageJson.dependencies.three !== installed
  )
    throw new Error("Three.js and offline decoder versions differ");
  const workspace = fs.readFileSync(
    path.join(project, "pnpm-workspace.yaml"),
    "utf8",
  );
  if (
    !workspace.includes(
      `three@${installed}: patches/three@${installed}.patch`,
    ) ||
    !fs.existsSync(path.join(project, `patches/three@${installed}.patch`))
  )
    throw new Error("Three.js patch target is missing or mismatched");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep))
      throw new Error("Invalid manifest path");
    const actual = createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    if (actual !== expected)
      throw new Error(`Offline decoder hash mismatch: ${name}`);
  }
  for (const name of [
    "draco/draco_decoder.wasm",
    "draco/draco_wasm_wrapper.js",
    "basis/basis_transcoder.wasm",
    "basis/basis_transcoder.js",
    "THREE-LICENSE.txt",
  ]) {
    if (!manifest.files[name])
      throw new Error(`Offline decoder missing from manifest: ${name}`);
  }
  console.log(
    `Offline decoders verified: Three.js ${installed}, ${Object.keys(manifest.files).length} files, matching patch and licenses.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
