import { Toaster } from "~/components/ui/sonner";

/**
 * 台球状态提示使用独立的顶部中间消息容器，通过 `toasterId` 与应用全局
 * 右下角消息隔离，互不影响；`expand` 让同时展示的提示全部展开、互不遮挡。
 */
export const BILLIARDS_TOASTER_ID = "billiards";
/** 台球提示同时最多展示的条数，超出时最早出现的一条立即消失。 */
export const BILLIARDS_VISIBLE_NOTICES = 2;
/** 台球提示的默认展示时长（毫秒）。 */
export const BILLIARDS_NOTICE_DURATION = 3000;

export function BilliardsToaster() {
  return (
    <Toaster
      id={BILLIARDS_TOASTER_ID}
      position="top-center"
      expand
      visibleToasts={BILLIARDS_VISIBLE_NOTICES}
    />
  );
}
