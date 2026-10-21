// @vitest-environment happy-dom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ clear: vi.fn() }));

vi.mock("~/features/connection-diagnostics/use-execution-logs", () => ({
  useExecutionLogs: () => ({
    operations: [],
    discarded: 0,
    error: null,
    clear: logs.clear,
    recordFailure: vi.fn(),
  }),
}));

import { ActivityProvider } from "./ActivityProvider";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  logs.clear.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function activityProvider(pathname: string) {
  return (
    <StrictMode>
      <ActivityProvider pathname={pathname}>
        <div />
      </ActivityProvider>
    </StrictMode>
  );
}

describe("活动日志清空时机", () => {
  it("离开活动页时丢弃日志，普通导航与尾斜杠不清空", async () => {
    await act(async () => root.render(activityProvider("/")));
    expect(logs.clear).not.toHaveBeenCalled();

    await act(async () => root.render(activityProvider("/activity")));
    expect(logs.clear).not.toHaveBeenCalled();

    await act(async () => root.render(activityProvider("/activity/")));
    expect(logs.clear).not.toHaveBeenCalled();

    await act(async () => root.render(activityProvider("/logs")));
    expect(logs.clear).toHaveBeenCalledTimes(1);

    await act(async () => root.render(activityProvider("/about")));
    expect(logs.clear).toHaveBeenCalledTimes(1);
  });
});
