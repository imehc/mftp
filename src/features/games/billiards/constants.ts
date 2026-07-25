/**
 * Billiards table geometry and physics tuning. Units are meters and
 * seconds (a 9-foot table); the renderer applies its own pixel scale.
 *
 * Everything here feeds the deterministic simulation — changing a value
 * changes shot outcomes, which will matter for online lockstep (both
 * peers must run identical constants).
 */

/** Playing surface (cushion face to cushion face), 9ft table. */
export const TABLE_W = 2.54;
export const TABLE_H = 1.27;

/**
 * Arcade-proportioned ball: a to-scale 57mm ball reads far too small in
 * a top-down view, so like most billiards games we render (and simulate)
 * an enlarged ball. Pocket mouths below are sized relative to this.
 */
export const BALL_RADIUS = 0.042;
export const BALL_MASS = 0.17; // kg

/** Fixed simulation timestep. Both live play and AI evaluation use it. */
export const FIXED_DT = 1 / 120;
/** A ball slower than this (m/s) is considered stopped. */
export const STOP_SPEED = 0.02;
/** Safety cap so a pathological shot can't simulate forever. */
export const MAX_SIM_SECONDS = 40;

/** Cloth rolling resistance approximation (rapier linear damping). */
export const LINEAR_DAMPING = 0.72;
export const ANGULAR_DAMPING = 1.2;
export const BALL_RESTITUTION = 0.94;
export const BALL_FRICTION = 0.06;
export const CUSHION_RESTITUTION = 0.7;
export const CUSHION_FRICTION = 0.14;

/** Cue speed (m/s) at power = 1 — roughly a hard break. */
export const MAX_SHOT_SPEED = 8.5;
/** Extra impulse factor for follow/draw (高低杆), applied at first contact. */
export const FOLLOW_DRAW_FACTOR = 0.55;

/** Cushion collider thickness (extends outward from the play area). */
export const CUSHION_THICKNESS = 0.06;
/** Pocket mouth: cushion inner face setback from each pocket center. */
export const CORNER_MOUTH = 0.1;
export const SIDE_MOUTH = 0.084;

export interface PocketSpec {
  id: number;
  x: number;
  y: number;
  /** Visual mouth radius; capture uses POCKET_CAPTURE_SCALE of this. */
  radius: number;
}

/**
 * Capture sensor = radius * this scale: the ball must genuinely enter
 * the mouth before it falls; at 1.0 a ball grazing the cushion line
 * near a pocket would get sucked in from the table surface.
 */
export const POCKET_CAPTURE_SCALE = 0.72;

const CORNER_OFFSET = 0.024;
const CORNER_POCKET_RADIUS = 0.098;
const SIDE_POCKET_RADIUS = 0.084;

export const POCKETS: readonly PocketSpec[] = [
  // Corners (offset outward along the diagonal).
  ...[-1, 1].flatMap((sx) =>
    [-1, 1].map((sy, i) => ({
      id: (sx < 0 ? 0 : 2) + i,
      x: sx * (TABLE_W / 2 + CORNER_OFFSET),
      y: sy * (TABLE_H / 2 + CORNER_OFFSET),
      radius: CORNER_POCKET_RADIUS,
    })),
  ),
  // Side pockets on the long rails.
  { id: 4, x: 0, y: -(TABLE_H / 2 + 0.042), radius: SIDE_POCKET_RADIUS },
  { id: 5, x: 0, y: TABLE_H / 2 + 0.042, radius: SIDE_POCKET_RADIUS },
];

/** Foot spot: rack apex / 8-ball respot position. */
export const FOOT_SPOT_X = TABLE_W / 4;
/** Head string: cue ball starts here; break placement zone is behind it. */
export const HEAD_SPOT_X = -TABLE_W / 4;

/**
 * Static 8-ball rack layout (row by row from the apex): 8 centered in
 * the third row, one solid and one stripe on the back corners. Fixed
 * (not shuffled) to keep initial state deterministic.
 */
export const RACK_LAYOUT: readonly (readonly number[])[] = [
  [1],
  [9, 2],
  [3, 8, 10],
  [11, 7, 14, 4],
  [5, 13, 15, 6, 12],
];
