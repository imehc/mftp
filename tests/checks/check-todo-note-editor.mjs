import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "vite";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = await mkdtemp(join(tmpdir(), "mftp-todo-note-editor-"));
const page = "tests/checks/fixtures/todo-notes/index.html";
await build({
  configFile: join(project, "vite.config.ts"),
  build: {
    outDir: output,
    emptyOutDir: false,
    rolldownOptions: {
      input: join(project, page),
    },
  },
});
const html = await readFile(join(output, page), "utf8");
const assets = await readdir(join(output, "assets"));
const editorChunk = assets.find((file) =>
  /^vendor-todo-editor-.*\.js$/.test(file),
);
assert.ok(editorChunk, "Missing isolated editor chunk");
assert.ok(!html.includes("vendor-todo-editor-"), "Editor must load on demand");
const bytes = await readFile(join(output, "assets", editorChunk));
const result = {
  output,
  page: `/${page}`,
  editorBytes: bytes.length,
  editorGzipBytes: gzipSync(bytes).length,
};
console.log(JSON.stringify(result, null, 2));
