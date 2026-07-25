/**
 * Billiards AiStrategy: enumerate pot candidates geometrically (ghost
 * ball per target×pocket), aim with difficulty-scaled gaussian noise,
 * verify the best few with the real deterministic simulation, and pick
 * the highest-scoring outcome.
 *
 * Difficulty knobs: aim/power noise, how many candidates get simulated,
 * and whether position play for the next shot is scored.
 */
import {
  createRng,
  gaussian,
  yieldToUi,
  type AiStrategy,
  type Difficulty,
} from "../engine/ai";
import type { SeatIndex } from "../engine/types";
import { BALL_RADIUS, POCKETS, TABLE_H, TABLE_W } from "./constants";
import { insidePlayArea, overlapsAnyBall, simulateShot } from "./physics";
import {
  ballGroup,
  remainingGroupBalls,
  type BallState,
  type BilliardsMove,
  type BilliardsState,
} from "./types";

interface DifficultyProfile {
  angleSigma: number;
  powerSigma: number;
  simCandidates: number;
  positionPlay: boolean;
  /** Easy AI sometimes picks a deliberately worse candidate. */
  blunderChance: number;
}

const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    angleSigma: 0.03,
    powerSigma: 0.07,
    simCandidates: 4,
    positionPlay: false,
    blunderChance: 0.35,
  },
  medium: {
    angleSigma: 0.0095,
    powerSigma: 0.035,
    simCandidates: 7,
    positionPlay: false,
    blunderChance: 0.08,
  },
  hard: {
    angleSigma: 0.0022,
    powerSigma: 0.012,
    simCandidates: 10,
    positionPlay: true,
    blunderChance: 0,
  },
};

interface Vec {
  x: number;
  y: number;
}

function norm(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/** Is the corridor of width 2r from `a` to `b` free of other balls? */
function pathClear(
  balls: readonly BallState[],
  a: Vec,
  b: Vec,
  ignore: readonly number[],
): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-6) return true;
  const dir = { x: d.x / len, y: d.y / len };
  for (const ball of balls) {
    if (ball.potted || ignore.includes(ball.id)) continue;
    const w = { x: ball.x - a.x, y: ball.y - a.y };
    const proj = w.x * dir.x + w.y * dir.y;
    if (proj < 0 || proj > len) continue;
    const perp = Math.hypot(w.x - proj * dir.x, w.y - proj * dir.y);
    if (perp < BALL_RADIUS * 2 - 1e-4) return false;
  }
  return true;
}

/** Legal target ball ids for the seat in the current state. */
function targetBallIds(state: BilliardsState, seat: SeatIndex): number[] {
  const alive = state.balls.filter((b) => !b.potted && b.id !== 0);
  if (state.variant === "practice") return alive.map((b) => b.id);
  const group = state.groups[seat];
  if (group === null) return alive.filter((b) => b.id !== 8).map((b) => b.id);
  if (remainingGroupBalls(state, group) === 0) {
    return alive.filter((b) => b.id === 8).map((b) => b.id);
  }
  return alive.filter((b) => ballGroup(b.id) === group).map((b) => b.id);
}

interface Candidate {
  angle: number;
  power: number;
  /** Geometric plausibility, used for pre-ranking before simulation. */
  quality: number;
}

function potCandidates(
  balls: readonly BallState[],
  targetIds: readonly number[],
): Candidate[] {
  const cue = balls.find((b) => b.id === 0);
  if (!cue || cue.potted) return [];
  const out: Candidate[] = [];

  for (const id of targetIds) {
    const ball = balls.find((b) => b.id === id);
    if (!ball || ball.potted) continue;
    for (const pocket of POCKETS) {
      const toPocket = norm({ x: pocket.x - ball.x, y: pocket.y - ball.y });
      const ghost = {
        x: ball.x - toPocket.x * BALL_RADIUS * 2,
        y: ball.y - toPocket.y * BALL_RADIUS * 2,
      };
      const aim = norm({ x: ghost.x - cue.x, y: ghost.y - cue.y });
      // Cut angle: cos of angle between the aim line and the pot line.
      const cut = aim.x * toPocket.x + aim.y * toPocket.y;
      if (cut < 0.08) continue; // effectively impossible cut
      if (!pathClear(balls, cue, ghost, [0, id])) continue;
      if (!pathClear(balls, ball, pocket, [0, id])) continue;

      const dCue = Math.hypot(ghost.x - cue.x, ghost.y - cue.y);
      const dPocket = Math.hypot(pocket.x - ball.x, pocket.y - ball.y);
      const travel = dCue + dPocket / Math.max(cut, 0.25);
      const power = Math.min(
        0.95,
        Math.max(0.16, 0.14 + (travel / 3.4) * 0.75),
      );
      const quality =
        cut / (1 + dCue * 0.45 + dPocket * 0.6);
      out.push({
        angle: Math.atan2(ghost.y - cue.y, ghost.x - cue.x),
        power,
        quality,
      });
    }
  }
  return out.sort((a, b) => b.quality - a.quality);
}

/** Cheap post-state estimate of how promising the next shot would be. */
function positionScore(state: BilliardsState, seat: SeatIndex): number {
  const targets = targetBallIds(state, seat);
  const best = potCandidates(state.balls, targets)[0];
  return best ? best.quality : 0;
}

