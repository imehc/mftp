import { afterEach, describe, expect, it } from "vitest";

import { OnlineMatchController } from "../engine/online/matchController";
import type { OnlineTransport } from "../engine/online/matchTypes";
import type { MatchControlMessage } from "../engine/online/protocol";
import type { RemoteMove } from "../engine/transport";
import { parseReversiMove, REVERSI_ONLINE } from "./onlineProtocol";
import { createInitialReversiState, legalMoves } from "./rules";
import type {
  ReversiMove,
  ReversiPresentation,
  ReversiState,
  Stone,
} from "./types";
import { undoPliesFor } from "./undo";

class Transport implements OnlineTransport<ReversiMove> {
  peer?: Transport;
  moves: RemoteMove<ReversiMove>[] = [];
  controls: MatchControlMessage[] = [];
  closed = false;
  moveHandlers = new Set<(move: RemoteMove<ReversiMove>) => void>();
  controlHandlers = new Set<(frame: MatchControlMessage) => void>();
  presenceHandlers = new Set<(connected: boolean) => void>();

  constructor(readonly localSeat: number) {}

  async sendMove(move: RemoteMove<ReversiMove>) {
    this.moves.push(structuredClone(move));
    this.peer?.moveHandlers.forEach((handler) =>
      handler(structuredClone(move)),
    );
  }

  async sendControl(frame: MatchControlMessage) {
    this.controls.push(structuredClone(frame));
    this.peer?.controlHandlers.forEach((handler) =>
      handler(structuredClone(frame)),
    );
  }

  onRemoteMove(handler: (move: RemoteMove<ReversiMove>) => void) {
    this.moveHandlers.add(handler);
    return () => {
      this.moveHandlers.delete(handler);
    };
  }

  onControl(handler: (frame: MatchControlMessage) => void) {
    this.controlHandlers.add(handler);
    return () => {
      this.controlHandlers.delete(handler);
    };
  }

  onPeerPresence(handler: (connected: boolean) => void) {
    this.presenceHandlers.add(handler);
    return () => {
      this.presenceHandlers.delete(handler);
    };
  }

  onClosed() {
    return () => {};
  }

  async close() {
    this.closed = true;
  }
}

const releases: (() => void)[] = [];

afterEach(() => {
  releases.splice(0).forEach((release) => release());
});

async function settle() {
  for (let i = 0; i < 64; i++) await Promise.resolve();
}

function pair(initialState = createInitialReversiState) {
  const a = new Transport(0);
  const b = new Transport(1);
  a.peer = b;
  b.peer = a;
  const definition = { ...REVERSI_ONLINE, initialState };
  const host = new OnlineMatchController(a, definition);
  const guest = new OnlineMatchController(b, definition);
  releases.push(host.retain(), guest.retain());
  return { host, guest, a, b };
}

type Match = OnlineMatchController<
  ReversiState,
  ReversiMove,
  ReversiPresentation
>;

function stateOf(match: Match) {
  return match.getSnapshot().match.runner.getSnapshot().state;
}

async function play(match: Match) {
  expect(
    match.getSnapshot().match.local.submit(legalMoves(stateOf(match))[0]),
  ).toBe(true);
  await settle();
}

