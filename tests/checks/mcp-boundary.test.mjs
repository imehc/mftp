import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("MCP 通用层不依赖待办且模块只有统一登记入口", () => {
  for (const file of readdirSync(new URL("src-tauri/src/modules/mcp/", root))) {
    if (
      file.endsWith(".rs") &&
      file !== "tests.rs" &&
      !file.endsWith("_tests.rs")
    ) {
      const source = read(`src-tauri/src/modules/mcp/${file}`);
      assert.doesNotMatch(
        source,
        /modules::todo|todo_items|TodoRepository|TodoContext/,
      );
    }
  }
  const registration = read("src-tauri/src/app/registry/mcp.rs");
  assert.match(
    registration,
    /Registry::new\(vec!\[mcp::registration\(todo\)\?\]\)/,
  );
});

test("MCP 服务和 SDK 独占依赖在移动构建时排除", () => {
  const manifest = read("src-tauri/Cargo.toml");
  let section = "";
  for (const line of manifest.split("\n")) {
    if (line.startsWith("[")) section = line;
    if (line.startsWith("rmcp =")) {
      assert.match(
        section,
        /cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)/,
      );
      assert.match(line, /version = "=3\.6\.0"/);
      assert.match(line, /default-features = false/);
    }
  }
  assert.match(
    read("src-tauri/src/modules/mod.rs"),
    /#\[cfg\(desktop\)\]\s*pub\(crate\) mod mcp;/,
  );
  assert.match(
    read("src-tauri/src/modules/todo/mod.rs"),
    /#\[cfg\(desktop\)\]\s*pub\(crate\) mod mcp;/,
  );
  assert.match(
    read("src-tauri/src/app/registry/command_baseline.txt"),
    /^desktop mcp_module_catalog$/m,
  );
  assert.doesNotMatch(
    read("src-tauri/src/app/registry/command_baseline.txt"),
    /^common mcp_/m,
  );
});

test("工具调用不复用任意 IPC 或暴露文件路径入口", () => {
  const handler = read("src-tauri/src/modules/mcp/handler.rs");
  assert.match(handler, /authorized_caller\(\)/);
  assert.doesNotMatch(handler, /invoke|generate_handler|Storage|Command::new/);
  const todo = read("src-tauri/src/modules/todo/mcp/mod.rs");
  assert.match(todo, /blocking_unlogged/);
  assert.doesNotMatch(todo, /std::fs|reqwest|arboard|note_clipboard/);
});
