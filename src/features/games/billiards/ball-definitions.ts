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
  0: "#f6f1e7",
  2: "#f7b500",
  3: "#1e7e34",
  4: "#854b2f",
  5: "#2158c4",
  6: "#ef8b9a",
  7: "#161616",
};

export function ballDefinition(
  id: number,
  equipment: EquipmentId,
): BallDefinition {
  if (equipment === "snooker")
    return {
      color: isRed(id) ? "#d93025" : snookerColors[id],
      number: null,
      striped: false,
      spottedCue: false,
      value: snookerValue(id),
    };
  return {
    color: BALL_HEX[id],
    number: id === 0 ? null : id,
    striped: id >= 9,
    spottedCue: id === 0,
    value: 0,
  };
}
