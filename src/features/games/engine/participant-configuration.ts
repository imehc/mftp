import type {
  ParticipantConfiguration,
  SeatConfiguration,
} from "./participants";

function identity(seat: SeatConfiguration) {
  const base = [seat.seat, seat.kind, seat.teamId ?? null];
  if (seat.kind === "computer") return [...base, seat.difficulty];
  if (seat.kind === "remote") return [...base, seat.memberId];
  return base;
}

/** 按明确字段比较，不依赖 JSON 对象或座位数组顺序。 */
export function sameParticipantConfiguration(
  left: ParticipantConfiguration,
  right: ParticipantConfiguration,
): boolean {
  const seats = (configuration: ParticipantConfiguration) =>
    [...configuration.seats].sort((a, b) => a.seat - b.seat).map(identity);
  return (
    left.version === right.version &&
    left.viewerSeat === right.viewerSeat &&
    JSON.stringify(seats(left)) === JSON.stringify(seats(right))
  );
}
