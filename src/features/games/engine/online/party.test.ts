import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GamePartyEnvelope,
  GamePartyEvent,
  GamePartyStatus,
} from "~/bindings";
import { releasePartyRuntime } from "~/lib/ipc";

import type { GameOutcome } from "../outcome";
import type { ParticipantConfiguration } from "../participants";
import {
  cardAdapter,
  cardGame,
  type CardObservation,
  chooseAction,
  deal,
} from "./__fixtures__/party-game";
import { PartyAuthority, type PartySend } from "./party-authority";
import { PartyReplica } from "./party-replica";

const releases: (() => void)[] = [];

const tick = async () => {
  for (let index = 0; index < 80; index++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(400);
};

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});

function room(): GamePartyStatus {
  return {
    instanceId: crypto.randomUUID(),
    roomId: crypto.randomUUID(),
    protocolVersion: 3,
    gameId: cardGame().id,
    rulesVersion: 1,
    seatCount: 3,
    roomName: "测试",
    host: "127.0.0.1",
    port: 1234,
    hosting: true,
    memberId: "host",
    seat: 0,
    connected: true,
    connectionGeneration: 0,
    code: null,
    members: [0, 1, 2].map((seat) => ({
      memberId: ["host", "bot", "guest"][seat],
      seat,
      name: `座位${seat}`,
      connected: true,
      connectionGeneration: seat === 0 ? 0 : 1,
    })),
  };
}

function setup(result?: GameOutcome) {
  vi.useFakeTimers();
  const status = room();
  const remote = {
    ...status,
    instanceId: crypto.randomUUID(),
    hosting: false,
    memberId: "guest",
    seat: 2,
    connectionGeneration: 1,
  };
  const frames: { target: string | null; envelope: GamePartyEnvelope }[] = [];
  const observed: CardObservation[] = [];
  const inbound: GamePartyEvent[] = [];
  const replica = new PartyReplica(
    remote,
    cardAdapter,
    async (_id, _target, envelope) => {
      inbound.push({
        type: "message",
        instanceId: status.instanceId,
        memberId: "guest",
        seat: 2,
        connectionGeneration: 1,
        envelope,
      });
    },
  );

  const send: PartySend = async (_id, target, envelope) => {
    frames.push({ target, envelope });
    if (target === null || target === "guest")
      replica.receive({
        type: "message",
        instanceId: remote.instanceId,
        memberId: "host",
        seat: 0,
        connectionGeneration: 0,
        envelope,
      });
  };

  const configuration: ParticipantConfiguration = {
    version: 1,
    viewerSeat: 0,
    seats: [
      { seat: 0, kind: "local" },
      { seat: 1, kind: "computer", difficulty: "medium" },
      { seat: 2, kind: "remote", memberId: "guest" },
    ],
  };
  const authority = new PartyAuthority(
    status,
    cardGame(result),
    deal(2026),
    configuration,
    {
      computer: {
        chooseMove: async (observation) => {
          observed.push(observation);
          return chooseAction(observation);
        },
      },
    },
    cardAdapter,
    send,
  );
  releases.push(() => {
    authority.dispose();
    replica.dispose();
    releasePartyRuntime(status.instanceId);
    releasePartyRuntime(remote.instanceId);
  });
  return {
    authority,
    replica,
    frames,
    observed,
    status,
    remote,
    inbound,
    send,
  };
}

