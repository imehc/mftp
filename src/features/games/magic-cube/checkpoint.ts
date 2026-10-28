import { z } from "zod";

import { applyMove, createCube, isSolved } from "./engine";
import { type CubeState, FACES } from "./types";

export const MAX_HISTORY = 500;
const orderSchema = z.union([
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
const moveSchema = z.strictObject({
  axis: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  layer: z.number().int().min(0).max(6),
  turns: z.union([z.literal(-1), z.literal(1), z.literal(2)]),
});
const stateSchema = z.strictObject({
  order: orderSchema,
  cubies: z
    .array(
      z.strictObject({
        id: z.number().int().nonnegative(),
        position: z.tuple([
          z.number().int(),
          z.number().int(),
          z.number().int(),
        ]),
        colors: z.array(z.enum(FACES).nullable()).length(6),
      }),
    )
    .min(8)
    .max(218),
});

function validCube(state: CubeState): boolean {
  const initial = createCube(state.order);
  if (initial.cubies.length !== state.cubies.length) return false;
  const originals = new Map(initial.cubies.map((c) => [c.id, c]));
  const ids = new Set<number>();
  const positions = new Set<string>();
  for (const cubie of state.cubies) {
    const original = originals.get(cubie.id);
    if (!original || ids.has(cubie.id) || positions.has(cubie.position.join()))
      return false;
    ids.add(cubie.id);
    positions.add(cubie.position.join());
    if (cubie.position.some((p) => p < 0 || p >= state.order)) return false;
    if (
      cubie.colors.filter(Boolean).sort().join() !==
      original.colors.filter(Boolean).sort().join()
    )
      return false;
    for (let face = 0; face < 6; face++) {
      const boundary =
        cubie.position[Math.floor(face / 2)] ===
        (face % 2 ? 0 : state.order - 1);
      if (boundary !== (cubie.colors[face] !== null)) return false;
    }
  }
  return true;
}

export const cubeCheckpointSchema = z
  .strictObject({
    version: z.literal(1),
    gameId: z.literal("magic-cube"),
    id: z.string().uuid(),
    base: stateSchema,
    moves: z.array(moveSchema).max(MAX_HISTORY),
    cursor: z.number().int().nonnegative().max(MAX_HISTORY),
    offset: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative().finite(),
    challenge: z.boolean(),
    started: z.boolean(),
    completed: z.boolean(),
    assisted: z.boolean(),
  })
  .refine((value) => {
    if (
      !validCube(value.base) ||
      value.cursor > value.moves.length ||
      value.moves.some((move) => move.layer >= value.base.order)
    )
      return false;
    const state = value.moves
      .slice(0, value.cursor)
      .reduce(applyMove, value.base);
    return (
      !value.completed || (value.challenge && value.started && isSolved(state))
    );
  });

export type CubeCheckpoint = z.infer<typeof cubeCheckpointSchema>;

export function checkpointState(checkpoint: CubeCheckpoint): CubeState {
  return checkpoint.moves
    .slice(0, checkpoint.cursor)
    .reduce(applyMove, checkpoint.base);
}
