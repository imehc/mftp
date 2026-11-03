import type { Difficulty } from "./ai";
import type { ControllerKind, SeatIndex } from "./types";

export type SeatConfiguration = (
  | { kind: "local" }
  | { kind: "computer"; difficulty: Difficulty }
  | { kind: "remote"; memberId: string }
) & { seat: SeatIndex; teamId?: string };

/** 此信息可进入参与者快照，不含其他座位的私有状态或连接身份。 */
export interface ParticipantSummary {
  seat: SeatIndex;
  kind: ControllerKind;
  teamId?: string;
}

export interface ParticipantConfiguration {
  version: 1;
  seats: readonly SeatConfiguration[];
  viewerSeat: SeatIndex | "active";
}

export function validateSeat(seat: SeatIndex, seatCount: number): void {
  if (!Number.isSafeInteger(seat) || seat < 0 || seat >= seatCount)
    throw new Error("Game participant seat is outside the match");
}

export function validateParticipants(
  configuration: ParticipantConfiguration,
  seatCount: number,
): void {
  if (
    !Number.isSafeInteger(seatCount) ||
    seatCount < 1 ||
    seatCount > 64 ||
    configuration.version !== 1 ||
    configuration.seats.length !== seatCount
  )
    throw new Error("Invalid game participant configuration");
  const occupied = new Set<SeatIndex>();
  for (const participant of configuration.seats) {
    validateSeat(participant.seat, seatCount);
    if (occupied.has(participant.seat))
      throw new Error("Duplicate game participant seat");
    occupied.add(participant.seat);
    if (
      participant.teamId !== undefined &&
      (!participant.teamId || participant.teamId.length > 128)
    )
      throw new Error("Invalid game participant team");
  }
  if (configuration.viewerSeat !== "active")
    validateSeat(configuration.viewerSeat, seatCount);
}
