import { RoomOwner } from "../engine/online/roomOwner";
import type { OnlineMatchSession } from "../engine/online/session";
import { registerGameResource } from "../engine/session-registry";
import { JunqiOnlineController } from "./online-controller";
import type { JunqiFrame } from "./online-protocol";
import type { JunqiVariant } from "./types";

class JunqiRoom {
  readonly owner = new RoomOwner<JunqiFrame>("direct");
  controller: JunqiOnlineController | null = null;
  private transport: OnlineMatchSession<JunqiFrame> | null = null;
  private off: (() => void) | undefined;
  private unregister: (() => void) | undefined;

  constructor(private readonly variant: JunqiVariant) {}

  activate() {
    if (this.off) return;
    this.off = this.owner.subscribe(() => this.sync());
    this.unregister = registerGameResource({
      foreground: () => {},
      dispose: () => this.dispose(),
    });
    this.owner.activate();
    this.sync();
  }

  private sync() {
    const session = this.owner.getSnapshot().ready?.session ?? null;
    if (session === this.transport) return;
    this.controller?.dispose();
    this.controller = null;
    this.transport = session;
    if (session) {
      this.controller = new JunqiOnlineController(
        {
          localSeat: session.localSeat === 1 ? 1 : 0,
          matchId: session.matchId,
          sendMessage: (frame) => session.sendMessage(frame),
          onMessage: (handler) => session.onMessage(handler),
          onPeerPresence: (handler) => session.onPeerPresence(handler),
          onClosed: (handler) => session.onClosed(handler),
        },
        this.variant,
      );
      this.controller.start();
    }
  }

  dispose() {
    this.off?.();
    this.off = undefined;
    this.unregister?.();
    this.unregister = undefined;
    this.controller?.dispose();
    this.controller = null;
    this.transport = null;
    this.owner.dispose();
  }

  async close() {
    await this.owner.close();
    this.dispose();
  }
}

const rooms = new Map<JunqiVariant, JunqiRoom>();

export function junqiRoom(variant: JunqiVariant) {
  let room = rooms.get(variant);
  if (!room) {
    room = new JunqiRoom(variant);
    rooms.set(variant, room);
  }
  return room;
}

export async function exitJunqiRoom(variant: JunqiVariant) {
  const room = rooms.get(variant);
  if (!room) return;
  await room.close();
  if (rooms.get(variant) === room) rooms.delete(variant);
}
