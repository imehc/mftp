// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  GameHeaderActions,
  GameHeaderActionsProvider,
  GameHeaderActionsSlot,
  GameMenuActionsSlot,
  useGameHeaderAction,
} from "./GameHeaderActions";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Action({ run }: { run(): void }) {
  const invoke = useGameHeaderAction();
  return <button onClick={() => invoke(run)}>悔棋</button>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("对局更新后标题栏使用最新动作，退出对局移除动作", async () => {
  const previous = vi.fn();
  const current = vi.fn();
  const view = (run?: () => void) => (
    <GameHeaderActionsProvider>
      <GameHeaderActionsSlot />
      {run ? (
        <GameHeaderActions>
          <Action run={run} />
        </GameHeaderActions>
      ) : null}
    </GameHeaderActionsProvider>
  );
  await act(async () => root.render(view(previous)));
  await act(async () => root.render(view(current)));
  await act(async () => host.querySelector("button")?.click());
  expect(previous).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
  await act(async () => root.render(view()));
  expect(host.querySelector("button")).toBeNull();
});

it("菜单中的动作等待菜单关闭，重新打开不沿用旧动作", async () => {
  let pending: (() => void) | undefined;
  const closeThen = vi.fn((action: () => void) => {
    pending = action;
  });
  const first = vi.fn();
  const second = vi.fn();
  const view = (open: boolean, run: () => void) => (
    <GameHeaderActionsProvider>
      {open ? <GameMenuActionsSlot closeThen={closeThen} /> : null}
      <GameHeaderActions menu>
        <Action run={run} />
      </GameHeaderActions>
    </GameHeaderActionsProvider>
  );
  await act(async () => root.render(view(true, first)));
  await act(async () => host.querySelector("button")?.click());
  expect(closeThen).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  await act(async () => root.render(view(false, first)));
  expect(host.querySelector("button")).toBeNull();
  pending?.();
  expect(first).toHaveBeenCalledOnce();
  await act(async () => root.render(view(true, second)));
  await act(async () => host.querySelector("button")?.click());
  pending?.();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});
