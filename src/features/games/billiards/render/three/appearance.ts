import type { EquipmentId } from "../../equipment";

type RGB = readonly [number, number, number];

interface TableAppearance {
  readonly cloth: RGB;
  readonly woodDark: RGB;
  readonly woodLight: RGB;
  readonly metal: number;
  readonly net: number;
}

// 中式八球保留已确认的材质参数；另外两种桌按各自参考图选色。
const pool: TableAppearance = {
  cloth: [3, 80, 60],
  woodDark: [20, 5, 2],
  woodLight: [106, 40, 18],
  metal: 0xffffff,
  net: 0x040403,
};
const snooker: TableAppearance = {
  cloth: [2, 88, 20],
  woodDark: [25, 6, 2],
  woodLight: [130, 43, 16],
  metal: 0xffecc0,
  net: 0x403e34,
};

export function tableAppearance(id: EquipmentId): TableAppearance {
  return id === "snooker" ? snooker : pool;
}