describe("黑白棋联机协议与双端对局", () => {
  it("走法只接收八乘八整数坐标且拒绝附带字段", () => {
    expect(parseReversiMove({ row: 2, col: 3 })).toEqual({ row: 2, col: 3 });
    for (const value of [
      null,
      [],
      { row: 8, col: 0 },
      { row: 2.2, col: 3 },
      { row: 2, col: "3" },
      { row: 2, col: 3, seat: 1 },
    ])
      expect(parseReversiMove(value)).toBe(null);
  });

  it("双方落子翻子同步，悔棋拒绝与同意均正确，重复响应不二次回退", async () => {
    const { host, guest, a } = pair();
    await play(host);
    await play(guest);
    expect(stateOf(host)).toEqual(stateOf(guest));
    host.requestUndo(
      undoPliesFor(host.getSnapshot().match.runner.getCheckpoint(), 0),
    );
    await settle();
    expect(
      host.getSnapshot().match.local.submit(legalMoves(stateOf(host))[0]),
    ).toBe(false);
    guest.respondUndo(false);
    await settle();
    expect(stateOf(host).moveCount).toBe(2);
    host.requestUndo(2);
    await settle();
    guest.respondUndo(true);
    await settle();
    expect(stateOf(host)).toEqual(createInitialReversiState());
    expect(stateOf(host)).toEqual(stateOf(guest));
    const response = a.peer?.controls.at(-1);
    expect(response).toBeDefined();
    if (response) a.controlHandlers.forEach((handler) => handler(response));
    await settle();
    expect(host.getSnapshot().revision).toBe(1);
    await play(host);
    expect(stateOf(host)).toEqual(stateOf(guest));
  });

  it("自动跳过后同一玩家连续落子，终局重赛交换执色", async () => {
    const board = Array<Stone>(64).fill(0);
    board[0] = board[7] = null;
    board[1] = board[6] = 1;
    const initial = () => ({
      ...createInitialReversiState(),
      board: [...board],
      moveCount: 58,
    });
    const { host, guest } = pair(initial);
    await play(host);
    expect(stateOf(host).passedSeat).toBe(1);
    expect(stateOf(host)).toEqual(stateOf(guest));
    await play(host);
    expect(stateOf(host).finished).toBe(true);
    expect(stateOf(host)).toEqual(stateOf(guest));
    host.requestRematch();
    await settle();
    guest.respondRematch(false);
    await settle();
    expect(host.getSnapshot().round).toBe(0);
    host.requestRematch();
    await settle();
    guest.respondRematch(true);
    await settle();
    expect(host.getSnapshot().round).toBe(1);
    expect(host.getSnapshot().localSeat).toBe(1);
    expect(guest.getSnapshot().localSeat).toBe(0);
    expect(stateOf(host)).toEqual(stateOf(guest));
    await play(guest);
    expect(stateOf(host)).toEqual(stateOf(guest));
  });

  it("完整双端对局每手哈希一致，旧帧不污染悔棋后的状态", async () => {
    const { host, guest, a, b } = pair();
    await play(host);
    const old = a.moves[0];
    host.requestUndo(1);
    await settle();
    guest.respondUndo(true);
    await settle();
    b.moveHandlers.forEach((handler) => handler(old));
    await settle();
    expect(stateOf(guest).moveCount).toBe(0);
    while (!stateOf(host).finished) {
      await play(stateOf(host).turnSeat === 0 ? host : guest);
      expect(REVERSI_ONLINE.hash(stateOf(host))).toBe(
        REVERSI_ONLINE.hash(stateOf(guest)),
      );
      expect(host.getSnapshot().end).toBe(null);
      expect(guest.getSnapshot().end).toBe(null);
    }
    expect(stateOf(host).moveCount).toBeLessThanOrEqual(60);
  });

  it("非法远端落子、状态哈希不符和对方离开会中止对局", async () => {
    const invalid = pair();
    invalid.b.moveHandlers.forEach((handler) =>
      handler({
        round: 0,
        revision: 0,
        seq: 0,
        seat: 0,
        move: { row: 0, col: 0 },
        stateHash: "invalid",
      }),
    );
    await settle();
    expect(invalid.guest.getSnapshot().end).toBe("desync");
    const mismatch = pair();
    mismatch.b.moveHandlers.forEach((handler) =>
      handler({
        round: 0,
        revision: 0,
        seq: 0,
        seat: 0,
        move: { row: 2, col: 3 },
        stateHash: "invalid",
      }),
    );
    await settle();
    expect(mismatch.guest.getSnapshot().end).toBe("desync");
    const departed = pair();
    departed.a.presenceHandlers.forEach((handler) => handler(false));
    await settle();
    expect(departed.host.getSnapshot().end).toBe("peer-left");
  });
});
