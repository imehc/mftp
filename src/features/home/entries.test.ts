import { expect, it } from "vitest";

import {
  availableHomeEntries,
  homeEntriesForPlatform,
  orderedHomeEntries,
} from "./entries";

it("会话入口只对 macOS 开放且仍保留共享桌面工具", () => {
  expect(
    homeEntriesForPlatform("macos").some(
      (entry) => entry.id === "agent-sessions",
    ),
  ).toBe(true);
  expect(
    homeEntriesForPlatform("macos").some(
      (entry) => entry.id === "lan-transfer",
    ),
  ).toBe(true);
  for (const platform of [
    "windows",
    "linux",
    "desktop",
    "android",
    "ios",
  ] as const)
    expect(
      homeEntriesForPlatform(platform).some(
        (entry) => entry.id === "agent-sessions",
      ),
    ).toBe(false);
});

it("按用户顺序排列入口并将新增入口追加在默认顺序后", () => {
  const defaults = availableHomeEntries.filter(
    (entry) => entry.category === "tools",
  );
  const reversed = [...defaults].reverse();
  const ordered = orderedHomeEntries(
    "tools",
    ["removed-entry", ...reversed.map((entry) => entry.id)],
    availableHomeEntries,
  );

  expect(ordered.map((entry) => entry.id)).toEqual(
    reversed.map((entry) => entry.id),
  );
});

it("忽略其他分类保存的入口 ID", () => {
  const ordered = orderedHomeEntries(
    "library",
    ["billiards", "library"],
    availableHomeEntries,
  );

  expect(ordered.map((entry) => entry.id)).toEqual(["library"]);
});
