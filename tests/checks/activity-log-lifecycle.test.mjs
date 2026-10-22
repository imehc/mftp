import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(
  new URL("../../src-tauri/src/app/mod.rs", import.meta.url),
  "utf8",
);
const events = app.slice(
  app.indexOf("fn on_run_event("),
  app.indexOf("fn shutdown("),
);

test("主窗口销毁清空诊断，辅助窗口销毁不释放全局日志", () => {
  assert.match(
    events,
    /WindowEvent::Destroyed[\s\S]*?if label == "main"\s*\{\s*state\.diagnostics\.clear\(\);\s*\}/,
  );
});

test("退出请求在完成判断之前清空诊断，最终退出再次兜底", () => {
  assert.match(
    events,
    /RunEvent::ExitRequested \{ api, code, \.\. \} => \{\s*state\.diagnostics\.clear\(\);[\s\S]*?if state\.lifecycle\.is_finished\(\)/,
  );
  assert.match(
    events,
    /RunEvent::Exit => \{\s*state\.diagnostics\.clear\(\);[\s\S]*?shutdown\(app, &state\.lifecycle, None\)/,
  );
  assert.doesNotMatch(
    events,
    /activity_logs_clear|clear_activity_logs|state\.storage\./,
  );
});
