import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  checkpointSchema,
  participantConfigurationSchema,
} from "./checkpoint-schema";
import { GameSessionStore } from "./game-session-store";
import { createMatchHandle } from "./match-handle";
import type { GameOutcome } from "./outcome";
import { sameParticipantConfiguration } from "./participant-configuration";
import {
  createParticipantSession,
  participantCapabilities,
} from "./participant-session";
import type { ParticipantConfiguration } from "./participants";
import type { GameDefinition } from "./types";

interface State {
  turn: number;
  moves: number;
  hands: string[];
  seed: string;
}

interface Observation {
  hand: string;
  turn: number;
  moves: number;
}

const initial: State = {
  turn: 0,
  moves: 0,
  hands: ["手牌甲", "手牌乙", "手牌丙"],
  seed: "权威私有种子",
};
const victory: GameOutcome = {
  kind: "victory",
  winners: [{ kind: "team", teamId: "伙伴" }],
  ranking: [
    { rank: 1, competitors: [{ kind: "team", teamId: "伙伴" }] },
    { rank: 2, competitors: [{ kind: "seat", seat: 1 }] },
  ],
};
const game = (
  outcome: GameOutcome = victory,
): GameDefinition<State, number, number, Observation> => ({
  id: "three-seat-test",
  version: 1,
  seatCount: 3,
  currentSeat: (state) => state.turn,
  isFinished: (state) => state.moves >= 3,
  outcome: (state) => (state.moves >= 3 ? outcome : null),
  observe: (state, seat) => ({
    hand: state.hands[seat],
    turn: state.turn,
    moves: state.moves,
  }),
  applyMove: (state, move, seat) => {
    if (seat !== state.turn || move !== 1) throw new Error("测试走法非法");
    return {
      state: { ...state, moves: state.moves + 1, turn: (state.turn + 1) % 3 },
      presentation: move,
    };
  },
});
const localConfiguration: ParticipantConfiguration = {
  version: 1,
  viewerSeat: "active",
  seats: [0, 1, 2].map((seat) => ({ seat, kind: "local" })),
};

const tick = async () => {
  for (let n = 0; n < 24; n++) await Promise.resolve();
};

const releases: (() => void)[] = [];

afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe("多座位装配与观察边界", () => {
  it("本地、电脑和远端共用规则循环，每个控制器只看到自己的手牌", async () => {
    const observed: Observation[] = [];
    const configuration: ParticipantConfiguration = {
      version: 1,
      viewerSeat: 0,
      seats: [
        { seat: 0, kind: "local", teamId: "伙伴" },
        { seat: 1, kind: "computer", difficulty: "medium" },
        { seat: 2, kind: "remote", teamId: "伙伴", memberId: "guest" },
      ],
    };
    const presented = vi.fn();
    const session = createParticipantSession(
      game(),
      initial,
      configuration,
      {
        computer: {
          chooseMove: async (observation) => {
            observed.push(observation);
            return 1;
          },
        },
        remote: () => ({
          kind: "remote",
          requestMove: async ({ observation }) => {
            observed.push(observation);
            return 1;
          },
        }),
      },
      { onMoveResolved: presented },
      undefined,
      0,
    );
    releases.push(() => session.runner.dispose());
    session.runner.start();
    expect(session.locals.get(0)?.submit(1)).toBe(true);
    await tick();
    expect(observed.map((view) => view.hand)).toEqual(["手牌乙", "手牌丙"]);
    expect(
      observed.every((view) => !("hands" in view) && !("seed" in view)),
    ).toBe(true);
    expect(
      presented.mock.calls.every(
        ([info]) => info.resolution.state.hand === "手牌甲",
      ),
    ).toBe(true);
    expect(session.runner.getSnapshot().outcome).toEqual(victory);
    expect(session.runner.getSnapshot().winnerSeat).toBeNull();
    expect(
      session.runner.getSnapshot().participants.map((seat) => seat.kind),
    ).toEqual(["local", "computer", "remote"]);
  });

  it("同屏三人使用独立输入控制器，并随回合切换可见观察", async () => {
    const { runner, locals } = createParticipantSession(
      game(),
      initial,
      localConfiguration,
      {},
    );
    releases.push(() => runner.dispose());
    runner.start();
    for (let seat = 0; seat < 3; seat++) {
      expect(runner.getSnapshot().state.hand).toBe(initial.hands[seat]);
      expect(locals.get((seat + 1) % 3)?.submit(1)).toBe(false);
      expect(runner.submitLocal(1)).toBe(true);
      await tick();
    }
    expect(runner.getSnapshot().phase).toBe("finished");
  });

  it("公开对局接口不携带权威状态，也不能查询其他座位", () => {
    const { runner } = createParticipantSession(
      game(),
      initial,
      { ...localConfiguration, viewerSeat: 0 },
      {},
    );
    releases.push(() => runner.dispose());
    const handle = createMatchHandle(runner);
    expect("getAuthorityCheckpoint" in handle).toBe(false);
    expect("getAuthorityState" in handle).toBe(false);
    expect("getSeatSnapshot" in handle).toBe(false);
    expect(JSON.stringify(handle)).not.toContain(initial.seed);
    expect(JSON.stringify(handle.getSnapshot())).not.toContain("手牌乙");
    expect(handle.getSnapshot().state).toEqual({
      hand: "手牌甲",
      turn: 0,
      moves: 0,
    });
    expect(handle.getSnapshot()).toBe(handle.getSnapshot());
    expect(Object.isFrozen(handle.getSnapshot())).toBe(true);
  });

  it("修改参与者观察和初始传入对象不会修改权威状态", () => {
    const input = structuredClone(initial);
    const { runner } = createParticipantSession(
      game(),
      input,
      localConfiguration,
      {},
    );
    releases.push(() => runner.dispose());
    runner.getSnapshot().state.hand = "伪造手牌";
    input.hands[0] = "外部修改";
    expect(runner.getAuthorityCheckpoint()[0].hands).toEqual(initial.hands);
    expect(runner.getObservationHistory()[0].hand).toBe("手牌甲");
  });

  it("固定座位只能提交本方输入，规则版本不兼容的存档不能恢复", async () => {
    const configuration = { ...localConfiguration, viewerSeat: 0 as const };
    const { runner } = createParticipantSession(
      game(),
      initial,
      configuration,
      {},
    );
    releases.push(() => runner.dispose());
    runner.start();
    expect(runner.submitLocal(1)).toBe(true);
    await tick();
    expect(runner.getSnapshot().activeSeat).toBe(1);
    expect(runner.submitLocal(1)).toBe(false);
    expect(runner.awaitingLocalInput).toBe(false);
    expect(() =>
      createParticipantSession(
        game(),
        initial,
        configuration,
        {},
        {},
        {
          id: crypto.randomUUID(),
          history: [initial],
          rulesVersion: 2,
        },
      ),
    ).toThrow("rules version");
  });

  it.each<GameOutcome>([
    { kind: "victory", winners: [{ kind: "seat", seat: 2 }] },
    { kind: "draw" },
    {
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
    },
    {
      kind: "custom",
      result: { points: [8, 5, 8] },
      ranking: [
        {
          rank: 1,
          competitors: [
            { kind: "seat", seat: 0 },
            { kind: "seat", seat: 2 },
          ],
        },
        { rank: 3, competitors: [{ kind: "seat", seat: 1 }] },
      ],
    },
  ])("个人、平局、并列和自定义排名保留完整结果：%j", async (outcome) => {
    const { runner } = createParticipantSession(
      game(outcome),
      initial,
      localConfiguration,
      {},
    );
    releases.push(() => runner.dispose());
    runner.start();
    for (let n = 0; n < 3; n++) {
      runner.submitLocal(1);
      await tick();
    }
    expect(runner.getSnapshot().outcome).toEqual(outcome);
    expect(runner.getSnapshot().winnerSeat).toBe(
      outcome.kind === "victory" && outcome.winners.length === 1 ? 2 : null,
    );
  });

  it("暂停期间迟到的第三座位结果丢弃，恢复和悔棋不会重用旧请求", async () => {
    let finish!: (move: number) => void;
    const request = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const configuration: ParticipantConfiguration = {
      ...localConfiguration,
      seats: [
        { seat: 0, kind: "local" },
        { seat: 1, kind: "local" },
        { seat: 2, kind: "remote", memberId: "test-peer" },
      ],
    };
    // 远端控制器暂停时仍可消费消息；此处用电脑模拟忽略取消的异步搜索。
    const asyncConfiguration: ParticipantConfiguration = {
      ...configuration,
      seats: [
        { seat: 0, kind: "local" },
        { seat: 1, kind: "local" },
        { seat: 2, kind: "computer", difficulty: "medium" },
      ],
    };
    const { runner } = createParticipantSession(
      game(),
      initial,
      asyncConfiguration,
      { computer: { chooseMove: request } },
      {},
      undefined,
      0,
    );
    releases.push(() => runner.dispose());
    runner.start();
    runner.submitLocal(1);
    await tick();
    runner.submitLocal(1);
    await tick();
    const stale = finish;
    runner.pause();
    stale(1);
    await tick();
    expect(runner.getSnapshot().moveCount).toBe(2);
    runner.resume();
    await tick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(runner.undo(1)).toBe(true);
    finish(1);
    await tick();
    expect(runner.getSnapshot().moveCount).toBe(1);
    expect(runner.getSnapshot().activeSeat).toBe(1);
  });

  it("未适配的方式不标为可用，装配失败会释放已创建控制器", () => {
    expect(participantCapabilities({})).toEqual({
      local: true,
      computer: false,
      remote: false,
    });
    const configuration: ParticipantConfiguration = {
      ...localConfiguration,
      seats: [
        { seat: 0, kind: "remote", memberId: "test-peer" },
        { seat: 1, kind: "computer", difficulty: "medium" },
        { seat: 2, kind: "local" },
      ],
    };
    const dispose = vi.fn();
    expect(() =>
      createParticipantSession(game(), initial, configuration, {
        remote: () => ({ kind: "remote", requestMove: async () => 1, dispose }),
      }),
    ).toThrow("does not support computer");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("重复、缺失及越界座位拒绝，配置字段顺序不影响存档兼容", () => {
    expect(() =>
      createParticipantSession(
        game(),
        initial,
        {
          ...localConfiguration,
          seats: [
            { seat: 0, kind: "local" },
            { seat: 0, kind: "local" },
            { seat: 2, kind: "local" },
          ],
        },
        {},
      ),
    ).toThrow("Duplicate");
    expect(() =>
      createParticipantSession(
        game(),
        initial,
        { ...localConfiguration, viewerSeat: 3 },
        {},
      ),
    ).toThrow("outside");
    expect(
      sameParticipantConfiguration(
        localConfiguration,
        participantConfigurationSchema.parse(localConfiguration),
      ),
    ).toBe(true);
    expect(
      participantConfigurationSchema.safeParse({
        ...localConfiguration,
        apiKey: "模拟凭据",
      }).success,
    ).toBe(false);
  });
});

describe("权威存档与公开恢复信息", () => {
  it("旧存档恢复后保存带版本的座位配置，公开快照不包含手牌历史", async () => {
    const schema = checkpointSchema(
      game().id,
      z.literal("legacy"),
      z.object({
        turn: z.number(),
        moves: z.number(),
        hands: z.array(z.string()),
        seed: z.string(),
      }),
    );
    let saved: unknown = {
      version: 1,
      gameId: game().id,
      id: crypto.randomUUID(),
      savedAt: 1,
      mode: "legacy",
      history: [initial],
    };
    const store = new GameSessionStore<
      "legacy",
      State,
      number,
      number,
      Observation
    >(
      {
        gameId: game().id,
        schema,
        create: (_, hooks, checkpoint) => {
          const session = createParticipantSession(
            game(),
            initial,
            { ...localConfiguration, viewerSeat: 0 },
            {},
            hooks,
            checkpoint,
          );
          return {
            ...session,
            local: {
              submit: (move) => session.runner.submitLocal(move),
              get awaitingInput() {
                return session.runner.awaitingLocalInput;
              },
            },
          };
        },
      },
      {
        read: async () => saved,
        write: async (_, value) => {
          saved = structuredClone(value);
        },
        remove: async () => {
          saved = undefined;
        },
      },
    );
    releases.push(() => store.dispose());
    await store.load();
    expect(JSON.stringify(store.getSnapshot())).not.toContain(initial.seed);
    expect(store.getSnapshot().saved?.moveCount).toBe(0);
    store.restore();
    const session = store.ensureSession();
    await tick();
    expect(schema.parse(saved).participants).toEqual({
      ...localConfiguration,
      viewerSeat: 0,
    });
    expect(session?.runner.getSnapshot().state.hand).toBe("手牌甲");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("手牌乙");
    expect(JSON.stringify(store.getSnapshot())).not.toContain(initial.seed);
    expect(session?.restored).toBe(true);
  });
});
