/** 通用模拟参数，以及尚在迁移的中式八球常量门面。 */
import { CHINESE_EIGHT, createPocketSpecs } from "./equipment";

export type { PocketSpec } from "./equipment";

export const TABLE_EQUIPMENT = CHINESE_EIGHT;
export const TABLE_W = CHINESE_EIGHT.tableWidth;
export const TABLE_H = CHINESE_EIGHT.tableHeight;
export const BALL_RADIUS = CHINESE_EIGHT.ballRadius;
export const BALL_MASS = CHINESE_EIGHT.ballMass;
export const CUSHION_THICKNESS = CHINESE_EIGHT.cushionWidth;
export const CORNER_POCKET_WIDTH = CHINESE_EIGHT.corner.width;
export const SIDE_POCKET_WIDTH = CHINESE_EIGHT.side.width;
export const POCKETS = createPocketSpecs(CHINESE_EIGHT);
export const FOOT_SPOT_X = TABLE_W / 4;
export const HEAD_SPOT_X = -TABLE_W / 4;

/** 固定模拟步长。实时对局与 AI 评估都使用它。 */
export const FIXED_DT = 1 / 960;
/** 速度低于此值（米/秒）的球视为已停止。 */
export const STOP_SPEED = 0.008;
/** 安全上限，防止异常球局无限模拟下去。 */
export const MAX_SIM_SECONDS = 40;

/** 台呢滚动阻力近似（rapier 线性阻尼）。 */
export const LINEAR_DAMPING = 0.12;
/** 低速滚动阻力，避免指数衰减造成球在停止前长时间滑行。 */
export const ROLLING_DECELERATION = 0.2;
/** 呈现仅采样 120Hz，物理细分不增加回放内存。 */
export const FRAME_DT = 1 / 120;
export const ANGULAR_DAMPING = 1.2;
export const BALL_RESTITUTION = 0.94;
export const BALL_FRICTION = 0.035;
export const CUSHION_RESTITUTION = 0.78;
export const CUSHION_FRICTION = 0.14;

/** 力度为 1 时的母球速度（米/秒）——大致相当于一记大力开球。 */
export const MAX_SHOT_SPEED = 7.5;
/** 跟杆/缩杆的额外冲量系数，在首次接触时施加。 */
export const FOLLOW_DRAW_FACTOR = 0.48;

/**
 * 固定黑八摆球布局（从顶点起逐行）：黑八居中于第三行，后两角为
 * 一全色一花色。固定（不随机）以保证初始状态确定。
 */
export const RACK_LAYOUT: readonly (readonly number[])[] = [
  [1],
  [9, 2],
  [3, 8, 10],
  [11, 7, 14, 4],
  [5, 13, 15, 6, 12],
];
