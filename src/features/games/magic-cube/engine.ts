import {
  type Axis,
  type CubeMove,
  type CubeOrder,
  type CubeState,
  type Face,
  FACES,
  NORMALS,
  type Vector,
} from "./types";

export function createCube(order: CubeOrder): CubeState {
  const cubies: CubeState["cubies"] = [];
  for (let x = 0; x < order; x++) {
    for (let y = 0; y < order; y++) {
      for (let z = 0; z < order; z++) {
        const position: Vector = [x, y, z];
        if (!position.some((n) => n === 0 || n === order - 1)) continue;
        cubies.push({
          id: x * order * order + y * order + z,
          position,
          colors: FACES.map((face, index) => {
            const axis = Math.floor(index / 2);
            return position[axis] === (index % 2 ? 0 : order - 1) ? face : null;
          }),
        });
      }
    }
  }
  return { order, cubies };
}

/** 使用整数置换，长期转动不积累矩阵误差；法向量使用相同的右手旋转。 */
export function rotateVector(
  [x, y, z]: Vector,
  axis: Axis,
  extent = 0,
): Vector {
  if (axis === 0) return [x, extent - z, y];
  if (axis === 1) return [z, y, extent - x];
  return [extent - y, x, z];
}

export function validMove(move: CubeMove, order: number): boolean {
  return (
    [0, 1, 2].includes(move.axis) &&
    Number.isInteger(move.layer) &&
    move.layer >= 0 &&
    move.layer < order &&
    [-1, 1, 2].includes(move.turns)
  );
}

export function applyMove(state: CubeState, move: CubeMove): CubeState {
  if (!validMove(move, state.order)) return state;
  const count = (move.turns + 4) % 4;
  return {
    order: state.order,
    cubies: state.cubies.map((cubie) => {
      if (cubie.position[move.axis] !== move.layer) return cubie;
      let position = cubie.position;
      let colors = cubie.colors;
      for (let i = 0; i < count; i++) {
        position = rotateVector(position, move.axis, state.order - 1);
        const next: (Face | null)[] = Array(6).fill(null);
        NORMALS.forEach((normal, face) => {
          const rotated = rotateVector(normal, move.axis);
          const target = NORMALS.findIndex((n) =>
            n.every((v, j) => v === rotated[j]),
          );
          next[target] = colors[face];
        });
        colors = next;
      }
      return { ...cubie, position, colors };
    }),
  };
}

export function inverseMove(move: CubeMove): CubeMove {
  return { ...move, turns: move.turns === 2 ? 2 : move.turns === 1 ? -1 : 1 };
}

export function faceMove(
  face: Face,
  depth: number,
  clockwise: boolean,
  order: CubeOrder,
): CubeMove {
  const index = FACES.indexOf(face);
  const positive = index % 2 === 0;
  return {
    axis: Math.floor(index / 2) as Axis,
    layer: positive ? order - depth : depth - 1,
    turns: clockwise === positive ? -1 : 1,
  };
}

export function isSolved(state: CubeState): boolean {
  return FACES.every((_, index) => {
    const colors = state.cubies
      .map((c) => c.colors[index])
      .filter((c) => c !== null);
    return (
      colors.length === state.order ** 2 && colors.every((c) => c === colors[0])
    );
  });
}

export function scrambleMoves(
  order: CubeOrder,
  random = Math.random,
): CubeMove[] {
  const moves: CubeMove[] = [];
  for (let i = 0; i < order * 12; i++) {
    // 相邻动作换轴，避免直接抵消；各层均有机会被打乱，不冒充比赛随机状态抽样。
    const previous = moves.at(-1)?.axis;
    const axes = ([0, 1, 2] as const).filter((axis) => axis !== previous);
    moves.push({
      axis: axes[Math.floor(random() * axes.length)],
      layer: Math.floor(random() * order),
      turns: ([-1, 1, 2] as const)[Math.floor(random() * 3)],
    });
  }
  return moves;
}

export function scrambleCube(order: CubeOrder): CubeState {
  const state = scrambleMoves(order).reduce(applyMove, createCube(order));
  return isSolved(state)
    ? applyMove(state, { axis: 0, layer: 0, turns: 1 })
    : state;
}