describe("多人权威对局与隐藏观察", () => {
  it("后台暂停禁止输入，显式恢复请求本方快照后才重新开放，不发送动作", async () => {
    const { authority, replica, inbound } = setup();
    await authority.start();
    replica.pause();
    authority.handle.submitLocal(
      chooseAction(authority.handle.getSnapshot().state),
    );
    await tick();
    expect(replica.getSnapshot().activeSeat).toBeNull();
    expect(
      await replica.submit(chooseAction(replica.getSnapshot().observation!)),
    ).toBe(false);
    await replica.resume();
    const request = inbound.shift()! as Extract<
      GamePartyEvent,
      { type: "message" }
    >;
    expect(request.envelope.kind).toBe("request");
    expect(JSON.parse(request.envelope.payload)).toEqual({ type: "snapshot" });
    authority.receive(request);
    await tick();
    expect(replica.getSnapshot().activeSeat).toBe(2);
    expect(replica.getSnapshot().revision).toBe(2);
    expect(inbound).toHaveLength(0);
  });

  it("本地、电脑和远端共用叫牌出牌循环，各自只收到本方手牌", async () => {
    vi.useFakeTimers();
    const { authority, replica, frames, observed, inbound } = setup();
    await authority.start();
    for (let round = 0; round < 3; round++) {
      expect(
        authority.handle.submitLocal(
          chooseAction(authority.handle.getSnapshot().state),
        ),
      ).toBe(true);
      await tick();
      await vi.advanceTimersByTimeAsync(400);
      await tick();
      expect(replica.getSnapshot().activeSeat).toBe(2);
      expect(
        await replica.submit(chooseAction(replica.getSnapshot().observation!)),
      ).toBe(true);
      authority.receive(inbound.shift()!);
      await tick();
    }
    expect(authority.handle.getSnapshot().phase).toBe("finished");
    expect(replica.getSnapshot().finished).toBe(true);
    expect(
      replica.getSnapshot().participants.map((participant) => participant.kind),
    ).toEqual(["local", "computer", "remote"]);
    expect(JSON.stringify(replica.getSnapshot().participants)).not.toContain(
      "model",
    );
    expect(replica.getSnapshot().outcome).toEqual(
      authority.handle.getSnapshot().outcome,
    );
    expect(observed).toHaveLength(3);
    expect(
      observed.every(
        (view) =>
          view.seat === 1 &&
          !("hands" in view) &&
          !("deck" in view) &&
          !("seed" in view),
      ),
    ).toBe(true);
    const snapshots = frames.filter(
      (frame) => frame.envelope.kind === "snapshot",
    );
    expect(
      snapshots.every(
        (frame) =>
          frame.target === "guest" &&
          JSON.parse(frame.envelope.payload).observation.seat === 2,
      ),
    ).toBe(true);
    expect(
      frames
        .filter((frame) => frame.target === null)
        .every(
          (frame) =>
            !/"hand"|"deck"|"seed"|"model"/.test(frame.envelope.payload),
        ),
    ).toBe(true);
    expect(JSON.stringify(authority.handle.getSnapshot())).not.toContain(
      '"hands"',
    );
    expect(authority.undo(1)).toBe(false);
  });

  it("固定种子可重放发牌，个人和并列排名通过本座位终局投影保留", async () => {
    expect(deal(2026)).toEqual(deal(2026));
    expect(deal(2027).hands).not.toEqual(deal(2026).hands);
    const outcome: GameOutcome = {
      kind: "victory",
      winners: [
        { kind: "seat", seat: 0 },
        { kind: "seat", seat: 2 },
      ],
      ranking: [
        {
          rank: 1,
          competitors: [
            { kind: "seat", seat: 0 },
            { kind: "seat", seat: 2 },
          ],
        },
      ],
      details: { score: [2, 1, 2] },
    };
    const { replica, frames, authority, remote } = setup(outcome);
    await authority.start();
    const last = frames.at(-1)!.envelope;
    // 直接投递权威终局投影，验证结果协议，而非重复实现规则循环。
    replica.receive({
      type: "message",
      instanceId: remote.instanceId,
      memberId: "host",
      seat: 0,
      connectionGeneration: 0,
      envelope: {
        ...last,
        sequence: last.sequence + 1,
        payload: JSON.stringify({
          ...JSON.parse(last.payload),
          activeSeat: null,
          finished: true,
          outcome,
        }),
      },
    });
    expect(replica.getSnapshot().outcome).toEqual(outcome);
  });

  it("恢复只补原座位当前观察，未确认动作不重放，旧连接和伪造座位不能推进", async () => {
    const { authority, replica, frames, status, remote, inbound } = setup();
    await authority.start();
    authority.handle.submitLocal(
      chooseAction(authority.handle.getSnapshot().state),
    );
    await tick();
    expect(
      await replica.submit(chooseAction(replica.getSnapshot().observation!)),
    ).toBe(true);
    const pending = inbound.shift()! as Extract<
      GamePartyEvent,
      { type: "message" }
    >;
    replica.receive({
      type: "disconnected",
      instanceId: remote.instanceId,
      connectionGeneration: 1,
    });
    const members = status.members.map((member) =>
      member.seat === 2 ? { ...member, connected: false } : member,
    );
    authority.receive({
      type: "members",
      instanceId: status.instanceId,
      localSeat: 0,
      members,
    });
    expect(authority.paused).toBe(true);
    authority.receive(pending);
    await tick();
    expect(authority.handle.getSnapshot().moveCount).toBe(2);
    const restored = members.map((member) =>
      member.seat === 2
        ? { ...member, connected: true, connectionGeneration: 2 }
        : member,
    );
    replica.reconnected({
      ...remote,
      connectionGeneration: 2,
      members: restored,
    });
    authority.receive({
      type: "members",
      instanceId: status.instanceId,
      localSeat: 0,
      members: restored,
    });
    await tick();
    expect(frames.at(-1)?.target).toBe("guest");
    replica.receive({
      type: "disconnected",
      instanceId: remote.instanceId,
      connectionGeneration: 1,
    });
    expect(replica.getSnapshot().connected).toBe(true);
    expect(replica.getSnapshot().revision).toBe(2);
    expect(replica.getSnapshot().observation?.hand).toEqual(
      deal(2026).hands[2],
    );
    expect(inbound).toHaveLength(0);
    await authority.resume();
    await tick();
    authority.receive(pending);
    authority.receive({
      ...pending,
      memberId: "bot",
      seat: 2,
      connectionGeneration: 2,
    });
    await tick();
    expect(authority.handle.getSnapshot().moveCount).toBe(2);
    await replica.submit(chooseAction(replica.getSnapshot().observation!));
    const fresh = inbound.shift()! as Extract<
      GamePartyEvent,
      { type: "message" }
    >;
    authority.receive({ ...fresh, connectionGeneration: 2 });
    await tick();
    expect(authority.handle.getSnapshot().moveCount).toBe(3);
    authority.receive({ ...fresh, connectionGeneration: 2 });
    await tick();
    expect(authority.handle.getSnapshot().moveCount).toBe(3);
  });

  it("同房间重开增加代次并延续序号，旧快照和动作忽略", async () => {
    const { authority, replica, frames, status, remote } = setup();
    await authority.start();
    const stale = frames.at(-1)!.envelope;
    const restarted = authority.restart(deal(2027));
    releases.push(() => restarted.dispose());
    await restarted.start();
    const latest = frames.at(-1)!.envelope;
    expect(latest.generation).toBeGreaterThan(stale.generation);
    expect(latest.sequence).toBeGreaterThan(stale.sequence);
    expect(replica.getSnapshot().observation?.hand).toEqual(
      deal(2027).hands[2],
    );
    replica.receive({
      type: "message",
      instanceId: remote.instanceId,
      memberId: "host",
      seat: 0,
      connectionGeneration: 0,
      envelope: { ...stale, sequence: latest.sequence + 10 },
    });
    restarted.receive({
      type: "message",
      instanceId: status.instanceId,
      memberId: "guest",
      seat: 2,
      connectionGeneration: 1,
      envelope: { ...stale, kind: "action" },
    });
    await tick();
    expect(replica.getSnapshot().generation).toBe(latest.generation);
    expect(restarted.handle.getSnapshot().moveCount).toBe(0);
  });

  it("首次发送失败后显式恢复能启动循环，非法动作作为结构化错误返回", async () => {
    const { authority, replica, remote } = setup();
    await authority.start();
    authority.handle.submitLocal(
      chooseAction(authority.handle.getSnapshot().state),
    );
    await tick();
    expect(await replica.submit({ type: "play", card: 18 })).toBe(false);
    expect(replica.getSnapshot().error).toMatchObject({
      kind: expect.any(String),
      code: expect.any(String),
    });
    const status = room();
    const send = vi
      .fn<PartySend>()
      .mockRejectedValueOnce(new Error("Isolated send failure"))
      .mockResolvedValue(undefined);
    const failed = new PartyAuthority(
      status,
      cardGame(),
      deal(1),
      {
        version: 1,
        viewerSeat: 0,
        seats: [0, 1, 2].map((seat) => ({ seat, kind: "local" })),
      },
      {},
      cardAdapter,
      send,
    );
    releases.push(() => {
      failed.dispose();
      releasePartyRuntime(status.instanceId);
      releasePartyRuntime(remote.instanceId);
    });
    await failed.start();
    expect(failed.error).not.toBeNull();
    expect(failed.handle.hasStarted).toBe(false);
    await failed.resume();
    expect(failed.error).toBeNull();
    expect(failed.handle.hasStarted).toBe(true);
    expect(failed.handle.submitLocal({ type: "call", bid: true })).toBe(true);
  });
});
