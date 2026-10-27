import type { PieceKind } from "./types";

export const RANK: Record<PieceKind, number> = {
  commander: 9,
  general: 8,
  division: 7,
  brigade: 6,
  regiment: 5,
  battalion: 4,
  company: 3,
  platoon: 2,
  engineer: 1,
  mine: 0,
  bomb: 0,
  flag: 0,
};

export function combat(
  attacker: PieceKind,
  defender: PieceKind,
): "attacker" | "defender" | "both" {
  if (defender === "flag") return "attacker";
  if (attacker === "bomb" || defender === "bomb") return "both";
  if (defender === "mine")
    return attacker === "engineer" ? "attacker" : "defender";
  return RANK[attacker] === RANK[defender]
    ? "both"
    : RANK[attacker] > RANK[defender]
      ? "attacker"
      : "defender";
}
