import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { JunqiOnlineController } from "./online-controller";
import { parseJunqiFrame } from "./online-protocol";
import { flush, pair } from "./online-test-support";
import { viewActions } from "./visibility";

beforeAll(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

describe("军棋权威联机协议", () => {
  it.each([
    { variant: "open", name: "明棋" },
    { variant: "hidden", name: "暗棋" },
    { variant: "flip", name: "翻棋" },
  ] as const)(
    "$name双方独立操作，确认结果一致并协商重赛交换先后手",
    async ({ variant }) => {
      const p = pair(variant);
      try {
        await flush();
        expect(p.guest.getSnapshot().view?.variant).toBe(variant);
        if (variant !== "flip") {
          p.host.submit({ type: "ready" });
          await flush();
          p.guest.submit({ type: "ready" });
          await flush();
        }
        const first = p.host.getSnapshot().view!;
        p.host.submit(viewActions(first)[0]);
        await flush();
        expect(p.guest.getSnapshot().view?.revision).toBe(
          p.host.getSnapshot().view?.revision,
        );
        p.guest.submit({ type: "concede" });
        await flush();
        expect(p.host.getSnapshot().view?.phase).toBe("finished");
        expect(p.guest.getSnapshot().view?.winner).toBe(
          p.host.getSnapshot().view?.winner,
        );
        p.host.requestRematch();
        await flush();
        expect(p.guest.getSnapshot().rematch?.direction).toBe("incoming");
        p.guest.respondRematch(true);
        await flush();
        expect(p.host.getSnapshot().round).toBe(1);
        expect(p.guest.getSnapshot().round).toBe(1);
        expect(p.host.getSnapshot().localSeat).toBe(1);
        expect(p.guest.getSnapshot().localSeat).toBe(0);
        expect(p.host.getSnapshot().view?.revision).toBe(0);
      } finally {
        p.dispose();
      }
    },
  );

  it("暗棋只发送访客可见投影，真值种子和房主身份不进入状态帧", async () => {
    const p = pair("hidden");
    try {
      await flush();
      p.host.submit({ type: "arrange" });
      await flush();
      const frames = p.wire.filter(
        (entry) => entry.sender === 0 && entry.frame.t === "state",
      );
      expect(frames.length).toBeGreaterThan(1);
      for (const { frame } of frames) {
        if (frame.t !== "state") continue;
        expect(
          frame.view.board
            .filter((piece) => piece?.side === 0)
            .every((piece) => piece?.face === "covered" && !("kind" in piece)),
        ).toBe(true);
        expect(
          frame.view.board.filter((piece) => piece?.face === "known"),
        ).toHaveLength(25);
        expect(frame.view).not.toHaveProperty("seed");
        expect(frame.view).not.toHaveProperty("positions");
        expect(frame.view).not.toHaveProperty("lastAction");
      }
    } finally {
      p.dispose();
    }
  });

  it("重复、过期修订和越权请求不再执行动作，断线不产生胜负", async () => {
    const p = pair("hidden");
    try {
      await flush();
      p.host.submit({ type: "ready" });
      await flush();
      p.guest.submit({ type: "ready" });
      await flush();
      const sent = p.wire.find(
        (entry) => entry.sender === 1 && entry.frame.t === "action",
      )!.frame;
      const before = p.host.getSnapshot().view;
      await p.channels[1].sendMessage(sent);
      await flush();
      expect(p.host.getSnapshot().view).toEqual(before);
      if (sent.t !== "action") throw new Error("Missing action frame");
      await p.channels[1].sendMessage({
        ...sent,
        requestId: sent.requestId + 1,
      });
      await flush();
      expect(p.host.getSnapshot().view).toEqual(before);
      expect(p.wire.at(-1)?.frame.t).toBe("reject");
      await p.channels[1].sendMessage({
        ...sent,
        requestId: sent.requestId + 2,
        revision: before!.revision,
        action: { type: "concede" },
      });
      await flush();
      expect(p.host.getSnapshot().view).toEqual(before);
      p.disconnect();
      p.host.submit(viewActions(before!)[0]);
      await flush();
      expect(p.host.getSnapshot().end).toBe("peer-left");
      expect(p.host.getSnapshot().view?.phase).toBe("playing");
      expect(p.host.getSnapshot().view?.winner).toBeNull();
    } finally {
      p.dispose();
    }
  });

  it("双方同时请求重赛只生成一个新局，旧局帧不能推进新局", async () => {
    const p = pair("flip");
    try {
      await flush();
      p.host.submit({ type: "flip", at: 0 });
      await flush();
      p.guest.submit({ type: "concede" });
      await flush();
      const old = p.wire.find((entry) => entry.frame.t === "action")!.frame;
      p.host.requestRematch();
      p.guest.requestRematch();
      await flush();
      p.guest.respondRematch(true);
      await flush();
      expect(p.host.getSnapshot().round).toBe(1);
      expect(p.guest.getSnapshot().round).toBe(1);
      await p.channels[1].sendMessage(old);
      await flush();
      expect(p.host.getSnapshot().view?.revision).toBe(0);
    } finally {
      p.dispose();
    }
  });

  it("协议拒绝暗子身份、客户端种子和伪造座位字段", () => {
    const envelope = {
      v: 1,
      t: "action",
      matchId: "room",
      round: 0,
      revision: 0,
      requestId: 1,
    };
    expect(
      parseJunqiFrame({ ...envelope, action: { type: "arrange", seed: 42 } }),
    ).toBeNull();
    expect(
      parseJunqiFrame({ ...envelope, action: { type: "ready" }, seat: 0 }),
    ).toBeNull();
    expect(
      parseJunqiFrame({ ...envelope, action: { type: "flip", at: 60 } }),
    ).toBeNull();
  });

  it("拒绝重赛后忽略旧请求，新的请求仍可协商", async () => {
    const p = pair("flip");
    try {
      await flush();
      p.host.submit({ type: "flip", at: 0 });
      await flush();
      p.guest.submit({ type: "concede" });
      await flush();
      p.host.requestRematch();
      await flush();
      const request = p.guest.getSnapshot().rematch!.request;
      p.guest.respondRematch(false);
      await flush();
      await p.channels[0].sendMessage(request);
      await flush();
      expect(p.guest.getSnapshot().rematch).toBeNull();
      p.host.requestRematch();
      await flush();
      expect(p.guest.getSnapshot().rematch?.direction).toBe("incoming");
      p.guest.respondRematch(true);
      await flush();
      expect(p.guest.getSnapshot().round).toBe(1);
    } finally {
      p.dispose();
    }
  });

  it("发送失败保留结构化错误且不重放操作，清理后忽略迟到确认", async () => {
    const p = pair("flip");
    try {
      await flush();
      p.host.submit({ type: "flip", at: 0 });
      await flush();
      const error = {
        kind: "external",
        code: "io:broken_pipe",
        message: "closed",
        args: {},
      };
      const send = vi
        .spyOn(p.channels[1], "sendMessage")
        .mockRejectedValue(error);
      p.guest.submit({ type: "concede" });
      await flush();
      p.guest.submit({ type: "concede" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(p.guest.getSnapshot().end).toBe("send-failed");
      expect(p.guest.getSnapshot().error).toEqual(error);
      expect(p.host.getSnapshot().view?.winner).toBeNull();
      const before = p.guest.getSnapshot();
      p.guest.dispose();
      await p.channels[0].sendMessage(
        p.wire.find((entry) => entry.frame.t === "state")!.frame,
      );
      await flush();
      expect(p.guest.getSnapshot()).toBe(before);
    } finally {
      p.dispose();
    }
  });

  it("首帧超时停止对局，不自动重发握手", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async () => {});
    const guest = new JunqiOnlineController(
      {
        localSeat: 1,
        matchId: "silent",
        sendMessage,
        onMessage: () => () => {},
        onPeerPresence: () => () => {},
        onClosed: () => () => {},
      },
      "hidden",
    );
    try {
      guest.start();
      await vi.advanceTimersByTimeAsync(15000);
      expect(guest.getSnapshot().end).toBe("timeout");
      expect(guest.getSnapshot().view).toBeNull();
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      guest.dispose();
      vi.useRealTimers();
    }
  });
});
