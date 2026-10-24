import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const directory = new URL("../../src-tauri/capabilities/", import.meta.url);

test("各平台均不授予运行时窗口换图权限", () => {
  const permissions = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, directory), "utf8")))
    .filter((capability) =>
      capability.permissions.some(
        (permission) =>
          (typeof permission === "string"
            ? permission
            : permission.identifier) === "core:window:allow-set-icon",
      ),
    );
  assert.deepEqual(permissions, []);
});
