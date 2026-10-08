/**
 * 共享联机对局控制器的时序回归测试：走法 seq/seat/代次校验、
 * 协商期间的输入锁、重复「同意」不再二次回退或重开、重赛换座，
 * 以及超时与发送失败的收口。
 */
import { expect, test, vi } from "vitest";
import type { GameRoomClosedReason } from "~/bindings";
import type { GameDefinition } from "~/features/games/engine/types";
import type { RemoteMove } from "~/features/games/engine/transport";
import { ONLINE_PROTOCOL_VERSION, type MatchControlMessage } from "./protocol";
import { OnlineMatchController } from "./matchController";
import type { OnlineTransport } from "./matchTypes";

// 「竞速」游戏：每走一步计数加一，走满三步后最后落子的座位获胜。
interface RaceState {
  count: number;
}
const raceGame: GameDefinition<RaceState, number, number> = {
  id: "race",
  seatCount: 2,
  currentSeat: (state) => (state.count >= 3 ? null : state.count % 2),
  winnerSeat: (state) => (state.count >= 3 ? (state.count - 1) % 2 : null),
  isFinished: (state) => state.count >= 3,
  applyMove: (state, _move, seat) => ({
    state: { count: state.count + 1 },
    presentation: seat,
  }),
};

class FakeTransport implements OnlineTransport<number> {
  readonly sentMoves: RemoteMove<number>[] = [];
  readonly sentControls: MatchControlMessage[] = [];
  peer: FakeTransport | null = null;
  closeCalls = 0;
  throwOnSend = false;
  private readonly moveHandlers = new Set<(move: RemoteMove<number>) => void>();
  private readonly controlHandlers = new Set<
    (frame: MatchControlMessage) => void
  >();
  private readonly presenceHandlers = new Set<(connected: boolean) => void>();
  private readonly closedHandlers = new Set<
    (reason: GameRoomClosedReason) => void
  >();

  constructor(readonly localSeat: number) {}

  emitMove(move: RemoteMove<number>): void {
    for (const handler of [...this.moveHandlers]) handler(move);
  }
  emitControl(frame: MatchControlMessage): void {
    for (const handler of [...this.controlHandlers]) handler(frame);
  }
  emitPeerGone(): void {
    for (const handler of [...this.presenceHandlers]) handler(false);
  }

  async sendMove(move: RemoteMove<number>): Promise<void> {
    if (this.throwOnSend) {
      this.throwOnSend = false;
      throw new Error("ipc send failed");
    }
    this.sentMoves.push(structuredClone(move));
    this.peer?.emitMove(move);
  }
  async sendControl(frame: MatchControlMessage): Promise<void> {
    if (this.throwOnSend) {
      this.throwOnSend = false;
      throw new Error("ipc send failed");
    }
    this.sentControls.push(structuredClone(frame));
    this.peer?.emitControl(frame);
  }
  onRemoteMove(handler: (move: RemoteMove<number>) => void): () => void {
    this.moveHandlers.add(handler);
    return () => this.moveHandlers.delete(handler);
  }
  onControl(handler: (frame: MatchControlMessage) => void): () => void {
    this.controlHandlers.add(handler);
    return () => this.controlHandlers.delete(handler);
  }
  onPeerPresence(handler: (connected: boolean) => void): () => void {
    this.presenceHandlers.add(handler);
    handler(true);
    return () => this.presenceHandlers.delete(handler);
  }
  onClosed(handler: (reason: GameRoomClosedReason) => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }
  close(): void {
    this.closeCalls++;
  }
}

type Match = OnlineMatchController<RaceState, number, number>;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};
// 每次都从最新快照取本地控制器：重赛后 round 对象会整体更换。
const play = (controller: Match, move: number): boolean =>
  controller.getSnapshot().match.local.submit(move);
const moveCount = (controller: Match): number =>
  controller.getSnapshot().match.runner.getSnapshot().moveCount;

function newMatch() {
  const transportA = new FakeTransport(0);
  const transportB = new FakeTransport(1);
  transportA.peer = transportB;
  transportB.peer = transportA;
  const definition = {
    game: raceGame,
    initialState: (): RaceState => ({ count: 0 }),
    hash: (state: RaceState) => `c${state.count}`,
  };
  const controllerA = new OnlineMatchController(transportA, definition);
  const controllerB = new OnlineMatchController(transportB, definition);
  const releaseA = controllerA.retain();
  const releaseB = controllerB.retain();
  return {
    transportA,
    transportB,
    controllerA,
    controllerB,
    release: () => {
      releaseA();
      releaseB();
    },
  };
}

const gen = { v: ONLINE_PROTOCOL_VERSION, round: 0, revision: 0 };

// 只为类型收窄：取回指定类型的第一帧，缺失即失败。
function firstFrame<T extends MatchControlMessage["t"]>(
  controls: MatchControlMessage[],
  type: T,
): Extract<MatchControlMessage, { t: T }> {
  const frame = controls.find((value) => value.t === type) as
    Extract<MatchControlMessage, { t: T }> | undefined;
  if (!frame) expect.fail(`missing ${type} frame`);
  return frame;
}

