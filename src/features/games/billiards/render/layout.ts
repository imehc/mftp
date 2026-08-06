/**
 * Shared world→pixel layout for the table renderer. Kept separate from
 * ./table so the procedural painter can use it without a circular import.
 */
import { CUSHION_THICKNESS, TABLE_H, TABLE_W } from "../constants";

/** Pixels per meter at root scale 1 (text stays crisp when downscaled). */
export const PPM = 320;
/** Wood frame width beyond the cushions, meters. */
export const FRAME = 0.09;
/** Outer half-extents of the drawn table (wood frame included), meters. */
export const OUTER_W = TABLE_W / 2 + CUSHION_THICKNESS + FRAME;
export const OUTER_H = TABLE_H / 2 + CUSHION_THICKNESS + FRAME;

export const px = (m: number): number => m * PPM;
