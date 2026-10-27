import type { Side } from "./types";

export const COLS = 5;
export const ROWS = 12;
export const CELLS = 60;
export const rowOf = (index: number) => Math.floor(index / COLS);
export const colOf = (index: number) => index % COLS;
export const validCell = (index: number) =>
  Number.isInteger(index) && index >= 0 && index < CELLS;
export const homeSide = (index: number): Side => (index < 30 ? 1 : 0);
export const frontDistance = (index: number) =>
  index < 30 ? 5 - rowOf(index) : rowOf(index) - 6;

export const isCamp = (index: number) => {
  const distance = frontDistance(index);
  const col = colOf(index);
  return (
    (distance === 2 && col === 2) ||
    ((distance === 1 || distance === 3) && (col === 1 || col === 3))
  );
};

export const isHeadquarters = (index: number) =>
  frontDistance(index) === 5 && (colOf(index) === 1 || colOf(index) === 3);

export interface Edge {
  from: number;
  to: number;
  rail: boolean;
}

function createEdges(): Edge[] {
  const edges: Edge[] = [];
  for (let from = 0; from < CELLS; from++) {
    for (let to = from + 1; to < CELLS; to++) {
      const r1 = rowOf(from),
        r2 = rowOf(to),
        c1 = colOf(from),
        c2 = colOf(to);
      const dr = r2 - r1,
        dc = Math.abs(c2 - c1);
      if (homeSide(from) !== homeSide(to)) {
        if (r1 === 5 && r2 === 6 && c1 === c2 && c1 % 2 === 0)
          edges.push({ from, to, rail: true });
        continue;
      }
      if (dr + dc === 1) {
        const rail =
          r1 === r2
            ? [1, 5, 6, 10].includes(r1)
            : c1 === c2 && (c1 === 0 || c1 === 4) && r1 !== 0 && r2 !== 11;
        edges.push({ from, to, rail });
      } else if (dr === 1 && dc === 1 && (isCamp(from) || isCamp(to))) {
        edges.push({ from, to, rail: false });
      }
    }
  }
  return edges;
}

export const BOARD_EDGES = createEdges();
export const ROAD_NEIGHBORS = Array.from({ length: CELLS }, (_, index) =>
  BOARD_EDGES.flatMap(({ from, to }) =>
    from === index ? [to] : to === index ? [from] : [],
  ),
);
export const RAIL_NEIGHBORS = Array.from({ length: CELLS }, (_, index) =>
  BOARD_EDGES.flatMap(({ from, to, rail }) =>
    !rail ? [] : from === index ? [to] : to === index ? [from] : [],
  ),
);
