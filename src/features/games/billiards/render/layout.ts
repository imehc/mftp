/**
 * 球桌渲染器共用的世界→像素布局。与 ./table 分离，以便程序化绘制者
 * 在使用时不会产生循环依赖。
 */
import { CUSHION_THICKNESS, TABLE_H, TABLE_W } from "../constants";

/** 根缩放为 1 时每米对应像素（缩小时文字保持清晰）。 */
export const PPM = 320;
/** 库边之外的木框宽度，单位为米。 */
export const FRAME = 0.09;
/** 所绘球桌的外半圆边长（含木框），单位为米。 */
export const OUTER_W = TABLE_W / 2 + CUSHION_THICKNESS + FRAME;
export const OUTER_H = TABLE_H / 2 + CUSHION_THICKNESS + FRAME;

export const px = (m: number): number => m * PPM;