test("seq、座位或代数错误的远程着法会结束对局", async () => {
  const wrongSeq = newMatch();
  expect(play(wrongSeq.controllerA, 10)).toBe(true);
  await settle();
  expect(play(wrongSeq.controllerB, 11)).toBe(true);
  await settle();
  // 轮到本地（count 2 应为 seq 2）：seq 与棋盘手数不符即判定分歧。
  wrongSeq.transportA.emitMove({
    ...gen,
    seq: 5,
    seat: 1,
    move: 99,
    stateHash: "c3",
  });
  await settle();
  expect(wrongSeq.controllerA.getSnapshot().end).toBe("desync");
  expect(wrongSeq.transportA.closeCalls).toBe(1);
  expect(wrongSeq.controllerB.getSnapshot().end).toBe(null);
  wrongSeq.release();

  const wrongSeat = newMatch();
  expect(play(wrongSeat.controllerA, 10)).toBe(true);
  await settle();
  // count 1 应轮到座位 1：声称来自座位 0 的走法被拒。
  wrongSeat.transportB.emitMove({
    ...gen,
    seq: 1,
    seat: 0,
    move: 99,
    stateHash: "c2",
  });
  await settle();
  expect(wrongSeat.controllerB.getSnapshot().end).toBe("desync");
  wrongSeat.release();

  const future = newMatch();
  expect(play(future.controllerA, 10)).toBe(true);
  await settle();
  // 超前代次（对方擅自修订）无法解释，直接收口为分歧。
  future.transportB.emitMove({
    ...gen,
    revision: 1,
    seq: 1,
    seat: 1,
    move: 99,
    stateHash: "c2",
  });
  await settle();
  expect(future.controllerB.getSnapshot().end).toBe("desync");
  future.release();
});

test("协商进行时锁定本地输入", async () => {
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  expect(transportA.sentMoves[0]).toStrictEqual({
    round: 0,
    revision: 0,
    seq: 0,
    seat: 0,
    move: 10,
    stateHash: "c1",
  });
  controllerA.requestUndo(1);
  await settle();
  expect(transportA.sentControls[0]).toStrictEqual({
    ...gen,
    t: "undo-request",
    requestId: 1,
    atMove: 1,
    stateHash: "c1",
    plies: 1,
  });
  const pending = controllerB.getSnapshot().pending;
  expect(pending?.direction).toBe("incoming");
  expect(pending?.request.t).toBe("undo-request");
  // 协商未决时本地走法必须被拒绝。
  expect(play(controllerB, 11)).toBe(false);
  controllerB.respondUndo(true);
  await settle();
  expect(transportB.sentMoves.length).toBe(0);
  expect(controllerA.getSnapshot().revision).toBe(1);
  expect(controllerB.getSnapshot().revision).toBe(1);
  expect(moveCount(controllerA)).toBe(0);
  expect(controllerA.getSnapshot().pending).toBe(null);
  expect(controllerB.getSnapshot().pending).toBe(null);
  release();
});

test("重放撤销协议不能再次回退棋盘", async () => {
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  controllerA.requestUndo(1);
  await settle();
  controllerB.respondUndo(true);
  await settle();
  const response = firstFrame(transportB.sentControls, "undo-response");
  expect(response.accept).toBe(true);
  transportA.emitControl(response);
  await settle();
  // 重复的「同意」被忽略：修订号不再前进，棋盘保持已回退的状态。
  expect(controllerA.getSnapshot().revision).toBe(1);
  expect(moveCount(controllerA)).toBe(0);
  expect(controllerA.getSnapshot().end).toBe(null);
  // 下一手按新修订号出线。
  expect(play(controllerA, 12)).toBe(true);
  await settle();
  expect(transportA.sentMoves[1]).toStrictEqual({
    round: 0,
    revision: 1,
    seq: 0,
    seat: 0,
    move: 12,
    stateHash: "c1",
  });
  transportB.emitMove(structuredClone(transportA.sentMoves[0]));
  await settle();
  // 重放的 revision 0 走法按旧代次丢弃，B 的棋盘不受影响。
  expect(moveCount(controllerB)).toBe(1);
  expect(controllerB.getSnapshot().end).toBe(null);
  release();
});

test("忽略重复的对端请求且不发送第二次响应", async () => {
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  controllerA.requestUndo(1);
  await settle();
  const request = firstFrame(transportA.sentControls, "undo-request");
  transportB.emitControl(request);
  await settle();
  // 旧请求 ID 重复到达：既不能覆盖挂起中的协商，也不能触发自动拒绝。
  expect(
    controllerB.getSnapshot().pending?.direction === "incoming",
  ).toBeTruthy();
  expect(controllerB.getSnapshot().pending?.request.requestId).toBe(
    request.requestId,
  );
  expect(transportB.sentControls.length).toBe(0);
  controllerB.respondUndo(false);
  await settle();
  // 拒绝走提示通道，悔棋不生效。
  expect(controllerA.getSnapshot().revision).toBe(0);
  expect(moveCount(controllerA)).toBe(1);
  expect(controllerA.getSnapshot().notice?.kind).toBe("undo");
  expect(controllerA.getSnapshot().pending).toBe(null);
  release();
});

