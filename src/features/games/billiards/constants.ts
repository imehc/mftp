/**
 * 台球桌几何与物理调参。单位为米与秒（9 英尺球桌）；渲染器自行
 * 套用像素比例。
 *
 * 这里的一切都喂给确定性模拟——改任一数值都会改变击球结果，
 * 这会影响到联机锁步（双方必须运行完全一致的常量）。
 */

/** 台面（库边内沿到内沿），9 英尺球桌。 */
export const TABLE_W = 2.54;
export const TABLE_H = 1.27;

/**
 * 美式球直径 57.15mm。渲染、碰撞、摆球和瞄准均使用相同半径。
 */
export const BALL_RADIUS = 0.028575;
export const BALL_MASS = 0.17; // kg

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

/** 库边碰撞体厚度（从台面区域向外延伸）。 */
export const CUSHION_THICKNESS = 0.06;
/** 袋口：库边内沿相对每个袋口中心的退让量。 */
export const CORNER_MOUTH = 0.085;
export const SIDE_MOUTH = 0.07;

export interface PocketSpec {
  id: number;
  x: number;
  y: number;
  /** 视觉袋口半径；落袋判定取该值的 POCKET_CAPTURE_SCALE 倍。 */
  radius: number;
}

/**
 * 落袋感应区 = 半径 × 该比例：球必须先真正进到袋口才会落袋；若为 1.0，
 * 则擦着袋口附近库边线的球会被从台面上吸进去。由于每个袋口有
 * 颚点把守（见下），只有大致居中的球才能穿过去够到感应区。
 */
export const POCKET_CAPTURE_SCALE = 0.6;

/**
 * 袋口颚的倒圆尺度；共享轮廓同时参与库边碰撞和绘制，
 * 不再叠加视觉中不存在的圆形碰撞体。球心须越过袋口后才下沉。
 */
export const JAW_RADIUS = 0.009;

const CORNER_OFFSET = 0.024;
const CORNER_POCKET_RADIUS = 0.065;
const SIDE_POCKET_RADIUS = 0.06;

export const POCKETS: readonly PocketSpec[] = [
  // 角袋（沿对角线向外偏移）。
  ...[-1, 1].flatMap((sx) =>
    [-1, 1].map((sy, i) => ({
      id: (sx < 0 ? 0 : 2) + i,
      x: sx * (TABLE_W / 2 + CORNER_OFFSET),
      y: sy * (TABLE_H / 2 + CORNER_OFFSET),
      radius: CORNER_POCKET_RADIUS,
    })),
  ),
  // 长边上的中袋。
  { id: 4, x: 0, y: -(TABLE_H / 2 + 0.042), radius: SIDE_POCKET_RADIUS },
  { id: 5, x: 0, y: TABLE_H / 2 + 0.042, radius: SIDE_POCKET_RADIUS },
];

/** 脚点：球堆顶点 / 黑八重置位置。 */
export const FOOT_SPOT_X = TABLE_W / 4;
/** 头线：母球初始位置；开球放置区在其后方。 */
export const HEAD_SPOT_X = -TABLE_W / 4;

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
