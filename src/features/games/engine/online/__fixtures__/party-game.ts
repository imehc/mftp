import { z } from "zod";

import type { GameOutcome } from "../../outcome";
import type { GameDefinition } from "../../types";
import type { PartyGameAdapter } from "../party-authority";

const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("call"), bid: z.boolean() }),
  z.strictObject({
    type: z.literal("play"),
    card: z.number().int().min(1).max(18),
  }),
]);
const eventSchema = z.strictObject({
  seat: z.number().int().min(0).max(2),
  action: actionSchema,
});
const observationSchema = z.strictObject({
  seat: z.number().int().min(0).max(2),
  hand: z.array(z.number().int().min(1).max(18)).max(2),
  counts: z.array(z.number().int().min(0).max(2)).length(3),
  phase: z.enum(["call", "play", "finished"]),
  turn: z.number().int().min(0).max(2),
  events: z.array(eventSchema).max(9),
});

export type CardAction = z.infer<typeof actionSchema>;

export type CardEvent = z.infer<typeof eventSchema>;

export type CardObservation = z.infer<typeof observationSchema>;

export interface CardState {
  seed: number;
  deck: number[];
  hands: number[][];
  phase: CardObservation["phase"];
  turn: number;
  events: CardEvent[];
}

/** 可重放随机发牌只保留在权威端，此规则样例不代表斗地主玩法。 */
export function deal(seed: number): CardState {
  const deck = Array.from({ length: 18 }, (_, index) => index + 1);
  let random = seed >>> 0;
  for (let index = deck.length - 1; index > 0; index--) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const target = random % (index + 1);
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return {
    seed,
    hands: [deck.splice(0, 2), deck.splice(0, 2), deck.splice(0, 2)],
    deck,
    phase: "call",
    turn: 0,
    events: [],
  };
}

export function chooseAction(observation: CardObservation): CardAction {
  return observation.phase === "call"
    ? { type: "call", bid: true }
    : { type: "play", card: observation.hand[0] };
}

export const cardAdapter: PartyGameAdapter<
  CardState,
  CardAction,
  CardObservation,
  CardEvent
> = {
  parseAction(value, observation, seat) {
    const action = actionSchema.parse(value);
    if (
      observation.seat !== seat ||
      observation.turn !== seat ||
      observation.phase !== action.type ||
      (action.type === "play" && !observation.hand.includes(action.card))
    )
      throw new Error("Illegal card action");
    return action;
  },
  publicEvent: (_state, action, seat) => ({ seat, action }),
  parseObservation: (value) => observationSchema.parse(value),
  parseEvent: (value) => eventSchema.parse(value),
};

export function cardGame(
  result: GameOutcome = {
    kind: "victory",
    winners: [{ kind: "team", teamId: "partners" }],
  },
): GameDefinition<CardState, CardAction, null, CardObservation> {
  return {
    id: "hidden-three-seat-fixture",
    version: 1,
    seatCount: 3,
    currentSeat: (state) => (state.phase === "finished" ? null : state.turn),
    isFinished: (state) => state.phase === "finished",
    outcome: (state) => (state.phase === "finished" ? result : null),
    observe: (state, seat) => ({
      seat,
      hand: [...state.hands[seat]],
      counts: state.hands.map((hand) => hand.length),
      phase: state.phase,
      turn: state.turn,
      events: state.events,
    }),
    applyMove(state, move, seat) {
      const observation = this.observe(state, seat);
      const action = cardAdapter.parseAction(move, observation, seat);
      const next = structuredClone(state);
      next.events.push({ seat, action });
      if (action.type === "play")
        next.hands[seat] = next.hands[seat].filter(
          (card) => card !== action.card,
        );
      next.turn = (seat + 1) % 3;
      if (next.events.length === 3) next.phase = "play";
      if (next.events.length === 9) next.phase = "finished";
      return { state: next, presentation: null };
    },
  };
}