test("交叉协商请求分别自动拒绝", async () => {
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  // 双方几乎同时发起悔棋：各自的挂起请求使对方的请求被自动拒绝。
  controllerA.requestUndo(1);
  controllerB.requestUndo(1);
  await settle();
  expect(firstFrame(transportA.sentControls, "undo-response").accept).toBe(
    false,
  );
  expect(firstFrame(transportB.sentControls, "undo-response").accept).toBe(
    false,
  );
  // 两边的拒绝回执各自解除挂起并给出提示，棋盘不回退。
  expect(controllerA.getSnapshot().pending).toBe(null);
  expect(controllerB.getSnapshot().pending).toBe(null);
  expect(controllerA.getSnapshot().notice?.kind).toBe("undo");
  expect(controllerB.getSnapshot().notice?.kind).toBe("undo");
  expect(controllerA.getSnapshot().revision).toBe(0);
  expect(controllerB.getSnapshot().revision).toBe(0);
  release();
});

test("接受再来一局后推进回合并交换座位", async () => {
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  expect(play(controllerB, 11)).toBe(true);
  await settle();
  expect(play(controllerA, 12)).toBe(true);
  await settle();
  expect(controllerA.getSnapshot().match.runner.getSnapshot().phase).toBe(
    "finished",
  );
  controllerA.requestRematch();
  await settle();
  const request = firstFrame(transportA.sentControls, "rematch-request");
  controllerB.respondRematch(true);
  await settle();
  expect(controllerA.getSnapshot().round).toBe(1);
  expect(controllerB.getSnapshot().round).toBe(1);
  expect(controllerA.getSnapshot().revision).toBe(0);
  // 换座：代次为奇数时双方座位互换。
  expect(controllerA.getSnapshot().localSeat).toBe(1);
  expect(controllerB.getSnapshot().localSeat).toBe(0);
  expect(moveCount(controllerA)).toBe(0);
  expect(moveCount(controllerB)).toBe(0);
  // 重赛只执行一次：重复的「同意」不能再次开局。
  const response = firstFrame(transportB.sentControls, "rematch-response");
  expect(response.accept).toBe(true);
  transportA.emitControl(response);
  await settle();
  expect(controllerA.getSnapshot().round).toBe(1);
  expect(controllerA.getSnapshot().end).toBe(null);
  // 旧代次（round 0）的走法与协商都对新回合无效。
  transportA.emitMove({ ...gen, seq: 0, seat: 0, move: 10, stateHash: "c1" });
  transportA.emitControl({ ...request, requestId: 9 });
  await settle();
  expect(moveCount(controllerA)).toBe(0);
  expect(controllerA.getSnapshot().pending).toBe(null);
  expect(controllerA.getSnapshot().end).toBe(null);
  expect(transportA.sentControls.length).toBe(1);
  // 新代次正常走线：B 先手（座位 0）。
  expect(play(controllerB, 20)).toBe(true);
  await settle();
  expect(transportB.sentMoves[1]).toStrictEqual({
    round: 1,
    revision: 0,
    seq: 0,
    seat: 0,
    move: 20,
    stateHash: "c1",
  });
  expect(moveCount(controllerA)).toBe(1);
  release();
});

test("协商超时会结束对局并关闭传输", async () => {
  // 控制器内部的协商超时依赖 setTimeout；保留真实推进能力，
  // 只在需要时显式跨过 30s 的协商期限。
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  controllerA.requestUndo(1);
  await settle();
  expect(
    controllerA.getSnapshot().pending?.direction === "outgoing",
  ).toBeTruthy();
  vi.advanceTimersByTime(30_001);
  await settle();
  expect(controllerA.getSnapshot().end).toBe("timeout");
  expect(controllerB.getSnapshot().end).toBe("timeout");
  expect(transportA.closeCalls).toBe(1);
  expect(transportB.closeCalls).toBe(1);
  vi.useRealTimers();
  release();
});

test("向外发送失败会结束对局", async () => {
  const { transportA, controllerA, controllerB, release } = newMatch();
  expect(play(controllerA, 10)).toBe(true);
  await settle();
  transportA.throwOnSend = true;
  controllerA.requestUndo(1);
  await settle();
  expect(controllerA.getSnapshot().end).toBe("send-failed");
  expect(controllerA.getSnapshot().error).toBeTruthy();
  expect(transportA.closeCalls).toBe(1);
  expect(controllerB.getSnapshot().end).toBe(null);
  release();
});
test("对端离线会以 peer-left 状态结束对局", async () => {
  const { transportA, transportB, controllerA, controllerB, release } =
    newMatch();
  transportA.emitPeerGone();
  transportB.emitPeerGone();
  await settle();
  expect(controllerA.getSnapshot().end).toBe("peer-left");
  expect(controllerB.getSnapshot().end).toBe("peer-left");
  expect(transportA.closeCalls).toBe(1);
  release();
});
