import type { GameRoomSummary } from "~/bindings";
export const sent: string[] = [];
export const sentInstances: string[] = [];
export const leftInstances: string[] = [];
export let leaves = 0;
let leave: (id: string) => Promise<void> = async () => {};
let discover: (game: string) => Promise<GameRoomSummary[]> = async () => [];
export function onLeave(handler: typeof leave) {
  leave = handler;
}
export function onDiscover(handler: typeof discover) {
  discover = handler;
}
export function resetIpc() {
  sent.length = 0;
  sentInstances.length = 0;
  leftInstances.length = 0;
  leaves = 0;
  leave = async () => {};
  discover = async () => [];
}
export async function gameRoomSend(instanceId: string, payload: string) {
  sentInstances.push(instanceId);
  sent.push(payload);
}
export async function gameRoomLeave(instanceId: string) {
  leaves++;
  leftInstances.push(instanceId);
  await leave(instanceId);
}
export const gameRoomDiscover = (gameId: string) => discover(gameId);
