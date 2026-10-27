import {
  JunqiOnlineController,
  type JunqiTransport,
} from "./online-controller";
import { type JunqiFrame, parseJunqiFrame } from "./online-protocol";
import type { JunqiVariant, Side } from "./types";

export async function flush() {
  for (let n = 0; n < 80; n++) await Promise.resolve();
}

export function pair(variant: JunqiVariant) {
  const listeners: (((frame: JunqiFrame) => void) | undefined)[] = [];
  const presence: (((connected: boolean) => void) | undefined)[] = [];
  const pending: JunqiFrame[][] = [[], []];
  const wire: { sender: Side; frame: JunqiFrame }[] = [];
  const transport = (seat: Side): JunqiTransport => ({
    localSeat: seat,
    matchId: "test-room",
    async sendMessage(frame) {
      const copy = parseJunqiFrame(JSON.parse(JSON.stringify(frame)));
      if (!copy) throw new Error("Invalid test frame");
      wire.push({ sender: seat, frame: copy });
      const other = 1 - seat;
      if (listeners[other]) listeners[other](copy);
      else pending[other].push(copy);
    },
    onMessage(handler) {
      listeners[seat] = handler;
      for (const frame of pending[seat].splice(0)) handler(frame);
      return () => {
        listeners[seat] = undefined;
      };
    },
    onPeerPresence(handler) {
      presence[seat] = handler;
      handler(true);
      return () => {
        presence[seat] = undefined;
      };
    },
    onClosed: () => () => {},
  });
  const channels = [transport(0), transport(1)] as const;
  let seed = 91;
  const host = new JunqiOnlineController(channels[0], variant, () => seed++);
  const guest = new JunqiOnlineController(channels[1], variant);
  host.start();
  guest.start();
  return {
    host,
    guest,
    wire,
    channels,
    disconnect: () => {
      presence[0]?.(false);
      presence[1]?.(false);
    },
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}
