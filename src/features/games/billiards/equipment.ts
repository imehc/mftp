/** 米制器材配置。袋颚未公开的工程尺寸为项目近似，不冒称竞赛模板。 */
export type EquipmentId = "chinese-eight" | "american-nine" | "snooker";

export type PocketSettings =
  | Readonly<{
      shape: "round";
      width: number;
      jawRadius: number;
      rearFlare: number;
      supportDepth: number;
    }>
  | Readonly<{
      shape: "cut";
      width: number;
      cutAngle: number;
      shelf: number;
    }>;

export interface TableEquipment {
  readonly id: EquipmentId;
  readonly tableWidth: number;
  readonly tableHeight: number;
  readonly ballRadius: number;
  readonly ballMass: number;
  readonly cushionWidth: number;
  readonly frameWidth: number;
  readonly cueLength: number;
  readonly cueTipDiameter: number;
  readonly cueButtDiameter: number;
  readonly corner: PocketSettings;
  readonly side: PocketSettings;
}

const roundCorner = Object.freeze({
  shape: "round" as const,
  width: 0.085,
  jawRadius: 0.025,
  rearFlare: 0.0075,
  supportDepth: 0.012,
});
const roundSide = Object.freeze({
  shape: "round" as const,
  width: 0.095,
  jawRadius: 0.025,
  rearFlare: 0.0075,
  supportDepth: 0.035,
});

/** 用户已确认的中式1270mm台宽，与Heyball 2025的1260mm区分。 */
export const CHINESE_EIGHT = Object.freeze({
  id: "chinese-eight",
  tableWidth: 2.54,
  tableHeight: 1.27,
  ballRadius: 0.028575,
  ballMass: 0.17,
  cushionWidth: 0.06,
  frameWidth: 0.09,
  cueLength: 1.45,
  cueTipDiameter: 0.0125,
  cueButtDiameter: 0.03,
  corner: roundCorner,
  side: roundSide,
} as const satisfies TableEquipment);

/** WPA的mouth取库鼻转折点间距，不能当作圆弧袋颚的最窄处。 */
export const AMERICAN_NINE = Object.freeze({
  ...CHINESE_EIGHT,
  id: "american-nine",
  cushionWidth: 0.05,
  frameWidth: 0.1,
  cueLength: 1.473,
  cueTipDiameter: 0.013,
  corner: Object.freeze({
    shape: "cut",
    width: 0.1143,
    cutAngle: 142,
    shelf: 0.0381,
  } as const),
  side: Object.freeze({
    shape: "cut",
    width: 0.127,
    cutAngle: 104,
    shelf: 0.00635,
  } as const),
} as const satisfies TableEquipment);

/** 6/10/15红球共用器材；142g与85/95mm袋口属于项目选型。 */
export const SNOOKER = Object.freeze({
  ...CHINESE_EIGHT,
  id: "snooker",
  tableWidth: 3.569,
  tableHeight: 1.778,
  ballRadius: 0.02625,
  ballMass: 0.142,
  cushionWidth: 0.05,
  frameWidth: 0.1,
  cueTipDiameter: 0.0095,
  cueButtDiameter: 0.029,
} as const satisfies TableEquipment);

export const EQUIPMENT: Readonly<Record<EquipmentId, TableEquipment>> =
  Object.freeze({
    "chinese-eight": CHINESE_EIGHT,
    "american-nine": AMERICAN_NINE,
    snooker: SNOOKER,
  });

export interface PocketSpec {
  readonly id: number;
  readonly kind: "corner" | "side";
  /** 库鼻延长线交点，或长库中点。 */
  readonly originX: number;
  readonly originY: number;
  /** 指向袋后的单位轴，角袋为45°。 */
  readonly dx: number;
  readonly dy: number;
  /** AI入袋轴目标，不是隐藏感应圆的圆心。 */
  readonly x: number;
  readonly y: number;
}

export function createPocketSpecs(
  equipment: TableEquipment,
): readonly PocketSpec[] {
  return [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
    [0, -1],
    [0, 1],
  ].map(([sx, sy], id) => {
    const length = Math.hypot(sx, sy);
    const dx = sx / length;
    const dy = sy / length;
    const originX = (sx * equipment.tableWidth) / 2;
    const originY = (sy * equipment.tableHeight) / 2;
    return Object.freeze({
      id,
      kind: sx === 0 ? "side" : "corner",
      originX,
      originY,
      dx,
      dy,
      x: originX + dx * 0.06,
      y: originY + dy * 0.06,
    });
  });
}
