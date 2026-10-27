import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { JunqiOnlineController } from "./online-controller";
import { parseJunqiFrame } from "./online-protocol";
import { flush, pair } from "./online-test-support";
import { canRequestUndo } from "./online-undo";
import type { JunqiVariant } from "./types";
import { viewActions } from "./visibility";

beforeAll(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

async function playing(p: ReturnType<typeof pair>) {
  await flush();
  if (p.host.getSnapshot().view?.phase === "deployment") {
    p.host.submit({ type: "ready" });
    await flush();
    p.guest.submit({ type: "ready" });
    await flush();
  }
}

async function play(controller: JunqiOnlineController) {
  const view = controller.getSnapshot().view!;
  const action = viewActions(view)[0];
  expect(action).toBeDefined();
  controller.submit(action);
  await flush();
  expect(controller.getSnapshot().view?.ply).toBe(view.ply + 1);
}

const cases = (["open", "hidden", "flip"] as JunqiVariant[]).flatMap(
  (variant) =>
    (["host", "guest"] as const).flatMap((requester) =>
      ([1, 2] as const).map((plies) => ({ variant, requester, plies })),
    ),
);

describe("军棋联机协商悔棋", () => {
  it.each(cases)(
    "$variant 的 $requester 请求撤销 $plies 手，双方回退后继续",
    async ({ variant, requester, plies }) => {
      const p = pair(variant);
      try {
        await playing(p);
        if (requester === "guest") await play(p.host);
        const local = p[requester],
          peer = requester === "host" ? p.guest : p.host;
        const before = [
          p.host.getSnapshot().view!,
          p.guest.getSnapshot().view!,
        ];
        await play(local);
        if (plies === 2) await play(peer);
        const revision = local.getSnapshot().view!.revision;
        expect(canRequestUndo(local.getSnapshot())).toBe(true);
        local.requestUndo();
        await flush();
        expect(peer.getSnapshot().undo?.request.plies).toBe(plies);
        expect(canRequestUndo(peer.getSnapshot())).toBe(false);
        peer.submit(viewActions(peer.getSnapshot().view!)[0]);
        await flush();
        expect(peer.getSnapshot().view?.revision).toBe(revision);
        peer.respondUndo(true);
        await flush();
        [p.host, p.guest].forEach((controller, index) => {
          expect(controller.getSnapshot().view).toEqual({
            ...before[index],
            revision: revision + 1,
          });
          expect(controller.getSnapshot().undo).toBeNull();
          expect(controller.getSnapshot().pending).toBe(false);
        });
        await play(local);
        expect(p.guest.getSnapshot().view?.revision).toBe(
          p.host.getSnapshot().view?.revision,
        );
      } finally {
        p.dispose();
      }
    },
  );

  it("布阵、尚未走棋及终局不能悔棋，新局不保留历史", async () => {
    const p = pair("hidden");
    try {
      await flush();
      p.host.requestUndo();
      expect(p.host.getSnapshot().undo).toBeNull();
      await playing(p);
      expect(canRequestUndo(p.host.getSnapshot())).toBe(false);
      await play(p.host);
      expect(canRequestUndo(p.guest.getSnapshot())).toBe(false);
      p.guest.submit({ type: "concede" });
      await flush();
      p.host.requestUndo();
      expect(p.host.getSnapshot().undo).toBeNull();
      p.host.requestRematch();
      await flush();
      p.guest.respondRematch(true);
      await flush();
      expect(p.host.getSnapshot().undoDepth).toBe(0);
      expect(p.guest.getSnapshot().undoDepth).toBe(0);
      p.guest.submit({ type: "ready" });
      await flush();
      p.host.submit({ type: "ready" });
      await flush();
      await play(p.guest);
      p.guest.requestUndo();
      await flush();
      p.host.respondUndo(true);
      await flush();
      expect(p.guest.getSnapshot().view?.ply).toBe(0);
      expect(p.guest.getSnapshot().localSeat).toBe(0);
    } finally {
      p.dispose();
    }
  });

  it("拒绝后可以重新请求，重复请求和确认不会再次撤销", async () => {
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      p.host.requestUndo();
      await flush();
      const old = p.guest.getSnapshot().undo!.request;
      p.guest.respondUndo(false);
      await flush();
      expect(p.host.getSnapshot().undoNotice?.kind).toBe("declined");
      await p.channels[0].sendMessage(old);
      await flush();
      expect(p.guest.getSnapshot().undo).toBeNull();
      p.host.requestUndo();
      await flush();
      const current = p.guest.getSnapshot().undo!.request;
      p.guest.respondUndo(true);
      p.guest.respondUndo(true);
      await flush();
      const before = p.host.getSnapshot().view;
      await p.channels[1].sendMessage({
        ...current,
        t: "undo-response",
        accept: true,
      });
      await p.channels[0].sendMessage(current);
      await flush();
      expect(p.host.getSnapshot().view).toEqual(before);
      expect(p.guest.getSnapshot().view?.ply).toBe(0);
      expect(p.guest.getSnapshot().view?.viewerSide).toBeNull();
      expect(
        p.guest
          .getSnapshot()
          .view?.board.filter(Boolean)
          .every((piece) => piece?.face === "covered" && piece.side === null),
      ).toBe(true);
    } finally {
      p.dispose();
    }
  });

  it("同时申请互相拒绝，随后仍可正常申请", async () => {
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      await play(p.guest);
      p.host.requestUndo();
      p.guest.requestUndo();
      await flush();
      expect(p.host.getSnapshot().undo).toBeNull();
      expect(p.guest.getSnapshot().undo).toBeNull();
      expect(p.host.getSnapshot().view?.ply).toBe(2);
      p.guest.requestUndo();
      await flush();
      p.host.respondUndo(true);
      await flush();
      expect(p.host.getSnapshot().view?.ply).toBe(1);
    } finally {
      p.dispose();
    }
  });

  it("房主落子与访客申请交叉时旧请求失效，不能撤销新走法", async () => {
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      await play(p.guest);
      p.host.submit(viewActions(p.host.getSnapshot().view!)[0]);
      p.guest.requestUndo();
      await flush();
      expect(p.host.getSnapshot().view?.ply).toBe(3);
      expect(p.guest.getSnapshot().view?.ply).toBe(3);
      expect(p.host.getSnapshot().undo).toBeNull();
      expect(p.guest.getSnapshot().undo).toBeNull();
      expect(p.guest.getSnapshot().undoNotice?.kind).toBe("stale");
    } finally {
      p.dispose();
    }
  });

  it("回退前的快照、旧修订动作与旧局请求不能覆盖回退结果", async () => {
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      await play(p.guest);
      const oldState = [...p.wire]
        .reverse()
        .find((entry) => entry.frame.t === "state")!.frame;
      const oldAction = [...p.wire]
        .reverse()
        .find((entry) => entry.frame.t === "action")!.frame;
      p.guest.requestUndo();
      await flush();
      const request = p.host.getSnapshot().undo!.request;
      p.host.respondUndo(true);
      await flush();
      const before = p.guest.getSnapshot().view;
      await p.channels[0].sendMessage(oldState);
      if (oldAction.t !== "action") throw new Error("Missing action");
      await p.channels[1].sendMessage({ ...oldAction, requestId: 999 });
      await p.channels[1].sendMessage({
        ...request,
        round: 99,
        requestId: 1000,
      });
      await flush();
      expect(p.guest.getSnapshot().view).toEqual(before);
      expect(p.host.getSnapshot().view?.ply).toBe(before?.ply);
      expect(p.host.getSnapshot().undo).toBeNull();
    } finally {
      p.dispose();
    }
  });

  it("同意后等待新投影，旧的同修订同步帧不能解锁", async () => {
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      const oldState = [...p.wire]
        .reverse()
        .find((entry) => entry.frame.t === "state")!.frame;
      p.host.requestUndo();
      await flush();
      const send = p.channels[0].sendMessage.bind(p.channels[0]);
      let release: (() => void) | undefined;
      vi.spyOn(p.channels[0], "sendMessage").mockImplementation(
        async (frame) => {
          if (frame.t === "state")
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          await send(frame);
        },
      );
      p.guest.respondUndo(true);
      await flush();
      expect(p.guest.getSnapshot().pending).toBe(true);
      await send(oldState);
      await flush();
      expect(p.guest.getSnapshot().pending).toBe(true);
      expect(p.guest.getSnapshot().undo).not.toBeNull();
      release?.();
      await flush();
      expect(p.guest.getSnapshot().pending).toBe(false);
      expect(p.guest.getSnapshot().undo).toBeNull();
    } finally {
      p.dispose();
    }
  });

  it("错误回退范围的响应不能确认，协商超时停止且不重发", async () => {
    vi.useFakeTimers();
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      p.host.requestUndo();
      await flush();
      const request = p.guest.getSnapshot().undo!.request;
      await p.channels[1].sendMessage({
        ...request,
        t: "undo-response",
        plies: 2,
        accept: true,
      });
      await flush();
      expect(p.host.getSnapshot().view?.ply).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(p.host.getSnapshot().end).toBe("timeout");
      expect(p.guest.getSnapshot().end).toBe("timeout");
      expect(p.host.getSnapshot().undo).toBeNull();
      expect(
        p.wire.filter((entry) => entry.frame.t === "undo-request"),
      ).toHaveLength(1);
    } finally {
      p.dispose();
      vi.useRealTimers();
    }
  });

  it("同意发送失败和断线不会继续回退或重发", async () => {
    const p = pair("flip");
    try {
      await playing(p);
      await play(p.host);
      p.host.requestUndo();
      await flush();
      const send = vi.spyOn(p.channels[1], "sendMessage").mockRejectedValue({
        kind: "external",
        code: "io:closed",
        message: "closed",
        args: {},
      });
      p.guest.respondUndo(true);
      await flush();
      p.guest.respondUndo(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(p.guest.getSnapshot().end).toBe("send-failed");
      expect(p.host.getSnapshot().view?.ply).toBe(1);
      p.disconnect();
      expect(p.host.getSnapshot().end).toBe("peer-left");
      expect(p.host.getSnapshot().undo).toBeNull();
    } finally {
      p.dispose();
    }
  });

  it("严格拒绝不合法手数和附加隐藏数据", () => {
    const frame = {
      v: 1,
      matchId: "test",
      round: 0,
      t: "undo-request",
      revision: 1,
      requestId: 1,
      plies: 1,
    };
    expect(parseJunqiFrame(frame)).not.toBeNull();
    for (const plies of [0, 3, -1, 1.5])
      expect(parseJunqiFrame({ ...frame, plies })).toBeNull();
    expect(parseJunqiFrame({ ...frame, history: [] })).toBeNull();
    expect(parseJunqiFrame({ ...frame, seed: 9 })).toBeNull();
  });
});
