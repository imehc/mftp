/**
 * 球桌渲染器共用的世界→像素布局。与 ./table 分离，以便程序化绘制者
 * 在使用时不会产生循环依赖。
 */
import { CHINESE_EIGHT, type TableEquipment } from "../equipment";

/** 根缩放为 1 时每米对应像素（缩小时文字保持清晰）。 */
export const PPM = 320;

export function tableLayout(equipment: TableEquipment) {
  return {
    FRAME: equipment.frameWidth,
    CORNER_RADIUS: equipment.frameWidth * 0.9,
    OUTER_W:
      equipment.tableWidth / 2 + equipment.cushionWidth + equipment.frameWidth,
    OUTER_H:
      equipment.tableHeight / 2 + equipment.cushionWidth + equipment.frameWidth,
  };
}

export const { FRAME, OUTER_W, OUTER_H } = tableLayout(CHINESE_EIGHT);

export const px = (m: number): number => m * PPM;
