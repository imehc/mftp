import { describe, expect, it, vi } from "vitest";

import type { GamePartyEvent, GamePartyStatus } from "~/bindings";

import { setGamesForeground } from "../session-registry";
import { PartyConnection } from "./party-connection";

describe("成员会话生命周期", () => {
  it("后台进入暂停，回到前台不自动恢复认证或行动", async () => {
    const endpoint = { receive: vi.fn(), pause: vi.fn(), dispose: vi.fn() };
    const services = {
      listen: vi.fn(async () => vi.fn()),
      resume: vi.fn(),
      leave: vi.fn(),
    };
    const connection = new PartyConnection("instance", endpoint, services);
    await connection.attach();
    setGamesForeground(false);
    setGamesForeground(true);
    expect(endpoint.pause).toHaveBeenCalledOnce();
    expect(services.resume).not.toHaveBeenCalled();
    connection.dispose();
  });

  it("监听登记后才恢复，并缓冲命令返回前到达的事件，不自动重放动作", async () => {
    let receive!: (event: GamePartyEvent) => void;
    const endpoint = {
      receive: vi.fn(),
      reconnected: vi.fn(),
      dispose: vi.fn(),
      disconnect: vi.fn(),
    };
    const services = {
      listen: vi.fn(async (callback) => {
        receive = callback;
        return vi.fn();
      }),
      resume: vi.fn(async () => {
        receive({
          type: "members",
          instanceId: "instance",
          localSeat: 2,
          members: [],
        });
        return { instanceId: "instance" } as GamePartyStatus;
      }),
      leave: vi.fn(),
    };
    const connection = new PartyConnection("instance", endpoint, services);
    await connection.attach();
    expect(services.resume).not.toHaveBeenCalled();
    await connection.reconnect();
    expect(services.resume).toHaveBeenCalledOnce();
    expect(endpoint.disconnect).toHaveBeenCalledOnce();
    expect(endpoint.receive.mock.calls.map(([event]) => event.type)).toEqual([
      "members",
    ]);
    expect(endpoint.reconnected.mock.invocationCallOrder[0]).toBeLessThan(
      endpoint.receive.mock.invocationCallOrder[0],
    );
    receive({
      type: "disconnected",
      instanceId: "other",
      connectionGeneration: 1,
    });
    expect(endpoint.receive).toHaveBeenCalledOnce();
    await connection.close();
    expect(services.leave).toHaveBeenCalledWith("instance");
    receive({
      type: "disconnected",
      instanceId: "instance",
      connectionGeneration: 1,
    });
    expect(endpoint.receive).toHaveBeenCalledOnce();
  });

  it("登记尚未完成时关闭，迟到监听立即释放，不再交付事件", async () => {
    let finish!: (stop: () => void) => void;
    const stop = vi.fn();
    const endpoint = { receive: vi.fn(), pause: vi.fn(), dispose: vi.fn() };
    const connection = new PartyConnection("instance", endpoint, {
      listen: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      resume: vi.fn(),
      leave: vi.fn(),
    });
    const pending = connection.attach();
    connection.dispose();
    finish(stop);
    await pending;
    expect(stop).toHaveBeenCalledOnce();
    expect(endpoint.pause).toHaveBeenCalledOnce();
    expect(endpoint.dispose).toHaveBeenCalledOnce();
  });
});
