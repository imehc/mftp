export const ORDERS = [2, 3, 4, 5, 6, 7] as const;

export type CubeOrder = (typeof ORDERS)[number];

export const FACES = ["R", "L", "U", "D", "F", "B"] as const;

export type Face = (typeof FACES)[number];

export type Axis = 0 | 1 | 2;

export type Vector = [number, number, number];

export type Turn = -1 | 1 | 2;

export interface CubeMove {
  axis: Axis;
  layer: number;
  turns: Turn;
}

export interface Cubie {
  id: number;
  position: Vector;
  colors: (Face | null)[];
}

export interface CubeState {
  order: CubeOrder;
  cubies: Cubie[];
}

export const NORMALS: Vector[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface CubeRecord {
  order: CubeOrder;
  elapsedMs: number;
  moves: number;
  assisted: boolean;
}
