import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { CjkFont } from "~/lib/color-theme";

/**
 * 字体选项文案。字体名是专有名词，只有「系统默认」需要按语言翻译；
 * 集中在此处，避免设置页与快捷菜单各维护一份映射。
 */
export const fontOptionLabels: Record<CjkFont, MessageDescriptor> = {
  system: msg`系统默认`,
  wenkai: msg`霞鹜文楷`,
  kuaile: msg`站酷快乐体`,
  longcang: msg`龙藏体`,
  pixel: msg`像素字体`,
};
