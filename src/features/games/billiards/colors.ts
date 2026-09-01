/**
 * 标准台球颜色，由 Pixi 舞台与 HUD 球托盘共用，以保证两边始终一致。
 */
export const BALL_HEX: Record<number, string> = {
  0: "#f6f1e7",
  1: "#f7b500",
  9: "#f7b500",
  2: "#2158c4",
  10: "#2158c4",
  3: "#d93025",
  11: "#d93025",
  4: "#7a3e9d",
  12: "#7a3e9d",
  5: "#f28211",
  13: "#f28211",
  6: "#1e7e34",
  14: "#1e7e34",
  7: "#8b2320",
  15: "#8b2320",
  8: "#161616",
};

export function ballColorNumber(id: number): number {
  return parseInt((BALL_HEX[id] ?? "#ffffff").slice(1), 16);
}
