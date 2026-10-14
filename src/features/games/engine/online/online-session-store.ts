import { registerGameResource } from "../session-registry";
import { OnlineMatchController } from "./matchController";
import type { OnlineGame, OnlineTransport } from "./matchTypes";
import { RoomOwner } from "./roomOwner";

const rooms = new Map<string, { dispose(): void; close(): Promise<void> }>();
const controllers = new WeakMap<object, unknown>();

class OnlineRoomSession<State, Move, Presentation> {
  readonly owner = new RoomOwner<Move>();
  private off: (() => void) | undefined;
  private release: (() => void) | undefined;
  private transport: OnlineTransport<Move> | undefined;
  private controller:
    OnlineMatchController<State, Move, Presentation> | undefined;
  private unregister: (() => void) | undefined;

  constructor(
    private readonly definition: OnlineGame<State, Move, Presentation>,
  ) {}

  activate(): void {
    if (this.off) return;
    this.off = this.owner.subscribe(() => this.sync());
    this.unregister = registerGameResource({
      foreground: () => {},
      dispose: () => this.dispose(),
    });
    this.owner.activate();
    this.sync();
  }

  private sync(): void {
    const transport = this.owner.getSnapshot().ready?.session;
    if (transport === this.transport) return;
    this.releaseController();
    if (!transport) return;
    this.transport = transport;
    const controller = new OnlineMatchController(transport, this.definition);
    this.controller = controller;
    controllers.set(transport, controller);
    this.release = controller.retain();
  }

  private releaseController(): void {
    if (this.transport) controllers.delete(this.transport);
    this.release?.();
    this.controller?.dispose();
    this.release = undefined;
    this.controller = undefined;
    this.transport = undefined;
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    this.unregister?.();
    this.unregister = undefined;
    this.releaseController();
    this.owner.dispose();
  }

  async close(): Promise<void> {
    await this.owner.close();
    this.dispose();
  }
}

export function onlineRoomSession<State, Move, Presentation>(
  gameId: string,
  definition: OnlineGame<State, Move, Presentation>,
) {
  const existing = rooms.get(gameId);
  if (existing) return existing as OnlineRoomSession<State, Move, Presentation>;
  const session = new OnlineRoomSession(definition);
  rooms.set(gameId, session);
  return session;
}

export function retainedOnlineController<State, Move, Presentation>(
  transport: OnlineTransport<Move>,
): OnlineMatchController<State, Move, Presentation> {
  const controller = controllers.get(transport);
  if (!controller)
    throw new Error("Online game controller is not attached to a room");
  return controller as OnlineMatchController<State, Move, Presentation>;
}

export async function exitOnlineRoom(gameId: string): Promise<void> {
  const room = rooms.get(gameId);
  if (!room) return;
  await room.close();
  if (rooms.get(gameId) === room) rooms.delete(gameId);
}
