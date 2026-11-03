import type { GamePartyEvent, GamePartyStatus } from "~/bindings";
import { listenGameParty } from "~/lib/events";
import { gamePartyResume, gameRoomLeave } from "~/lib/ipc";

import { registerGameResource } from "../session-registry";

interface PartyEndpoint {
  receive(event: GamePartyEvent): void;
  pause?(): void;
  reconnected?(status: GamePartyStatus): void;
  disconnect?(): void;
  dispose(): void;
}

interface ConnectionServices {
  listen: typeof listenGameParty;
  resume: typeof gamePartyResume;
  leave: typeof gameRoomLeave;
}

/** 页面显式持有房间生命周期；切页暂停，恢复认证只由用户动作调用。 */
export class PartyConnection {
  private disposed = false;
  private stopListening: (() => void) | null = null;
  private attaching: Promise<void> | null = null;
  private reconnecting = false;
  private buffered: GamePartyEvent[] = [];
  private overflow = false;
  private unregister: (() => void) | null = null;

  constructor(
    private readonly instanceId: string,
    private readonly endpoint: PartyEndpoint,
    private readonly services: ConnectionServices = {
      listen: listenGameParty,
      resume: gamePartyResume,
      leave: gameRoomLeave,
    },
  ) {}

  attach(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.unregister ??= registerGameResource({
      foreground: (visible) => {
        if (!visible) this.endpoint.pause?.();
      },
      dispose: () => this.dispose(),
    });
    this.attaching ??= this.services
      .listen((event) => {
        if (this.disposed || event.instanceId !== this.instanceId) return;
        if (this.reconnecting) {
          if (this.buffered.length < 32) this.buffered.push(event);
          else this.overflow = true;
        } else this.endpoint.receive(event);
      })
      .then((stop) => {
        if (this.disposed) stop();
        else this.stopListening = stop;
      });
    return this.attaching;
  }

  async reconnect(): Promise<void> {
    if (this.disposed || this.reconnecting) return;
    this.reconnecting = true;
    this.endpoint.disconnect?.();
    try {
      await this.attach();
      const status = await this.services.resume(this.instanceId);
      if (!this.disposed) {
        if (this.overflow) throw new Error("Recovery event buffer exceeded");
        this.endpoint.reconnected?.(status);
        for (const event of this.buffered) this.endpoint.receive(event);
      }
    } finally {
      this.reconnecting = false;
      this.buffered = [];
      this.overflow = false;
    }
  }

  async close(): Promise<void> {
    this.dispose();
    await this.services.leave(this.instanceId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endpoint.pause?.();
    this.stopListening?.();
    this.stopListening = null;
    this.unregister?.();
    this.unregister = null;
    this.endpoint.dispose();
  }
}