function stateSeed(state: BilliardsState): number {
  let h = state.turnSeat + 1;
  for (const ball of state.balls) {
    if (ball.potted) continue;
    h = (h * 31 + Math.round((ball.x + 2) * 1e4)) >>> 0;
    h = (h * 31 + Math.round((ball.y + 2) * 1e4)) >>> 0;
  }
  return h;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof DOMException
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }
}

function chooseCuePlacement(state: BilliardsState, seat: SeatIndex): Vec {
  const targets = targetBallIds(state, seat);
  const candidates: Vec[] = [];
  const nx = 9;
  const ny = 5;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      candidates.push({
        x: -TABLE_W / 2 + ((i + 0.5) / nx) * TABLE_W,
        y: -TABLE_H / 2 + ((j + 0.5) / ny) * TABLE_H,
      });
    }
  }
  let best: Vec | null = null;
  let bestQuality = -1;
  for (const pos of candidates) {
    if (!insidePlayArea(pos.x, pos.y)) continue;
    if (overlapsAnyBall(state.balls, pos.x, pos.y, 0)) continue;
    const balls = state.balls.map((b) =>
      b.id === 0 ? { ...b, x: pos.x, y: pos.y, potted: false } : b,
    );
    const top = potCandidates(balls, targets)[0];
    const quality = top ? top.quality : 0;
    if (quality > bestQuality) {
      bestQuality = quality;
      best = pos;
    }
  }
  return best ?? { x: 0, y: 0 };
}

export const billiardsAiStrategy: AiStrategy<BilliardsState, BilliardsMove> = {
  async chooseMove(state, seat, difficulty, signal) {
    throwIfAborted(signal);
    const profile = PROFILES[difficulty];
    const rng = createRng(stateSeed(state) ^ seat);

    if (state.ballInHand) {
      const spot = chooseCuePlacement(state, seat);
      return { type: "place-cue", x: spot.x, y: spot.y };
    }

    const cue = state.balls.find((b) => b.id === 0);
    if (!cue) throw new Error("billiards ai: cue missing");

    // Break: smash the rack apex.
    if (!state.breakDone) {
      const rack = state.balls.filter((b) => !b.potted && b.id !== 0);
      const apex = rack.reduce((a, b) => (a.x < b.x ? a : b));
      const angle =
        Math.atan2(apex.y - cue.y, apex.x - cue.x) +
        gaussian(rng) * profile.angleSigma * 2;
      return { type: "shot", angle, power: 1, followDraw: 0 };
    }

    const targets = targetBallIds(state, seat);
    const geometric = potCandidates(state.balls, targets);
    const pool = geometric.slice(0, profile.simCandidates);

    let bestMove: Extract<BilliardsMove, { type: "shot" }> | null = null;
    let bestScore = -Infinity;
    const scored: Array<{
      move: Extract<BilliardsMove, { type: "shot" }>;
      score: number;
    }> = [];

    for (const candidate of pool) {
      throwIfAborted(signal);
      const move = {
        type: "shot" as const,
        angle: candidate.angle + gaussian(rng) * profile.angleSigma,
        power: Math.min(
          1,
          Math.max(0.08, candidate.power + gaussian(rng) * profile.powerSigma),
        ),
        followDraw: 0,
      };
      const sim = simulateShot(state.balls, move);

      let score = 0;
      const ownPotted = sim.pottedInOrder.filter((id) =>
        targets.includes(id),
      ).length;
      score += ownPotted * 100;
      if (sim.cuePotted) score -= 320;
      if (sim.firstContact === null) score -= 160;
      const eightPotted = sim.pottedInOrder.includes(8);
      const onEight = targets.length === 1 && targets[0] === 8;
      if (eightPotted) score += onEight && !sim.cuePotted ? 900 : -1000;

      if (profile.positionPlay && ownPotted > 0 && !sim.cuePotted) {
        const after: BilliardsState = { ...state, balls: sim.balls };
        score += positionScore(after, seat) * 70;
      }
      score += candidate.quality * 10; // stable tiebreak toward easier shots

      scored.push({ move, score });
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      await yieldToUi();
    }

    // Easy AI occasionally takes a worse option on purpose.
    if (
      bestMove &&
      scored.length > 1 &&
      profile.blunderChance > 0 &&
      rng() < profile.blunderChance
    ) {
      const others = scored.filter((s) => s.move !== bestMove);
      bestMove = others[Math.floor(rng() * others.length)].move;
    }

    if (bestMove) return bestMove;

    // No pot available: nudge the nearest legal ball (crude safety).
    const fallbackTargets = targets.length > 0
      ? targets
      : state.balls.filter((b) => !b.potted && b.id !== 0).map((b) => b.id);
    const nearest = fallbackTargets
      .map((id) => state.balls.find((b) => b.id === id))
      .filter((b): b is BallState => !!b)
      .reduce((a, b) =>
        Math.hypot(a.x - cue.x, a.y - cue.y) <
        Math.hypot(b.x - cue.x, b.y - cue.y)
          ? a
          : b,
      );
    return {
      type: "shot",
      angle:
        Math.atan2(nearest.y - cue.y, nearest.x - cue.x) +
        gaussian(rng) * profile.angleSigma,
      power: 0.3,
      followDraw: 0,
    };
  },
};
