import { BALL_HEX } from "./colors";
import type { EquipmentId } from "./equipment";
import { isRed, snookerValue } from "./snooker-equipment";

export interface BallDefinition {
  color: string;
  number: number | null;
  striped: boolean;
  spottedCue: boolean;
  value: number;
}

const snookerColors: Readonly<Record<number, string>> = {
  0: "#f5efcf",
  2: "#f7b500",
  3: "#006446",
  4: "#743207",
  5: "#004ab3",
  6: "#ed729b",
  7: "#060607",
};

export function ballDefinition(
  id: number,
  equipment: EquipmentId,
): BallDefinition {
  if (equipment === "snooker")
    return {
      color: isRed(id) ? "#b7070e" : snookerColors[id],
      number: null,
      striped: false,
      spottedCue: false,
      value: snookerValue(id),
    };
  return {
    color: BALL_HEX[id],
    number: id === 0 ? null : id,
    striped: id >= 9,
    spottedCue: false,
    value: 0,
  };
}
